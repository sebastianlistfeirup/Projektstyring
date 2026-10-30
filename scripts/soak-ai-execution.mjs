// Offline execution endurance: serial coding, checkpoints, deliberate pause,
// resume in the same worktree and real final checks. No provider calls.
// ORBIT_SOAK_JOB_SECONDS=600 ORBIT_SOAK_JOBS=6 node scripts/soak-ai-execution.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { executeRun, activeRuns } from '../server/ai-runtime.mjs';
import { readRun } from '../server/ai-state.mjs';
import { setSecretsDir } from '../server/ai-services.mjs';

const seconds = Number(process.env.ORBIT_SOAK_JOB_SECONDS ?? 600), count = Number(process.env.ORBIT_SOAK_JOBS ?? 6);
if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3000 || !Number.isInteger(count) || count < 2 || count > 20) throw new Error('Choose 1–3000 seconds per job and 2–20 jobs.');
const root = mkdtempSync(join(tmpdir(), 'orbit-execution-soak-')), source = join(root, 'source');
const dirs = { cwd: join(root, 'context'), runs: join(root, 'runs'), memory: join(root, 'memory'), artifacts: join(root, 'artifacts') };
for (const dir of [source, ...Object.values(dirs)]) mkdirSync(dir, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
git('init', '-q'); writeFileSync(join(source, 'README.md'), 'Source checkout stays unchanged.'); git('add', '.');
git('-c', 'user.name=Soak', '-c', 'user.email=soak@local', 'commit', '-qm', 'base');
const sourceCommit = git('rev-parse', 'HEAD');
const fake = join(root, 'fake.mjs');
writeFileSync(fake, `import fs from 'node:fs';
let prompt=process.argv.at(-1); const context=prompt.match(/UTF-8-filen (.*)\\. Filen indeholder/); if(context) prompt=fs.readFileSync(context[1],'utf8');
const id=Number(prompt.match(/SOAK_JOB=(\\d+)/)?.[1]); if(!Number.isInteger(id)) throw new Error('Missing job marker');
const timer=setInterval(()=>console.log('Local fixture still working'),Math.min(30000,${seconds * 1000} / 2));
await new Promise(resolve=>setTimeout(resolve,${seconds * 1000})); clearInterval(timer);
fs.writeFileSync('delivery-'+id+'.txt','verified '+id+'\\n');console.log('Completed local delivery '+id);`);
setSecretsDir(root); globalThis.fetch = async () => { throw new Error('Offline execution soak'); };
const cfg = { aiProviders: { codex: { cmd: process.execPath, cliTemplate: `"${fake}" {prompt}`, billingMode: 'included', noExtraCharges: true } }, aiPrefs: { autoJudge: false, selfHeal: false } };
const jobs = Array.from({ length: count }, (_, index) => ({ id: `job-${index}`, title: `Delivery ${index}`, serviceId: 'codex', phase: 'production', description: `SOAK_JOB=${index}`, dependsOn: index ? [index - 1] : [] }));
const checkScript = `const fs=require('fs');for(let i=0;i<${count};i++)if(fs.readFileSync('delivery-'+i+'.txt','utf8')!=='verified '+i+'\\n')process.exit(7);console.log('All deliveries verified');`;
const checks = [{ name: 'Actual delivery files', command: process.execPath, args: ['-e', checkScript] }];
const bible = 'Keep the complete mandate and preserve the source checkout.\n'.repeat(300);
const sourceHashes = Object.fromEntries(['ai-runtime.mjs', 'ai-state.mjs', 'ai-services.mjs', 'ai-repository.mjs', 'ai-check-process.mjs', 'ai-history.mjs', 'ai-capabilities.mjs', 'ai-processes.mjs'].map(name => [name, createHash('sha256').update(readFileSync(new URL(`../server/${name}`, import.meta.url))).digest('hex')]));
sourceHashes['shared/ai-plan.mjs'] = createHash('sha256').update(readFileSync(new URL('../shared/ai-plan.mjs', import.meta.url))).digest('hex');
const startedAt = Date.now(); let samples = 0, maxRss = 0, monitorError, currentId = 'first';
const monitor = setInterval(() => {
  try {
    const run = readRun(dirs, currentId); samples++; maxRss = Math.max(maxRss, process.memoryUsage().rss);
    assert.equal(run.bible, bible);
    if (run.status === 'running' && Date.now() - run.startedAt > 15000) assert.ok(Date.now() - run.heartbeatAt < 20000, 'heartbeat remains current');
    assert.ok(run.events.length <= 400);
    if (samples % 12 === 0) console.log(JSON.stringify({ minute: Math.floor((Date.now() - startedAt) / 60000), run: currentId, status: run.status, completed: run.results.length, samples }));
  } catch (error) {
    monitorError ??= error;
    const handle = activeRuns.get(currentId); if (handle) { handle.cancelled = true; handle.abort.abort(); }
  }
}, 5000);
try {
  await executeRun({ runId: currentId, goal: 'Offline execution endurance', bible, projectId: 'soak-project', repository: { source }, cfg, dirs, predefinedJobs: jobs, checks, emit(event) {
    if (event.type === 'job_done' && event.result?.jobId === `job-${Math.floor(count / 2) - 1}`) {
      const handle = activeRuns.get(currentId); handle.cancelled = true; handle.abort.abort();
    }
  } });
  if (monitorError) throw monitorError;
  const previousRun = readRun(dirs, currentId);
  assert.equal(previousRun.status, 'cancelled'); assert.equal(previousRun.results.length, Math.floor(count / 2)); assert.deepEqual(previousRun.processes, []);
  currentId = 'resumed'; const restarted = [];
  await executeRun({ runId: currentId, goal: previousRun.goal, bible: previousRun.bible, projectId: previousRun.projectId, repository: previousRun.repository, cfg, dirs, predefinedJobs: previousRun.jobs, checks,
    previousRun, resumeDir: previousRun.workDir, emit(event) { if (event.type === 'job_start') restarted.push(event.job.id); } });
  if (monitorError) throw monitorError;
  const final = readRun(dirs, currentId);
  assert.equal(final.status, 'done'); assert.equal(final.verification.status, 'passed'); assert.equal(final.results.length, count);
  assert.equal(final.workDir, previousRun.workDir); assert.equal(final.bible, bible);
  assert.deepEqual(restarted, jobs.slice(Math.floor(count / 2)).map(job => job.id));
  assert.equal(git('rev-parse', 'HEAD'), sourceCommit); assert.equal(git('status', '--porcelain'), '');
  assert.equal(readdirSync(final.workDir).filter(file => /^delivery-\d+\.txt$/.test(file)).length, count);
  const report = { ok: true, scenario: 'serial execution, saved pause and same-worktree resume', sourceHashes, startedAt: new Date(startedAt).toISOString(), durationMs: Date.now() - startedAt, samples, maxParentRssBytes: maxRss, jobs: count, secondsPerJob: seconds, root, finalCommit: final.evidence.commit, finalStatus: final.status, checks: final.verification };
  writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { clearInterval(monitor); }

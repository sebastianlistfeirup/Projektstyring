import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeRun, activeRuns, swarmState, projectMemoryDirs } from '../server/ai-runtime.mjs';
import { validatePlan, readRun, saveRun, recoverRuns } from '../server/ai-state.mjs';
import { billingPolicy } from '../server/ai-billing.mjs';
import { produceMedia, setSecretsDir } from '../server/ai-services.mjs';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network disabled by test'); };
const root = mkdtempSync(join(tmpdir(), 'orbit-tests-'));
setSecretsDir(root);
const fake = join(root, 'fake.mjs');
writeFileSync(fake, `const prompt = process.argv.at(-1); if (prompt.includes('FAIL_MARKER')) process.exit(1); console.log('RESULT ' + prompt);`);
const cfg = { aiProviders: { codex: { cmd: process.execPath, cliTemplate: `"${fake}" {prompt}`, billingMode: 'included', noExtraCharges: true } }, aiPrefs: { selfHeal: false, autoJudge: false } };
function fixture() {
  const dir = mkdtempSync(join(root, 'run-'));
  const dirs = { cwd: dir, runs: join(dir, 'runs'), memory: join(dir, 'memory'), artifacts: join(dir, 'artifacts') };
  Object.values(dirs).forEach(d => mkdirSync(d, { recursive: true }));
  return dirs;
}
const job = (id, description, dependsOn = []) => ({ id, title: id, description, dependsOn, serviceId: 'codex', phase: 'test' });
const start = (dirs, extra = {}) => executeRun({ runId: 'test', goal: 'Test goal', bible: 'FULL_BIBLE', cfg, dirs, emit() {}, ...extra });

test('failure blocks dependants but independent work continues; run is partial', async () => {
  const dirs = fixture(), events = [];
  await start(dirs, { predefinedJobs: [job('a', 'FAIL_MARKER'), job('b', 'dependent', [0]), job('c', 'independent')], emit: e => events.push(e) });
  const run = readRun(dirs, 'test');
  assert.deepEqual(run.jobs.map(j => j.status), ['error', 'blocked', 'done']);
  assert.equal(run.status, 'partial');
  assert.ok(!events.some(e => e.type === 'done'));
  assert.ok(!events.some(e => e.type === 'job_start' && e.job.id === 'b'));
  assert.equal(run.bible, 'FULL_BIBLE');
  assert.match(run.results[0].commit, /^[a-f0-9]{40}$/);
});

test('plan validation rejects cycles, dangling dependencies, duplicate and unsafe ids', () => {
  assert.throws(() => validatePlan([job('a', '', [1]), job('b', '', [0])]), /cirkulær/);
  assert.throws(() => validatePlan([job('a', '', [99])]), /ugyldig/);
  assert.throws(() => validatePlan([job('a', ''), job('a', '')]), /entydigt/);
  assert.throws(() => validatePlan([job('../outside', '')]), /stitegn/);
});

test('approval is persisted and can be cancelled without executing a job', async () => {
  const dirs = fixture();
  let ready;
  const paused = new Promise(r => { ready = r; });
  const promise = start(dirs, { pauseAfterPlan: true, predefinedJobs: [job('a', 'ok')], emit: e => { if (e.type === 'plan' && e.paused) queueMicrotask(ready); } });
  await paused;
  const saved = readRun(dirs, 'test');
  assert.equal(saved.status, 'awaiting_approval');
  assert.equal(saved.jobs[0].status, 'queued');
  const handle = activeRuns.get('test');
  assert.equal(handle.approvalTimer, undefined);
  handle.cancelled = true; handle.abort.abort(); handle.resolveApproval([]);
  await promise;
  assert.equal(readRun(dirs, 'test').status, 'cancelled');
});

test('disconnected observer does not stop execution', async () => {
  const dirs = fixture();
  await start(dirs, { predefinedJobs: [job('a', 'ok')], emit() { throw new Error('Disconnected'); } });
  assert.equal(readRun(dirs, 'test').status, 'done');
});

test('project memory cannot carry another projects instructions into a run', async () => {
  const dirs = fixture();
  const foreign = projectMemoryDirs(dirs, 'foreign');
  mkdirSync(foreign.memory, { recursive: true });
  writeFileSync(join(foreign.memory, 'codex.md'), 'FAIL_MARKER: private foreign context');
  writeFileSync(join(dirs.memory, 'codex.md'), 'FAIL_MARKER: unscoped legacy context');
  await start(dirs, { projectId: 'own', predefinedJobs: [job('a', 'ok')] });
  assert.equal(readRun(dirs, 'test').status, 'done');
  assert.ok(readFileSync(join(projectMemoryDirs(dirs, 'own').memory, 'codex.md'), 'utf8').includes('tegn leveret'));
});

test('resume keeps completed results, full bible, instructions and work directory', async () => {
  const dirs = fixture();
  await start(dirs, { predefinedJobs: [job('a', 'FIRST'), job('b', 'FAIL_MARKER', [0])] });
  const previousRun = readRun(dirs, 'test');
  previousRun.instructions = ['Retain this instruction'];
  previousRun.contextManifest = { version: 1, documents: [{ id: 'old-bible' }] };
  previousRun.jobs[1].description = 'SECOND';
  await start(dirs, { runId: 'resumed', previousRun, resumeDir: previousRun.workDir, bible: previousRun.bible, predefinedJobs: previousRun.jobs });
  const resumed = readRun(dirs, 'resumed');
  assert.equal(resumed.status, 'done');
  assert.equal(resumed.results.length, 2);
  assert.equal(resumed.workDir, previousRun.workDir);
  assert.deepEqual(resumed.contextManifest, previousRun.contextManifest);
  assert.ok(!resumed.events.some(e => e.type === 'job_start' && e.job.id === 'a'));
  assert.match(resumed.results[1].text, /FIRST/);
  assert.match(resumed.results[1].text, /FULL_BIBLE/);
  assert.match(resumed.results[1].text, /Retain this instruction/);
});

test('restart preserves approval and marks active work interrupted', () => {
  const dirs = fixture();
  saveRun(dirs, { runId: 'waiting', status: 'awaiting_approval', jobs: [job('a', 'ok')] });
  saveRun(dirs, { runId: 'working', status: 'running', jobs: [{ ...job('a', 'ok'), status: 'running' }] });
  const verification = { status: 'running', checks: [{ name: 'finished', status: 'passed', output: 'ok' }, { name: 'active', status: 'running', output: '' }] };
  saveRun(dirs, { runId: 'testing', status: 'running', jobs: [{ ...job('a', 'ok'), status: 'done' }], verification, verificationHistory: [{ number: 1, ...verification }], processes: [{ pid: 1234, checkName: 'active' }] });
  recoverRuns(dirs);
  assert.equal(readRun(dirs, 'waiting').status, 'awaiting_approval');
  assert.equal(readRun(dirs, 'working').status, 'interrupted');
  assert.equal(readRun(dirs, 'working').jobs[0].status, 'interrupted');
  const interrupted = readRun(dirs, 'testing');
  assert.equal(interrupted.verification.status, 'interrupted');
  assert.deepEqual(interrupted.verification.checks.map(check => check.status), ['passed', 'interrupted']);
  assert.equal(interrupted.verificationHistory[0].status, 'interrupted');
  assert.equal(interrupted.processes[0].pid, 1234);
});

test('billing never infers subscription coverage from name or key', () => {
  for (const kind of ['cli', 'sub-api', 'paid-api']) {
    assert.equal(billingPolicy({ kind }, { apiKey: 'fake' }).allowed, false);
    assert.equal(billingPolicy({ kind }, { billingMode: 'usage', noExtraCharges: true }).allowed, false);
    assert.equal(billingPolicy({ kind }, { billingMode: 'included', noExtraCharges: true }).allowed, true);
  }
  assert.equal(billingPolicy({ kind: 'local' }).allowed, true);
  assert.equal(billingPolicy({ kind: 'local' }, { baseUrl: 'https://ollama.com' }).allowed, false);
  assert.equal(billingPolicy({ kind: 'local' }, { model: 'qwen:cloud' }).allowed, false);
  assert.equal(billingPolicy({ kind: 'local' }, { model: 'renamed-model', remoteModel: true }).allowed, false);
  assert.equal(billingPolicy({ kind: 'local' }, { baseUrl: 'https://ollama.com', billingMode: 'included', noExtraCharges: true }).allowed, true);
});

test('media failure propagates rather than returning an empty success', async () => {
  await assert.rejects(produceMedia({ serviceId: 'elevenlabs', description: 'Hello' }, 'Hello', { aiProviders: { elevenlabs: { apiKey: 'fake', billingMode: 'included', noExtraCharges: true } } }, fixture(), () => {}), /Medieproduktion fejlede/);
});

test('failed code is preserved separately; independent jobs see the clean base', async () => {
  const dirs = fixture(), source = join(dirs.cwd, 'source'), agent = join(dirs.cwd, 'coding.mjs');
  mkdirSync(source);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(source, 'init', '-q'); writeFileSync(join(source, 'game.txt'), 'original');
  git(source, 'add', '.'); git(source, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'base');
  writeFileSync(agent, `import fs from 'node:fs'; const p=process.argv.at(-1); if(p.includes('BROKEN_CHANGE')) {fs.writeFileSync('game.txt','broken'); process.exit(1);} if(fs.readFileSync('game.txt','utf8')!=='original') process.exit(4); fs.writeFileSync('game.txt','fixed'); console.log('Implemented');`);
  const localCfg = { ...cfg, aiProviders: { codex: { ...cfg.aiProviders.codex, cliTemplate: `"${agent}" {prompt}` } } };
  await start(dirs, { cfg: localCfg, repository: { source }, predefinedJobs: [job('a', 'BROKEN_CHANGE'), job('b', 'independent')] });
  const run = readRun(dirs, 'test');
  assert.equal(run.status, 'partial');
  assert.deepEqual(run.jobs.map(j => j.status), ['error', 'done']);
  assert.equal(readFileSync(join(source, 'game.txt'), 'utf8'), 'original');
  assert.equal(readFileSync(join(run.workDir, 'game.txt'), 'utf8'), 'fixed');
  assert.equal(git(source, 'show', 'orbit-attempt/test/a:game.txt'), 'broken');
});

test('actual runtime verifies repository, blocks failed checks and detects mutation', async () => {
  for (const mode of ['pass', 'fail', 'mutate']) {
    const dirs = fixture(), source = join(dirs.cwd, 'source'); mkdirSync(source);
    const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' });
    git('init', '-q'); writeFileSync(join(source, 'game.txt'), 'original'); git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'base');
    const script = mode === 'mutate' ? "require('fs').writeFileSync('game.txt','mutated')" : `process.exit(${mode === 'pass' ? 0 : 2})`;
    await start(dirs, { repository: { source }, predefinedJobs: [job('a', 'ok')], checks: [{ name: mode, command: process.execPath, args: ['-e', script] }] });
    const run = readRun(dirs, 'test');
    assert.equal(run.status, mode === 'pass' ? 'done' : 'blocked');
    assert.equal(run.verification.status, mode === 'pass' ? 'passed' : 'failed');
    assert.match(run.evidence.commit, /^[a-f0-9]{40}$/);
    assert.equal(readFileSync(join(source, 'game.txt'), 'utf8'), 'original');
  }
});

test('runtime checkpoints completed checks and running process before cancellation, then resumes only checks', async () => {
  const dirs = fixture(), source = join(dirs.cwd, 'source'); mkdirSync(source);
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' });
  git('init', '-q'); git('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '--allow-empty', '-qm', 'base');
  const checks = [
    { name: 'completed', command: process.execPath, args: ['-e', 'console.log("saved evidence")'] },
    { name: 'long', command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] },
  ];
  let persisted;
  await start(dirs, { repository: { source }, predefinedJobs: [job('a', 'ok')], checks, emit(event) {
    if (event.type === 'job_process' && event.checkName === 'long' && !event.finished) {
      persisted = readRun(dirs, 'test');
      const handle = activeRuns.get('test'); handle.cancelled = true; handle.abort.abort();
    }
  } });
  assert.equal(persisted.verification.status, 'running');
  assert.deepEqual(persisted.verification.checks.map(check => check.status), ['passed', 'running']);
  assert.ok(persisted.processes.some(info => info.checkName === 'long'));
  const previousRun = readRun(dirs, 'test');
  assert.equal(previousRun.status, 'cancelled'); assert.equal(previousRun.verification.status, 'cancelled');
  assert.match(previousRun.verification.checks[0].output, /saved evidence/); assert.deepEqual(previousRun.processes, []);
  const events = [];
  await start(dirs, { runId: 'resumed-checks', previousRun, resumeDir: previousRun.workDir, bible: previousRun.bible, repository: previousRun.repository, predefinedJobs: previousRun.jobs, checks: [checks[0]], emit: event => events.push(event) });
  const resumed = readRun(dirs, 'resumed-checks');
  assert.equal(resumed.status, 'done');
  assert.deepEqual(resumed.verificationHistory.map(attempt => attempt.status), ['cancelled', 'passed']);
  assert.equal(events.some(event => event.type === 'job_start'), false);
});



test('bounded verification repair uses actual failing output and repeats the same checks', async () => {
  for (const succeeds of [true, false]) {
    const dirs = fixture(), source = join(dirs.cwd, 'source'), agent = join(dirs.cwd, 'repair.mjs'); mkdirSync(source);
    const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' });
    git('init', '-q'); writeFileSync(join(source, 'game.txt'), 'original'); git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'base');
    writeFileSync(agent, `import fs from 'node:fs'; let p=process.argv.at(-1); const f=p.match(/UTF-8-filen (.*)\\. Filen indeholder/); if(f) p=fs.readFileSync(f[1],'utf8'); const repair=p.includes('RETTELSE EFTER FAKTISK TESTFEJL'); if(repair&&!p.includes('EXPECTED_FIXED_GOT_BROKEN')) process.exit(7); fs.writeFileSync('game.txt',repair&&${succeeds}?'fixed':'broken'); console.log(repair?'Repaired from actual failure':'First implementation');`);
    const localCfg = { ...cfg, aiProviders: { codex: { ...cfg.aiProviders.codex, cliTemplate: `"${agent}" {prompt}` } }, aiPrefs: { selfHeal: true, autoJudge: false } };
    const checks = [{ name: 'Save integrity', command: process.execPath, args: ['-e', "if(require('fs').readFileSync('game.txt','utf8')!=='fixed'){console.error('EXPECTED_FIXED_GOT_BROKEN');process.exit(2)}"] }];
    await start(dirs, { cfg: localCfg, repository: { source }, predefinedJobs: [job('a', 'Implement')], checks });
    const run = readRun(dirs, 'test');
    assert.equal(run.status, succeeds ? 'done' : 'blocked');
    assert.equal(run.jobs.length, 2); assert.equal(run.jobs[1].repairFor, 1);
    assert.equal(run.verificationRepairs, 1); assert.equal(run.verificationHistory.length, 2);
    assert.equal(run.verificationHistory[0].status, 'failed');
    assert.equal(run.verificationHistory[1].status, succeeds ? 'passed' : 'failed');
    assert.deepEqual(run.verificationHistory[1].checks[0].args, checks[0].args);
    assert.ok(run.events.some(event => event.type === 'job_added'));
    assert.equal(run.events.find(event => event.type === 'plan').jobs.length, 1);
    assert.equal(readFileSync(join(source, 'game.txt'), 'utf8'), 'original');
  }
});




test('independent review is tied to a commit and rejects weak scores, serious findings and reviewer writes', async () => {
  for (const mode of ['pass', 'low', 'major', 'mutate']) {
    const dirs = fixture(), source = join(dirs.cwd, 'source'), agent = join(dirs.cwd, 'review-agent.mjs'); mkdirSync(source);
    const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' });
    git('init', '-q'); writeFileSync(join(source, 'game.txt'), 'original'); git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'base');
    writeFileSync(agent, `import fs from 'node:fs'; let p=process.argv.at(-1); const f=p.match(/UTF-8-filen (.*)\\. Filen indeholder/); if(f) p=fs.readFileSync(f[1],'utf8'); if(p.includes('uafhængig reviewer')) { if(fs.readFileSync('game.txt','utf8')!=='fixed') process.exit(4); if('${mode}'==='mutate') fs.writeFileSync('game.txt','reviewer-change'); console.log(JSON.stringify({score:'${mode}'==='low'?7:9,note:'Checked actual game file',examinedFiles:['game.txt'],findings:'${mode}'==='major'?[{severity:'major',file:'game.txt',message:'Missing integration'}]:[]})); } else { fs.writeFileSync('game.txt','fixed'); console.log('Implemented game file'); }`);
    const provider = { cmd: process.execPath, cliTemplate: `"${agent}" {prompt}`, billingMode: 'included', noExtraCharges: true };
    const localCfg = { aiProviders: { codex: provider, claude: provider }, aiPrefs: { selfHeal: false, autoJudge: true } };
    await start(dirs, { cfg: localCfg, repository: { source }, predefinedJobs: [job('a', 'Implement')] });
    const run = readRun(dirs, 'test');
    assert.equal(run.status, mode === 'pass' ? 'done' : 'error', JSON.stringify(run.jobs));
    if (mode === 'pass') {
      assert.equal(run.jobs[0].review.minimumScore, 8); assert.equal(run.jobs[0].review.serviceId, 'claude');
      assert.equal(run.results[0].commit, run.jobs[0].review.commit);
      assert.deepEqual(run.jobs[0].review.examinedFiles, ['game.txt']);
      assert.equal(run.processes.length, 0);
    } else if (mode === 'mutate') assert.match(run.jobs[0].error, /Reviewer ændrede/);
    else assert.equal(run.jobs[0].review.status, 'blocked');
    assert.equal(readFileSync(join(source, 'game.txt'), 'utf8'), 'original');
  }
});




test('required review cannot silently disappear when no independent service is available', async () => {
  const dirs = fixture();
  await start(dirs, { cfg: { ...cfg, aiPrefs: { selfHeal: false, autoJudge: true } }, predefinedJobs: [job('a', 'Implement')] });
  const run = readRun(dirs, 'test');
  assert.equal(run.status, 'error'); assert.match(run.jobs[0].error, /ingen anden coding-tjeneste/);
  assert.equal(run.results.length, 0);
});

test('cleanup leaves no active run', () => { assert.equal(activeRuns.size, 0); assert.equal(swarmState.active, null); globalThis.fetch = originalFetch; });

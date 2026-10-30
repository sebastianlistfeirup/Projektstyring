import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeRun, activeRuns, swarmState } from '../server/ai-runtime.mjs';
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

test('resume keeps completed results, full bible, instructions and work directory', async () => {
  const dirs = fixture();
  await start(dirs, { predefinedJobs: [job('a', 'FIRST'), job('b', 'FAIL_MARKER', [0])] });
  const previousRun = readRun(dirs, 'test');
  previousRun.instructions = ['Retain this instruction'];
  previousRun.jobs[1].description = 'SECOND';
  await start(dirs, { runId: 'resumed', previousRun, resumeDir: previousRun.workDir, bible: previousRun.bible, predefinedJobs: previousRun.jobs });
  const resumed = readRun(dirs, 'resumed');
  assert.equal(resumed.status, 'done');
  assert.equal(resumed.results.length, 2);
  assert.equal(resumed.workDir, previousRun.workDir);
  assert.ok(!resumed.events.some(e => e.type === 'job_start' && e.job.id === 'a'));
  assert.match(resumed.results[1].text, /FIRST/);
  assert.match(resumed.results[1].text, /FULL_BIBLE/);
  assert.match(resumed.results[1].text, /Retain this instruction/);
});

test('restart preserves approval and marks active work interrupted', () => {
  const dirs = fixture();
  saveRun(dirs, { runId: 'waiting', status: 'awaiting_approval', jobs: [job('a', 'ok')] });
  saveRun(dirs, { runId: 'working', status: 'running', jobs: [{ ...job('a', 'ok'), status: 'running' }] });
  recoverRuns(dirs);
  assert.equal(readRun(dirs, 'waiting').status, 'awaiting_approval');
  assert.equal(readRun(dirs, 'working').status, 'interrupted');
  assert.equal(readRun(dirs, 'working').jobs[0].status, 'interrupted');
});

test('billing never infers subscription coverage from name or key', () => {
  for (const kind of ['cli', 'sub-api', 'paid-api']) {
    assert.equal(billingPolicy({ kind }, { apiKey: 'fake' }).allowed, false);
    assert.equal(billingPolicy({ kind }, { billingMode: 'usage', noExtraCharges: true }).allowed, false);
    assert.equal(billingPolicy({ kind }, { billingMode: 'included', noExtraCharges: true }).allowed, true);
  }
  assert.equal(billingPolicy({ kind: 'local' }).allowed, true);
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

test('cleanup leaves no active run', () => { assert.equal(activeRuns.size, 0); assert.equal(swarmState.active, null); globalThis.fetch = originalFetch; });

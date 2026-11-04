import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { durableStorePath, readDurableDocument, transactDurableDocument, claimExternalSubmission, updateExternalSubmission, readExternalSubmission, captureExternalSubmissionLedger, mergeExternalSubmissionLedger } from '../server/ai-durable-store.mjs';
import { DurableRunQueue, pauseRestoredQueue } from '../server/ai-queue.mjs';
import { saveRun, readRun, recoverRuns } from '../server/ai-state.mjs';
import { listRunSummaries, readRunSummary } from '../server/ai-history.mjs';
import { createWorkspaceBackup, restoreWorkspaceBackup } from '../server/workspace-backup.mjs';

const dirs = () => ({ runs: mkdtempSync(join(tmpdir(), 'orbit-durable-')) });
const hash = text => createHash('sha256').update(text).digest('hex');
const queueUrl = new URL('../server/ai-queue.mjs', import.meta.url).href;
const storeUrl = new URL('../server/ai-durable-store.mjs', import.meta.url).href;
const stateUrl = new URL('../server/ai-state.mjs', import.meta.url).href;

test('run and history survive a crash between SQLite commit and JSON projection', () => {
  const root = dirs(), file = join(root.runs, 'run.json');
  saveRun(root, { runId: 'run', status: 'running', goal: 'Before' });
  rmSync(file); mkdirSync(file);
  assert.throws(() => saveRun(root, { runId: 'run', status: 'done', goal: 'Committed', results: [{ text: 'Kept' }] }));
  assert.equal(readRun(root, 'run').results[0].text, 'Kept');
  assert.equal(listRunSummaries(root).runs[0].status, 'done');
  rmSync(file, { recursive: true });
  recoverRuns(root);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).goal, 'Committed');
  // A stale projection never replaces the transaction's completed result.
  writeFileSync(file, JSON.stringify({ runId: 'run', status: 'running', goal: 'Old export' }));
  assert.equal(readRun(root, 'run').status, 'done');
  assert.equal(listRunSummaries(root).runs[0].goal, 'Committed');
});

test('database-backed history and projection recovery never require redundant legacy summary writes', () => {
  const root = dirs(), projection = join(root.runs, 'durable.json'), legacyCache = join(root.runs, 'durable.summary');
  saveRun(root, { runId: 'durable', status: 'running', goal: 'Original' });
  saveRun(root, { runId: 'durable', status: 'done', goal: 'Latest committed result', results: [{ jobId: 'job', title: 'Kept result' }] });
  assert.equal(existsSync(legacyCache), false);
  assert.equal(JSON.parse(readFileSync(projection, 'utf8')).goal, 'Latest committed result');
  assert.equal(readRunSummary(root, 'durable').status, 'done');
  assert.equal(listRunSummaries(root).runs[0].goal, 'Latest committed result');
  assert.equal(existsSync(legacyCache), false);
  rmSync(projection);
  recoverRuns(root);
  assert.equal(JSON.parse(readFileSync(projection, 'utf8')).results[0].title, 'Kept result');
  assert.equal(readRunSummary(root, 'durable').results[0].title, 'Kept result');
  assert.equal(existsSync(legacyCache), false);
  // An export from an older app cannot override the transactional summary and
  // need not be repaired on each read; legacy-only runs have their own test.
  writeFileSync(legacyCache, 'obsolete cache');
  assert.equal(readRunSummary(root, 'durable').goal, 'Latest committed result');
  assert.equal(readFileSync(legacyCache, 'utf8'), 'obsolete cache');
});

test('an abrupt process exit rolls back an uncommitted write and leaves the store usable', () => {
  const root = dirs(), path = durableStorePath(root);
  transactDurableDocument(path, 'test', () => ({ value: { committed: true } }));
  const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    db.exec('BEGIN IMMEDIATE');
    db.prepare('UPDATE documents SET body=? WHERE key=?').run(JSON.stringify({committed:false}), 'test');
    process.exit(17);
  `, path], { encoding: 'utf8' });
  assert.equal(crashed.status, 17);
  assert.deepEqual(readDurableDocument(path, 'test').value, { committed: true });
  transactDurableDocument(path, 'test', current => ({ value: { ...current.value, recovered: true } }));
  assert.equal(readDurableDocument(path, 'test').value.recovered, true);
});

test('two queue instances keep concurrent intents and claim at most one execution', async () => {
  const root = dirs(), path = join(root.runs, 'ai-queue.json'), calls = [], runs = new Map();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const dependencies = { path, readRun: id => runs.get(id), execute: async input => {
    calls.push(input.goal); await gate; runs.set(input.runId, { status: 'done' });
  } };
  const first = new DurableRunQueue(dependencies), second = new DurableRunQueue(dependencies);
  first.enqueue({ goal: 'First', projectId: 'p', taskId: 'a' });
  assert.equal(second.enqueue({ goal: 'Duplicate', projectId: 'p', taskId: 'a' }).duplicate, true);
  second.enqueue({ goal: 'Second' });
  assert.equal(first.snapshot().entries.length, 2);
  const active = first.pump(); await second.pump();
  assert.deepEqual(calls, ['First']);
  second.recover();
  assert.equal(second.snapshot().entries[0].status, 'running');
  second.pause(); release(); await active;
  assert.equal(first.snapshot().paused, true);
  assert.equal(first.snapshot().entries[1].status, 'queued');
});

test('separate processes atomically deduplicate the same scheduled intent', async () => {
  const root = dirs(), path = join(root.runs, 'ai-queue.json');
  new DurableRunQueue({ path }); // Schema exists before concurrent writers start.
  const code = `import { DurableRunQueue } from ${JSON.stringify(queueUrl)}; new DurableRunQueue({path:process.argv[1]}).enqueue({goal:'One scheduled action'}, {key:'same-minute'});`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, path], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', value => { stderr += value; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  await Promise.all([run(), run(), run()]);
  assert.equal(new DurableRunQueue({ path }).snapshot().entries.length, 1);
});

test('unknown provider submission is not replayed after process exit; receipts resume and completion reuses results', () => {
  const root = dirs(), key = 'original-workspace/job-1/meshy', requestHash = hash('A stone city');
  const claimed = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { claimExternalSubmission } from ${JSON.stringify(storeUrl)};
    claimExternalSubmission({runs:process.argv[1]}, {key:process.argv[2], serviceId:'meshy', requestHash:process.argv[3]});
    process.exit(19);
  `, root.runs, key, requestHash], { encoding: 'utf8' });
  assert.equal(claimed.status, 19);
  assert.throws(() => claimExternalSubmission(root, { key, serviceId: 'meshy', requestHash }), /genbestiller ikke/);
  updateExternalSubmission(root, key, { state: 'processing', remoteId: 'provider-123' });
  const resumed = claimExternalSubmission(root, { key, serviceId: 'meshy', requestHash });
  assert.equal(resumed.created, false); assert.equal(resumed.submission.remoteId, 'provider-123');
  const artifacts = [{ name: 'city.glb', url: '/api/ai/file/city.glb' }];
  updateExternalSubmission(root, key, { state: 'completed', artifacts });
  assert.deepEqual(claimExternalSubmission(root, { key, serviceId: 'meshy', requestHash }).submission.artifacts, artifacts);
  assert.equal(readExternalSubmission(root, key).state, 'completed');
  assert.throws(() => claimExternalSubmission(root, { key, serviceId: 'meshy', requestHash: hash('Different city') }), /grundlag er ændret/);
});

test('legacy queues migrate once and restored queues pause the authoritative database', () => {
  const root = dirs(), path = join(root.runs, 'ai-queue.json');
  writeFileSync(path, JSON.stringify({ version: 1, paused: false, reason: '', entries: [{ id: 'old', status: 'queued', input: { goal: 'Legacy intent' } }], scheduleKeys: {}, updatedAt: 1 }));
  const queue = new DurableRunQueue({ path });
  queue.enqueue({ goal: 'New intent' });
  // Simulate a stale projection saved before the newest database transaction.
  writeFileSync(path, JSON.stringify({ version: 1, paused: false, entries: [], scheduleKeys: {}, updatedAt: 0 }));
  pauseRestoredQueue(path);
  const reopened = new DurableRunQueue({ path });
  assert.equal(reopened.snapshot().paused, true); assert.equal(reopened.snapshot().entries.length, 2);
});

test('corrupt databases fail closed instead of using stale JSON exports', async () => {
  const root = dirs(), path = join(root.runs, 'ai-queue.json');
  const queue = new DurableRunQueue({ path }); queue.enqueue({ goal: 'Never replay' });
  writeFileSync(durableStorePath(root), 'corrupt sqlite');
  const reopened = new DurableRunQueue({ path, execute: () => assert.fail('Must not dispatch') });
  assert.equal(reopened.snapshot().paused, true); assert.ok(reopened.storageError);
  assert.throws(() => reopened.enqueue({ goal: 'Unsafe fallback' }));
  await reopened.pump();
});

test('a newer storage schema is refused without modifying it', () => {
  const root = dirs(), path = durableStorePath(root);
  transactDurableDocument(path, 'test', () => ({ value: { original: true } }));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA user_version=99'); db.close();
  `, path]);
  assert.equal(result.status, 0);
  const before = readFileSync(path);
  assert.throws(() => readDurableDocument(path, 'test'), /nyere Orbit-version/);
  assert.deepEqual(readFileSync(path), before);
});

test('workspace backup restores transactions and pauses saved intent before publishing the snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-db-backup-')), app = join(root, 'app'), attachments = join(root, 'attachments');
  const originalDirs = { runs: join(app, 'ai-runs') }, queuePath = join(originalDirs.runs, 'ai-queue.json');
  const queue = new DurableRunQueue({ path: queuePath }); queue.enqueue({ goal: 'Preserved intent' });
  saveRun(originalDirs, { runId: 'kept', goal: 'Verified delivery', status: 'done' });
  claimExternalSubmission(originalDirs, { key: 'provider-job', serviceId: 'meshy', requestHash: hash('Original city') });
  const backup = createWorkspaceBackup({ tasks: [] }, app, attachments);
  assert.ok(backup.files.some(file => file.path === 'orbit-state.sqlite'));
  const restoredApp = join(root, 'restored'), restoredDirs = { runs: join(restoredApp, 'ai-runs') }, restoredQueue = join(restoredDirs.runs, 'ai-queue.json');
  let published = false;
  restoreWorkspaceBackup(backup, restoredApp, join(root, 'restored-attachments'), { commitSnapshot: () => {
    pauseRestoredQueue(restoredQueue);
    assert.equal(new DurableRunQueue({ path: restoredQueue }).snapshot().paused, true);
    published = true;
  } });
  assert.equal(published, true);
  assert.equal(readRun(restoredDirs, 'kept').goal, 'Verified delivery');
  assert.equal(new DurableRunQueue({ path: restoredQueue }).snapshot().entries[0].input.goal, 'Preserved intent');
  assert.throws(() => claimExternalSubmission(restoredDirs, { key: 'provider-job', serviceId: 'meshy', requestHash: hash('Original city') }), /genbestiller ikke/);
});

test('restoring an older workspace retains later provider claims and never reorders a completed delivery', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-receipt-restore-')), app = join(root, 'app'), attachments = join(root, 'attachments');
  const liveDirs = { runs: join(app, 'ai-runs') };
  saveRun(liveDirs, { runId: 'original', goal: 'Generate city', status: 'interrupted' });
  const oldBackup = createWorkspaceBackup({ tasks: [] }, app, attachments);
  for (const key of ['unknown', 'processing', 'completed']) claimExternalSubmission(liveDirs, { key, serviceId: 'meshy', requestHash: hash(key) });
  updateExternalSubmission(liveDirs, 'processing', { state: 'processing', remoteId: 'remote-1' });
  updateExternalSubmission(liveDirs, 'completed', { state: 'completed', artifacts: [{ url: '/api/ai/file/later.glb' }] });
  const recentBackup = createWorkspaceBackup({ tasks: [] }, app, attachments);
  const receipts = captureExternalSubmissionLedger(liveDirs);
  restoreWorkspaceBackup(oldBackup, app, attachments, { commitSnapshot: () => mergeExternalSubmissionLedger(liveDirs, receipts) });
  assert.throws(() => claimExternalSubmission(liveDirs, { key: 'unknown', serviceId: 'meshy', requestHash: hash('unknown') }), /genbestiller ikke/);
  assert.equal(claimExternalSubmission(liveDirs, { key: 'processing', serviceId: 'meshy', requestHash: hash('processing') }).submission.remoteId, 'remote-1');
  assert.throws(() => claimExternalSubmission(liveDirs, { key: 'completed', serviceId: 'meshy', requestHash: hash('completed') }), /nyere backup/);
  // Restoring the later backup also restores its artifacts; an older retained
  // warning must not override the completed record belonging to that backup.
  const retained = captureExternalSubmissionLedger(liveDirs);
  restoreWorkspaceBackup(recentBackup, app, attachments, { commitSnapshot: () => mergeExternalSubmissionLedger(liveDirs, retained) });
  assert.equal(claimExternalSubmission(liveDirs, { key: 'completed', serviceId: 'meshy', requestHash: hash('completed') }).submission.state, 'completed');
});

test('conflicting restored provider receipts roll back the whole workspace replacement', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-receipt-conflict-')), app = join(root, 'app'), attachments = join(root, 'attachments');
  const liveDirs = { runs: join(app, 'ai-runs') };
  const request = { key: 'same-operation', serviceId: 'meshy', requestHash: hash('City') };
  claimExternalSubmission(liveDirs, request);
  updateExternalSubmission(liveDirs, request.key, { state: 'processing', remoteId: 'original-provider-id' });
  saveRun(liveDirs, { runId: 'original', goal: 'Before restore', status: 'done' });
  const backup = createWorkspaceBackup({ tasks: [] }, app, attachments);
  const receipts = captureExternalSubmissionLedger(liveDirs);
  receipts[0].remoteId = 'conflicting-provider-id';
  saveRun(liveDirs, { runId: 'original', goal: 'Keep current workspace', status: 'done' });
  assert.throws(() => restoreWorkspaceBackup(backup, app, attachments, { commitSnapshot: () => mergeExternalSubmissionLedger(liveDirs, receipts) }), /modstridende/);
  assert.equal(readRun(liveDirs, 'original').goal, 'Keep current workspace');
  assert.equal(readExternalSubmission(liveDirs, request.key).remoteId, 'original-provider-id');
});

test('a second process cannot recover the first process live run or release its queue claim', async () => {
  const root = dirs(), path = join(root.runs, 'ai-queue.json');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { saveRun, readRun } from ${JSON.stringify(stateUrl)};
    import { DurableRunQueue } from ${JSON.stringify(queueUrl)};
    const dirs = {runs:process.argv[1]};
    const queue = new DurableRunQueue({path:process.argv[2], readRun:id=>readRun(dirs,id), execute:async input=>{
      saveRun(dirs, {runId:input.runId,status:'running',executionOwnerPid:process.pid,jobs:[{id:'job',status:'running'}]});
      process.send({runId:input.runId});
      await new Promise(()=>{});
    }});
    queue.enqueue({goal:'Owned execution'}); void queue.pump();
    setInterval(()=>{},1000);
  `, root.runs, path], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr.on('data', value => { stderr += value; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    const runId = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Owner process did not start: ${stderr}`)), 10000);
      child.once('message', message => { clearTimeout(timeout); resolve(message.runId); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error(stderr)); });
    });
    assert.deepEqual(recoverRuns(root), []);
    assert.equal(readRun(root, runId).status, 'running');
    const observer = new DurableRunQueue({ path, readRun: id => readRun(root, id) });
    observer.recover();
    assert.equal(observer.snapshot().entries[0].status, 'running');
    // Even a terminal snapshot cannot let an observer steal the live claim;
    // its actual owner commits the queue result after execute returns.
    saveRun(root, { ...readRun(root, runId), status: 'done' });
    observer.recover();
    assert.equal(observer.snapshot().entries[0].status, 'running');
    saveRun(root, { ...readRun(root, runId), status: 'running' });
    child.kill('SIGKILL'); await exited;
    assert.equal(recoverRuns(root)[0].status, 'interrupted');
    observer.recover();
    assert.equal(observer.snapshot().entries[0].status, 'interrupted');
    assert.equal(observer.snapshot().paused, true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
});

test('an explicitly guarded restore can recover a saved PID that is still alive', () => {
  const root = dirs();
  saveRun(root, { runId: 'old-snapshot', status: 'running', executionOwnerPid: process.pid, jobs: [{ id: 'job', status: 'running' }] });
  assert.deepEqual(recoverRuns(root), []);
  assert.equal(recoverRuns(root, { force: true })[0].status, 'interrupted');
});

test('queue reconciliation can read a committed run while holding its own write transaction', () => {
  const root = dirs(), path = join(root.runs, 'ai-queue.json');
  const queue = new DurableRunQueue({ path, readRun: id => readRun(root, id) });
  const { entry } = queue.enqueue({ goal: 'Completed before queue checkpoint' });
  queue.commit(state => Object.assign(state.entries.find(item => item.id === entry.id), { status: 'running', runId: 'finished', ownerPid: null }));
  saveRun(root, { runId: 'finished', status: 'done' });
  queue.recover();
  assert.equal(queue.snapshot().entries[0].status, 'done');
  assert.equal(queue.snapshot().paused, false);
});

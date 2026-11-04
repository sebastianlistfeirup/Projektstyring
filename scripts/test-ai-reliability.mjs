import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archivedArtifactPath, registerArtifactRoutes } from '../server/ai-artifacts.mjs';
import { readRun } from '../server/ai-state.mjs';
import { listDurableDocuments, durableStorePath } from '../server/ai-durable-store.mjs';
import { createWorkspaceBackup, restoreWorkspaceBackup } from '../server/workspace-backup.mjs';
import express from 'express';

const script = fileURLToPath(import.meta.url), repository = resolve(dirname(script), '..');
const digest = content => createHash('sha256').update(content).digest('hex');
const directories = root => ({ cwd: join(root, 'ai-context'), runs: join(root, 'ai-runs'), memory: join(root, 'ai-memory'), artifacts: join(root, 'ai-artifacts') });

async function worker() {
  const [root, origin, mode, originalId, runId] = process.argv.slice(3);
  const { executeRun } = await import('../server/ai-runtime.mjs');
  const { recoverRuns } = await import('../server/ai-state.mjs');
  const { setSecretsDir } = await import('../server/ai-services.mjs');
  const dirs = directories(root);
  Object.values(dirs).forEach(path => mkdirSync(path, { recursive: true }));
  setSecretsDir(root);
  const nativeFetch = globalThis.fetch;
  // Network stays local. The adapter still performs real HTTP requests, and
  // provider receipts outlive the killed process in the parent's fixture.
  globalThis.fetch = (url, options) => {
    const remote = String(url);
    if (remote.startsWith('https://api.meshy.ai/openapi/v2/text-to-3d')) return nativeFetch(`${origin}/provider${remote.slice('https://api.meshy.ai/openapi/v2/text-to-3d'.length)}`, options);
    if (remote === 'https://fixture.invalid/model.glb') return nativeFetch(`${origin}/model.glb`, options);
    return Promise.reject(new Error('Network outside local reliability fixture is disabled'));
  };
  const cfg = { aiProviders: { meshy: { apiKey: 'local-fixture-key', billingMode: 'included', noExtraCharges: true } }, aiPrefs: { autoJudge: false, selfHeal: false } };
  const job = { id: 'model', serviceId: 'meshy', phase: 'production', title: 'Create a 3D model', description: 'A simple cube for a reliability fixture', dependsOn: [] };
  let previousRun;
  if (mode === 'resume') { recoverRuns(dirs); previousRun = readRun(dirs, originalId); }
  await executeRun({ runId, goal: 'Create a 3D model', bible: 'Reliability fixture only', dirs, cfg,
    predefinedJobs: previousRun?.jobs ?? [job], previousRun, resumeDir: previousRun?.workDir,
    emit(event) {
      if (event.type === 'job_media' && ((mode === 'receipt' && event.media?.remoteId) || (mode === 'archived' && event.media?.state === 'completed'))) {
        process.send?.({ type: 'checkpoint', boundary: mode });
        // Do not let the worker advance across the chosen boundary while the
        // parent schedules SIGKILL. No cleanup/exit handlers can complete it.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
      }
    },
  });
  process.send?.({ type: 'finished', run: readRun(dirs, runId) }, () => process.exit(0));
}

if (process.argv[2] === '--worker') {
  await worker().catch(error => { process.stderr.write(`${error.stack}\n`); process.exit(2); });
} else {
  const startedAt = new Date().toISOString(), started = performance.now(), measurements = [];
  const requestedCycles = Number(process.env.ORBIT_RELIABILITY_CYCLES ?? 2);
  if (!Number.isInteger(requestedCycles) || requestedCycles < 1 || requestedCycles > 20) throw new Error('ORBIT_RELIABILITY_CYCLES must be an integer from 1 to 20.');
  const cycles = requestedCycles;
  const testedSources = Object.fromEntries(['server', 'shared'].flatMap(dir => readdirSync(join(repository, dir)).filter(file => file.endsWith('.mjs')).map(file => `${dir}/${file}`))
    .concat('scripts/test-ai-reliability.mjs').map(file => [file, digest(readFileSync(join(repository, file)))]));

  async function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'orbit-reliability-'));
    const requests = [], sockets = new Set();
    let holdPost = false, accepted;
    const json = JSON.stringify({ asset: { version: '2.0' } });
    const body = Buffer.from(json + ' '.repeat((4 - json.length % 4) % 4));
    const header = Buffer.alloc(20); header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + body.length, 8); header.writeUInt32LE(body.length, 12); header.write('JSON', 16);
    const model = Buffer.concat([header, body]);
    const server = createServer((req, res) => {
      requests.push({ method: req.method, path: req.url });
      req.resume();
      if (req.method === 'POST' && req.url === '/provider') {
        if (holdPost) { holdPost = false; accepted?.(); return; }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ result: 'remote-stable' }));
      } else if (req.url === '/provider/remote-stable') {
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'SUCCEEDED', model_urls: { glb: 'https://fixture.invalid/model.glb' } }));
      } else if (req.url === '/model.glb') { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(model); }
      else { res.statusCode = 404; res.end(); }
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
    return { root, model, requests, origin: `http://127.0.0.1:${server.address().port}`,
      holdSubmission() { holdPost = true; return new Promise(resolve => { accepted = resolve; }); } };
  }

  function startChild(t, fixture, mode, originalId, runId) {
    const child = spawn(process.execPath, [script, '--worker', fixture.root, fixture.origin, mode, originalId, runId], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '', finished;
    child.stderr.on('data', bytes => { stderr += bytes; });
    let checkpointResolve, checkpointReject;
    const checkpoint = new Promise((resolve, reject) => { checkpointResolve = resolve; checkpointReject = reject; });
    void checkpoint.catch(() => {});
    child.on('message', message => {
      if (message.type === 'checkpoint') checkpointResolve(message);
      if (message.type === 'finished') finished = message.run;
    });
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => { checkpointReject(new Error(`Worker exited before boundary (${code}/${signal}): ${stderr}`)); resolve({ code, signal, finished, stderr }); });
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 20000);
    timeout.unref();
    t.after(() => { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    return { child, checkpoint, done };
  }

  async function verifyHttpAndBackup(t, f, run, artifact) {
    const dirs = directories(f.root);
    const archived = await archivedArtifactPath(dirs.artifacts, artifact.url.split('/')[4], artifact.artifactId);
    assert.deepEqual(readFileSync(archived.path), f.model);
    const app = express(); registerArtifactRoutes(app, { dirs, readRun });
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const response = await fetch(`http://127.0.0.1:${server.address().port}${artifact.url}`, { headers: { Range: 'bytes=0-3' } });
    assert.equal(response.status, 206); assert.equal(await response.text(), 'glTF');
    const backup = createWorkspaceBackup({ tasks: [], schemaVersion: 2, workspaceState: {} }, f.root, join(f.root, 'attachments'));
    const restored = `${f.root}-restored`;
    restoreWorkspaceBackup(backup, restored, join(restored, 'attachments'));
    const restoredRun = readRun(directories(restored), run.runId);
    assert.equal(restoredRun.status, 'done');
    assert.equal(restoredRun.results[0].artifacts[0].sha256, artifact.sha256);
    const restoredFile = await archivedArtifactPath(directories(restored).artifacts, artifact.url.split('/')[4], artifact.artifactId);
    assert.deepEqual(readFileSync(restoredFile.path), f.model);
    const ledger = listDurableDocuments(durableStorePath(directories(restored)), 'submission:');
    assert.equal(ledger.length, 1); assert.equal(ledger[0].value.state, 'completed');
    assert.equal(ledger[0].value.artifacts[0].sha256, artifact.sha256);
  }

  for (const boundary of ['receipt', 'archived']) test(`abrupt death at ${boundary} resumes a real runtime with one provider submission and restorable evidence`, { timeout: 60000 }, async t => {
    const begin = performance.now(); let posts = 0;
    for (let i = 0; i < cycles; i++) {
      const f = await fixture(t), originalId = `original-${i}`, runId = `resumed-${i}`;
      const first = startChild(t, f, boundary, originalId, originalId);
      await first.checkpoint; first.child.kill('SIGKILL');
      const killed = await first.done; assert.ok(killed.signal || killed.code !== 0);
      assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
      const resumed = await startChild(t, f, 'resume', originalId, runId).done;
      assert.equal(resumed.code, 0, resumed.stderr);
      assert.equal(resumed.finished?.status, 'done', JSON.stringify(resumed.finished?.jobs));
      assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
      const artifact = resumed.finished.results[0]?.artifacts[0]; assert.ok(artifact?.artifactId);
      assert.equal(artifact.sha256, digest(f.model));
      if (boundary === 'archived') assert.match(artifact.url, new RegExp(`/runs/${originalId}/`));
      await verifyHttpAndBackup(t, f, resumed.finished, artifact);
      posts += f.requests.filter(request => request.method === 'POST').length;
    }
    measurements.push({ boundary, cycles, childProcesses: cycles * 2, forcedTerminations: cycles, providerPosts: posts, duplicatePosts: posts - cycles, restoredArchives: cycles, elapsedMs: Math.round(performance.now() - begin), status: 'passed' });
  });

  test('provider accepts a request then process dies before receipt: resumed runtime blocks instead of ordering again', { timeout: 60000 }, async t => {
    const begin = performance.now(); let posts = 0;
    for (let i = 0; i < cycles; i++) {
      const f = await fixture(t), accepted = f.holdSubmission(), originalId = `unknown-${i}`;
      const first = startChild(t, f, 'unknown', originalId, originalId);
      await Promise.race([accepted, first.done.then(result => { throw new Error(`Child stopped before accepted request: ${result.stderr}`); })]);
      first.child.kill('SIGKILL'); await first.done;
      const resumed = await startChild(t, f, 'resume', originalId, `resume-unknown-${i}`).done;
      assert.equal(resumed.code, 0, resumed.stderr);
      assert.notEqual(resumed.finished?.status, 'done');
      assert.match(resumed.finished?.jobs[0]?.error ?? '', /genbestiller ikke automatisk/);
      assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
      const ledger = listDurableDocuments(durableStorePath(directories(f.root)), 'submission:');
      assert.equal(ledger.length, 1); assert.equal(ledger[0].value.state, 'submitting');
      posts += f.requests.filter(request => request.method === 'POST').length;
    }
    measurements.push({ boundary: 'accepted_without_receipt', cycles, childProcesses: cycles * 2, forcedTerminations: cycles, providerPosts: posts, duplicatePosts: posts - cycles, explicitlyBlockedResumes: cycles, elapsedMs: Math.round(performance.now() - begin), status: 'passed' });
  });

  after(() => {
    if (!process.env.ORBIT_RELIABILITY_REPORT) return;
    const report = { format: 'orbit-reliability-sample', version: 1, startedAt, finishedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started),
      status: measurements.length === 3 ? 'passed' : 'incomplete', platform: process.platform, architecture: process.arch,
      nodeVersion: process.version, sqliteVersion: process.versions.sqlite ?? null,
      baselineCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
      workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim()),
      testedSourceSha256: testedSources,
      sourcesChangedDuringSample: Object.entries(testedSources).filter(([file, hash]) => digest(readFileSync(join(repository, file))) !== hash).map(([file]) => file), measurements,
      scope: 'Local subprocess fault injection through executeRun, SQLite, actual HTTP provider fixture, immutable archive HTTP Range and workspace backup/restore. No real provider accounts or Windows installation.',
      limitations: ['Short measured sample, not a 24-hour endurance test.', 'Process termination is tested; host power loss, filesystem hardware failure and distributed workers are not.', 'Workspace JSON backup retains its 256 MB aggregate limit; valid larger media archives need a separate file backup.', 'Hashes identify source bytes at test start; baselineCommit alone does not identify these uncommitted changes.'] };
    const path = resolve(process.env.ORBIT_RELIABILITY_REPORT); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  });
}

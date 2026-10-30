import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerAiRoutes } from '../server/ai-engine.mjs';
import { localAiAccess } from '../server/local-access.mjs';
import { activeRuns } from '../server/ai-runtime.mjs';
import { stopAiProcesses } from '../server/ai-processes.mjs';

test('HTTP approval, validation, browser disconnect and persisted results', async t => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-http-'));
  const fake = join(root, 'fake.mjs'); writeFileSync(fake, "console.log('Verified fake agent result');");
  let cfg = { aiProviders: { codex: { cmd: process.execPath, cliTemplate: `"${fake}" {prompt}`, billingMode: 'included', noExtraCharges: true } }, aiPrefs: { autoJudge: false, selfHeal: false } };
  const app = express(); app.use(express.json()); app.use('/api/ai', localAiAccess);
  registerAiRoutes(app, { loadConfig: () => cfg, saveConfig: c => { cfg = c; }, APP_DIR: root });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => {
    for (const handle of activeRuns.values()) { handle.cancelled = true; handle.abort.abort(); handle.resolveApproval?.([]); }
    server.closeAllConnections(); server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => String(url).startsWith(base) ? nativeFetch(url, options) : Promise.reject(new Error('External network disabled'));
  t.after(() => { globalThis.fetch = nativeFetch; });
  const post = (path, body, extra = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  for (const patch of [{ allowPaidApis: true }, { autoJudge: 'false' }, { selfHeal: 1 }, { minimumReviewScore: '10' }, { minimumReviewScore: 11 }, { orchestrator: 'meshy' }, { undocumented: true }]) {
    assert.equal((await post('/api/ai/prefs', patch)).status, 400);
    assert.equal(cfg.aiPrefs.autoJudge, false); assert.equal(cfg.aiPrefs.selfHeal, false);
  }
  assert.equal((await post('/api/ai/prefs', { minimumReviewScore: 9 })).status, 200);
  assert.equal(cfg.aiPrefs.minimumReviewScore, 9);
  const plan = [{ id: 'a', title: 'One', serviceId: 'codex', description: 'Execute', dependsOn: [], phase: 'test' }];
  const response = await post('/api/ai/orchestrate', { goal: 'HTTP test', bible: 'Persistent bible', pauseAfterPlan: true, jobs: plan });
  const textPromise = response.text();
  // Attach rejection handling immediately so assertion failures can safely close SSE.
  void textPromise.catch(() => {});
  let run;
  for (const deadline = Date.now() + 20000; Date.now() < deadline;) {
    run = (await (await fetch(`${base}/api/ai/swarm`)).json()).run;
    if (run?.status === 'awaiting_approval') break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(run.status, 'awaiting_approval');
  const id = run.runId;
  const uploaded = await (await post('/api/ai/upload', { name: 'clarification.txt', mime: 'text/plain', dataBase64: Buffer.from('Preserve saved games').toString('base64') })).json();
  assert.equal(uploaded.ok, true);
  assert.equal((await post(`/api/ai/runs/${id}/message`, { text: 'Keep compatibility', attachments: [uploaded.file] })).status, 200);
  assert.equal((await post(`/api/ai/runs/${id}/message`, { text: 'Invalid attachment', attachments: [{ name: 'outside', path: '/etc/passwd' }] })).status, 400);
  assert.equal((await post(`/api/ai/runs/${id}/approve`, { jobs: [{ ...plan[0], dependsOn: [3] }] })).status, 400);
  assert.equal((await (await fetch(`${base}/api/ai/swarm`)).json()).run.status, 'awaiting_approval');
  assert.equal((await post(`/api/ai/runs/${id}/approve`, { jobs: plan })).status, 200);
  assert.match(await textPromise, /"type":"done"/);
  const saved = (await (await fetch(`${base}/api/ai/runs/${id}`)).json()).run;
  assert.equal(saved.status, 'done'); assert.equal(saved.bible, 'Persistent bible');
  assert.deepEqual(saved.instructions, ['Keep compatibility']);
  assert.equal(saved.attachments[0].name, 'clarification.txt');
  assert.equal(saved.processes.length, 0);
  const live = (await (await fetch(`${base}/api/ai/swarm?view=live`)).json()).run;
  assert.equal(live.bible, undefined); assert.equal(live.runId, saved.runId);
  assert.equal(saved.bible, 'Persistent bible');
  const history = await (await fetch(`${base}/api/ai/runs?limit=1&q=HTTP`)).json();
  assert.equal(history.total, 1); assert.equal(history.runs[0].runId, id);
  assert.equal(history.runs[0].bible, undefined); assert.equal(history.runs[0].results[0].text, undefined);
  for (const query of ['limit=0', 'limit=101', 'offset=-1', 'offset=1.5', 'q=a&q=b']) assert.equal((await fetch(`${base}/api/ai/runs?${query}`)).status, 400);
  const activityLog = await (await fetch(`${base}/api/ai/runs/${id}/events`)).text();
  assert.ok(activityLog.split('\n').filter(Boolean).map(line => JSON.parse(line)).some(event => event.type === 'run_finished'));
  const forbidden = await post('/api/ai/orchestrate', { goal: 'must not run' }, { Origin: 'https://untrusted.example' });
  assert.equal(forbidden.status, 403);
  // Disconnect after headers. The next run still finishes and is recoverable by GET.
  const ac = new AbortController();
  const stream = await fetch(`${base}/api/ai/orchestrate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: 'Detached', jobs: plan }), signal: ac.signal });
  assert.equal(stream.status, 200); ac.abort();
  for (const deadline = Date.now() + 20000; Date.now() < deadline;) {
    run = (await (await fetch(`${base}/api/ai/swarm`)).json()).run;
    if (run?.goal === 'Detached' && run.status === 'done') break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(run.goal, 'Detached'); assert.equal(run.status, 'done');
});

test('shutdown sees direct chat processes, can refuse active work, then drains and blocks new calls', async t => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-shutdown-')), fake = join(root, 'fake.mjs');
  writeFileSync(fake, "console.log('Direct chat active');setInterval(()=>{},1000);");
  let cfg = { aiProviders: { codex: { cmd: process.execPath, cliTemplate: `"${fake}" {prompt}`, billingMode: 'included', noExtraCharges: true } } };
  const app = express(); app.use(express.json()); app.use('/api/ai', localAiAccess);
  registerAiRoutes(app, { loadConfig: () => cfg, saveConfig: value => { cfg = value; }, APP_DIR: root });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { stopAiProcesses(); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await post('/api/ai/chat', { service: 'codex', messages: [{ role: 'user', text: 'Read-only fixture' }] });
  const output = response.text(); void output.catch(() => {});
  let state;
  for (let i = 0; i < 100; i++) {
    state = await (await fetch(`${base}/api/ai/swarm`)).json();
    if (state.processes.length) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(state.processes.length, 1); assert.equal(state.processes[0].kind, 'agent');
  assert.equal((await post('/api/ai/prepare-shutdown', { refuseActive: true })).status, 409);
  assert.equal((await (await fetch(`${base}/api/ai/swarm`)).json()).processes.length, 1);
  assert.equal((await post('/api/ai/prepare-shutdown', {})).status, 200);
  assert.match(await output, /Companion lukkes/);
  assert.deepEqual((await (await fetch(`${base}/api/ai/swarm`)).json()).processes, []);
  assert.equal((await post('/api/ai/chat', { service: 'codex', messages: [] })).status, 503);
  assert.equal((await post('/api/ai/queue/control', { action: 'resume' })).status, 503);
  assert.equal((await (await fetch(`${base}/api/ai/queue`)).json()).queue.paused, true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerAiRoutes } from '../server/ai-engine.mjs';
import { localAiAccess } from '../server/local-access.mjs';
import { activeRuns } from '../server/ai-runtime.mjs';

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
  assert.equal((await post(`/api/ai/runs/${id}/approve`, { jobs: [{ ...plan[0], dependsOn: [3] }] })).status, 400);
  assert.equal((await (await fetch(`${base}/api/ai/swarm`)).json()).run.status, 'awaiting_approval');
  assert.equal((await post(`/api/ai/runs/${id}/approve`, { jobs: plan })).status, 200);
  assert.match(await textPromise, /"type":"done"/);
  const saved = (await (await fetch(`${base}/api/ai/runs/${id}`)).json()).run;
  assert.equal(saved.status, 'done'); assert.equal(saved.bible, 'Persistent bible');
  assert.equal(saved.processes.length, 0);
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

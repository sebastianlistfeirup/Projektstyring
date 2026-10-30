import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerAiRoutes } from '../server/ai-engine.mjs';
import { activeRuns } from '../server/ai-runtime.mjs';

test('account delivery test is explicit, isolated, persisted and never upgrades user billing or unknown quota to provider proof', async t => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-account-test-'));
  const fake = join(root, 'fake.mjs');
  writeFileSync(fake, "console.log(process.argv.at(-1).match(/ORBIT_CHECK_[a-f0-9]+/)?.[0] ?? 'NO_MARKER');");
  const cfg = { aiProviders: { codex: { cmd: process.execPath, cliTemplate: `"${fake}" {prompt}`, billingMode: 'usage' } }, aiPrefs: { autoJudge: true, selfHeal: true } };
  const events = [], app = express(); app.use(express.json());
  registerAiRoutes(app, { loadConfig: () => cfg, saveConfig() {}, APP_DIR: root, broadcast: event => events.push(event) });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => String(url).startsWith(base) ? nativeFetch(url, options) : Promise.reject(new Error('External network disabled'));
  t.after(() => { globalThis.fetch = nativeFetch; for (const handle of activeRuns.values()) { handle.cancelled = true; handle.abort.abort(); } server.closeAllConnections(); server.close(); });
  const post = (id, body) => fetch(`${base}/api/ai/services/${id}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const getReport = async () => (await (await fetch(`${base}/api/ai/services/codex/verification`)).json()).report;
  assert.equal((await post('codex', {})).status, 400);
  assert.equal((await post('meshy', { execute: true })).status, 400);
  assert.equal((await post('codex', { execute: true })).status, 409);
  assert.equal(await getReport(), null);
  cfg.aiProviders.codex.billingMode = 'included'; cfg.aiProviders.codex.noExtraCharges = true;
  const started = await post('codex', { execute: true }); assert.equal(started.status, 202);
  const { runId } = await started.json();
  let report;
  for (const deadline = Date.now() + 15000; Date.now() < deadline;) {
    report = await getReport(); if (report?.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(report.status, 'passed'); assert.equal(report.delivery, 'verified');
  assert.equal(report.billing.source, 'user_confirmed'); assert.equal(report.quota.status, 'unknown');
  assert.equal(report.providerIdentity, 'not_independently_verified'); assert.equal(report.customTemplate, true);
  assert.equal(report.configurationHash, undefined); assert.equal(report.configurationChanged, false);
  assert.equal(cfg.aiPrefs.autoJudge, true); assert.equal(cfg.aiPrefs.selfHeal, true);
  const calls = events.filter(event => event.type === 'service_call_start');
  assert.equal(calls.length, 1); assert.equal(calls[0].call.serviceId, 'codex');
  const run = (await (await fetch(`${base}/api/ai/runs/${runId}`)).json()).run;
  assert.equal(run.jobs.length, 1); assert.equal(run.repository, null); assert.equal(run.jobs[0].readOnly, true);
  cfg.aiProviders.codex.model = 'a-different-model';
  assert.equal((await getReport()).configurationChanged, true);
  writeFileSync(join(root, 'ai-account-checks', 'codex.json'), JSON.stringify({ ...report, status: 'running', runId: 'unknown-crashed-run' }));
  assert.equal((await getReport()).status, 'interrupted');
});

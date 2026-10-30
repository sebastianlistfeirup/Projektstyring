// Offline endurance check for the old ten-minute auto-approval bug.
// Example: ORBIT_SOAK_MINUTES=12 node scripts/soak-ai.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { executeRun, activeRuns } from '../server/ai-runtime.mjs';
import { readRun } from '../server/ai-state.mjs';
import { setSecretsDir } from '../server/ai-services.mjs';

const minutes = Number(process.env.ORBIT_SOAK_MINUTES ?? 12);
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 10080) throw new Error('Choose 0–10080 minutes');
const root = mkdtempSync(join(tmpdir(), 'orbit-soak-'));
const dirs = { cwd: root, runs: join(root, 'runs'), memory: join(root, 'memory'), artifacts: join(root, 'artifacts') };
Object.values(dirs).forEach(d => mkdirSync(d, { recursive: true }));
setSecretsDir(root);
globalThis.fetch = async () => { throw new Error('Offline endurance test'); };
const fake = join(root, 'fake.mjs'); writeFileSync(fake, "console.log('Approved only after explicit decision');");
const cfg = { aiProviders: { codex: { cmd: process.execPath, cliTemplate: `"${fake}" {prompt}`, billingMode: 'included', noExtraCharges: true } }, aiPrefs: { autoJudge: false, selfHeal: false } };
const jobs = [{ id: 'job-0', title: 'Explicit approval', serviceId: 'codex', phase: 'test', dependsOn: [], description: 'Execute only after approval' }];
const started = Date.now();
let ready;
const waiting = new Promise(resolve => { ready = resolve; });
const running = executeRun({ runId: 'soak', goal: 'Endurance approval', bible: 'Preserve the entire project mandate.', cfg, dirs, predefinedJobs: jobs, pauseAfterPlan: true, emit: e => { if (e.type === 'plan' && e.paused) queueMicrotask(ready); } });
await waiting;
let samples = 0, lastMinute = -1;
try {
  while (Date.now() - started < minutes * 60000) {
    const run = readRun(dirs, 'soak');
    assert.equal(run.status, 'awaiting_approval');
    assert.equal(run.results.length, 0);
    assert.ok(!run.events.some(e => e.type === 'job_start'));
    assert.equal(run.bible, 'Preserve the entire project mandate.');
    if (Date.now() - started > 15000) assert.ok(Date.now() - run.heartbeatAt < 15000);
    samples++;
    const minute = Math.floor((Date.now() - started) / 60000);
    if (minute !== lastMinute) { lastMinute = minute; console.log(JSON.stringify({ minute, status: run.status, samples })); }
    await delay(Math.min(5000, Math.max(1, minutes * 60000 - (Date.now() - started))));
  }
  activeRuns.get('soak').resolveApproval(jobs);
  await running;
  assert.equal(readRun(dirs, 'soak').status, 'done');
  const report = { ok: true, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, samples, root, finalStatus: 'done' };
  writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  const handle = activeRuns.get('soak');
  if (handle) { handle.cancelled = true; handle.abort.abort(); handle.resolveApproval?.([]); }
  await running;
  throw error;
}

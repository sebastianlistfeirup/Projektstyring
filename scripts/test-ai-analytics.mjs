import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAnalysis, summarizeUsage } from '../server/ai-analytics.mjs';

test('analytics use measured attempts and durations without treating queued jobs as success or inventing costs', () => {
  const history = { total: 90, unreadable: 1, runs: [{ usage: { jobs: 2, byService: { codex: { jobs: 2, kind: 'cli' } } }, jobs: [
    { serviceId: 'codex', title: '__proto__', status: 'error', startedAt: 1000, finishedAt: 2000 },
    { serviceId: 'codex', title: 'Implemented', status: 'done', startedAt: 2000, finishedAt: 5000 },
    { serviceId: 'codex', title: 'Waiting', status: 'queued' },
    { serviceId: 'codex', title: 'Blocked', status: 'blocked', finishedAt: 6000 },
  ] }] };
  const analysis = summarizeAnalysis(history);
  assert.equal(analysis.avgJobMs, 2000); assert.equal(analysis.services[0].avgMs, 2000);
  assert.equal(analysis.services[0].errorRate, 50); assert.equal(analysis.services[0].attempts, 2);
  assert.equal(analysis.services[0].jobs, 4); assert.equal(analysis.errorTitles[0].title, '__proto__');
  assert.equal(analysis.totalAvailable, 90); assert.equal(analysis.windowRuns, 1); assert.equal(analysis.unreadable, 1);
  const usage = summarizeUsage(history);
  assert.equal(usage.totalJobs, 2); assert.equal(usage.totalRuns, 1); assert.equal(usage.estKr, null);
  assert.equal(usage.byService[0].subscriptionCovered, false); assert.equal(usage.byService[0].estKr, null);
  assert.equal(summarizeAnalysis({ runs: [], total: 0, unreadable: 0 }).avgJobMs, 0);
});

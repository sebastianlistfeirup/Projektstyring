import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveRun, readRun } from '../server/ai-state.mjs';
import { listRunSummaries, readRunSummary } from '../server/ai-history.mjs';

test('history paginates and filters compact summaries without leaking full documents or losing legacy runs', () => {
  const dirs = { runs: mkdtempSync(join(tmpdir(), 'orbit-history-')) };
  for (let i = 0; i < 30; i++) {
    const run = { runId: `run-${i}`, goal: `Realmread milestone ${i}`, projectId: i % 2 ? 'realmread' : 'other', status: 'done',
      startedAt: 100 + i, finishedAt: 900 + i * 100, bible: 'B'.repeat(20000), instructions: ['private full context'],
      jobs: [{ id: 'a', title: 'Code', status: 'done', description: 'D'.repeat(10000), text: 'T'.repeat(100000), actions: [{ label: 'Long event' }], startedAt: 1, finishedAt: 10 }],
      results: [{ jobId: 'a', title: 'Delivery', text: 'R'.repeat(100000), score: 9 }], events: [{ type: 'run_start' }, { type: 'done' }] };
    if (i === 0) writeFileSync(join(dirs.runs, 'run-0.json'), JSON.stringify(run)); // Old version without a cache.
    else saveRun(dirs, run);
  }
  writeFileSync(join(dirs.runs, 'ai-queue.json'), JSON.stringify({ entries: [] }));
  writeFileSync(join(dirs.runs, 'broken.json'), '{unfinished');
  const first = listRunSummaries(dirs, { limit: 12 });
  assert.equal(first.total, 30); assert.equal(first.nextOffset, 12); assert.equal(first.unreadable, 1);
  assert.equal(first.runs[0].runId, 'run-29'); assert.equal(first.runs[0].bible, undefined);
  assert.equal(first.runs[0].jobs[0].text, undefined); assert.equal(first.runs[0].results[0].text, undefined);
  assert.equal(first.runs[0].results[0].score, 9); assert.equal(first.runs[0].eventCount, 2);
  assert.ok(JSON.stringify(first).length < 15000);
  const all = [first, listRunSummaries(dirs, { limit: 12, offset: 12 }), listRunSummaries(dirs, { limit: 12, offset: 24 })];
  assert.equal(new Set(all.flatMap(page => page.runs.map(run => run.runId))).size, 30); assert.equal(all.at(-1).nextOffset, null);
  const filtered = listRunSummaries(dirs, { query: 'MILESTONE 2', projectId: 'realmread' });
  assert.deepEqual(filtered.runs.map(run => run.runId), ['run-29', 'run-27', 'run-25', 'run-23', 'run-21']);
  assert.equal(readRun(dirs, 'run-0').bible.length, 20000);
  const cache = join(dirs.runs, 'run-0.summary'), before = statSync(cache).mtimeMs;
  assert.ok(readFileSync(cache).length < 2000); listRunSummaries(dirs); assert.equal(statSync(cache).mtimeMs, before);
  rmSync(join(dirs.runs, 'run-0.json')); assert.equal(listRunSummaries(dirs).total, 29); // An orphan index cannot revive a run.
});

test('history invalidates stale or corrupt indexes and orders mixed old/new timestamps by time', () => {
  const dirs = { runs: mkdtempSync(join(tmpdir(), 'orbit-history-refresh-')) };
  saveRun(dirs, { runId: 'a', goal: 'Before', status: 'running', startedAt: 1000 });
  writeFileSync(join(dirs.runs, 'a.json'), JSON.stringify({ runId: 'a', goal: 'After a legacy update', status: 'done', finishedAt: 1200 }));
  assert.equal(readRunSummary(dirs, 'a').goal, 'After a legacy update');
  writeFileSync(join(dirs.runs, 'a.summary'), 'broken'); assert.equal(readRunSummary(dirs, 'a').status, 'done');
  saveRun(dirs, { runId: 'b', goal: 'ISO date', status: 'done', finishedAt: '2026-10-30T00:00:00Z' });
  saveRun(dirs, { runId: 'c', goal: 'Active', status: 'running', startedAt: Date.parse('2026-10-31T00:00:00Z') });
  assert.deepEqual(listRunSummaries(dirs).runs.map(run => run.runId), ['c', 'b', 'a']);
  assert.equal(readRunSummary(dirs, '../outside'), null);
});

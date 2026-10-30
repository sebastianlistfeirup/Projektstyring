import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRunEvent, eventJournalPath, saveRun, readRun, runPath, saveRunHeartbeat, withRunEvents } from '../server/ai-state.mjs';

test('append-only journal freezes old plans and bounds the live snapshot without losing history', () => {
  const dirs = { runs: mkdtempSync(join(tmpdir(), 'orbit-journal-')) }, run = { runId: 'journal', events: [], status: 'running', jobs: [], bible: 'Full context' };
  const jobs = [{ id: 'original' }];
  appendRunEvent(dirs, run, { at: 1, type: 'plan', jobs }); jobs.push({ id: 'later-repair' });
  for (let index = 0; index < 500; index++) appendRunEvent(dirs, run, { at: index + 2, type: 'job_action', action: { id: `a${index}`, label: `Action ${index}` } });
  assert.equal(run.events.length, 400); assert.equal(run.eventCount, 501);
  saveRun(dirs, run);
  const full = withRunEvents(dirs, readRun(dirs, 'journal'));
  assert.equal(full.events.length, 501); assert.equal(full.events[0].jobs.length, 1); assert.equal(full.eventsTruncated, false);
  assert.equal(readRun(dirs, 'journal').events.length, 400);
});

test('heartbeat updates do not rewrite the complete project snapshot', () => {
  const dirs = { runs: mkdtempSync(join(tmpdir(), 'orbit-pulse-')) }, run = { runId: 'pulse', status: 'awaiting_approval', bible: 'B'.repeat(100000), heartbeatAt: 10 };
  saveRun(dirs, run); const before = readFileSync(runPath(dirs, 'pulse'), 'utf8');
  run.heartbeatAt = 20; saveRunHeartbeat(dirs, run);
  assert.equal(readFileSync(runPath(dirs, 'pulse'), 'utf8'), before);
  assert.equal(readRun(dirs, 'pulse').heartbeatAt, 20);
  assert.ok(readFileSync(join(dirs.runs, 'pulse.pulse')).length < 200);
});

test('large or incomplete journals do not masquerade as complete replay history', () => {
  const dirs = { runs: mkdtempSync(join(tmpdir(), 'orbit-journal-limit-')) }, run = { runId: 'limited', events: [] };
  appendRunEvent(dirs, run, { at: 1, type: 'run_start' });
  appendFileSync(eventJournalPath(dirs, 'limited'), '{"incomplete"');
  assert.equal(withRunEvents(dirs, run).eventsTruncated, true);
  truncateSync(eventJournalPath(dirs, 'limited'), 8 * 1024 * 1024 + 1);
  const large = withRunEvents(dirs, run); assert.equal(large.eventsTruncated, true); assert.deepEqual(large.events, []);
});


test('live polling omits full documents and marks long delivery previews explicitly', async () => {
  const { liveRunView } = await import('../server/ai-state.mjs');
  const run = { runId: 'large', bible: 'B'.repeat(1000000), attachments: [{ dataUrl: 'large' }], events: [{ large: 'raw' }], contextManifest: { documents: [{ sha256: 'identity' }] },
    jobs: [{ id: 'j', description: 'D'.repeat(10000), text: 'T'.repeat(10000), actions: Array.from({ length: 100 }, (_, id) => ({ id })) }], results: [{ jobId: 'j', text: 'R'.repeat(20000) }] };
  const view = liveRunView(run);
  assert.equal(view.bible, undefined); assert.equal(view.events, undefined); assert.equal(view.attachments, undefined);
  assert.equal(view.results[0].text.length, 6000); assert.equal(view.results[0].textTruncated, true);
  assert.equal(view.jobs[0].actions.length, 12); assert.equal(view.jobs[0].textTruncated, true);
  assert.equal(view.contextManifest.documents[0].sha256, 'identity'); assert.equal(run.bible.length, 1000000);
  assert.ok(JSON.stringify(view).length < 12000);
});

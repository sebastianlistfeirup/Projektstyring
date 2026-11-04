import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveEventBuffer } from '../shared/live-event-buffer.mjs';

test('text bursts are bounded, preserve event counts and flush before terminal metadata', () => {
  const deliveries = [], scheduled = new Set();
  const buffer = createLiveEventBuffer(events => deliveries.push(events), { schedule: callback => { scheduled.add(callback); return callback; }, cancel: callback => scheduled.delete(callback) });
  for (let i = 0; i < 1000; i++) buffer.push({ type: 'job_delta', runId: 'one', jobId: 'a', delta: '0123456789' });
  assert.equal(deliveries.length, 0); assert.equal(scheduled.size, 1);
  buffer.push({ type: 'job_done', runId: 'one', jobId: 'a' });
  assert.equal(deliveries[0][0].deltaCount, 1000); assert.equal(deliveries[0][0].delta.length, 400);
  assert.equal(deliveries[1][0].type, 'job_done'); assert.equal(scheduled.size, 0);
  for (let i = 0; i < 130; i++) buffer.push({ type: 'subagent_delta', runId: 'one', jobId: 'a', subId: String(i), delta: 'x' });
  buffer.flush(); assert.ok(deliveries.every(batch => batch.length <= 64));
  assert.equal(deliveries.flat().filter(event => event.type === 'subagent_delta').length, 130);
  assert.equal(scheduled.size, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableRunQueue } from '../server/ai-queue.mjs';
import { cronMatches, validateCron } from '../server/ai-runtime.mjs';

const path = () => join(mkdtempSync(join(tmpdir(), 'orbit-queue-')), 'queue.json');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

test('queue persists while busy, deduplicates tasks and schedule minutes, and executes serially', async () => {
  const file = path(), runs = new Map(), calls = []; let busy = true, concurrent = 0;
  const dependencies = { path: file, isBusy: () => busy, readRun: id => runs.get(id), execute: async input => {
    concurrent++; assert.equal(concurrent, 1); calls.push(input.goal);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).entries.find(entry => entry.runId === input.runId).status, 'running');
    await new Promise(resolve => setImmediate(resolve)); runs.set(input.runId, { status: 'done' }); concurrent--;
  } };
  const queue = new DurableRunQueue(dependencies);
  queue.enqueue({ goal: 'One', projectId: 'p', taskId: 't' }, { key: 'minute:1' });
  assert.equal(queue.enqueue({ goal: 'Again', projectId: 'p', taskId: 't' }).duplicate, true);
  assert.equal(queue.enqueue({ goal: 'Again' }, { key: 'minute:1' }).duplicate, true);
  queue.enqueue({ goal: 'Two' }); await queue.pump(); assert.equal(calls.length, 0);
  const restarted = new DurableRunQueue(dependencies); restarted.recover();
  busy = false; await restarted.pump(); await settle();
  assert.deepEqual(calls, ['One', 'Two']); assert.ok(restarted.state.entries.every(entry => entry.status === 'done'));
  assert.equal(restarted.enqueue({ goal: 'Again' }, { key: 'minute:1' }).duplicate, true);
});

test('failed runs pause the queue and a later explicit continuation can dispatch the next task', async () => {
  const runs = new Map(), calls = [], queue = new DurableRunQueue({ path: path(), readRun: id => runs.get(id), execute: async input => { calls.push(input.goal); runs.set(input.runId, { status: input.goal === 'Fail' ? 'error' : 'done' }); } });
  queue.enqueue({ goal: 'Fail' }); queue.enqueue({ goal: 'Next' });
  await queue.pump(); await settle(); assert.deepEqual(calls, ['Fail']); assert.equal(queue.state.paused, true);
  queue.resume(); await settle(); assert.deepEqual(calls, ['Fail', 'Next']);
});

test('a crash after a claim never replays the claimed action; final persisted runs reconcile', () => {
  for (const runStatus of [undefined, 'interrupted', 'done']) {
    const file = path(), queue = new DurableRunQueue({ path: file, readRun: () => runStatus ? { status: runStatus } : undefined });
    const { entry } = queue.enqueue({ goal: 'Claimed' });
    queue.commit(state => { const item = state.entries.find(item => item.id === entry.id); item.status = 'running'; item.runId = 'r'; });
    const recovered = new DurableRunQueue({ path: file, readRun: queue.readRun }); recovered.recover();
    assert.equal(recovered.state.entries[0].status, runStatus === 'done' ? 'done' : 'interrupted');
    assert.equal(recovered.state.paused, runStatus !== 'done');
  }
});

test('queue revalidates scope at dispatch and cannot resume over a surviving process', async () => {
  let calls = 0;
  const queue = new DurableRunQueue({ path: path(), resolveInput: () => { throw new Error('Outside scope'); }, execute: async () => { calls++; } });
  queue.enqueue({ goal: 'Changed scope' }); await queue.pump();
  assert.equal(calls, 0); assert.equal(queue.state.entries[0].status, 'blocked'); assert.match(queue.state.reason, /Outside scope/);
  queue.canResume = () => 'Live process'; assert.throws(() => queue.resume(), /Live process/);
});

test('corrupt queues fail closed and restore reloads only the saved queue, paused', async () => {
  const file = path(); writeFileSync(file, 'broken');
  const corrupt = new DurableRunQueue({ path: file });
  assert.equal(corrupt.state.paused, true); assert.throws(() => corrupt.enqueue({ goal: 'Unsafe' }), /kunne ikke læses/);
  await corrupt.pump(); assert.equal(readFileSync(file, 'utf8'), 'broken');
  const goodFile = path(), queue = new DurableRunQueue({ path: goodFile }); queue.enqueue({ goal: 'Original' });
  const backup = readFileSync(goodFile, 'utf8'); queue.enqueue({ goal: 'Stale memory' }); writeFileSync(goodFile, backup);
  queue.reloadAfterRestore(); assert.equal(queue.state.entries.length, 1); assert.equal(queue.state.paused, true);
});

test('cron validates ranges and steps instead of accepting silently inert schedules', () => {
  for (const expr of ['*/0 * * * *', '99 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '* * * * 7', 'bad bad bad bad bad']) assert.throws(() => validateCron(expr));
  assert.equal(cronMatches('*/5 * * * *', new Date(2026, 0, 1, 8, 10)), true);
  assert.equal(cronMatches('0 8 * */2 *', new Date(2026, 0, 1, 8, 0)), true);
  assert.equal(cronMatches('0 8 * */2 *', new Date(2026, 1, 1, 8, 0)), false);
});


test('restored queues remain blocked if their required pause cannot be persisted', async () => {
  const file = path(), calls = [];
  const queue = new DurableRunQueue({ path: file, execute: input => calls.push(input), readRun: () => null });
  queue.enqueue({ goal: 'Must remain paused' });
  queue.commit = () => { throw new Error('Simulated unavailable disk'); };
  queue.reloadAfterRestore();
  assert.equal(queue.state.paused, true); assert.match(queue.storageError, /pause kunne ikke gemmes/);
  await queue.pump(); assert.equal(calls.length, 0);
  assert.throws(() => queue.enqueue({ goal: 'No new dispatch' }), /pause kunne ikke gemmes/);
});

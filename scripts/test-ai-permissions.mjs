import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativePermissions } from '../server/ai-permissions.mjs';
import { claudeControl } from '../server/claude-control.mjs';

test('permissions wait for a specific one-time decision and reject stale or cancelled approvals', async () => {
  const queue = new NativePermissions(), events = [], controller = new AbortController();
  let settled = false;
  const pending = queue.request({ tool_name: 'Bash', input: { command: 'godot --headless --import' } }, { signal: controller.signal, runId: 'run-a', onEvent: e => events.push(e) }).then(r => { settled = true; return r; });
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(settled, false);
  const request = queue.snapshot()[0];
  assert.equal(request.input.command, 'godot --headless --import');
  assert.ok(!JSON.stringify(events).includes('godot --headless'));
  assert.throws(() => queue.decide('other-request', { decision: 'allow' }));
  queue.decide(request.id, { decision: 'allow', updatedInput: { command: 'changed by client' } });
  assert.deepEqual(await pending, { behavior: 'allow', updatedInput: { command: 'godot --headless --import' } });
  assert.throws(() => queue.decide(request.id, { decision: 'allow' }));
  const next = queue.request({ tool_name: 'Read', input: { file_path: '/project/bible.md' } }, { signal: controller.signal });
  const stale = queue.snapshot()[0].id; controller.abort();
  assert.equal((await next).behavior, 'deny'); assert.equal(queue.snapshot().length, 0);
  assert.throws(() => queue.decide(stale, { decision: 'allow' }));
});

test('read-only jobs cannot approve commands and user questions require actual answers', async () => {
  const queue = new NativePermissions();
  assert.equal((await queue.request({ tool_name: 'Bash', input: { command: 'touch file' } }, { readOnly: true })).behavior, 'deny');
  assert.equal(queue.snapshot().length, 0);
  const waiting = queue.request({ tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Hvilken reference?', options: [{ label: 'Realmread' }] }] } }, { readOnly: true });
  const id = queue.snapshot()[0].id;
  assert.throws(() => queue.decide(id, { decision: 'allow' }));
  queue.decide(id, { decision: 'allow', answers: { 'Hvilken reference?': 'Realmread og de vedtagne referencebilleder' } });
  assert.equal((await waiting).updatedInput.answers['Hvilken reference?'], 'Realmread og de vedtagne referencebilleder');
  assert.equal((await queue.request({ tool_name: 'AskUserQuestion', input: { questions: [null] } })).behavior, 'deny');
});

test('Claude control protocol sends matched responses and retains stdin for background agent permissions', async () => {
  const writes = [], queue = new NativePermissions(); let ended = false;
  const transport = claudeControl({ prompt: 'Execute', write: text => writes.push(JSON.parse(text)), end: () => { ended = true; }, onFailure: error => { throw error; }, onPermission: (request, options) => queue.request(request, options) });
  transport.start();
  transport.event({ type: 'control_response', response: { subtype: 'success', request_id: writes[0].request_id, response: {} } });
  assert.equal(writes[1].message.content, 'Execute');
  transport.event({ type: 'system', subtype: 'task_started', task_id: 'child', task_type: 'local_agent' });
  transport.event({ type: 'result', result: 'Parent complete' }); assert.equal(ended, false);
  transport.event({ type: 'control_request', request_id: 'permission-1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'godot --version' } } });
  await new Promise(resolve => setImmediate(resolve));
  queue.decide(queue.snapshot()[0].id, { decision: 'allow' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.at(-1).response.request_id, 'permission-1');
  assert.equal(writes.at(-1).response.response.updatedInput.command, 'godot --version');
  transport.event({ type: 'system', subtype: 'task_updated', task_id: 'child', patch: { status: 'completed' } });
  assert.equal(ended, true); transport.close();
});

test('native cancellation or process exit invalidates the approval card', async () => {
  const queue = new NativePermissions(), writes = [];
  const transport = claudeControl({ prompt: 'Execute', write: text => writes.push(JSON.parse(text)), end() {}, onFailure: error => { throw error; }, onPermission: (request, options) => queue.request(request, options) });
  transport.event({ type: 'control_request', request_id: 'cancel-me', request: { subtype: 'can_use_tool', tool_name: 'Read', input: { file_path: 'bible.md' } } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(queue.snapshot().length, 1);
  transport.event({ type: 'control_cancel_request', request_id: 'cancel-me' });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(queue.snapshot().length, 0); assert.equal(writes.length, 0);
  transport.event({ type: 'control_request', request_id: 'exit-pending', request: { subtype: 'can_use_tool', tool_name: 'Read', input: { file_path: 'bible.md' } } });
  await new Promise(resolve => setImmediate(resolve));
  const stale = queue.snapshot()[0].id;
  transport.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queue.snapshot().length, 0); assert.equal(writes.length, 0);
  assert.throws(() => queue.decide(stale, { decision: 'allow' }));
});

test('a failed audit never grants permission', async () => {
  const queue = new NativePermissions();
  const pending = queue.request({ tool_name: 'Bash', input: { command: 'run-check' } }, { onEvent: event => { if (event.type === 'permission_resolved') throw new Error('Disk unavailable'); } });
  queue.decide(queue.snapshot()[0].id, { decision: 'allow' });
  assert.equal((await pending).behavior, 'deny'); assert.equal(queue.snapshot().length, 0);
});

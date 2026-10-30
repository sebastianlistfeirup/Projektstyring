import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentEvents } from '../server/ai-events.mjs';
import { chatCli } from '../server/ai-services.mjs';

test('Codex events expose actual actions and final text without reasoning', () => {
  const text = [], actions = [], subagents = [];
  const emit = agentEvents('codex', { onText: t => text.push(t), onAction: a => actions.push(a), onSubagent: a => subagents.push(a) });
  emit({ type: 'item.completed', item: { id: 'r', type: 'reasoning', text: 'private thought' } });
  emit({ type: 'item.started', item: { id: 'cmd', type: 'command_execution', command: 'npm test' } });
  emit({ type: 'item.completed', item: { id: 'cmd', type: 'command_execution', command: 'npm test', exit_code: 1, aggregated_output: 'test failed' } });
  emit({ type: 'item.completed', item: { id: 'files', type: 'file_change', changes: [{ kind: 'update', path: 'game.gd' }], status: 'completed' } });
  emit({ type: 'item.completed', item: { id: 'final', type: 'agent_message', text: 'Result' } });
  emit({ type: 'item.started', item: { id: 'agent', type: 'collab_tool_call', tool: 'spawn_agent', receiver_thread_ids: ['child'] } });
  assert.deepEqual(text, ['Result']);
  assert.deepEqual(actions.map(a => a.status), ['running', 'error', 'done']);
  assert.equal(actions[2].label, 'update: game.gd');
  assert.equal(subagents[0].subId, 'child');
  assert.throws(() => emit({ type: 'turn.failed', error: { message: 'quota' } }), /quota/);
});

test('Claude tracks MCP and Agent tools and reports failed child results', () => {
  const actions = [], children = [];
  const emit = agentEvents('claude', { onAction: a => actions.push(a), onSubagent: a => children.push(a) });
  emit({ type: 'assistant', message: { content: [
    { type: 'thinking', thinking: 'private' },
    { type: 'tool_use', id: 'm', name: 'mcp__docs__search', input: { apiKey: 'not exposed' } },
    { type: 'tool_use', id: 'a', name: 'Agent', input: { description: 'Review' } },
  ] } });
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', is_error: true }, { type: 'tool_result', tool_use_id: 'm' }] } });
  assert.equal(actions[0].kind, 'mcp');
  assert.equal(actions[1].status, 'done');
  assert.equal(children[1].phase, 'done');
  assert.ok(children[1].error);
  assert.ok(!JSON.stringify(actions).includes('not exposed'));
});

test('CLI reads final JSON line and callback failures terminate without crashing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-cli-')), script = join(root, 'agent.mjs');
  writeFileSync(script, `process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'æøå'}}));`);
  const messages = [];
  await chatCli({ cmd: process.execPath, cliTemplate: `"${script}" {prompt}`, prompt: 'test', cwd: root, jsonl: true, onEvent: agentEvents('codex', { onText: t => messages.push(t) }) });
  assert.deepEqual(messages, ['æøå']);
  writeFileSync(script, `setInterval(()=>{},100);`);
  await assert.rejects(chatCli({ cmd: process.execPath, cliTemplate: `"${script}" {prompt}`, prompt: 'test', cwd: root, onProcess: p => { if (!p.finished) throw new Error('Disk full'); } }), /Disk full/);
});

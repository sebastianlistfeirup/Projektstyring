import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentEvents } from '../server/ai-events.mjs';
import { chatCli, cliArguments, inspectCliInstallation, runChat, setSecretsDir } from '../server/ai-services.mjs';
import { nativeCliOptions } from '../server/ai-cli-options.mjs';
import { serviceCapabilities } from '../server/ai-capabilities.mjs';

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
  emit({ type: 'item.completed', item: { type: 'collab_tool_call', tool: 'spawn_agent', receiver_thread_ids: ['child'] } });
  assert.equal(subagents.at(-1).phase, 'start');
  emit({ type: 'item.completed', item: { type: 'collab_tool_call', tool: 'wait', receiver_thread_ids: ['child'], agents_states: { child: { status: 'completed' } } } });
  assert.equal(subagents.at(-1).phase, 'done');
  assert.throws(() => emit({ type: 'turn.failed', error: { message: 'quota' } }), /quota/);
});

test('Gemini, Kimi and Qwen native streams expose tool status and fail on terminal errors', () => {
  const texts = [], actions = [], children = [];
  const callbacks = { onText: t => texts.push(t), onAction: a => actions.push(a), onSubagent: a => children.push(a) };
  const gemini = agentEvents('gemini', callbacks);
  gemini({ type: 'message', role: 'user', content: 'private input' });
  gemini({ type: 'message', role: 'assistant', content: 'Gemini reply' });
  gemini({ type: 'tool_use', tool_id: 'g', tool_name: 'run_shell_command', parameters: { command: 'npm test', key: 'hidden' } });
  gemini({ type: 'tool_result', tool_id: 'g', status: 'error', error: { message: 'Test failed' } });
  assert.equal(actions.at(-1).status, 'error');
  assert.throws(() => gemini({ type: 'result', status: 'error', error: { message: 'Quota' } }), /Quota/);
  const kimi = agentEvents('kimi', callbacks);
  kimi({ role: 'assistant', content: 'Kimi reply', tool_calls: [{ id: 'k', function: { name: 'Read', arguments: '{"path":"game.gd"}' } }] });
  kimi({ role: 'tool', tool_call_id: 'k', content: 'Contents of game.gd' });
  assert.equal(actions.at(-1).status, 'done');
  assert.equal(actions.at(-1).label, 'game.gd');
  assert.throws(() => kimi({ type: 'error', message: 'Unavailable' }), /Unavailable/);
  const qwen = agentEvents('qwen-code', callbacks);
  qwen({ type: 'assistant', message: { content: [{ type: 'text', text: 'Qwen reply' }, { type: 'tool_use', id: 'q', name: 'Agent', input: { description: 'Review save/load' } }] } });
  qwen({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'q' }] } });
  assert.equal(children.at(-1).phase, 'done');
  assert.deepEqual(texts, ['Gemini reply', 'Kimi reply', 'Qwen reply']);
  assert.ok(!JSON.stringify(actions).includes('hidden'));
});

test('native CLI options preserve prompt values and Kimi analysis uses a read-only tool profile', () => {
  const contextDir = mkdtempSync(join(tmpdir(), 'orbit-options-'));
  for (const id of ['codex', 'claude', 'gemini', 'qwen-code', 'kimi']) {
    const options = nativeCliOptions(id, { readOnly: true, accessDirs: ['a path'], contextDir });
    const args = cliArguments(id === 'codex' ? 'exec --skip-git-repo-check {prompt}' : '-p {prompt}', 'actual prompt', options.args);
    assert.equal(options.jsonl, true);
    if (id !== 'codex') assert.equal(args[args.indexOf('-p') + 1], 'actual prompt');
    else assert.equal(args[0], 'exec');
    assert.equal(serviceCapabilities({ id }).repository, true);
  }
  const profile = readFileSync(join(contextDir, 'orbit-reader.md'), 'utf8');
  assert.match(profile, /tools:\n  - Read\n  - Grep\n  - Glob/);
  assert.ok(!profile.includes('Bash'));
  assert.equal(serviceCapabilities({ id: 'qwen' }).repository, false);
  assert.throws(() => cliArguments('-p', 'lost prompt'), /prompt/);
  const imageOptions = nativeCliOptions('codex', { imagePaths: ['shot one.png', 'shot-two.png'] });
  const imageArgs = cliArguments('exec --skip-git-repo-check {prompt}', 'Inspect images', imageOptions.args);
  assert.deepEqual(imageArgs.slice(imageArgs.indexOf('--image'), imageArgs.indexOf('--skip-git-repo-check')), ['--image', 'shot one.png', '--image', 'shot-two.png']);
});

test('installation probe runs version only and never reports verified login or quota', async () => {
  setSecretsDir(mkdtempSync(join(tmpdir(), 'orbit-probe-')));
  const result = await inspectCliInstallation('codex', { aiProviders: { codex: { cmd: process.execPath } } });
  assert.match(result.version, /\d+\.\d+/);
  assert.equal(result.login, 'not_checked');
  await assert.rejects(inspectCliInstallation('meshy', {}), /ikke en lokal CLI/);
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

test('CLI cancellation terminates grandchildren even when their parent exits first', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-cli-tree-')), marker = join(root, 'pulse'), script = join(root, 'parent.mjs');
  const childScript = `const fs=require('fs'); process.on('SIGTERM',()=>{}); setInterval(()=>fs.writeFileSync(${JSON.stringify(marker)},String(Date.now())),20);`;
  writeFileSync(script, `import {spawn} from 'node:child_process';spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore'});setInterval(()=>{},1000);`);
  const controller = new AbortController();
  const pending = chatCli({ cmd: process.execPath, cliTemplate: `"${script}" {prompt}`, prompt: 'test', cwd: root, signal: controller.signal });
  void pending.catch(() => {});
  try {
    for (let i = 0; i < 200 && !existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(existsSync(marker), 'grandchild started');
  } finally { controller.abort(); }
  await assert.rejects(pending, /Afbrudt/);
  const pulse = readFileSync(marker, 'utf8');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(readFileSync(marker, 'utf8'), pulse);
});


test('separate native calls cannot overwrite each others tool or subagent events', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-event-ids-'));
  writeFileSync(join(root, 'exec'), `console.log(JSON.stringify({type:'item.completed',item:{id:'item_0',type:'command_execution',command:'test',exit_code:0}})); console.log(JSON.stringify({type:'item.started',item:{type:'collab_tool_call',tool:'spawn_agent',receiver_thread_ids:['child_0']}}));`);
  const cfg = { aiProviders: { codex: { cmd: process.execPath, billingMode: 'included', noExtraCharges: true } } };
  const actions = [], children = [];
  for (let i = 0; i < 2; i++) await runChat({ serviceId: 'codex', messages: [{ role: 'user', text: 'Task' }], cfg, dirs: { runs: root, cwd: root }, cwd: root, onAction: action => actions.push(action), onSubagent: child => children.push(child) });
  assert.equal(actions.length, 2); assert.notEqual(actions[0].id, actions[1].id);
  assert.equal(children.length, 2); assert.notEqual(children[0].subId, children[1].subId);
});


test('native Claude events retain explicit nested agent ancestry', () => {
  const children = [];
  const emit = agentEvents('claude', { onSubagent: event => children.push(event) });
  emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'parent', name: 'Agent', input: { description: 'First agent' } }] } });
  emit({ type: 'assistant', parent_tool_use_id: 'parent', message: { content: [{ type: 'tool_use', id: 'child', name: 'Agent', input: { description: 'Nested agent' } }] } });
  assert.equal(children[1].parentSubId, 'parent'); assert.equal(children[1].subId, 'child');
  assert.equal(children[0].parentSubId, undefined);
});

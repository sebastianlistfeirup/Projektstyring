import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { nativeCliOptions } from '../server/ai-cli-options.mjs';
import { agentEvents } from '../server/ai-events.mjs';
import { assertUsable, serviceById, runChat, setSecretsDir, chatCli } from '../server/ai-services.mjs';

const included = { billingMode: 'included', noExtraCharges: true };

test('Grok Build has a native adapter without requiring a guessed custom template', () => {
  setSecretsDir(mkdtempSync(join(tmpdir(), 'orbit-grok-unit-')));
  assert.doesNotThrow(() => assertUsable(serviceById('grok'), { aiProviders: { grok: included } }));
  assert.throws(() => assertUsable(serviceById('grok'), { aiProviders: { grok: {} } }));
  const read = nativeCliOptions('grok', { readOnly: true, accessDirs: ['C:\\Art assets'], model: 'selected-model' });
  assert.equal(read.jsonl, true);
  assert.equal(read.args[read.args.indexOf('--tools') + 1], 'Read,Grep,Glob');
  assert.equal(read.args[read.args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.ok(read.args.includes('--no-subagents'));
  assert.ok(read.args.includes('MCPTool'));
  assert.ok(!read.args.includes('--always-approve'));
  const write = nativeCliOptions('grok', { readOnly: false });
  assert.equal(write.args[write.args.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.ok(!write.args.includes('--always-approve'));
});

test('Grok message stream normalizes text, file reads, failed tools and nested agents without thinking', () => {
  const text = [], actions = [], children = [];
  const emit = agentEvents('grok', { onText: x => text.push(x), onAction: x => actions.push(x), onSubagent: x => children.push(x) });
  emit({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: 'Result' }, { type: 'tool_use', id: 'read', name: 'read_file', input: { target_file: 'Docs/bible.md' } }] } });
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'read', is_error: true }] } });
  emit({ type: 'assistant', parent_tool_use_id: 'parent', message: { content: [{ type: 'tool_use', id: 'child', name: 'task', input: { description: 'Read requirements' } }] } });
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'child' }] } });
  emit({ type: 'result', is_error: false, result: 'Result' });
  assert.deepEqual(text, ['Result']);
  assert.equal(actions[0].label, 'Docs/bible.md');
  assert.equal(actions[1].status, 'error');
  assert.equal(children[0].parentSubId, 'parent');
  assert.equal(children[1].phase, 'done');
  assert.throws(() => emit({ type: 'result', is_error: true, errors: ['Login required'] }), /Login required/);
});

test('Grok subprocess drops API-key environment fallback and disables background updates', async t => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-grok-env-'));
  const script = join(root, 'env.mjs');
  writeFileSync(script, `console.log(JSON.stringify({ keyPresent: ['XAI_API_KEY','GROK_API_KEY','GROK_DEPLOYMENT_KEY'].some(k => Boolean(process.env[k])), updates: process.env.GROK_DISABLE_AUTOUPDATER, memory: process.env.GROK_MEMORY }));`);
  const keys = ['XAI_API_KEY', 'GROK_API_KEY', 'GROK_DEPLOYMENT_KEY'];
  const previous = keys.map(k => process.env[k]);
  for (const key of keys) process.env[key] = 'fixture-not-real';
  t.after(() => keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }));
  let output = '';
  await chatCli({ cmd: process.execPath, cliTemplate: `"${script}" {prompt}`, prompt: 'unused', cwd: root, grok: true, onDelta: d => { output += d; } });
  assert.deepEqual(JSON.parse(output), { keyPresent: false, updates: '1', memory: '0' });
});

// Optional genuine CLI transport/permission check against a local model fixture.
// No provider login or credits. Download the official binary separately, then:
// ORBIT_GROK_BIN=/absolute/path/to/grok node --test scripts/test-ai-grok.mjs
const binary = process.env.ORBIT_GROK_BIN;
test('real Grok CLI reads and writes through Orbit, but refuses a forced shell write in analysis', { skip: !binary, timeout: 90000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-grok-transport-'));
  const sentinel = join(root, 'must-not-exist');
  writeFileSync(join(root, 'bible.txt'), 'ORBIT_BIBLE_FIXTURE');
  let scenario = 'read', served = false;
  const toolResults = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'fixture', object: 'model' }] })); return; }
    let input = ''; for await (const chunk of req) input += chunk;
    const body = JSON.parse(input);
    const primary = body.tools?.some(tool => tool.function?.name === 'read_file');
    for (const message of body.messages ?? []) if (message.role === 'tool') toolResults.push(message.content);
    let delta = { role: 'assistant', content: 'ORBIT_TRANSPORT_OK' }, finish = 'stop';
    if (primary && !served) {
      served = true;
      const call = scenario === 'read' ? { name: 'read_file', arguments: JSON.stringify({ target_file: join(root, 'bible.txt') }) }
        : scenario === 'write' ? { name: 'write', arguments: JSON.stringify({ file_path: join(root, 'delivery.txt'), content: 'ORBIT_WRITTEN_FIXTURE' }) }
        : scenario === 'blocked-edit' ? { name: 'write', arguments: JSON.stringify({ file_path: sentinel, content: 'forbidden' }) }
        : { name: 'bash', arguments: JSON.stringify({ command: `echo forbidden > "${sentinel}"` }) };
      delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'tool-fixture', type: 'function', function: call }] };
      finish = 'tool_calls';
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const [d, f] of [[delta, null], [{}, finish]]) res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture', choices: [{ index: 0, delta: d, finish_reason: f }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const previous = process.env.GROK_HOME;
  process.env.GROK_HOME = root;
  t.after(() => { if (previous === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = previous; server.closeAllConnections(); server.close(); });
  writeFileSync(join(root, 'config.toml'), `[model.orbit-fixture]\nmodel = "fixture"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\napi_key = "not-a-real-key"\napi_backend = "chat_completions"\n[models]\ndefault = "orbit-fixture"\n`);
  setSecretsDir(root);
  for (scenario of ['read', 'blocked-write', 'blocked-edit', 'write']) {
    served = false; toolResults.length = 0;
    const actions = [];
    const output = await runChat({ serviceId: 'grok', messages: [{ role: 'user', text: 'Execute the local test fixture.' }], cfg: { aiProviders: { grok: { ...included, cmd: binary, model: 'orbit-fixture' } } }, dirs: { cwd: root, runs: root }, cwd: root, readOnly: scenario !== 'write', onAction: a => actions.push(a), signal: AbortSignal.timeout(25000) });
    assert.match(output, /ORBIT_TRANSPORT_OK/);
    assert.ok(served);
    if (scenario === 'read') { assert.match(JSON.stringify(toolResults), /ORBIT_BIBLE_FIXTURE/); assert.ok(actions.some(a => a.status === 'done')); }
    else if (scenario === 'write') { assert.equal(readFileSync(join(root, 'delivery.txt'), 'utf8'), 'ORBIT_WRITTEN_FIXTURE'); assert.ok(actions.some(a => a.status === 'done')); }
    else { assert.equal(existsSync(sentinel), false); assert.ok(toolResults.length > 0); }
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chatCli } from '../server/ai-services.mjs';
import { agentEvents } from '../server/ai-events.mjs';
import { NativePermissions } from '../server/ai-permissions.mjs';

// Genuine CLI + local Messages fixture. No Anthropic login, account or credits.
const binary = process.env.ORBIT_CLAUDE_BIN;
test('real Claude CLI waits for Orbit approval, executes once, and respects rejection', { skip: !binary, timeout: 120000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-claude-native-'));
  const keyScript = join(root, 'key.cjs'); writeFileSync(keyScript, "console.log('local-fixture-key')");
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ apiKeyHelper: `"${process.execPath}" "${keyScript}"`, permissions: { ask: ['Bash'] } }));
  let served = false;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (req.url.includes('count_tokens')) { res.setHeader('Content-Type', 'application/json'); res.end('{"input_tokens":100}'); return; }
    if (!raw) { res.end('{}'); return; }
    const body = JSON.parse(raw);
    const tool = body.tools?.some(tool => tool.name === 'Bash') && !served;
    if (tool) served = true;
    const block = tool ? { type: 'tool_use', id: 'tool-fixture', name: 'Bash', input: { command: `node -e "require('fs').writeFileSync('delivery.txt','approved')"`, description: 'Write the local fixture delivery' } } : { type: 'text', text: 'ORBIT_NATIVE_DONE' };
    const message = { id: 'msg_fixture', type: 'message', role: 'assistant', model: body.model, content: [block], stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } };
    if (!body.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(message)); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = data => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    send({ type: 'message_start', message: { ...message, content: [], stop_reason: null } });
    send({ type: 'content_block_start', index: 0, content_block: tool ? { ...block, input: {} } : { type: 'text', text: '' } });
    send({ type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    send({ type: 'content_block_stop', index: 0 });
    send({ type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 20 } });
    send({ type: 'message_stop' }); res.end();
  });
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const values = { CLAUDE_CONFIG_DIR: root, ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]])); Object.assign(process.env, values);
  t.after(() => { server.closeAllConnections(); server.close(); for (const key of Object.keys(values)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  for (const decision of ['allow', 'deny']) {
    served = false;
    const queue = new NativePermissions(), controller = new AbortController();
    let answer = '';
    const pending = chatCli({ cmd: binary, prompt: 'Run the requested fixture command.', cwd: root, claude: true, jsonl: true, signal: controller.signal,
      extraArgs: ['--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--settings', join(root, 'settings.json'), '--no-session-persistence'],
      onPermission: (request, options) => queue.request(request, options), onEvent: agentEvents('claude', { onText: text => { answer += text; } }),
    });
    void pending.catch(() => {});
    try {
      for (const deadline = Date.now() + 35000; !queue.snapshot().length && Date.now() < deadline;) await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(queue.snapshot().length, 1, answer);
      assert.equal(queue.snapshot()[0].toolName, 'Bash');
      if (decision === 'allow') assert.equal(existsSync(join(root, 'delivery.txt')), false);
      queue.decide(queue.snapshot()[0].id, { decision });
      if (decision === 'allow') { await pending; assert.equal(readFileSync(join(root, 'delivery.txt'), 'utf8'), 'approved'); writeFileSync(join(root, 'delivery.txt'), 'must stay'); }
      else { await assert.rejects(pending, error => error.code === 'ORBIT_PERMISSION_BLOCKED'); assert.equal(readFileSync(join(root, 'delivery.txt'), 'utf8'), 'must stay'); }
    } finally { controller.abort(); await pending.catch(() => {}); }
  }
});

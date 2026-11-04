import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { probeStdioMcp, registerMcpChecks } from '../server/ai-mcp-probe.mjs';
import { nativeMcpConfiguration } from '../server/ai-integration-evidence.mjs';
import { processMayBeWorking, aiProcessSnapshot, stopAiProcesses } from '../server/ai-processes.mjs';
import { setTimeout as delay } from 'node:timers/promises';

function fixture(mode = 'pass') {
  const root = mkdtempSync(join(tmpdir(), 'orbit-mcp-probe-')), script = join(root, 'server.mjs'), log = join(root, 'methods.jsonl'), pid = join(root, 'pid.txt');
  writeFileSync(script, `import readline from 'node:readline'; import {appendFileSync,writeFileSync} from 'node:fs'; import {spawn} from 'node:child_process';
writeFileSync(${JSON.stringify(pid)},String(process.pid));
if(${JSON.stringify(mode)}==='persistent')setInterval(()=>{},1000);
if(${JSON.stringify(mode)}==='descendants'){const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});writeFileSync(${JSON.stringify(`${pid}.child`)},String(child.pid));}
process.stderr.write('private-token-never-returned');
const answer=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');
if(m.method==='initialize') answer(m.id,{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}});
if(m.method==='tools/list') {
  if(['hang','descendants'].includes(${JSON.stringify(mode)})) return;
  if(${JSON.stringify(mode)}==='overflow') {process.stdout.write('x'.repeat(3*1024*1024));return;}
  if(${JSON.stringify(mode)}==='reject') {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-1,message:'private-token-never-returned'}})+'\\n');return;}
  answer(m.id,{tools:[{name:'render_preview',inputSchema:{type:'object'}},{name:'read_scene',inputSchema:{type:'object'}}]});
}});`);
  const settings = { command: process.execPath, args: [script], cwd: root, env: { ORBIT_MCP_TEST_SECRET: 'private-token-never-returned' } };
  writeFileSync(join(root, '.claude.json'), JSON.stringify({ mcpServers: { blender: settings } }));
  return { root, settings, log, pid, configuration: nativeMcpConfiguration('claude', 'blender', root) };
}

test('MCP probe performs initialize and tools/list only, hides process output, and stops its server', async () => {
  const f = fixture();
  const result = await probeStdioMcp(f.configuration);
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.toolNames, ['render_preview', 'read_scene']);
  assert.equal(result.complete, true);
  assert.doesNotMatch(JSON.stringify(result), /private-token|ORBIT_MCP_TEST_SECRET/);
  const messages = readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(messages.map(message => message.method), ['initialize', 'notifications/initialized', 'tools/list']);
  assert.equal(processMayBeWorking(Number(readFileSync(f.pid, 'utf8'))), false);
});

test('MCP probe bounds timeout and sanitizes server errors without tool execution', async () => {
  const rejected = fixture('reject');
  await assert.rejects(probeStdioMcp(rejected.configuration), error => {
    assert.match(error.message, /afviste forbindelsesprøven/); assert.doesNotMatch(error.message, /private-token/); return true;
  });
  const hanging = fixture('hang'), start = Date.now();
  await assert.rejects(probeStdioMcp(hanging.configuration, { timeoutMs: 1000 }), /tidsgrænsen/);
  assert.ok(Date.now() - start < 10000);
  if (existsSync(hanging.pid)) assert.equal(processMayBeWorking(Number(readFileSync(hanging.pid, 'utf8'))), false);
});

test('MCP timeout stops descendants and excessive output is bounded', async () => {
  const f = fixture('descendants');
  await assert.rejects(probeStdioMcp(f.configuration, { timeoutMs: 1000 }), /tidsgrænsen/);
  assert.equal(processMayBeWorking(Number(readFileSync(f.pid, 'utf8'))), false);
  assert.equal(processMayBeWorking(Number(readFileSync(`${f.pid}.child`, 'utf8'))), false);
  const flood = fixture('overflow');
  await assert.rejects(probeStdioMcp(flood.configuration), /overskred 2 MB/);
  assert.equal(processMayBeWorking(Number(readFileSync(flood.pid, 'utf8'))), false);
});

test('MCP cleanup waits for a delayed descendant after its parent has closed', { skip: process.platform === 'win32' }, async t => {
  const f = fixture('descendants'); let child, delayedKill, forced = false;
  t.after(() => {
    clearTimeout(delayedKill);
    if (child?.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The owned process group already stopped. */ }
  });
  await assert.rejects(probeStdioMcp(f.configuration, { timeoutMs: 1000, terminateProcess: async managedChild => {
    child = managedChild;
    // Close only the parent now. The fixture's descendant has ignored stdio
    // and remains in the owned group until its delayed forced termination.
    managedChild.kill('SIGTERM');
    delayedKill = setTimeout(() => {
      forced = true;
      try { process.kill(-managedChild.pid, 'SIGKILL'); } catch { /* Already stopped. */ }
    }, 250);
  } }), /tidsgrænsen/);
  assert.equal(forced, true);
  assert.equal(processMayBeWorking(child.pid), false);
  assert.equal(processMayBeWorking(Number(readFileSync(`${f.pid}.child`, 'utf8'))), false);
  assert.equal(aiProcessSnapshot().some(item => item.pid === child.pid), false);
});

test('failed MCP cleanup retains a live process registration and a later stop retries it', async t => {
  const f = fixture('persistent'); let child, attempts = 0;
  t.after(() => child?.kill('SIGKILL'));
  await assert.rejects(probeStdioMcp(f.configuration, { terminateProcess: async managedChild => {
    child = managedChild;
    if (++attempts === 1) throw new Error('Controlled first cleanup failure');
    managedChild.kill('SIGKILL');
  } }), /MCP-processen kunne ikke stoppes/);
  assert.equal(processMayBeWorking(child.pid), true);
  assert.ok(aiProcessSnapshot().some(item => item.pid === child.pid && item.kind === 'mcp-check'));
  stopAiProcesses();
  for (let i = 0; i < 100 && aiProcessSnapshot().some(item => item.pid === child.pid); i++) await delay(20);
  assert.ok(attempts >= 2);
  assert.equal(processMayBeWorking(child.pid), false);
  assert.equal(aiProcessSnapshot().some(item => item.pid === child.pid), false);
});

test('configured server route requires explicit action and invalidates persisted proof after configuration changes', async t => {
  const f = fixture(), app = express(); app.use(express.json());
  const checks = registerMcpChecks(app, { APP_DIR: join(f.root, 'orbit'), home: f.root });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/ai/services/claude/mcp/verify`;
  const post = data => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await post({ serverName: 'blender' })).status, 400);
  assert.equal((await post({ execute: true, serverName: 'unknown', command: process.execPath })).status, 400);
  assert.equal(existsSync(f.pid), false);
  const response = await post({ execute: true, serverName: 'blender' });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.report.status, 'passed');
  assert.equal(data.report.configurationChanged, false);
  assert.doesNotMatch(JSON.stringify(data), /private-token|fingerprint|command|ORBIT_MCP_TEST_SECRET/);
  assert.equal(checks.inventory('claude').servers[0].lastCheck.status, 'passed');
  writeFileSync(join(f.root, '.claude.json'), JSON.stringify({ mcpServers: { blender: { ...f.settings, env: { ORBIT_MCP_TEST_SECRET: 'changed' } } } }));
  assert.equal(checks.inventory('claude').servers[0].lastCheck.configurationChanged, true);
});

test('MCP configuration rejects unsupported expansion, transport and arbitrary server names', () => {
  const f = fixture();
  assert.throws(() => nativeMcpConfiguration('codex', 'blender', f.root), /JSON-brugerkonfiguration/);
  assert.throws(() => nativeMcpConfiguration('claude', '__proto__', f.root), /findes ikke/);
  writeFileSync(join(f.root, '.claude.json'), JSON.stringify({ mcpServers: { remote: { url: 'https://secret.example' }, expanded: { command: 'node', args: ['${PRIVATE_PATH}'] } } }));
  assert.throws(() => nativeMcpConfiguration('claude', 'remote', f.root), /stdio/);
  assert.throws(() => nativeMcpConfiguration('claude', 'expanded', f.root), /variabeludvidelser/);
});

test('MCP shutdown hook tracks requests before a child exists and drains an active check', async t => {
  const f = fixture('hang'), app = express(); app.use(express.json());
  registerMcpChecks(app, { APP_DIR: join(f.root, 'orbit'), home: f.root });
  assert.equal(app.locals.mcpChecksActive, 0);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const pending = fetch(`http://127.0.0.1:${server.address().port}/api/ai/services/claude/mcp/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ execute: true, serverName: 'blender' }) });
  for (let i = 0; i < 100 && !app.locals.mcpChecksActive; i++) await delay(20);
  assert.equal(app.locals.mcpChecksActive, 1);
  app.locals.abortMcpChecks();
  assert.equal((await pending).status, 422);
  assert.equal(app.locals.mcpChecksActive, 0);
  if (existsSync(f.pid)) assert.equal(processMayBeWorking(Number(readFileSync(f.pid, 'utf8'))), false);
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(probeStdioMcp(f.configuration, { signal: stopped.signal }), { name: 'AbortError' });
});

test('Windows command resolution abort never starts the configured MCP server', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture(), controller = new AbortController();
  const promise = probeStdioMcp({ ...f.configuration, command: 'node' }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(existsSync(f.pid), false);
});

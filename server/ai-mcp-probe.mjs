import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { cliSpawnSpec, chooseCliCandidate } from './ai-services.mjs';
import { trackAiProcess, processMayBeWorking } from './ai-processes.mjs';
import { nativeMcpConfiguration, nativeMcpInventory } from './ai-integration-evidence.mjs';
import { writeAtomicJson } from './atomic-json.mjs';

const exec = promisify(execFile);
const MAX_OUTPUT = 2 * 1024 * 1024;
const PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

async function terminateMcpProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') await exec('taskkill', ['/pid', String(child.pid), '/T', '/F'], { timeout: 5000, maxBuffer: 16384 });
  else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Checked again after the forced stop. */ }
    await delay(150);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Checked by processMayBeWorking before releasing registration. */ }
  }
}

// This probe only negotiates MCP and lists tool metadata. Server-initiated
// requests are refused; no tool, prompt, resource or model request is executed.
export async function probeStdioMcp(configuration, { signal, timeoutMs = 20000, terminateProcess = terminateMcpProcessTree } = {}) {
  signal?.throwIfAborted();
  let command = configuration.command;
  if (!isAbsolute(configuration.cwd)) throw new Error('MCP-prøven kræver en absolut arbejdsmappe.');
  if (process.platform === 'win32' && !/[\\/]/.test(command)) {
    try { command = chooseCliCandidate((await exec('where', [command], { timeout: 3000, maxBuffer: 16384, signal })).stdout); }
    catch { signal?.throwIfAborted(); throw new Error('MCP-programmet kunne ikke findes. Kontrollér den native konfiguration.'); }
    if (!command) throw new Error('MCP-programmet kunne ikke findes.');
  }
  // A desktop shutdown can arrive while Windows resolves a command, before
  // there is a child PID for the process registry to stop.
  signal?.throwIfAborted();
  let launch;
  try { launch = cliSpawnSpec(command, configuration.args); }
  catch { throw new Error('MCP-programmets Windows-launcher kunne ikke opløses sikkert.'); }
  const child = spawn(launch.cmd, launch.args, { cwd: configuration.cwd, env: { ...process.env, ...configuration.env }, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let sequence = 0, bytes = 0, buffer = '', failure = null;
  const fail = message => {
    failure ??= new Error(message);
    for (const waiter of pending.values()) waiter.reject(failure);
    pending.clear();
  };
  let isClosed = false, cleanupPromise = null, untrack = () => {};
  const releaseIfStopped = () => {
    if (!isClosed || (child.pid && processMayBeWorking(child.pid))) return false;
    untrack(); return true;
  };
  child.once('close', () => { isClosed = true; releaseIfStopped(); });
  // A failed kill is not proof of termination. Keep a retryable registration
  // until the child really closes and its process/group is no longer working.
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      try { child.stdin.end(); await terminateProcess(child); } catch { /* Verify actual closure below instead of trusting the kill command. */ }
      // Parent closure can precede the OS finishing SIGKILL of its descendants.
      // Wait for both conditions; an already closed parent is not an idle group.
      const deadline = performance.now() + 1000;
      while (!releaseIfStopped()) {
        if (performance.now() >= deadline) throw new Error('MCP-processen kunne ikke stoppes. Den forbliver registreret, og opdatering skal vente på, at den er afsluttet.');
        await delay(20);
      }
    })().finally(() => { cleanupPromise = null; });
    return cleanupPromise;
  };
  child.once('error', () => fail('MCP-processen kunne ikke startes. Kontrollér den native konfiguration.'));
  child.once('exit', () => fail('MCP-processen sluttede før prøven var færdig.'));
  child.stdin.on('error', () => fail('MCP-forbindelsen blev afbrudt.'));
  const send = value => {
    if (failure) throw failure;
    child.stdin.write(`${JSON.stringify(value)}\n`);
  };
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const id = ++sequence; pending.set(id, { resolve, reject });
    try { send({ jsonrpc: '2.0', id, method, params }); }
    catch (error) { pending.delete(id); reject(error); }
  });
  const consume = chunk => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_OUTPUT) { fail('MCP-prøvens output overskred 2 MB.'); return; }
    buffer += chunk;
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { fail('MCP-serveren returnerede ugyldig protokoldata.'); return; }
      if (!message || message.jsonrpc !== '2.0') { fail('MCP-serveren returnerede ugyldig protokoldata.'); return; }
      if (typeof message.method === 'string') {
        if (message.id !== undefined) try { send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Orbit connection check does not execute server requests.' } }); } catch { /* Original failure remains authoritative. */ }
        continue;
      }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error || !Object.hasOwn(message, 'result')) waiter.reject(new Error('MCP-serveren afviste forbindelsesprøven. Kontrollér dens login og konfiguration i den native tjeneste.'));
      else waiter.resolve(message.result);
    }
  };
  child.stdout.setEncoding('utf8'); child.stdout.on('data', consume);
  child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_OUTPUT) fail('MCP-prøvens output overskred 2 MB.'); });
  const abort = () => fail('MCP-prøven blev afbrudt.');
  untrack = trackAiProcess(child.pid, { kind: 'mcp-check', stop: () => { abort(); void cleanup().catch(() => {}); } });
  const timer = setTimeout(() => fail('MCP-prøven overskred tidsgrænsen.'), timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const initialized = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'Orbit connection check', version: '1.0.0' } });
    if (!initialized || !PROTOCOLS.has(initialized.protocolVersion) || !initialized.capabilities?.tools) throw new Error('MCP-serveren annoncerer ikke en understøttet værktøjsliste.');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const names = [], seenCursors = new Set(); let cursor, complete = true;
    for (let page = 0; page < 5; page++) {
      const listed = await request('tools/list', cursor ? { cursor } : {});
      if (!listed || !Array.isArray(listed.tools) || listed.tools.some(tool => !tool || typeof tool.name !== 'string')) throw new Error('MCP-serverens værktøjsliste er ugyldig.');
      for (const tool of listed.tools) {
        if (names.length >= 500) { complete = false; break; }
        if (/^[A-Za-z0-9_.:-]{1,128}$/.test(tool.name)) names.push(tool.name);
      }
      if (!listed.nextCursor) break;
      if (typeof listed.nextCursor !== 'string' || listed.nextCursor.length > 4096 || seenCursors.has(listed.nextCursor)) throw new Error('MCP-serverens paginering er ugyldig.');
      cursor = listed.nextCursor; seenCursors.add(cursor);
      if (page === 4 || names.length >= 500) { complete = false; break; }
    }
    return { status: 'passed', scope: 'initialize_and_tools_list', protocolVersion: initialized.protocolVersion, toolNames: [...new Set(names)], complete, note: 'Forbindelse og værktøjsliste er afprøvet. Ingen værktøjer er kaldt; kontoens adgang til konkrete data eller handlinger er ikke verificeret.' };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    await cleanup();
  }
}

export function registerMcpChecks(app, { APP_DIR, home = homedir() }) {
  const directory = join(APP_DIR, 'ai-account-checks', 'mcp'); mkdirSync(directory, { recursive: true });
  const active = new Map();
  Object.defineProperty(app.locals, 'mcpChecksActive', { configurable: true, get: () => active.size });
  app.locals.abortMcpChecks = () => { for (const controller of active.values()) controller.abort(); };
  const identity = (serviceId, serverName) => createHash('sha256').update(JSON.stringify([serviceId, serverName])).digest('hex');
  const read = (serviceId, serverName) => {
    const id = identity(serviceId, serverName);
    try {
      const saved = JSON.parse(readFileSync(join(directory, `${id}.json`), 'utf8'));
      let changed = true;
      try { changed = saved.fingerprint !== nativeMcpConfiguration(serviceId, serverName, home).fingerprint; } catch { /* Missing/unsupported config invalidates proof. */ }
      const { fingerprint: _fingerprint, ...report } = saved;
      return { ...report, status: report.status === 'running' && !active.has(id) ? 'interrupted' : report.status, configurationChanged: changed };
    } catch { return null; }
  };
  app.post('/api/ai/services/:id/mcp/verify', async (req, res) => {
    if (req.body?.execute !== true || typeof req.body?.serverName !== 'string') return res.status(400).json({ ok: false, reason: 'Vælg en konfigureret MCP-server og start forbindelsesprøven eksplicit.' });
    if (active.size) return res.status(409).json({ ok: false, reason: 'En MCP-forbindelsesprøve kører allerede.' });
    let configuration;
    try { configuration = nativeMcpConfiguration(req.params.id, req.body.serverName, home); }
    catch { return res.status(400).json({ ok: false, reason: 'Serveren understøttes ikke af prøven eller er ændret. Genindlæs forbindelserne og kontrollér den native konfiguration.' }); }
    const id = identity(req.params.id, req.body.serverName), path = join(directory, `${id}.json`), controller = new AbortController();
    const started = Date.now(), report = { version: 1, serviceId: req.params.id, serverName: req.body.serverName, checkedAt: new Date().toISOString(), fingerprint: configuration.fingerprint, status: 'running', scope: 'initialize_and_tools_list' };
    active.set(id, controller);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', disconnect);
    try {
      writeAtomicJson(path, report);
      const result = await probeStdioMcp(configuration, { signal: controller.signal });
      writeAtomicJson(path, { ...report, ...result, durationMs: Date.now() - started });
      res.json({ ok: true, report: read(req.params.id, req.body.serverName) });
    } catch (error) {
      // Errors created by the protocol adapter contain no process output or config.
      const reason = /^MCP-/.test(error.message) ? error.message : 'MCP-prøven kunne ikke afsluttes. Kontrollér den native konfiguration.';
      try { writeAtomicJson(path, { ...report, status: 'failed', reason, durationMs: Date.now() - started }); } catch { /* Never hide the failed connection if reporting storage also fails. */ }
      if (!res.destroyed) res.status(422).json({ ok: false, reason, report: read(req.params.id, req.body.serverName) });
    } finally { active.delete(id); res.off('close', disconnect); }
  });
  return { inventory(serviceId) { const inventory = nativeMcpInventory(serviceId, home); return { ...inventory, servers: inventory.servers.map(server => ({ ...server, lastCheck: read(serviceId, server.name) })) }; } };
}

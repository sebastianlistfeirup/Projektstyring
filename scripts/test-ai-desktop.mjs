import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, linkSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import vm from 'node:vm';
import { registerDesktopRuntime } from '../server/desktop-runtime.mjs';
import { fileDigest, releaseFiles, verifyRelease } from './desktop/release.mjs';
import { launchRelease, stopManaged } from './desktop/launch.mjs';
import { installRelease } from './desktop/install.mjs';

async function freePorts(count = 1) {
  const servers = [];
  try {
    // Keep all reservations listening until every distinct port is allocated.
    // Closing one before allocating the next lets the OS reuse the same port.
    for (let i = 0; i < count; i++) {
      const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
    }
    return servers.map(server => server.address().port);
  } finally { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); }
}

async function fixture(root, id, { failReal = false } = {}) {
  const dir = join(root, id); mkdirSync(join(dir, 'server'), { recursive: true }); mkdirSync(join(dir, 'dist')); mkdirSync(join(dir, 'desktop')); mkdirSync(join(dir, 'runtime'));
  const nodePath = `runtime/${process.platform === 'win32' ? 'node.exe' : 'node'}`;
  if (process.platform === 'win32') cpSync(process.execPath, join(dir, nodePath));
  else { try { linkSync(process.execPath, join(dir, nodePath)); } catch { cpSync(process.execPath, join(dir, nodePath)); } }
  writeFileSync(join(dir, 'dist', 'index.html'), '<html><div id="root"></div></html>');
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dir, 'desktop', 'launch.mjs'), '// launcher fixture');
  writeFileSync(join(dir, 'desktop', 'start-installed.ps1'), readFileSync(new URL('./desktop/start-installed.ps1', import.meta.url)));
  writeFileSync(join(dir, 'server', 'companion.mjs'), `import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const m=JSON.parse(fs.readFileSync('release.json')); if(${failReal} && fs.existsSync(path.join(process.env.ORBIT_APP_DIR,'user-data')))process.exit(7);
const s=http.createServer((q,r)=>{q.resume();r.setHeader('Content-Type','application/json');
if(q.url==='/api/ping')r.end(JSON.stringify({ok:true,version:m.version,releaseId:m.releaseId,runtimeId:process.env.ORBIT_RUNTIME_ID}));
else if(q.url==='/api/desktop/shutdown'){if(q.headers['x-orbit-desktop-token']!==process.env.ORBIT_DESKTOP_TOKEN){r.statusCode=403;r.end('{}');}else if(fs.existsSync(path.join(process.env.ORBIT_APP_DIR,'busy'))){r.statusCode=409;r.end(JSON.stringify({reason:'Arbejdet er aktivt'}));}else{r.end('{}');s.close(()=>process.exit(0));}}
else {r.setHeader('Content-Type','text/html');r.end('<div id="root"></div>');}});s.listen(Number(process.env.ORBIT_PORT),'127.0.0.1');`);
  const files = []; for (const path of releaseFiles(dir)) files.push({ path, sha256: await fileDigest(join(dir, path)) });
  writeFileSync(join(dir, 'release.json'), JSON.stringify({ format: 1, stateFormat: 2, releaseId: id, version: '1.4.0', platform: process.platform, arch: process.arch, nodePath, files }));
  return dir;
}

test('release verification rejects changed bytes, extra files and unsafe manifest paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-desktop-integrity-'));
  try {
    const dir = await fixture(root, 'integrity'); assert.equal((await verifyRelease(dir)).releaseId, 'integrity');
    writeFileSync(join(dir, 'unexpected'), 'extra'); await assert.rejects(verifyRelease(dir), /uden for manifestet/); rmSync(join(dir, 'unexpected'));
    writeFileSync(join(dir, 'dist', 'index.html'), 'changed'); await assert.rejects(verifyRelease(dir), /Release-kontrol/);
    const manifest = JSON.parse(readFileSync(join(dir, 'release.json'))); manifest.files[0].path = '../outside'; writeFileSync(join(dir, 'release.json'), JSON.stringify(manifest));
    await assert.rejects(verifyRelease(dir), /Ugyldig fil/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('managed startup verifies identity, reuses same release and refuses shutdown while busy', async t => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-desktop-start-')), appDir = join(root, 'app'), [port] = await freePorts();
  t.after(async () => { rmSync(join(appDir, 'busy'), { force: true }); await stopManaged(appDir, port); rmSync(root, { recursive: true, force: true }); });
  {
    const dir = await fixture(root, 'start');
    assert.equal((await launchRelease(dir, { appDir, port })).reused, false);
    assert.equal((await launchRelease(dir, { appDir, port })).reused, true);
    writeFileSync(join(appDir, 'busy'), 'work'); await assert.rejects(stopManaged(appDir, port), /aktivt/);
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/ping`)).json()).releaseId, 'start');
    rmSync(join(appDir, 'busy')); await stopManaged(appDir, port);
    assert.equal(existsSync(join(appDir, 'desktop-control.json')), false);
  }
});

test('failed release activation restarts compatible previous release and preserves user data and launcher', async t => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-desktop-update-')), appDir = join(root, 'app'), installDir = join(root, 'installed'), [port, smokePort] = await freePorts(2);
  t.after(async () => { rmSync(join(appDir, 'busy'), { force: true }); await stopManaged(appDir, port); rmSync(root, { recursive: true, force: true }); });
  {
    const first = await fixture(root, 'first'), bad = await fixture(root, 'bad', { failReal: true });
    await installRelease(first, { appDir, installDir, port, smokePort, open: false, createShortcuts: false });
    writeFileSync(join(appDir, 'user-data'), 'precious decisions');
    const launcher = readFileSync(join(installDir, 'Start-Orbit.cmd'), 'utf8');
    writeFileSync(join(appDir, 'busy'), 'active work');
    await assert.rejects(installRelease(bad, { appDir, installDir, port, smokePort, open: false, createShortcuts: false }), /aktivt/);
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/ping`)).json()).releaseId, 'first');
    rmSync(join(appDir, 'busy'));
    await assert.rejects(installRelease(bad, { appDir, installDir, port, smokePort, open: false, createShortcuts: false }), /tidligere version er startet igen/);
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/ping`)).json()).releaseId, 'first');
    assert.equal(readFileSync(join(appDir, 'user-data'), 'utf8'), 'precious decisions');
    assert.equal(readFileSync(join(installDir, 'Start-Orbit.cmd'), 'utf8'), launcher);
    assert.equal(JSON.parse(readFileSync(join(installDir, 'installation.json'))).current, 'first');
    assert.equal(existsSync(join(installDir, '.update-lock')), false);
  }
});

test('packaged service worker never intercepts API or public project responses', () => {
  const handlers = {};
  const context = { self: { location: { origin: 'http://127.0.0.1:4310' }, addEventListener: (name, callback) => { handlers[name] = callback; } }, URL };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  for (const path of ['/api/ping', '/api/ai/queue', '/api/ai/runs/abc/artifacts/def', '/public/status/token', '/ws']) {
    let intercepted = false;
    handlers.fetch({ request: { method: 'GET', url: `http://127.0.0.1:4310${path}`, mode: 'cors' }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, path);
  }
});

test('desktop shutdown requires ownership token and trusted origin, serves uncached HTML', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-desktop-routes-'));
  const dir = await fixture(root, 'routes'), app = express(); app.use(express.json());
  let busy = true, stopped = false, prepared = false;
  registerDesktopRuntime(app, { env: { ORBIT_FRONTEND_DIR: join(dir, 'dist'), ORBIT_RUNTIME_ID: 'runtime', ORBIT_DESKTOP_TOKEN: 'x'.repeat(64) }, isBusy: () => busy, prepareShutdown: () => { prepared = true; }, shutdown: () => { stopped = true; } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const send = headers => fetch(`${base}/api/desktop/shutdown`, { method: 'POST', headers });
    assert.equal((await send({})).status, 403);
    assert.equal((await send({ 'X-Orbit-Desktop-Token': 'x'.repeat(64), Origin: 'https://evil.example' })).status, 403);
    assert.equal((await fetch(base, { headers: { Origin: 'https://evil.example' } })).status, 403);
    const reboundHostStatus = await new Promise((resolve, reject) => {
      const req = request(base, { headers: { Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }); req.once('error', reject); req.end();
    });
    assert.equal(reboundHostStatus, 403);
    assert.equal((await send({ 'X-Orbit-Desktop-Token': 'x'.repeat(64) })).status, 409); assert.equal(prepared, false);
    busy = false; assert.equal((await send({ 'X-Orbit-Desktop-Token': 'x'.repeat(64) })).status, 200);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(prepared, true); assert.equal(stopped, true);
    assert.equal((await fetch(base)).headers.get('cache-control'), 'no-cache');
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); }
});

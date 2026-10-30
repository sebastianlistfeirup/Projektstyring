import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

async function start(root) {
  const child = spawn(process.execPath, ['server/companion.mjs'], { env: { ...process.env, ORBIT_APP_DIR: join(root, 'app'), ORBIT_EXPORT_DIR: join(root, 'export'), ORBIT_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Companion startup timeout')); }, 15000);
    child.stdout.on('data', data => { output += data; const match = output.match(/kører på (http:\/\/127.0.0.1:\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    child.on('error', reject); child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Companion exited ${code}`)); });
  });
  return { base, child, stop: async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); } } };
}

test('Companion restart restores latest workspace and backup preserves exact state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-restart-'));
  let server = await start(root);
  const post = async (path, body) => (await fetch(`${server.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  try {
    const snapshot = { schemaVersion: 2, tasks: [], projects: [{ id: 'realm' }], sprints: [], users: [], labels: [], activity: [], workspaceState: { bibles: { realm: 'Full project bible' }, aiChats: [{ id: 'chat', messages: [{ text: 'Decisions' }] }] }, workspaceVersions: { bibles: '2026-10-30T10:00:00Z' } };
    assert.equal((await post('/api/sync/push', { clientId: 'test', snapshot })).ok, true);
    await server.stop(); server = await start(root);
    const restored = await (await fetch(`${server.base}/api/sync/state`)).json();
    assert.equal(restored.snapshot.workspaceState.bibles.realm, 'Full project bible');
    const backup = await post('/api/backup/now', {}); assert.equal(backup.ok, true);
    const file = JSON.parse(readFileSync(backup.path, 'utf8'));
    assert.equal(file.snapshot.workspaceState.aiChats[0].messages[0].text, 'Decisions');
    assert.deepEqual(file.snapshot.workspaceState.projects, [{ id: 'realm' }]);
  } finally { await server.stop(); }
});

test('SIGTERM drains a direct coding CLI before Companion exits', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-signal-')), marker = join(root, 'pulse'), fake = join(root, 'fake.mjs');
  writeFileSync(fake, `import fs from 'node:fs';setInterval(()=>fs.writeFileSync(${JSON.stringify(marker)},String(Date.now())),20);`);
  const server = await start(root);
  const post = (path, body) => fetch(`${server.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ac = new AbortController();
  try {
    assert.equal((await post('/api/ai/services/codex', { cmd: process.execPath, cliTemplate: `"${fake}" {prompt}`, billingMode: 'included', noExtraCharges: true })).status, 200);
    const stream = await fetch(`${server.base}/api/ai/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'codex', messages: [{ role: 'user', text: 'Read-only long fixture' }] }), signal: ac.signal });
    const output = stream.text(); void output.catch(() => {});
    for (let i = 0; i < 100 && !existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(existsSync(marker));
    await server.stop(); assert.equal(server.child.exitCode, 0);
    const pulse = readFileSync(marker, 'utf8');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(readFileSync(marker, 'utf8'), pulse);
  } finally { ac.abort(); await server.stop(); }
});

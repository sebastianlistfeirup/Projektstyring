import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { processMayBeWorking } from '../server/ai-processes.mjs';

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


test('a real Companion crash preserves completed work and blocks resume until the surviving agent stops', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-crash-')), source = join(root, 'source'); mkdirSync(source);
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
  git('init', '-q'); writeFileSync(join(source, 'base.txt'), 'original'); git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'base'); const initialCommit = git('rev-parse', 'HEAD');
  const marker = join(root, 'orphan-pid'), counter = join(root, 'first-count'), allowed = join(root, 'allow-completion'), fake = join(root, 'fake.mjs');
  writeFileSync(fake, `import fs from 'node:fs';let prompt=process.argv.at(-1);const context=prompt.match(/UTF-8-filen (.*)\\. Filen indeholder/);if(context)prompt=fs.readFileSync(context[1],'utf8');
if(prompt.includes('JOB_SECOND')){if(!fs.existsSync(${JSON.stringify(allowed)})){fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));fs.writeFileSync('second.txt','partial');setInterval(()=>{},1000);}else{fs.writeFileSync('second.txt','finished');console.log('Second complete');}}
else{fs.writeFileSync(${JSON.stringify(counter)},String(Number(fs.existsSync(${JSON.stringify(counter)})?fs.readFileSync(${JSON.stringify(counter)},'utf8'):0)+1));fs.writeFileSync('first.txt','retained');console.log('First complete');}`);
  let server = await start(root), orphan;
  const post = (path, body) => fetch(`${server.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const waitFor = async (read, accept) => {
    let result;
    for (const deadline = Date.now() + 20000; Date.now() < deadline;) { result = await read(); if (accept(result)) return result; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error(`Crash fixture timed out: ${JSON.stringify(result)}`);
  };
  const stopOrphan = () => {
    if (!orphan) return;
    try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(orphan), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-orphan, 'SIGKILL'); } catch { /* already stopped */ }
  };
  try {
    await post('/api/ai/services/codex', { cmd: process.execPath, cliTemplate: `"${fake}" {prompt}`, billingMode: 'included', noExtraCharges: true });
    await post('/api/ai/prefs', { autoJudge: false, selfHeal: false });
    const bible = 'Complete crash recovery mandate.\n'.repeat(300);
    const response = await post('/api/ai/orchestrate', { goal: 'Recover committed work after a crash', bible, repositoryPath: source, jobs: [
      { id: 'first', title: 'First', description: 'JOB_FIRST', serviceId: 'codex', phase: 'production', dependsOn: [] },
      { id: 'second', title: 'Second', description: 'JOB_SECOND', serviceId: 'codex', phase: 'production', dependsOn: [0] },
    ], checks: [{ name: 'Verify both files', command: process.execPath, args: ['-e', "const fs=require('fs');if(fs.readFileSync('first.txt','utf8')!=='retained'||fs.readFileSync('second.txt','utf8')!=='finished')process.exit(2)"] }] });
    const stream = response.text(); void stream.catch(() => {});
    const run = await waitFor(async () => (await (await fetch(`${server.base}/api/ai/swarm`)).json()).run, run => run?.jobs?.[1]?.status === 'running' && run.processes?.length && existsSync(marker));
    orphan = Number(readFileSync(marker, 'utf8')); assert.ok(run.processes.some(process => process.pid === orphan));
    const exited = once(server.child, 'exit'); server.child.kill('SIGKILL'); await exited;
    server = await start(root);
    const recovered = (await (await fetch(`${server.base}/api/ai/runs/${run.runId}`)).json()).run;
    assert.equal(recovered.status, 'interrupted'); assert.deepEqual(recovered.jobs.map(job => job.status), ['done', 'interrupted']);
    assert.equal(recovered.bible, bible); assert.equal(recovered.workDir, run.workDir);
    // A second restart must not forget an already-interrupted manual run.
    await server.stop(); server = await start(root);
    const state = await (await fetch(`${server.base}/api/ai/swarm`)).json();
    if (processMayBeWorking(orphan)) {
      assert.ok(state.processes.some(process => process.pid === orphan && process.kind === 'recovered'));
      assert.equal((await post('/api/ai/queue/control', { action: 'resume' })).status, 409);
      assert.equal((await post('/api/ai/orchestrate', { goal: 'Must not overlap orphan', jobs: [{ id: 'other', title: 'Other', serviceId: 'codex', dependsOn: [] }] })).status, 409);
      assert.equal((await post('/api/ai/prepare-shutdown', { refuseActive: true })).status, 409);
      const refused = await post(`/api/ai/runs/${run.runId}/resume`, {});
      assert.equal(refused.status, 409); assert.ok((await refused.json()).pids.includes(orphan));
    } else {
      // Windows process/job supervision can terminate the child with its parent.
      // In that case recovery must not invent a surviving process.
      assert.ok(!state.processes.some(process => process.pid === orphan));
    }
    stopOrphan(); writeFileSync(allowed, 'yes');
    let resumed;
    await waitFor(async () => {
      const response = await post(`/api/ai/runs/${run.runId}/resume`, {}); const body = await response.json();
      if (response.ok) resumed = body; return { status: response.status, body };
    }, result => result.status === 200);
    const final = await waitFor(async () => (await (await fetch(`${server.base}/api/ai/runs/${resumed.runId}`)).json()).run, run => run?.status === 'done' || run?.status === 'error' || run?.status === 'blocked');
    assert.equal(final.status, 'done'); assert.equal(final.verification.status, 'passed'); assert.equal(final.workDir, recovered.workDir);
    assert.equal(readFileSync(counter, 'utf8'), '1'); assert.equal(final.results.length, 2); assert.equal(final.bible, bible);
    assert.equal(git('rev-parse', 'HEAD'), initialCommit); assert.equal(git('status', '--porcelain'), '');
  } finally { stopOrphan(); await server.stop(); }
});

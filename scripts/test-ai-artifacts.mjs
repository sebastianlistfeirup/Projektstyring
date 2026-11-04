import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, symlinkSync, openSync, closeSync, ftruncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { archiveArtifact, archivedArtifactPath, registerArtifactRoutes, MAX_ARTIFACT_BYTES } from '../server/ai-artifacts.mjs';
import { createWorkspaceBackup, restoreWorkspaceBackup } from '../server/workspace-backup.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orbit-artifact-version-'));
  const filePath = join(root, 'render.png'), artifactsDir = join(root, 'archive');
  writeFileSync(filePath, 'first rendered image');
  return { root, filePath, artifactsDir, runId: 'run-1', jobId: 'render-1', name: 'reports/render.png', sourcePath: 'reports/render.png', sourceCommit: 'a'.repeat(40) };
}

test('artifact version keeps exact bytes and provenance after original overwrite or deletion', async () => {
  const input = fixture();
  const first = await archiveArtifact(input);
  assert.equal(first.sha256, createHash('sha256').update('first rendered image').digest('hex'));
  assert.equal(first.size, 20); assert.equal(first.jobId, 'render-1'); assert.equal(first.sourceCommit, input.sourceCommit);
  assert.equal(first.kind, 'image'); assert.match(first.url, /^\/api\/ai\/runs\/run-1\/artifacts\/[a-f0-9]{64}$/);
  writeFileSync(input.filePath, 'second rendered image');
  const second = await archiveArtifact({ ...input, jobId: 'render-2', sourceCommit: 'b'.repeat(40) });
  assert.notEqual(first.artifactId, second.artifactId);
  unlinkSync(input.filePath);
  const original = await archivedArtifactPath(input.artifactsDir, input.runId, first.artifactId);
  assert.equal(readFileSync(original.path, 'utf8'), 'first rendered image');
  assert.equal(original.metadata.sourcePath, input.sourcePath);
  assert.equal(readFileSync((await archivedArtifactPath(input.artifactsDir, input.runId, second.artifactId)).path, 'utf8'), 'second rendered image');
});

test('concurrent repeated archiving never overwrites a version and deduplicates identical blobs', async () => {
  const input = fixture();
  const [a, b, c] = await Promise.all([archiveArtifact(input), archiveArtifact(input), archiveArtifact({ ...input, jobId: 'other-job' })]);
  assert.deepEqual(a, b); assert.notEqual(a.artifactId, c.artifactId); assert.equal(a.sha256, c.sha256);
  const names = readdirSync(join(input.artifactsDir, 'versions', input.runId));
  assert.equal(names.filter(name => name.endsWith('.blob')).length, 1);
  assert.equal(names.filter(name => name.endsWith('.json')).length, 2);
  assert.ok(!names.some(name => name.includes('.tmp')));
});

test('artifact archive rejects traversal, mismatched types, empty and oversized sources', async () => {
  const input = fixture();
  for (const patch of [{ runId: '../outside' }, { jobId: '../job' }, { name: '../render.png' }, { name: 'render.exe' }, { mime: 'text/html' }]) {
    await assert.rejects(archiveArtifact({ ...input, ...patch }));
  }
  for (const id of ['../outside', 'a'.repeat(63), 'z'.repeat(64)]) await assert.rejects(archivedArtifactPath(input.artifactsDir, 'run-1', id));
  writeFileSync(input.filePath, ''); await assert.rejects(archiveArtifact(input), /tom/);
  const fd = openSync(input.filePath, 'w'); ftruncateSync(fd, MAX_ARTIFACT_BYTES + 1); closeSync(fd);
  await assert.rejects(archiveArtifact(input), /for stor/);
});

test('archive detects changed blob bytes and never replaces corrupted evidence silently', async () => {
  const input = fixture(), saved = await archiveArtifact(input);
  const { path } = await archivedArtifactPath(input.artifactsDir, input.runId, saved.artifactId);
  writeFileSync(path, 'tampered evidence');
  await assert.rejects(archivedArtifactPath(input.artifactsDir, input.runId, saved.artifactId), /kontrolsum/);
  await assert.rejects(archiveArtifact(input), /ændret indhold/);
  assert.ok(!readdirSync(join(input.artifactsDir, 'versions', input.runId)).some(name => name.includes('.tmp')));
});

test('archive rejects symlinked sources and archive directories', async t => {
  const input = fixture(), linkedSource = join(input.root, 'linked.png');
  try { symlinkSync(input.filePath, linkedSource, 'file'); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('Windows account cannot create file symlinks'); throw error; }
  await assert.rejects(archiveArtifact({ ...input, filePath: linkedSource }), /almindelig fil/);
  mkdirSync(input.artifactsDir); const outside = join(input.root, 'outside'); mkdirSync(outside);
  symlinkSync(outside, join(input.artifactsDir, 'versions'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(archiveArtifact(input), /uden for|symbolsk/);
  assert.deepEqual(readdirSync(outside), []);
});

test('archived HTTP media supports immutable previews and ranges without mutable source access', async t => {
  const input = fixture(), artifact = await archiveArtifact(input);
  const app = express();
  registerArtifactRoutes(app, { dirs: { artifacts: input.artifactsDir }, readRun: (_dirs, id) => { if (id !== input.runId) throw new Error('No run'); return { runId: id }; } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(input.filePath, 'later source image');
  const response = await fetch(`${origin}${artifact.url}`);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'first rendered image');
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.match(response.headers.get('cache-control'), /immutable/);
  assert.equal(response.headers.get('etag'), `"${artifact.sha256}"`);
  const ranged = await fetch(`${origin}${artifact.url}`, { headers: { Range: 'bytes=0-4' } });
  assert.equal(ranged.status, 206); assert.equal(await ranged.text(), 'first');
  assert.equal((await fetch(`${origin}${artifact.url.replace('run-1', 'another-run')}`)).status, 404);
  assert.equal((await fetch(`${origin}${artifact.url.replace(artifact.artifactId, 'a'.repeat(64))}`)).status, 404);
});

test('workspace backup restores all immutable versions without original worktree or source files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-archive-backup-')), app = join(root, 'app');
  const input = { ...fixture(), artifactsDir: join(app, 'ai-artifacts') };
  const first = await archiveArtifact(input);
  writeFileSync(input.filePath, 'a second version after resume');
  const resumed = await archiveArtifact({ ...input, runId: 'resumed-run', jobId: 'render-2' });
  const snapshot = { tasks: [], schemaVersion: 2, workspaceState: {} };
  const bundle = createWorkspaceBackup(snapshot, app, join(root, 'attachments'));
  assert.equal(bundle.files.filter(file => file.root === 'ai-artifacts' && file.path.endsWith('.blob')).length, 2);
  assert.equal(bundle.files.filter(file => file.root === 'ai-artifacts' && file.path.endsWith('.json')).length, 2);
  const target = join(root, 'restored-app');
  restoreWorkspaceBackup(bundle, target, join(root, 'restored-attachments'));
  unlinkSync(input.filePath);
  const restoredArtifacts = join(target, 'ai-artifacts');
  assert.equal(readFileSync((await archivedArtifactPath(restoredArtifacts, input.runId, first.artifactId)).path, 'utf8'), 'first rendered image');
  assert.equal(readFileSync((await archivedArtifactPath(restoredArtifacts, 'resumed-run', resumed.artifactId)).path, 'utf8'), 'a second version after resume');
});

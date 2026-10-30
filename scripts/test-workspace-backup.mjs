import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceBackup, restoreWorkspaceBackup } from '../server/workspace-backup.mjs';

test('backup restores documents, chat, AI history and bytes without credentials or stale files', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-backup-')), app = join(root, 'app'), attachments = join(root, 'attachments');
  mkdirSync(join(app, 'ai-uploads'), { recursive: true }); mkdirSync(attachments);
  writeFileSync(join(app, 'ai-uploads', 'bible.pdf'), Buffer.from([0, 1, 255]));
  writeFileSync(join(app, 'ai-keys.json'), 'must not be exported');
  mkdirSync(join(app, 'ai-account-checks'), { recursive: true });
  writeFileSync(join(app, 'ai-account-checks', 'codex.json'), JSON.stringify({ status: 'passed', quota: 'unknown' }));
  mkdirSync(join(app, 'ai-runs', 'work', 'example'), { recursive: true });
  writeFileSync(join(app, 'ai-runs', 'work', 'example', 'private-cache'), 'must not be exported');
  writeFileSync(join(attachments, 'image.png'), 'image');
  const snapshot = { tasks: [], schemaVersion: 2, workspaceState: { bibles: { realmread: 'Rules' }, aiChats: [{ id: 'chat', messages: ['history'] }], notes: [{ id: 'decision' }] } };
  const bundle = createWorkspaceBackup(snapshot, app, attachments);
  assert.ok(!JSON.stringify(bundle).includes('must not be exported'));
  const target = join(root, 'restored'), targetAttachments = join(root, 'restored-attachments');
  mkdirSync(join(target, 'ai-uploads'), { recursive: true });
  writeFileSync(join(target, 'ai-uploads', 'stale'), 'stale');
  mkdirSync(join(target, 'ai-runs', 'work', 'local'), { recursive: true });
  writeFileSync(join(target, 'ai-runs', 'work', 'local', 'source'), 'keep registered worktree');
  const restored = restoreWorkspaceBackup(bundle, target, targetAttachments);
  assert.deepEqual(restored, { ...snapshot, workspaceState: { ...snapshot.workspaceState, tasks: [] } });
  assert.deepEqual(readFileSync(join(target, 'ai-uploads', 'bible.pdf')), Buffer.from([0, 1, 255]));
  assert.equal(readFileSync(join(targetAttachments, 'image.png'), 'utf8'), 'image');
  assert.equal(existsSync(join(target, 'ai-uploads', 'stale')), false);
  assert.equal(readFileSync(join(target, 'ai-runs', 'work', 'local', 'source'), 'utf8'), 'keep registered worktree');
  assert.equal(JSON.parse(readFileSync(join(target, 'ai-account-checks', 'codex.json'), 'utf8')).quota, 'unknown');
});

test('tampered or traversing backup is rejected before live data changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-backup-bad-'));
  mkdirSync(join(root, 'ai-uploads'));
  writeFileSync(join(root, 'ai-uploads', 'keep'), 'keep');
  const bundle = createWorkspaceBackup({ tasks: [] }, root, join(root, 'attachments'));
  const tampered = structuredClone(bundle); tampered.files[0].data = Buffer.from('bad').toString('base64');
  assert.throws(() => restoreWorkspaceBackup(tampered, root, join(root, 'attachments')), /beskadiget/);
  bundle.files[0].path = '../outside';
  assert.throws(() => restoreWorkspaceBackup(bundle, root, join(root, 'attachments')), /filsti/);
  assert.equal(readFileSync(join(root, 'ai-uploads', 'keep'), 'utf8'), 'keep');
});

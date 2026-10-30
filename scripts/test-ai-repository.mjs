import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRunWorktree, inspectRepository, verifyRepository, repositoryEvidence } from '../server/ai-repository.mjs';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

test('isolated worktree preserves source checkout and records actual checks and commit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-repo-'));
  git(root, 'init', '-q');
  writeFileSync(join(root, 'game.txt'), 'original');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'base');
  const source = await inspectRepository(root);
  const workDir = join(root, '..', `${basename(root)}-work`);
  const repo = await createRunWorktree(root, workDir, 'test');
  writeFileSync(join(workDir, 'game.txt'), 'fixed');
  assert.equal(readFileSync(join(root, 'game.txt'), 'utf8'), 'original');
  assert.equal(git(root, 'rev-parse', 'HEAD'), source.baseCommit);
  const checks = await verifyRepository(workDir, [
    { name: 'actual assertion', command: process.execPath, args: ['-e', "if(require('fs').readFileSync('game.txt','utf8')!=='fixed') process.exit(1)"] },
    { name: 'failure', command: process.execPath, args: ['-e', 'process.exit(7)'] },
    { name: 'must not run', command: process.execPath, args: ['-e', "require('fs').writeFileSync('should-not-exist','bad')"] },
  ]);
  assert.deepEqual(checks.map(c => c.exitCode), [0, 7]);
  assert.equal(existsSync(join(workDir, 'should-not-exist')), false);
  git(workDir, 'add', '.'); git(workDir, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'fixed');
  const evidence = await repositoryEvidence(workDir, repo.baseCommit);
  assert.deepEqual(evidence.changedFiles, ['game.txt']);
  assert.notEqual(evidence.commit, source.baseCommit);
});

test('uncommitted source changes are never silently omitted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-dirty-'));
  git(root, 'init', '-q'); git(root, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '--allow-empty', '-qm', 'base');
  writeFileSync(join(root, 'unsaved'), 'work');
  await assert.rejects(createRunWorktree(root, join(root, 'work'), 'test'), /lokale ændringer/);
});

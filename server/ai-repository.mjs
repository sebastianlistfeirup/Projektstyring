import { execFile } from 'node:child_process';
import { cliSpawnSpec } from './ai-services.mjs';
import { promisify } from 'node:util';
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
const exec = promisify(execFile);
const git = async (cwd, args) => (await exec('git', args, { cwd, timeout: 30000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();

export async function inspectRepository(path) {
  const source = realpathSync(path);
  const root = await git(source, ['rev-parse', '--show-toplevel']);
  const baseCommit = await git(root, ['rev-parse', 'HEAD']);
  const branch = await git(root, ['branch', '--show-current']);
  const dirty = Boolean(await git(root, ['status', '--porcelain']));
  return { source: root, baseCommit, branch, dirty };
}

export async function createRunWorktree(path, workDir, runId) {
  const repo = await inspectRepository(path);
  // Snapshot the committed base. Uncommitted work is never silently omitted.
  if (repo.dirty) throw new Error('Repository har lokale ændringer. Commit eller gem dem før Orbit opretter en arbejdsgren.');
  const branch = `orbit/${runId}`;
  await git(repo.source, ['worktree', 'add', '-b', branch, workDir, repo.baseCommit]);
  return { ...repo, branch, workDir };
}

export function validateChecks(checks) {
  if (!Array.isArray(checks) || checks.length > 10) throw new Error('Angiv højst 10 kontrolkommandoer.');
  return checks.map(check => {
    if (!check || typeof check.command !== 'string' || !check.command.trim() || !Array.isArray(check.args) || check.args.some(a => typeof a !== 'string')) throw new Error('En kontrol kræver command og args som en liste af strenge.');
    return { command: check.command, args: check.args, name: String(check.name ?? check.command) };
  });
}

export async function verifyRepository(cwd, checks, signal) {
  const results = [];
  for (const check of validateChecks(checks)) {
    signal?.throwIfAborted();
    const startedAt = Date.now();
    try {
      let command = check.command;
      if (process.platform === 'win32' && !isAbsolute(command)) {
        const found = await exec('where', [command], { timeout: 5000 });
        command = found.stdout.trim().split(/\r?\n/)[0];
      }
      const launch = cliSpawnSpec(command, check.args);
      const { stdout, stderr } = await exec(launch.cmd, launch.args, { cwd, signal, timeout: 10 * 60 * 1000, maxBuffer: 2 * 1024 * 1024 });
      results.push({ ...check, startedAt, finishedAt: Date.now(), exitCode: 0, status: 'passed', output: `${stdout}\n${stderr}`.slice(-20000) });
    } catch (e) {
      results.push({ ...check, startedAt, finishedAt: Date.now(), exitCode: typeof e.code === 'number' ? e.code : null, status: 'failed', output: `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message}`.slice(-20000) });
      break;
    }
  }
  return results;
}

export async function repositoryEvidence(cwd, baseCommit) {
  return { commit: await git(cwd, ['rev-parse', 'HEAD']), trackedChangesAfterChecks: await git(cwd, ['status', '--porcelain', '--untracked-files=no']), changedFiles: (await git(cwd, ['diff', '--name-only', baseCommit, 'HEAD'])).split('\n').filter(Boolean), diffStat: await git(cwd, ['diff', '--stat', baseCommit, 'HEAD']) };
}

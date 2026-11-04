import { execFile } from 'node:child_process';
import { cliSpawnSpec } from './ai-services.mjs';
import { promisify } from 'node:util';
import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { runCheckProcess } from './ai-check-process.mjs';
const exec = promisify(execFile);
const git = async (cwd, args) => (await exec('git', args, { cwd, timeout: 30000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();

export function runArtifactPath(workDir, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..') || !/\.(png|jpe?g|webp|glb|mp3|wav|mp4|webm)$/i.test(name) || !/(^|\/)(reports|screenshots|visual|captures)(\/|$)/i.test(name)) throw new Error('Mediefilen ligger ikke i en rapportmappe.');
  const root = realpathSync(workDir), file = realpathSync(join(root, name));
  const rel = relative(root, file);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Billedet ligger uden for arbejdsgrenen.');
  const stat = statSync(file);
  if (!stat.isFile() || stat.size > 256 * 1024 * 1024) throw new Error('Mediefilen kan ikke vises.');
  return file;
}

function reportFiles(workDir) {
  const found = [];
  let visited = 0;
  const visit = (relativeDir, depth) => {
    if (depth > 5 || visited >= 5000) return;
    let entries;
    try { entries = readdirSync(join(workDir, relativeDir), { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (++visited > 5000) break;
      const name = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) visit(name, depth + 1);
      else if (entry.isFile() && /\.(png|jpe?g|webp|glb|mp3|wav|mp4|webm)$/i.test(name)) found.push(name);
    }
  };
  for (const name of ['reports', 'screenshots', 'visual', 'captures']) {
    try { if (lstatSync(join(workDir, name)).isDirectory()) visit(name, 0); }
    catch { /* This report directory does not exist. */ }
  }
  return found;
}

export async function runWorktreeArtifacts(workDir, runId, baseCommit) {
  const [changed, untracked, trackedReports] = await Promise.all([
    baseCommit ? git(workDir, ['diff', '--name-only', '--diff-filter=AM', '-z', baseCommit, 'HEAD']) : git(workDir, ['ls-files', '-z', '--cached']),
    git(workDir, ['ls-files', '-z', '--others', '--exclude-standard']),
    git(workDir, ['ls-files', '-z', '--cached', '--', 'reports', 'screenshots', 'visual', 'captures']),
  ]);
  const tracked = new Set(trackedReports.split('\0').filter(Boolean));
  const paths = [...new Set([...changed.split('\0'), ...untracked.split('\0'), ...reportFiles(workDir).filter(name => !tracked.has(name))].filter(Boolean))];
  const files = paths.filter(name => /\.(png|jpe?g|webp|glb|mp3|wav|mp4|webm)$/i.test(name) && /(^|\/)(reports|screenshots|visual|captures)(\/|$)/i.test(name)).flatMap(name => {
    try {
      const path = runArtifactPath(workDir, name);
      return [{ name, modified: statSync(path).mtimeMs }];
    } catch { return []; }
  });
  return files.sort((a, b) => b.modified - a.modified).slice(0, 30).map(({ name }) => {
    const ext = name.split('.').at(-1).toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', glb: 'model/gltf-binary', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm' }[ext];
    return { kind: mime.startsWith('image/') ? 'image' : 'file', name, mime, url: `/api/ai/runs/${encodeURIComponent(runId)}/visual?path=${encodeURIComponent(name)}` };
  });
}

export async function inspectRepository(path) {
  const source = realpathSync(path);
  const root = await git(source, ['rev-parse', '--show-toplevel']);
  const baseCommit = await git(root, ['rev-parse', 'HEAD']);
  const branch = await git(root, ['branch', '--show-current']);
  const dirty = Boolean(await git(root, ['status', '--porcelain']));
  return { source: root, baseCommit, branch, dirty };
}

export async function repositoryReadiness(path) {
  const repo = await inspectRepository(path);
  const [status, history, branches, tracked] = await Promise.all([
    git(repo.source, ['status', '--porcelain']),
    git(repo.source, ['log', '-8', '--format=%H%x09%s']),
    git(repo.source, ['for-each-ref', '--no-merged=HEAD', '--format=%(refname:short)%09%(objectname:short)', 'refs/heads']),
    git(repo.source, ['ls-files', '--', 'project.godot']),
  ]);
  const changes = status ? status.split('\n') : [];
  const unmerged = branches ? branches.split('\n').map(line => { const [branch, commit] = line.split('\t'); return { branch, commit }; }) : [];
  const branchDetails = await Promise.all(unmerged.slice(0, 30).map(async item => {
    const [counts, subject] = await Promise.all([
      git(repo.source, ['rev-list', '--left-right', '--count', `HEAD...refs/heads/${item.branch}`]),
      git(repo.source, ['log', '-1', '--format=%s', item.commit]),
    ]);
    const [behind, ahead] = counts.split(/\s+/).map(Number);
    return { ...item, ahead, behind, subject };
  }));
  const descendants = branchDetails.filter(item => item.behind === 0 && item.ahead > 0);
  let suggestedBranch = null;
  // Suggest only an unambiguous latest tip; diverging fixes require an owner choice.
  if (unmerged.length === branchDetails.length && descendants.length > 0 && descendants.length <= 10) {
    const isAncestor = async (before, after) => {
      try { await git(repo.source, ['merge-base', '--is-ancestor', before, after]); return true; }
      catch (error) { if (error.code === 1) return false; throw error; }
    };
    const tips = [];
    for (const item of descendants) {
      let superseded = false;
      for (const other of descendants) {
        if (item === other) continue;
        if (await isAncestor(item.commit, other.commit)) { superseded = true; break; }
      }
      if (!superseded) tips.push(item);
    }
    if (tips.length === 1) suggestedBranch = tips[0].branch;
  }
  return { ...repo, checkedAt: new Date().toISOString(), changedFiles: changes.slice(0, 50), changedFileCount: changes.length,
    recentCommits: history.split('\n').filter(Boolean).map(line => { const [commit, ...subject] = line.split('\t'); return { commit, subject: subject.join('\t') }; }),
    otherBranches: branchDetails, otherBranchCount: unmerged.length, suggestedBranch, godotProject: Boolean(tracked),
    stable: repo.baseCommit === await git(repo.source, ['rev-parse', 'HEAD']),
  };
}

export async function createRunWorktree(path, workDir, runId, startCommit, startRef) {
  const repo = await inspectRepository(path);
  // Snapshot the committed base. Uncommitted work is never silently omitted.
  if (repo.dirty) throw new Error('Repository har lokale ændringer. Commit eller gem dem før Orbit opretter en arbejdsgren.');
  let baseCommit = repo.baseCommit;
  if (startRef && !startCommit) {
    if (typeof startRef !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_./-]{0,180}$/.test(startRef) || startRef.includes('..') || startRef.includes('//') || startRef.endsWith('/') || startRef.endsWith('.')) throw new Error('Den valgte Git-gren har et ugyldigt navn.');
    const ref = `refs/heads/${startRef}`;
    const candidate = await git(repo.source, ['show-ref', '--verify', '--hash', ref]).catch(() => { throw new Error('Den valgte Git-gren findes ikke længere. Kontrollér projektgrundlaget igen.'); });
    try { await git(repo.source, ['merge-base', '--is-ancestor', repo.baseCommit, candidate]); }
    catch { throw new Error('Den valgte gren er ikke en fortsættelse af kildens commit. Saml grenene under gennemgang først.'); }
    baseCommit = candidate;
  }
  if (startCommit) {
    if (!/^[a-f0-9]{40,64}$/.test(startCommit)) throw new Error('Den gemte AI-arbejdsgren har et ugyldigt commit.');
    const ancestor = async (before, after) => {
      try { await git(repo.source, ['merge-base', '--is-ancestor', before, after]); return true; }
      catch (error) { if (error.code === 1) return false; throw error; }
    };
    if (await ancestor(repo.baseCommit, startCommit)) baseCommit = startCommit;
    else if (!await ancestor(startCommit, repo.baseCommit)) throw new Error('Kildegrenen og den verificerede AI-gren har forskellige ændringer. Integrér dem i Git før næste arbejdsordre. Orbit fletter dem ikke automatisk.');
  }
  const branch = `orbit/${runId}`;
  await git(repo.source, ['worktree', 'add', '-b', branch, workDir, baseCommit]);
  return { ...repo, sourceCommit: repo.baseCommit, baseCommit, startRef: startRef ?? null, branch, workDir };
}

export function validateChecks(checks) {
  if (!Array.isArray(checks) || checks.length > 10) throw new Error('Angiv højst 10 kontrolkommandoer.');
  return checks.map(check => {
    if (!check || typeof check.command !== 'string' || !check.command.trim() || !Array.isArray(check.args) || check.args.some(a => typeof a !== 'string')) throw new Error('En kontrol kræver command og args som en liste af strenge.');
    return { command: check.command, args: check.args, name: String(check.name ?? check.command) };
  });
}

export async function verifyRepository(cwd, checks, signal, { onProgress, onProcess, timeoutMs } = {}) {
  const results = [];
  for (const check of validateChecks(checks)) {
    signal?.throwIfAborted();
    const startedAt = Date.now();
    onProgress?.([...results, { ...check, startedAt, status: 'running', exitCode: null, output: '' }]);
    try {
      let command = check.command;
      if (process.platform === 'win32' && !isAbsolute(command)) {
        const found = await exec('where', [command], { timeout: 5000 });
        command = found.stdout.trim().split(/\r?\n/)[0];
      }
      const launch = cliSpawnSpec(command, check.args);
      const godot = /^godot(?:[_.-].*)?(?:\.exe)?$/i.test(command.split(/[\\/]/).at(-1));
      const result = await runCheckProcess(launch.cmd, launch.args, { cwd, signal, timeoutMs, failOnErrorOutput: godot, onProcess: info => onProcess?.({ ...info, checkName: check.name }) });
      results.push({ ...check, startedAt, finishedAt: Date.now(), ...result });
    } catch (e) {
      results.push({ ...check, startedAt, finishedAt: Date.now(), exitCode: typeof e.code === 'number' ? e.code : null, status: 'failed', output: `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message}`.slice(-20000) });
    }
    onProgress?.([...results]);
    if (results.at(-1).status !== 'passed') break;
  }
  return results;
}

export async function repositoryEvidence(cwd, baseCommit) {
  return { commit: await git(cwd, ['rev-parse', 'HEAD']), trackedChangesAfterChecks: await git(cwd, ['status', '--porcelain', '--untracked-files=no']), changedFiles: (await git(cwd, ['diff', '--name-only', baseCommit, 'HEAD'])).split('\n').filter(Boolean), diffStat: await git(cwd, ['diff', '--stat', baseCommit, 'HEAD']) };
}

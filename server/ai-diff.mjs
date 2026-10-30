import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpathSync } from 'node:fs';

const exec = promisify(execFile);
const git = async (cwd, args, maxBuffer = 4 * 1024 * 1024) => (await exec('git', ['--literal-pathspecs', ...args], { cwd, timeout: 30000, maxBuffer })).stdout;

async function target(run, requestedCommit) {
  const baseCommit = run.repository?.baseCommit, commit = requestedCommit ?? run.evidence?.commit ?? run.results?.at(-1)?.commit;
  if (!run.repository || !/^[a-f0-9]{40,64}$/.test(baseCommit ?? '') || !/^[a-f0-9]{40,64}$/.test(commit ?? '')) throw new Error('Kørslen har endnu ingen gemt repository-leverance.');
  const recorded = [run.evidence?.commit, ...(run.results ?? []).map(result => result.commit), ...(run.verificationHistory ?? []).map(attempt => attempt.commit)];
  if (!recorded.includes(commit)) throw new Error('Commit er ikke registreret som en leverance i denne kørsel.');
  let cwd;
  try { cwd = realpathSync(run.workDir); } catch { throw new Error('Kørslens arbejdsmappe mangler. Gendan den på denne maskine for at se kodeændringerne.'); }
  if (realpathSync((await git(cwd, ['rev-parse', '--show-toplevel'])).trim()) !== cwd) throw new Error('Kørslens arbejdsmappe er ikke det forventede Git-repository.');
  await git(cwd, ['merge-base', '--is-ancestor', baseCommit, commit]);
  return { cwd, baseCommit, commit };
}

export async function repositoryChanges(run, file, requestedCommit) {
  const { cwd, baseCommit, commit } = await target(run, requestedCommit);
  const options = ['diff', '--no-ext-diff', '--no-textconv', '--no-renames'];
  const stats = (await git(cwd, [...options, '--numstat', '-z', baseCommit, commit, '--'])).split('\0').filter(Boolean).map(row => {
    const [added, removed, ...path] = row.split('\t');
    return { path: path.join('\t'), added: added === '-' ? null : Number(added), removed: removed === '-' ? null : Number(removed), binary: added === '-' };
  });
  const changes = (await git(cwd, [...options, '--name-status', '-z', baseCommit, commit, '--'])).split('\0');
  const statuses = new Map();
  for (let i = 0; i + 1 < changes.length; i += 2) statuses.set(changes[i + 1], changes[i]);
  const files = stats.map(item => ({ ...item, status: statuses.get(item.path) ?? 'M' }));
  if (file === undefined) return { baseCommit, commit, files: files.slice(0, 1000), totalFiles: files.length, filesTruncated: files.length > 1000 };
  const entry = files.find(item => item.path === file);
  if (!entry) throw new Error('Filen findes ikke i denne kodeleverance.');
  if (entry.binary) return { baseCommit, commit, file: entry, patch: '', truncated: false };
  let patch, truncated = false;
  try { patch = await git(cwd, [...options, '--no-color', '--unified=3', baseCommit, commit, '--', file], 2 * 1024 * 1024); }
  catch (error) {
    if (error.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error;
    patch = String(error.stdout ?? ''); truncated = true;
  }
  if (patch.length > 128000) { patch = patch.slice(0, 128000); patch = patch.slice(0, patch.lastIndexOf('\n')); truncated = true; }
  return { baseCommit, commit, file: entry, patch, truncated };
}

export async function repositoryPatch(run, expectedCommit) {
  const { cwd, baseCommit, commit } = await target(run, expectedCommit);
  try { return await git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--binary', baseCommit, commit, '--'], 16 * 1024 * 1024); }
  catch (error) {
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('Patchen er større end 16 MB. Brug Git i kørslens arbejdsmappe til denne leverance.');
    throw error;
  }
}

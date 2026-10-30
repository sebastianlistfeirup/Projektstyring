import { existsSync, readdirSync, lstatSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeSnapshot } from './workspace-state.mjs';

const ROOTS = ['ai-runs', 'ai-memory', 'ai-uploads', 'ai-artifacts'];
const hash = data => createHash('sha256').update(data).digest('hex');
const MAX_BYTES = 256 * 1024 * 1024;

// No tokens, provider keys, OAuth caches or companion configuration are exported.
export function createWorkspaceBackup(snapshot, appDir, attachmentsDir) {
  snapshot = normalizeSnapshot(snapshot);
  const files = [];
  let bytes = 0;
  function collect(root, path, rel = '') {
    if (!existsSync(path)) return;
    for (const name of readdirSync(path)) {
      // Worktrees contain dependencies, local caches and pointers to external
      // repositories. Back them up with Git, never copy them as portable files.
      if (root === 'ai-runs' && !rel && name === 'work') continue;
      const full = join(path, name), relative = rel ? `${rel}/${name}` : name;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`Backup kan ikke følge et symbolsk link: ${relative}`);
      if (stat.isDirectory()) collect(root, full, relative);
      else if (stat.isFile()) {
        bytes += stat.size;
        if (bytes > MAX_BYTES) throw new Error('Backup overstiger 256 MB. Brug en separat filbackup til større projekter.');
        const data = readFileSync(full);
        files.push({ root, path: relative, sha256: hash(data), data: data.toString('base64') });
      }
    }
  }
  for (const root of ROOTS) collect(root, join(appDir, root));
  collect('attachments', attachmentsDir);
  return { format: 'orbit-workspace', version: 2, createdAt: new Date().toISOString(), snapshot, files,
    scope: 'Workspace, AI history and local attachments. External repositories and provider credentials require their own backup.' };
}

export function restoreWorkspaceBackup(bundle, appDir, attachmentsDir, { commitSnapshot } = {}) {
  if (bundle.format !== 'orbit-workspace') {
    if (!Array.isArray(bundle.tasks)) throw new Error('Ugyldig backup.');
    const snapshot = normalizeSnapshot(bundle);
    commitSnapshot?.(snapshot);
    return snapshot; // Legacy snapshot, no file mutations.
  }
  if (bundle.version !== 2 || !Array.isArray(bundle.files) || !Array.isArray(bundle.snapshot?.tasks)) throw new Error('Ukendt eller beskadiget backupformat.');
  const roots = new Map([...ROOTS.map(root => [root, join(appDir, root)]), ['attachments', attachmentsDir]]);
  const seen = new Set();
  let bytes = 0;
  // Validate every entry before touching live data.
  const entries = bundle.files.map(file => {
    if (!roots.has(file.root) || typeof file.path !== 'string' || !file.path || file.path.split('/').some(p => !p || p === '.' || p === '..' || /[\\:]/.test(p) || p.includes(String.fromCharCode(0)))) throw new Error('Backup indeholder en ugyldig filsti.');
    if (file.root === 'ai-runs' && (file.path === 'work' || file.path.startsWith('work/'))) throw new Error('Backup må ikke erstatte aktive Git-arbejdsområder.');
    const key = `${file.root}/${file.path}`;
    if (seen.has(key)) throw new Error('Backup indeholder dublerede filer.');
    seen.add(key);
    const data = Buffer.from(file.data, 'base64');
    bytes += data.length;
    if (bytes > MAX_BYTES || hash(data) !== file.sha256) throw new Error('Backup er beskadiget eller for stor.');
    return { ...file, data };
  });
  const snapshot = normalizeSnapshot(bundle.snapshot);
  const suffix = randomUUID(), swapped = [], staged = [];
  try {
    for (const [root, live] of roots) {
      const stage = `${live}.restore-${suffix}`, old = `${live}.before-${suffix}`;
      mkdirSync(stage, { recursive: true }); staged.push(stage);
      for (const file of entries.filter(f => f.root === root)) {
        const target = join(stage, file.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.data, { mode: 0o600 });
      }
      const existed = existsSync(live);
      if (existed) renameSync(live, old);
      try {
        // Keep worktrees at their registered Git paths. Move only after the
        // original directory has been secured, and undo on any swap failure.
        if (root === 'ai-runs' && existed && existsSync(join(old, 'work'))) renameSync(join(old, 'work'), join(stage, 'work'));
        renameSync(stage, live);
      } catch (e) {
        if (root === 'ai-runs' && existsSync(join(stage, 'work'))) renameSync(join(stage, 'work'), join(old, 'work'));
        if (existed) renameSync(old, live);
        throw e;
      }
      swapped.push({ live, old, existed });
    }
    // Keep all previous directories until the workspace record itself is
    // durable. A failed disk write must not pair old tasks with restored files.
    commitSnapshot?.(snapshot);
  } catch (e) {
    for (const { live, old, existed } of swapped.reverse()) {
      if (live === roots.get('ai-runs') && existed && existsSync(join(live, 'work'))) renameSync(join(live, 'work'), join(old, 'work'));
      rmSync(live, { recursive: true, force: true });
      if (existed) renameSync(old, live);
    }
    throw e;
  } finally {
    for (const stage of staged) try { rmSync(stage, { recursive: true, force: true }); } catch { console.warn('En midlertidig gendannelsesmappe kunne ikke ryddes op.'); }
  }
  for (const { old, existed } of swapped) if (existed) {
    try { rmSync(old, { recursive: true, force: true }); } catch { console.warn('En tidligere backupmappe kunne ikke ryddes op efter gendannelse.'); }
  }
  return snapshot;
}

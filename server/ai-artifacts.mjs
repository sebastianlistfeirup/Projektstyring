import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { mkdir, realpath, lstat, open, link, unlink, readFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const HASH = /^[a-f0-9]{64}$/;
const TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.obj': 'text/plain', '.fbx': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
};

function checkedId(value, field) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`Ugyldigt ${field} til mediearkiv.`);
  return value;
}

function shortText(value, max = 1024) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > max || Array.from(value).some(character => character.charCodeAt(0) < 32)) throw new Error('Ugyldige metadata til mediearkiv.');
  return value;
}

async function confined(root, target) {
  const actual = await realpath(target), rel = relative(root, actual);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || resolve(root, rel) !== actual) throw new Error('Mediearkivet peger uden for sin mappe.');
  // Even an internal symlink must not make two artifact IDs share mutable files.
  if ((await lstat(target)).isSymbolicLink() || actual !== resolve(target)) throw new Error('Mediearkivet indeholder et symbolsk link.');
  return actual;
}

async function runDirectory(artifactsDir, runId, create = false) {
  checkedId(runId, 'kørsels-id');
  if (typeof artifactsDir !== 'string' || !artifactsDir) throw new Error('Mediearkivets mappe mangler.');
  if (create) await mkdir(artifactsDir, { recursive: true, mode: 0o700 });
  const root = await realpath(artifactsDir);
  let dir = root;
  for (const name of ['versions', runId]) {
    dir = join(dir, name);
    if (create) await mkdir(dir, { recursive: true, mode: 0o700 });
    await confined(root, dir);
  }
  return { root, dir };
}

async function digestFile(path, maxBytes = MAX_ARTIFACT_BYTES) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Mediefilen er for stor til arkivet.');
    hash.update(chunk);
  }
  return { sha256: hash.digest('hex'), size };
}

function identity(metadata) {
  return { version: 1, runId: metadata.runId, jobId: metadata.jobId, name: metadata.name, mime: metadata.mime,
    sha256: metadata.sha256, size: metadata.size, sourcePath: metadata.sourcePath,
    sourceCommit: metadata.sourceCommit, serviceId: metadata.serviceId, remoteId: metadata.remoteId };
}

const artifactIdFor = metadata => createHash('sha256').update(JSON.stringify(identity(metadata))).digest('hex');

function descriptor(metadata) {
  return { kind: metadata.mime.startsWith('image/') ? 'image' : 'file', name: metadata.name, mime: metadata.mime,
    artifactId: metadata.artifactId, sha256: metadata.sha256, size: metadata.size,
    jobId: metadata.jobId, sourceCommit: metadata.sourceCommit, createdAt: metadata.createdAt,
    serviceId: metadata.serviceId, remoteId: metadata.remoteId,
    url: `/api/ai/runs/${encodeURIComponent(metadata.runId)}/artifacts/${metadata.artifactId}` };
}

// Publish via a hard link after fsync: readers never observe a partial file and
// an existing immutable version is never overwritten (including concurrent jobs).
async function publish(temp, final) {
  try { await link(temp, final); return true; }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
}

export async function archiveArtifact({ artifactsDir, runId, jobId, filePath, name, mime, sourceCommit = null, sourcePath = null, serviceId = null, remoteId = null }) {
  checkedId(jobId, 'job-id');
  shortText(name);
  const inferred = TYPES[extname(name ?? '').toLowerCase()];
  if (!name || !inferred || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Mediefilens navn eller format kan ikke arkiveres.');
  if (mime && mime !== inferred && !(inferred === 'application/octet-stream' && mime === 'application/octet-stream')) throw new Error('Mediefilens type passer ikke til filnavnet.');
  const source = await lstat(filePath);
  if (!source.isFile() || source.isSymbolicLink() || source.size === 0 || source.size > MAX_ARTIFACT_BYTES) throw new Error('Mediefilen er tom, for stor eller ikke en almindelig fil.');
  const { root, dir } = await runDirectory(artifactsDir, runId, true);
  const temp = join(dir, `.${randomUUID()}.tmp`), metaTemp = `${temp}.json`;
  let handle, sourceHandle;
  try {
    sourceHandle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await sourceHandle.stat();
    if (!opened.isFile() || opened.dev !== source.dev || opened.ino !== source.ino || opened.size !== source.size || opened.mtimeMs !== source.mtimeMs || opened.ctimeMs !== source.ctimeMs) throw new Error('Mediefilen ændrede sig før arkivering.');
    handle = await open(temp, 'wx', 0o600);
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of sourceHandle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > MAX_ARTIFACT_BYTES) throw new Error('Mediefilen voksede ud over arkivets størrelsesgrænse.');
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    if (!size) throw new Error('Mediefilen er tom.');
    const after = await sourceHandle.stat();
    if (after.size !== size || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) throw new Error('Mediefilen ændrede sig under arkivering. Prøv igen, når produktionen er afsluttet.');
    await handle.sync(); await handle.close(); handle = undefined;
    const metadata = { version: 1, runId, jobId, name, mime: inferred, sha256: hash.digest('hex'), size,
      sourceCommit: shortText(sourceCommit, 64), sourcePath: shortText(sourcePath), serviceId: shortText(serviceId, 128), remoteId: shortText(remoteId, 256),
      createdAt: new Date().toISOString() };
    metadata.artifactId = artifactIdFor(metadata);
    const blob = join(dir, `${metadata.sha256}.blob`), record = join(dir, `${metadata.artifactId}.json`);
    if (!await publish(temp, blob)) {
      await confined(root, blob);
      const existing = await digestFile(blob);
      if (existing.sha256 !== metadata.sha256 || existing.size !== size) throw new Error('En arkiveret mediefil har ændret indhold.');
    }
    handle = await open(metaTemp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(metadata)); await handle.sync(); await handle.close(); handle = undefined;
    if (!await publish(metaTemp, record)) {
      const existing = await archivedArtifactPath(artifactsDir, runId, metadata.artifactId);
      return descriptor(existing.metadata);
    }
    return descriptor(metadata);
  } finally {
    await sourceHandle?.close();
    await handle?.close();
    await Promise.all([temp, metaTemp].map(path => unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; })));
  }
}

export async function archivedArtifactPath(artifactsDir, runId, artifactId) {
  if (typeof artifactId !== 'string' || !HASH.test(artifactId)) throw new Error('Ugyldigt medie-id.');
  const { root, dir } = await runDirectory(artifactsDir, runId);
  const record = await confined(root, join(dir, `${artifactId}.json`));
  if ((await lstat(record)).size > 16 * 1024) throw new Error('Mediets metadata er for store.');
  const metadata = JSON.parse(await readFile(record, 'utf8'));
  if (metadata.version !== 1 || metadata.runId !== runId || metadata.artifactId !== artifactId || !HASH.test(metadata.sha256) || artifactIdFor(metadata) !== artifactId || TYPES[extname(metadata.name).toLowerCase()] !== metadata.mime) throw new Error('Mediets metadata matcher ikke den gemte version.');
  const path = await confined(root, join(dir, `${metadata.sha256}.blob`));
  if (!(await lstat(path)).isFile()) throw new Error('Medieversionen er ikke en fil.');
  const digest = await digestFile(path);
  if (digest.sha256 !== metadata.sha256 || digest.size !== metadata.size) throw new Error('Medieversionens kontrolsum matcher ikke.');
  return { path, metadata };
}

export function registerArtifactRoutes(app, { dirs, readRun }) {
  app.get('/api/ai/runs/:id/artifacts/:artifactId', async (req, res) => {
    try {
      readRun(dirs, req.params.id);
      const { path, metadata } = await archivedArtifactPath(dirs.artifacts, req.params.id, req.params.artifactId);
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.setHeader('ETag', `"${metadata.sha256}"`);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(basename(metadata.name))}`);
      res.type(metadata.mime).sendFile(path);
    } catch { res.status(404).end(); }
  });
}

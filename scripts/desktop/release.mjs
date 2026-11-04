import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute, sep } from 'node:path';

export async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

export function releaseFiles(root, dir = '') {
  const files = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const name = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Release indeholder et symbolsk link: ${name}`);
    if (entry.isDirectory()) files.push(...releaseFiles(root, name));
    else if (entry.isFile() && name !== 'release.json') files.push(name);
  }
  return files.sort();
}

export async function verifyRelease(root) {
  const base = realpathSync(root);
  const manifest = JSON.parse(readFileSync(join(base, 'release.json'), 'utf8'));
  if (manifest.format !== 1 || !/^[a-zA-Z0-9._-]{1,100}$/.test(manifest.releaseId) || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Ugyldigt release-manifest.');
  const names = new Set();
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || file.path.includes('\\') || file.path.split('/').some(part => !part || part === '.' || part === '..') || isAbsolute(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || names.has(file.path)) throw new Error('Ugyldig fil i release-manifest.');
    names.add(file.path);
    const path = realpathSync(join(base, file.path)), rel = relative(base, path);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !lstatSync(path).isFile() || await fileDigest(path) !== file.sha256) throw new Error(`Release-kontrol fejlede: ${file.path}`);
  }
  const actual = releaseFiles(base);
  if (actual.length !== names.size || actual.some(name => !names.has(name))) throw new Error('Release-mappen indeholder filer uden for manifestet.');
  for (const required of ['server/companion.mjs', 'dist/index.html', 'desktop/launch.mjs', 'package.json', manifest.nodePath]) if (!names.has(required)) throw new Error(`Release mangler ${required}.`);
  return manifest;
}

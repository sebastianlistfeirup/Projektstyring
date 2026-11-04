import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileDigest, releaseFiles, verifyRelease } from './desktop/release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = resolve(process.argv[2] ?? join(root, 'desktop-build', 'Orbit'));
if (existsSync(dest)) throw new Error('Vælg en ny tom release-mappe. Eksisterende releases overskrives ikke.');
if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('Kør npm run build før desktop-pakning.');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) throw new Error('Pakning kræver Node.js 22.13 eller nyere.');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
mkdirSync(dest, { recursive: true });
try {
  for (const name of ['server', 'shared', 'dist', 'package.json', 'package-lock.json']) cpSync(join(root, name), join(dest, name), { recursive: true, dereference: false });
  cpSync(join(root, 'scripts', 'desktop'), join(dest, 'desktop'), { recursive: true });
  // npm runs only at packaging time. The installed product needs neither npm,
  // a system Node installation nor a Vite development server.
  const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
  if (!existsSync(npmCli)) throw new Error('Start pakningen gennem npm run desktop:package, så npm-stien er kendt.');
  execFileSync(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dest, stdio: 'inherit' });
  // React, Tailwind and the 3D viewer are already compiled into dist. Retain
  // only server dependencies in the installed runtime, with lockfile versions.
  const serverDependencies = Object.fromEntries(['express', 'ws', '@azure/msal-node', 'pdfjs-dist', 'mammoth'].map(name => {
    if (!pkg.dependencies?.[name]) throw new Error(`Serverafhængigheden ${name} mangler i package.json.`);
    return [name, pkg.dependencies[name]];
  }));
  writeFileSync(join(dest, 'package.json'), JSON.stringify({ name: 'orbit-desktop-runtime', private: true, version: pkg.version, type: 'module', engines: pkg.engines, dependencies: serverDependencies }, null, 2));
  execFileSync(process.execPath, [npmCli, 'prune', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dest, stdio: 'inherit' });
  const pruneBuildCommands = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.bin') rmSync(join(dir, entry.name), { recursive: true, force: true });
      else if (entry.isDirectory()) pruneBuildCommands(join(dir, entry.name));
    }
  };
  pruneBuildCommands(join(dest, 'node_modules'));
  mkdirSync(join(dest, 'runtime'));
  const nodePath = `runtime/${process.platform === 'win32' ? 'node.exe' : 'node'}`;
  cpSync(process.execPath, join(dest, nodePath));
  cpSync(join(root, 'src-tauri', 'icons', 'icon.ico'), join(dest, 'runtime', 'orbit.ico'));
  const launch = '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0desktop\\launch.mjs" %*\r\nif errorlevel 1 pause\r\n';
  writeFileSync(join(dest, 'Start-Orbit.cmd'), launch);
  writeFileSync(join(dest, 'Stop-Orbit.cmd'), launch.replace('%*', '--stop'));
  writeFileSync(join(dest, 'Install-Orbit.cmd'), '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0desktop\\install.mjs"\r\nif errorlevel 1 pause\r\n');
  const files = [];
  for (const path of releaseFiles(dest)) files.push({ path, sha256: await fileDigest(join(dest, path)) });
  const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  let sourceCommit = null, sourceDirty = null;
  try {
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim());
  } catch { /* Exported sources may not include Git. */ }
  const manifest = { format: 1, stateFormat: 2, version: pkg.version, releaseId: `${pkg.version}-${digest.slice(0, 16)}`, platform: process.platform, arch: process.arch, nodeVersion: process.versions.node, nodePath, sourceCommit, sourceDirty, createdAt: new Date().toISOString(), files };
  writeFileSync(join(dest, 'release.json'), JSON.stringify(manifest, null, 2));
  await verifyRelease(dest);
  console.log(`Orbit release: ${dest}\nRelease-id: ${manifest.releaseId}\nPlatform: ${manifest.platform}/${manifest.arch}`);
} catch (error) {
  // Leave an inspectable failed build, clearly not an installable release.
  rmSync(join(dest, 'release.json'), { force: true });
  throw error;
}

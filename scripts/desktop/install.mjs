import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyRelease } from './release.mjs';
import { launchRelease, stopManaged, writeState, writeAtomicText } from './launch.mjs';

export async function installRelease(source, { installDir, appDir = join(homedir(), '.orbit'), smokePort = 14310, port = 4310, open = true, createShortcuts = true } = {}) {
  if (!installDir) throw new Error('Installationsmappe mangler.');
  mkdirSync(installDir, { recursive: true });
  const lockPath = join(installDir, '.update-lock');
  let lock;
  try { lock = openSync(lockPath, 'wx', 0o600); }
  catch {
    let stale = false;
    try {
      const previousLock = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (Number.isSafeInteger(previousLock.pid) && previousLock.pid > 0) {
        try { process.kill(previousLock.pid, 0); } catch (error) { stale = error.code === 'ESRCH'; }
      }
    } catch { /* Unknown ownership must be reviewed, never guessed. */ }
    if (!stale) throw new Error('En anden installation er i gang. Kontrollér processen før du prøver igen.');
    rmSync(lockPath); lock = openSync(lockPath, 'wx', 0o600);
  }
  writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  try { return await activateRelease(source, { installDir, appDir, smokePort, port, open, createShortcuts }); }
  finally { closeSync(lock); rmSync(lockPath, { force: true }); }
}

async function activateRelease(source, { installDir, appDir, smokePort, port, open, createShortcuts }) {
  const manifest = await verifyRelease(source);
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('Releasen er bygget til en anden platform.');
  mkdirSync(join(installDir, 'releases'), { recursive: true });
  const statePath = join(installDir, 'installation.json');
  let before = null;
  if (existsSync(statePath)) before = JSON.parse(readFileSync(statePath, 'utf8'));
  const target = join(installDir, 'releases', manifest.releaseId);
  if (!existsSync(target)) {
    const staging = `${target}.staging-${randomUUID()}`;
    try { cpSync(source, staging, { recursive: true, errorOnExist: true, force: false }); await verifyRelease(staging); renameSync(staging, target); }
    finally { rmSync(staging, { recursive: true, force: true }); }
  }
  await verifyRelease(target);
  const smokeDir = join(tmpdir(), `orbit-install-check-${randomUUID()}`);
  // Validate the complete new runtime with empty isolated data BEFORE touching
  // the existing instance. A failed build leaves the old installation running.
  try {
    await launchRelease(target, { appDir: smokeDir, exportDir: join(smokeDir, 'exports'), port: smokePort });
    await stopManaged(smokeDir, smokePort);
  } finally {
    // A refused/unfinished shutdown keeps its control file for diagnosis; do
    // not erase the only ownership proof while a process may still be alive.
    if (!existsSync(join(smokeDir, 'desktop-control.json'))) rmSync(smokeDir, { recursive: true, force: true });
  }
  await stopManaged(appDir, port);
  try {
    await launchRelease(target, { appDir, port, open: false });
  } catch (error) {
    // Roll back code only within an explicitly compatible storage format. Never
    // restore an old data snapshot over decisions or changes made by the user.
    let recovered = false;
    if (before?.current && /^[a-zA-Z0-9._-]{1,100}$/.test(before.current)) {
      const previousDir = join(installDir, 'releases', before.current);
      try {
        const previous = await verifyRelease(previousDir);
        if (previous.stateFormat === manifest.stateFormat && manifest.stateFormat === 2) {
          await launchRelease(previousDir, { appDir, port, open: false }); recovered = true;
        }
      } catch { /* Preserve both releases and data for manual diagnosis. */ }
    }
    writeState(join(installDir, 'last-update-error.json'), { releaseId: manifest.releaseId, previous: before?.current ?? null, time: new Date().toISOString(), reason: error.message });
    throw new Error(`Den nye Orbit-version kunne ikke starte. ${recovered ? 'Den tidligere version er startet igen.' : 'Den tidligere startgenvej og alle data er bevaret.'} ${error.message}`);
  }
  // Both stable launchers read the same atomic version pointer. A crash cannot
  // leave Start on the new version and Stop on the old version. The runtime
  // binary is versioned and never overwritten while it is running.
  writeAtomicText(join(installDir, 'Start-Orbit.ps1'), readFileSync(join(target, 'desktop', 'start-installed.ps1'), 'utf8'));
  writeAtomicText(join(installDir, 'Start-Orbit.cmd'), '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Orbit.ps1"\r\nif errorlevel 1 pause\r\n');
  writeAtomicText(join(installDir, 'Stop-Orbit.cmd'), '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Orbit.ps1" -Stop\r\nif errorlevel 1 pause\r\n');
  writeState(statePath, { format: 1, current: manifest.releaseId, previous: before?.current === manifest.releaseId ? before?.previous ?? null : before?.current ?? null, updatedAt: new Date().toISOString() });
  if (process.platform === 'win32' && createShortcuts) {
    try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(target, 'desktop', 'shortcuts.ps1'), '-InstallDir', installDir], { windowsHide: true, stdio: 'pipe' }); }
    catch { console.warn(`Orbit er installeret, men genvejen kunne ikke oprettes. Brug ${join(installDir, 'Start-Orbit.cmd')}.`); }
  }
  if (open) await launchRelease(target, { appDir, port, open: true });
  return { releaseId: manifest.releaseId, previous: before?.current ?? null, installDir };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const installDir = process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Programs', 'Orbit') : join(homedir(), '.local', 'share', 'orbit-desktop');
  try { const result = await installRelease(source, { installDir }); console.log(`Orbit ${result.releaseId} er installeret. Startgenvej: ${join(installDir, 'Start-Orbit.cmd')}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

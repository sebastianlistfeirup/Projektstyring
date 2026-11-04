import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyRelease } from './release.mjs';

export function writeState(path, state) {
  writeAtomicText(path, JSON.stringify(state, null, 2));
}

export function writeAtomicText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600 });
  renameSync(temporary, path);
}

async function ping(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1000) });
    if (response.ok) return await response.json();
  } catch { /* An offline port is not a healthy runtime. */ }
  return null;
}

export async function stopManaged(appDir, port = 4310) {
  const controlPath = join(appDir, 'desktop-control.json');
  const current = await ping(port);
  if (!current) return;
  let control;
  try { control = JSON.parse(readFileSync(controlPath, 'utf8')); }
  catch { throw new Error('Porten bruges af en anden Orbit-installation. Afslut den fra dens egen start/stop-genvej.'); }
  if (control.runtimeId !== current.runtimeId || control.releaseId !== current.releaseId || control.port !== port) throw new Error('Den kørende Orbit-runtime tilhører ikke denne installation. Ingen proces blev stoppet.');
  const response = await fetch(`http://127.0.0.1:${port}/api/desktop/shutdown`, { method: 'POST', headers: { 'X-Orbit-Desktop-Token': control.token, 'Content-Type': 'application/json', Connection: 'close' }, body: '{}', signal: AbortSignal.timeout(5000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.reason ?? 'Orbit kunne ikke lukkes sikkert.');
  for (let attempt = 0; attempt < 100; attempt++) {
    let alive = false;
    try { process.kill(control.pid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') alive = true; }
    if (!await ping(port) && !alive) { rmSync(controlPath, { force: true }); return; }
    await delay(250);
  }
  throw new Error('Orbit lukker stadig. Opdateringen er ikke aktiveret.');
}

export async function launchRelease(releaseDir, { appDir = join(homedir(), '.orbit'), exportDir, port = 4310, open = false, timeoutMs = 30000, verify = true } = {}) {
  const manifest = verify ? await verifyRelease(releaseDir) : JSON.parse(readFileSync(join(releaseDir, 'release.json'), 'utf8'));
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('Denne Orbit-release er bygget til en anden platform.');
  const current = await ping(port);
  if (current) {
    let control;
    try { control = JSON.parse(readFileSync(join(appDir, 'desktop-control.json'), 'utf8')); } catch { /* Fail closed. */ }
    if (current.releaseId !== manifest.releaseId || !control || current.runtimeId !== control.runtimeId) throw new Error('En anden Orbit-version kører allerede. Opdateringsprogrammet skal lukke den sikkert først.');
    if (open) openWindow(port);
    return { reused: true, releaseId: manifest.releaseId, runtimeId: current.runtimeId };
  }
  mkdirSync(appDir, { recursive: true });
  const logDir = join(appDir, 'desktop-logs'); mkdirSync(logDir, { recursive: true });
  const token = randomBytes(32).toString('hex'), runtimeId = randomUUID();
  const output = openSync(join(logDir, `${manifest.releaseId}.log`), 'a', 0o600);
  const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
  const child = spawn(join(releaseDir, manifest.nodePath), [join(releaseDir, 'server', 'companion.mjs')], {
    cwd: releaseDir, detached: true, windowsHide: true, stdio: ['ignore', output, output],
    env: { ...inheritedEnv, PATH: `${dirname(join(releaseDir, manifest.nodePath))}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`, ORBIT_HOST: '127.0.0.1', ORBIT_PORT: String(port), ORBIT_APP_DIR: appDir,
      ORBIT_FRONTEND_DIR: join(releaseDir, 'dist'), ORBIT_RUNTIME_ID: runtimeId, ORBIT_DESKTOP_TOKEN: token,
      ...(exportDir ? { ORBIT_EXPORT_DIR: exportDir } : {}) },
  });
  closeSync(output);
  let failure;
  child.once('error', error => { failure = error; });
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (failure || child.exitCode !== null || child.signalCode !== null) throw failure ?? new Error('Orbit-processen stoppede under opstart.');
      const health = await ping(port);
      if (health?.ok && health.runtimeId === runtimeId && health.releaseId === manifest.releaseId && health.version === manifest.version) {
        const page = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) });
        if (!page.ok || !(await page.text()).includes('id="root"')) throw new Error('Orbit-vinduet kunne ikke indlæses fra den nye release.');
        writeState(join(appDir, 'desktop-control.json'), { format: 1, runtimeId, releaseId: manifest.releaseId, port, pid: child.pid, token });
        child.unref();
        if (open) openWindow(port);
        return { reused: false, releaseId: manifest.releaseId, runtimeId };
      }
      if (health && health.runtimeId !== runtimeId) throw new Error('Porten blev overtaget af en anden proces.');
      await delay(200);
    }
    throw new Error(`Orbit blev ikke klar. Se desktop-loggen i ${logDir}.`);
  } catch (error) {
    // Only our own new child is touched. Never kill a process found by port/PID.
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), delay(3000)]);
    }
    child.unref();
    throw error;
  }
}

function openWindow(port) {
  const url = `http://127.0.0.1:${port}/`;
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const opener = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  opener.on('error', () => { console.log(`Åbn Orbit: ${url}`); }); opener.unref();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const releaseDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const smoke = process.argv.includes('--smoke'), appDir = smoke ? join(tmpdir(), `orbit-release-smoke-${randomUUID()}`) : join(homedir(), '.orbit');
  const port = Number(process.env.ORBIT_DESKTOP_PORT ?? (smoke ? 14310 : 4310));
  try {
    if (process.argv.includes('--stop')) await stopManaged(appDir, port);
    else {
      const result = await launchRelease(releaseDir, { appDir, port, open: !smoke, ...(smoke ? { exportDir: join(appDir, 'exports') } : {}) });
      console.log(`Orbit ${result.releaseId}: klar.`);
      if (smoke) { await stopManaged(appDir, port); rmSync(appDir, { recursive: true, force: true }); }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

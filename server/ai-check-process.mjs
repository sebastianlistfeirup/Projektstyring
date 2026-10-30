import { spawn, execFile } from 'node:child_process';
import { trackAiProcess } from './ai-processes.mjs';

// Checks run as their own process group so npm/Godot/test-runner children are
// stopped with their parent. No shell interprets the user-supplied arguments.
export function runCheckProcess(command, args, { cwd, signal, timeoutMs = 600000, onProcess } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', bytes = 0, reason = null, callbackError, forceTimer, windowsStop;
    const terminate = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        windowsStop ??= new Promise(done => execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { timeout: 10000 }, () => done()));
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ }
        forceTimer ??= setTimeout(force, 2000);
        forceTimer.unref();
      }
    };
    const force = () => { if (child.pid && process.platform !== 'win32') try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already stopped */ } };
    const stop = message => { reason ??= message; terminate(); };
    const notify = finished => {
      if (!child.pid) return;
      try { onProcess?.({ pid: child.pid, startedAt, finished }); }
      catch (error) { callbackError ??= error; stop('Procesregistrering kunne ikke gemmes.'); }
    };
    const startedAt = Date.now();
    const untrack = trackAiProcess(child.pid, { kind: 'verification', command: String(command).split(/[\\/]/).at(-1), stop: () => stop('Kontrollen stoppes, fordi Companion lukkes.') });
    const abort = () => stop('Kontrollen blev afbrudt.');
    const timer = setTimeout(() => stop('Kontrollen overskred tidsgrænsen.'), timeoutMs);
    const capture = chunk => {
      bytes += Buffer.byteLength(chunk);
      output = (output + chunk).slice(-20000);
      if (bytes > 2 * 1024 * 1024) stop('Kontrollens output overskred 2 MB.');
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.on('error', error => { reason ??= error.message; });
    child.on('close', async code => {
      clearTimeout(timer); clearTimeout(forceTimer); signal?.removeEventListener('abort', abort);
      // A parent can exit while a detached-stdio grandchild ignores SIGTERM.
      if (reason) force();
      if (windowsStop) await windowsStop;
      untrack();
      notify(true);
      if (callbackError) { reject(callbackError); return; }
      resolve({ exitCode: reason ? null : code, status: signal?.aborted ? 'cancelled' : !reason && code === 0 ? 'passed' : 'failed', output: `${output}${reason ? `\n${reason}` : ''}`.slice(-20000) });
    });
    signal?.addEventListener('abort', abort, { once: true });
    notify(false);
    if (signal?.aborted) abort();
  });
}

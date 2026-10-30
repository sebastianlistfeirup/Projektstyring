import { readFileSync, readdirSync } from 'node:fs';

// Covers direct chats as well as Auto. Persisted Auto process identities still
// handle crash recovery; this registry handles deliberate, graceful shutdown.
const processes = new Map();

export function trackAiProcess(pid, { stop, ...metadata }) {
  if (!Number.isInteger(pid) || pid <= 0) return () => {};
  processes.set(pid, { pid, startedAt: Date.now(), ...metadata, stop });
  return () => processes.delete(pid);
}

export function aiProcessSnapshot() {
  return [...processes.values()].map(({ stop: _stop, ...metadata }) => metadata);
}

export function stopAiProcesses() {
  for (const item of [...processes.values()]) {
    try { item.stop(); } catch { /* caller keeps waiting while process is registered */ }
  }
}


function exists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

// A dead parent can leave working grandchildren in its detached process group.
// Conversely, a Linux zombie still accepts signal 0 but cannot execute code.
export function processMayBeWorking(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  const parent = exists(pid), group = process.platform !== 'win32' && exists(-pid);
  if (!parent && !group) return false;
  if (process.platform !== 'linux') return true;
  const info = id => {
    try {
      const raw = readFileSync(`/proc/${id}/stat`, 'utf8');
      const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
      return { working: !['Z', 'X'].includes(fields[0]), group: Number(fields[2]) };
    } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error; }
  };
  try {
    if (parent && info(pid)?.working) return true;
    if (group) for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      const member = info(name);
      if (member?.group === pid && member.working) return true;
    }
    return false;
  } catch { return true; } // Unknown process visibility keeps recovery blocked.
}

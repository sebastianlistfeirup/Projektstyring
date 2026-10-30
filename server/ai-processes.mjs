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

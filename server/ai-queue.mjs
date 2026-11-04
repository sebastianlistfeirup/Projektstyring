import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, basename } from 'node:path';
import { writeAtomicJson } from './atomic-json.mjs';
import { durableStorePath, readDurableDocument, transactDurableDocument } from './ai-durable-store.mjs';
import { processMayBeWorking } from './ai-processes.mjs';

const terminal = new Set(['done', 'error', 'partial', 'blocked', 'cancelled', 'interrupted']);

const queueKey = path => `queue:${basename(path)}`;
const queueStore = path => durableStorePath({ runs: dirname(path) });
function validateQueue(saved) {
  if (saved.version !== 1 || typeof saved.paused !== 'boolean' || !Array.isArray(saved.entries) || saved.entries.some(entry => !entry || typeof entry.id !== 'string' || !entry.input || typeof entry.input.goal !== 'string' || !['queued', 'running', ...terminal].includes(entry.status)) || new Set(saved.entries.map(entry => entry.id)).size !== saved.entries.length || !saved.scheduleKeys || typeof saved.scheduleKeys !== 'object' || Array.isArray(saved.scheduleKeys)) throw new Error('Ukendt køformat');
  return saved;
}

function loadQueue(path, initial) {
  return transactDurableDocument(queueStore(path), queueKey(path), current => {
    if (current) { validateQueue(current.value); return {}; }
    let saved;
    try { saved = validateQueue(JSON.parse(readFileSync(path, 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; saved = initial; }
    return { value: saved };
  }).document.value;
}

// Called inside the workspace-restore transaction before its new snapshot is
// published. The DB wins over a stale JSON projection; old backups import once.
export function pauseRestoredQueue(path, reason = 'Backup er gendannet. Gennemgå køen før den fortsættes.') {
  const initial = { version: 1, paused: true, reason, entries: [], scheduleKeys: {}, updatedAt: Date.now() };
  loadQueue(path, initial);
  const { document } = transactDurableDocument(queueStore(path), queueKey(path), current => ({ value: {
    ...validateQueue(current.value), paused: true, reason, updatedAt: Date.now(),
    entries: current.value.entries.map(entry => entry.status === 'running' ? { ...entry, ownerPid: null } : entry),
  } }));
  writeAtomicJson(path, document.value);
  return document.value;
}

/** Durable intent queue for one Companion process. Claims are saved before
 * execution. A crash after a claim is never treated as proof nothing happened. */
export class DurableRunQueue {
  constructor({ path, execute, readRun, resolveInput = input => input, isBusy = () => false, canResume = () => '', onUpdate = () => {}, now = () => Date.now() }) {
    Object.assign(this, { path, execute, readRun, resolveInput, isBusy, canResume, onUpdate, now });
    this.running = false;
    this.state = { version: 1, paused: false, reason: '', entries: [], scheduleKeys: {}, updatedAt: now() };
    try {
      this.state = loadQueue(path, this.state);
    } catch (error) {
      if (error.code !== 'ENOENT') { this.storageError = 'Arbejdskøen kunne ikke læses. Gendan køfilen fra backup før nye kørsler.'; this.state.paused = true; this.state.reason = this.storageError; }
    }
  }
  reloadAfterRestore() {
    if (this.running) throw new Error('Stop den aktive køopgave før gendannelse.');
    const loaded = new DurableRunQueue({ path: this.path });
    this.state = loaded.state; this.storageError = loaded.storageError;
    if (!this.storageError) try { this.recover(); this.pause('Backup er gendannet. Gennemgå de ventende opgaver og fortsæt køen, når de stadig er aktuelle.'); }
    catch { this.storageError = 'Backup er gendannet, men køens pause kunne ikke gemmes. Køen er blokeret, indtil lageret er rettet og gendannelsen gennemført igen.'; this.state.paused = true; this.state.reason = this.storageError; }
  }
  snapshot() {
    if (!this.storageError) {
      try { this.state = validateQueue(readDurableDocument(queueStore(this.path), queueKey(this.path)).value); }
      catch { this.storageError = 'Arbejdskøens joblager kunne ikke læses. Kontrollér lageret før nye kørsler.'; this.state.paused = true; this.state.reason = this.storageError; }
    }
    return structuredClone({ ...this.state, storageError: this.storageError });
  }
  commit(change) {
    if (this.storageError) throw new Error(this.storageError);
    const { document, result } = transactDurableDocument(queueStore(this.path), queueKey(this.path), current => {
      const next = structuredClone(validateQueue(current.value)), result = change(next);
      next.updatedAt = this.now();
      next.scheduleKeys = Object.fromEntries(Object.entries(next.scheduleKeys).sort((a, b) => b[1] - a[1]).slice(0, 2000));
      return { value: next, result };
    });
    this.state = document.value;
    // JSON remains a portable compatibility projection, never the claim lock.
    // A projection failure stops this worker even though the transaction is safe.
    try { writeAtomicJson(this.path, this.state); }
    catch (error) { this.storageError = 'Køen er gemt i joblageret, men dens eksport kunne ikke gemmes. Kontrollér disken før arbejdet fortsættes.'; throw error; }
    try { this.onUpdate(this.snapshot()); } catch { /* observers do not own the queue */ }
    return result;
  }
  recover() {
    if (this.storageError || !this.state.entries.some(entry => entry.status === 'running')) return;
    this.commit(state => {
      for (const entry of state.entries.filter(entry => entry.status === 'running')) {
        // Another Companion instance may still own the claim. A PID is a
        // conservative local guard, not a lease or proof of remote completion.
        if (entry.ownerPid && processMayBeWorking(entry.ownerPid)) continue;
        let run; try { run = this.readRun(entry.runId); } catch { /* unknown dispatch outcome */ }
        entry.status = run && terminal.has(run.status) ? run.status : 'interrupted';
        entry.finishedAt = this.now();
        if (entry.status !== 'done') {
          entry.reason = 'Companion genstartede under arbejdet. Kontrollér den tilknyttede kørsel før genoptagelse.';
          state.paused = true; state.reason = entry.reason;
        }
      }
    });
  }
  enqueue(input, { key, source = 'manual', name = '' } = {}) {
    if (this.storageError) throw new Error(this.storageError);
    if (!input || typeof input.goal !== 'string' || !input.goal.trim() || input.goal.length > 50000) throw new Error('Køopgaven kræver et mål på højst 50.000 tegn.');
    return this.commit(state => {
      if (key && Object.hasOwn(state.scheduleKeys, key)) return { duplicate: true, entry: structuredClone(state.entries.find(entry => entry.key === key) ?? null) };
      const duplicate = input.taskId ? state.entries.find(entry => ['queued', 'running'].includes(entry.status) && entry.input.projectId === input.projectId && entry.input.taskId === input.taskId) : null;
      if (duplicate) {
        if (key) state.scheduleKeys[key] = this.now();
        return { duplicate: true, entry: structuredClone(duplicate) };
      }
      if (state.entries.filter(entry => ['queued', 'running'].includes(entry.status)).length >= 100) throw new Error('Arbejdskøen har allerede 100 ventende eller aktive opgaver.');
      const entry = { id: `queue-${randomUUID().slice(0, 12)}`, input: structuredClone(input), name: name || input.goal.slice(0, 100), source, key, status: 'queued', createdAt: this.now() };
      state.entries = [...state.entries.filter(entry => !terminal.has(entry.status)), ...state.entries.filter(entry => terminal.has(entry.status)).slice(-200), entry];
      if (key) state.scheduleKeys[key] = this.now();
      return { duplicate: false, entry: structuredClone(entry) };
    });
  }
  pause(reason = 'Køen er sat på pause. Den aktive kørsel fortsætter.') { this.commit(state => { state.paused = true; state.reason = reason; }); }
  resume() {
    const reason = this.canResume(); if (reason) throw new Error(reason);
    this.commit(state => { state.paused = false; state.reason = ''; });
    void this.pump();
  }
  cancel(id) {
    this.commit(state => {
      const item = state.entries.find(entry => entry.id === id);
      if (!item || item.status !== 'queued') throw new Error('Kun ventende køopgaver kan fjernes. Stop en aktiv kørsel via kørselskontrollerne.');
      item.status = 'cancelled'; item.finishedAt = this.now(); item.reason = 'Fjernet fra køen af brugeren.';
    });
  }
  async pump() {
    if (this.running || this.storageError || this.isBusy()) return;
    this.snapshot();
    if (this.storageError || this.state.paused || this.state.entries.some(entry => entry.status === 'running')) return;
    const entry = this.state.entries.find(entry => entry.status === 'queued');
    if (!entry) return;
    this.running = true;
    let input, runId;
    try {
      const guard = this.canResume(); if (guard) throw new Error(guard);
      input = this.resolveInput(structuredClone(entry.input));
      runId = randomUUID().slice(0, 12);
      const claimed = this.commit(state => {
        const item = state.entries.find(item => item.id === entry.id);
        if (state.paused || item?.status !== 'queued' || state.entries.some(item => item.status === 'running')) return false;
        item.status = 'running'; item.runId = runId; item.ownerPid = process.pid; item.startedAt = this.now();
        return true;
      });
      if (!claimed) return;
      await this.execute({ ...input, runId });
      const run = this.readRun(runId);
      if (!run || !terminal.has(run.status)) throw new Error('Kørslen returnerede uden en gemt slutstatus.');
      this.commit(state => {
        const item = state.entries.find(item => item.id === entry.id);
        item.status = run.status; item.finishedAt = this.now();
        if (run.status !== 'done') { item.reason = `Kørslen sluttede som ${run.status}. Gennemgå resultatet før køen fortsættes.`; state.paused = true; state.reason = item.reason; }
      });
    } catch (error) {
      try {
        this.commit(state => {
          const item = state.entries.find(item => item.id === entry.id);
          item.status = runId ? 'interrupted' : 'blocked'; item.finishedAt = this.now(); item.reason = error.message;
          state.paused = true; state.reason = error.message;
        });
      } catch {
        // Never dispatch more work after losing persistence during a claim.
        this.storageError = 'Køens tilstand kunne ikke gemmes. Kontrollér disken og den aktive kørsel før genstart.';
        this.state.paused = true; this.state.reason = this.storageError;
      }
    } finally { this.running = false; }
    if (!this.state.paused && !this.storageError) queueMicrotask(() => void this.pump());
  }
}

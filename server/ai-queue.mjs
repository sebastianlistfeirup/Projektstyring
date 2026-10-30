import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { writeAtomicJson } from './atomic-json.mjs';

const terminal = new Set(['done', 'error', 'partial', 'blocked', 'cancelled', 'interrupted']);

/** Durable intent queue for one Companion process. Claims are saved before
 * execution. A crash after a claim is never treated as proof nothing happened. */
export class DurableRunQueue {
  constructor({ path, execute, readRun, resolveInput = input => input, isBusy = () => false, canResume = () => '', onUpdate = () => {}, now = () => Date.now() }) {
    Object.assign(this, { path, execute, readRun, resolveInput, isBusy, canResume, onUpdate, now });
    this.running = false;
    this.state = { version: 1, paused: false, reason: '', entries: [], scheduleKeys: {}, updatedAt: now() };
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      if (saved.version !== 1 || typeof saved.paused !== 'boolean' || !Array.isArray(saved.entries) || saved.entries.some(entry => !entry || typeof entry.id !== 'string' || !entry.input || typeof entry.input.goal !== 'string' || !['queued', 'running', ...terminal].includes(entry.status)) || new Set(saved.entries.map(entry => entry.id)).size !== saved.entries.length || !saved.scheduleKeys || typeof saved.scheduleKeys !== 'object' || Array.isArray(saved.scheduleKeys)) throw new Error('Ukendt køformat');
      this.state = saved;
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
  snapshot() { return structuredClone({ ...this.state, storageError: this.storageError }); }
  commit(change) {
    if (this.storageError) throw new Error(this.storageError);
    const next = structuredClone(this.state); change(next); next.updatedAt = this.now();
    next.scheduleKeys = Object.fromEntries(Object.entries(next.scheduleKeys).sort((a, b) => b[1] - a[1]).slice(0, 2000));
    writeAtomicJson(this.path, next); this.state = next;
    try { this.onUpdate(this.snapshot()); } catch { /* observers do not own the queue */ }
  }
  recover() {
    if (this.storageError || !this.state.entries.some(entry => entry.status === 'running')) return;
    this.commit(state => {
      for (const entry of state.entries.filter(entry => entry.status === 'running')) {
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
    if (key && this.state.scheduleKeys[key]) return { duplicate: true, entry: this.state.entries.find(entry => entry.key === key) ?? null };
    const duplicate = input.taskId ? this.state.entries.find(entry => ['queued', 'running'].includes(entry.status) && entry.input.projectId === input.projectId && entry.input.taskId === input.taskId) : null;
    if (duplicate) {
      if (key) this.commit(state => { state.scheduleKeys[key] = this.now(); });
      return { duplicate: true, entry: structuredClone(duplicate) };
    }
    if (this.state.entries.filter(entry => ['queued', 'running'].includes(entry.status)).length >= 100) throw new Error('Arbejdskøen har allerede 100 ventende eller aktive opgaver.');
    const entry = { id: `queue-${randomUUID().slice(0, 12)}`, input: structuredClone(input), name: name || input.goal.slice(0, 100), source, key, status: 'queued', createdAt: this.now() };
    this.commit(state => {
      state.entries = [...state.entries.filter(entry => !terminal.has(entry.status)), ...state.entries.filter(entry => terminal.has(entry.status)).slice(-200), entry];
      if (key) state.scheduleKeys[key] = this.now();
      state.scheduleKeys = Object.fromEntries(Object.entries(state.scheduleKeys).sort((a, b) => b[1] - a[1]).slice(0, 2000));
    });
    return { duplicate: false, entry: structuredClone(entry) };
  }
  pause(reason = 'Køen er sat på pause. Den aktive kørsel fortsætter.') { this.commit(state => { state.paused = true; state.reason = reason; }); }
  resume() {
    const reason = this.canResume(); if (reason) throw new Error(reason);
    this.commit(state => { state.paused = false; state.reason = ''; });
    void this.pump();
  }
  cancel(id) {
    const entry = this.state.entries.find(entry => entry.id === id);
    if (!entry || entry.status !== 'queued') throw new Error('Kun ventende køopgaver kan fjernes. Stop en aktiv kørsel via kørselskontrollerne.');
    this.commit(state => { const item = state.entries.find(entry => entry.id === id); item.status = 'cancelled'; item.finishedAt = this.now(); item.reason = 'Fjernet fra køen af brugeren.'; });
  }
  async pump() {
    if (this.running || this.storageError || this.state.paused || this.isBusy()) return;
    const entry = this.state.entries.find(entry => entry.status === 'queued');
    if (!entry) return;
    this.running = true;
    let input, runId;
    try {
      const guard = this.canResume(); if (guard) throw new Error(guard);
      input = this.resolveInput(structuredClone(entry.input));
      runId = randomUUID().slice(0, 12);
      this.commit(state => { const item = state.entries.find(item => item.id === entry.id); item.status = 'running'; item.runId = runId; item.startedAt = this.now(); });
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

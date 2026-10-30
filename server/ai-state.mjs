import { mkdirSync, writeFileSync, readFileSync, renameSync, readdirSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';

export const TERMINAL = new Set(['done', 'error', 'partial', 'cancelled', 'blocked', 'interrupted']);

// Validate the complete graph before executing any job. Dependencies are indexes
// for compatibility with existing saved plans, never implicit success on absence.
export function validatePlan(input) {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('Planen skal indeholde 1–100 jobs.');
  const ids = new Set();
  const jobs = input.map((j, i) => {
    if (!j || typeof j !== 'object') throw new Error(`Job ${i + 1} er ugyldigt.`);
    const id = String(j.id ?? `job-${i}`);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || ids.has(id)) throw new Error('Job-id skal være entydigt og uden stitegn.');
    ids.add(id);
    if (!String(j.title ?? '').trim()) throw new Error(`Job ${i + 1} mangler en titel.`);
    if (!Array.isArray(j.dependsOn ?? [])) throw new Error(`Job ${id} har ugyldige afhængigheder.`);
    const dependsOn = [...new Set(j.dependsOn ?? [])];
    if (dependsOn.some(d => !Number.isInteger(d) || d < 0 || d >= input.length || d === i)) throw new Error(`Job ${id} har en ugyldig afhængighed.`);
    return { ...j, id, title: String(j.title).trim(), description: String(j.description ?? ''), dependsOn };
  });
  const visited = new Set(), visiting = new Set();
  function visit(i) {
    if (visiting.has(i)) throw new Error('Planen indeholder en cirkulær afhængighed.');
    if (visited.has(i)) return;
    visiting.add(i);
    jobs[i].dependsOn.forEach(visit);
    visiting.delete(i); visited.add(i);
  }
  jobs.forEach((_, i) => visit(i));
  return jobs;
}

export function runOutcome(jobs, cancelled = false) {
  if (cancelled) return 'cancelled';
  if (jobs.length && jobs.every(j => j.status === 'done')) return 'done';
  if (jobs.some(j => j.status === 'done')) return 'partial';
  if (jobs.some(j => j.status === 'error')) return 'error';
  return 'blocked';
}

// A single writer is intentional: until a job owns an isolated checkout, two
// coding agents must never modify the same worktree concurrently.
export async function executeGraph(jobs, { execute, status, transition, cancelled = () => false }) {
  const pending = new Set(jobs.filter(j => status(j.id) !== 'done').map(j => j.id));
  while (pending.size) {
    if (cancelled()) {
      for (const id of pending) transition(id, 'cancelled', 'Kørslen blev stoppet.');
      break;
    }
    let progressed = false;
    for (const job of jobs) {
      if (!pending.has(job.id)) continue;
      const deps = job.dependsOn.map(d => status(jobs[d].id));
      if (deps.some(s => ['error', 'blocked', 'skipped', 'cancelled', 'interrupted'].includes(s))) {
        transition(job.id, 'blocked', 'En nødvendig forgænger leverede ikke et resultat.');
        pending.delete(job.id); progressed = true; continue;
      }
      if (!deps.every(s => s === 'done')) continue;
      if (cancelled()) break;
      await execute(job);
      pending.delete(job.id); progressed = true;
    }
    if (!progressed && !cancelled()) throw new Error('Planen kan ikke fortsætte: ingen klar afhængighed.');
  }
}

export function runPath(dirs, runId) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) throw new Error('Ugyldigt kørsels-id.');
  return join(dirs.runs, `${runId}.json`);
}

export function saveRun(dirs, run) {
  mkdirSync(dirs.runs, { recursive: true });
  const path = runPath(dirs, run.runId), temp = `${path}.tmp`;
  const fd = openSync(temp, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify({ ...run, schemaVersion: 2 }, null, 2)); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temp, path);
}

export function readRun(dirs, runId) {
  return JSON.parse(readFileSync(runPath(dirs, runId), 'utf8'));
}

// A process cannot prove that an interrupted external action never happened.
// Keep evidence and require a deliberate resume; never silently replay actions.
export function recoverRuns(dirs) {
  const recovered = [];
  for (const file of readdirSync(dirs.runs).filter(f => f.endsWith('.json'))) {
    let run;
    try { run = readRun(dirs, file.slice(0, -5)); } catch { console.warn(`Kunne ikke læse kørselsfil: ${file}`); continue; }
    if (!run.runId) continue;
    if (['running', 'planning', 'awaiting_approval'].includes(run.status)) {
      if (run.status !== 'awaiting_approval') run.status = 'interrupted';
      run.jobs = (run.jobs ?? []).map(j => j.status === 'running' ? { ...j, status: 'interrupted', error: 'Companion blev genstartet. Kontrollér eventuelle eksterne handlinger før genoptagelse.' } : j);
      run.recoveredAt = Date.now();
      saveRun(dirs, run);
      recovered.push(run);
    }
  }
  return recovered;
}

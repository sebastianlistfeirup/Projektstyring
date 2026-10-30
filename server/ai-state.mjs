import { mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomicJson } from './atomic-json.mjs';
import { saveRunSummary } from './ai-history.mjs';
import { AI_PHASES, normalizePhase } from '../shared/ai-plan.mjs';

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
    const phase = normalizePhase(j.phase);
    if (!AI_PHASES.includes(phase)) throw new Error(`Job ${id} har en ukendt fase.`);
    for (const field of ['readOnly', 'team']) if (j[field] !== undefined && typeof j[field] !== 'boolean') throw new Error(`Job ${id}: ${field} skal være sand eller falsk.`);
    if (!Array.isArray(j.dependsOn ?? [])) throw new Error(`Job ${id} har ugyldige afhængigheder.`);
    const dependsOn = [...new Set(j.dependsOn ?? [])];
    if (dependsOn.some(d => !Number.isInteger(d) || d < 0 || d >= input.length || d === i)) throw new Error(`Job ${id} har en ugyldig afhængighed.`);
    return { ...j, id, phase, title: String(j.title).trim(), description: String(j.description ?? ''), dependsOn };
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
  writeAtomicJson(runPath(dirs, run.runId), { ...run, schemaVersion: 2 });
  try { saveRunSummary(dirs, run); } catch { /* Derived index; full run is saved. */ }
}

export function eventJournalPath(dirs, runId) {
  runPath(dirs, runId); // Validate id before deriving another filename.
  return join(dirs.runs, `${runId}.events.ndjson`);
}

export function appendRunEvent(dirs, run, event) {
  mkdirSync(dirs.runs, { recursive: true });
  // Freeze events now: a later repair job must not mutate the earlier plan.
  const captured = JSON.parse(JSON.stringify(event));
  if (captured.type === 'job_done' && captured.result?.text?.length > 2000) {
    captured.result.text = captured.result.text.slice(0, 2000);
    captured.result.textTruncated = true;
  }
  const fd = openSync(eventJournalPath(dirs, run.runId), 'a', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(captured)}\n`); fsyncSync(fd); }
  finally { closeSync(fd); }
  run.eventsJournal = true;
  run.eventCount = (run.eventCount ?? run.events?.length ?? 0) + 1;
  run.events = [...(run.events ?? []).slice(-399), captured];
}

export function saveRunHeartbeat(dirs, run) {
  runPath(dirs, run.runId);
  writeAtomicJson(join(dirs.runs, `${run.runId}.pulse`), { runId: run.runId, heartbeatAt: run.heartbeatAt });
}

export function readRun(dirs, runId) {
  const run = JSON.parse(readFileSync(runPath(dirs, runId), 'utf8'));
  try {
    const pulse = JSON.parse(readFileSync(join(dirs.runs, `${runId}.pulse`), 'utf8'));
    if (pulse.runId === runId && Number.isFinite(pulse.heartbeatAt) && pulse.heartbeatAt > (run.heartbeatAt ?? 0)) run.heartbeatAt = pulse.heartbeatAt;
  } catch { /* Old runs have no separate heartbeat. */ }
  return run;
}

export function withRunEvents(dirs, run) {
  if (!run.eventsJournal) return run;
  try {
    const path = eventJournalPath(dirs, run.runId);
    // Large journals are downloaded as a stream, never expanded into browser
    // memory for replay. The saved run still contains current jobs and evidence.
    if (statSync(path).size > 8 * 1024 * 1024) return { ...run, events: [], eventsTruncated: true };
    const events = [], lines = readFileSync(path, 'utf8').split('\n');
    let incomplete = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { incomplete = true; }
    }
    return { ...run, events, eventsTruncated: incomplete };
  } catch { return { ...run, eventsTruncated: true }; }
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
      if (run.verification?.status === 'running') {
        run.verification = { ...run.verification, status: 'interrupted', checks: run.verification.checks.map(check => check.status === 'running' ? { ...check, status: 'interrupted', output: `${check.output}\nCompanion blev genstartet under kontrollen. Resultatet er ukendt.` } : check) };
        const last = run.verificationHistory?.at(-1);
        if (last) run.verificationHistory[run.verificationHistory.length - 1] = { ...last, ...run.verification };
      }
      run.recoveredAt = Date.now();
      saveRun(dirs, run);
      recovered.push(run);
    }
  }
  return recovered;
}

export function liveRunView(run) {
  if (!run) return null;
  // The full bible and long deliveries stay in the durable run. Five-second UI
  // polling needs status, context identities and bounded previews only.
  const { bible: _bible, attachments: _attachments, events: _events, ...view } = run;
  const preview = (text, limit) => String(text ?? '').slice(0, limit);
  return {
    ...view,
    jobs: (run.jobs ?? []).map(job => ({ ...job, description: preview(job.description, 2000),
      text: preview(job.text, 2000), textTruncated: Boolean(job.textTruncated || String(job.text ?? '').length > 2000),
      actions: (job.actions ?? []).slice(-12),
    })),
    results: (run.results ?? []).map(result => ({ ...result, text: preview(result.text, 6000), textTruncated: String(result.text ?? '').length > 6000 })),
  };
}

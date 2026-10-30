import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomicJson } from './atomic-json.mjs';

const VERSION = 2;
const validId = id => /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const text = (value, limit = 200) => String(value ?? '').slice(0, limit);
const time = value => typeof value === 'number' ? value : Date.parse(value ?? '') || 0;

export function summarizeRun(run) {
  return {
    file: `${run.runId}.json`, runId: run.runId, goal: text(run.goal, 500), goalTruncated: String(run.goal ?? '').length > 500,
    projectId: run.projectId ?? null, taskId: run.taskId ?? null, status: run.status,
    startedAt: run.startedAt, finishedAt: run.finishedAt, orchestratorId: run.orchestratorId, mode: run.mode,
    usage: run.usage ? { jobs: run.usage.jobs, byService: Object.fromEntries(Object.entries(run.usage.byService ?? {}).map(([id, usage]) => [id, { jobs: usage.jobs, kind: usage.kind }])) } : undefined,
    eventCount: run.eventCount ?? run.events?.length ?? 0,
    jobs: (run.jobs ?? []).map(job => ({ id: job.id, title: text(job.title), serviceId: job.serviceId,
      status: job.status, startedAt: job.startedAt, finishedAt: job.finishedAt })),
    results: (run.results ?? []).map(result => ({ jobId: result.jobId, title: text(result.title), score: result.score ?? null })),
  };
}

// A disposable index. The full run remains authoritative; stale, missing or
// corrupt indexes are regenerated one run at a time without retaining bodies.
export function saveRunSummary(dirs, run) {
  if (!validId(run.runId)) return;
  const source = statSync(join(dirs.runs, `${run.runId}.json`));
  writeAtomicJson(join(dirs.runs, `${run.runId}.summary`), {
    version: VERSION, sourceSize: source.size, sourceMtimeMs: source.mtimeMs, run: summarizeRun(run),
  });
}

export function readRunSummary(dirs, runId) {
  if (!validId(runId)) return null;
  const path = join(dirs.runs, `${runId}.json`), source = statSync(path);
  try {
    const cache = JSON.parse(readFileSync(join(dirs.runs, `${runId}.summary`), 'utf8'));
    if (cache.version === VERSION && cache.sourceSize === source.size && cache.sourceMtimeMs === source.mtimeMs && cache.run?.runId === runId) return cache.run;
  } catch { /* Derived cache only. */ }
  const run = JSON.parse(readFileSync(path, 'utf8'));
  if (run.runId !== runId) return null; // Queue/config JSON is not a run.
  try { saveRunSummary(dirs, run); } catch { /* Listing still works on read-only backups. */ }
  return summarizeRun(run);
}

export function listRunSummaries(dirs, { limit = 20, offset = 0, query = '', projectId = '' } = {}) {
  const runs = [], needle = String(query).trim().toLocaleLowerCase();
  let unreadable = 0;
  for (const file of readdirSync(dirs.runs).filter(name => name.endsWith('.json') && name !== 'ai-queue.json')) {
    try {
      const run = readRunSummary(dirs, file.slice(0, -5));
      if (!run || (projectId && run.projectId !== projectId)) continue;
      if (needle && !`${run.goal} ${run.runId}`.toLocaleLowerCase().includes(needle)) continue;
      runs.push(run);
    } catch { unreadable++; }
  }
  runs.sort((a, b) => (time(b.finishedAt) || time(b.startedAt)) - (time(a.finishedAt) || time(a.startedAt)) || b.runId.localeCompare(a.runId));
  const end = offset + limit;
  return { runs: runs.slice(offset, end), total: runs.length, nextOffset: end < runs.length ? end : null, unreadable };
}

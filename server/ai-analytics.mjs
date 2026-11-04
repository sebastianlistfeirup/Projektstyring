const count = value => Number.isFinite(value) && value >= 0 ? value : 0;
const stamp = value => typeof value === 'number' ? value : Date.parse(value ?? '');
const windowInfo = history => ({ windowRuns: history.runs.length, totalAvailable: history.total, windowLimit: 60, unreadable: history.unreadable });

export function summarizeUsage(history, nameOf = id => id) {
  const byService = new Map();
  let totalJobs = 0, totalRuns = 0;
  for (const run of history.runs) {
    if (!run.usage) continue;
    totalRuns++; totalJobs += count(run.usage.jobs);
    for (const [id, usage] of Object.entries(run.usage.byService ?? {})) {
      const previous = byService.get(id) ?? { id, name: nameOf(id), jobs: 0, kind: usage.kind, subscriptionCovered: false, estKr: null };
      previous.jobs += count(usage.jobs); byService.set(id, previous);
    }
  }
  return { ...windowInfo(history), totalRuns, totalJobs, estKr: null, byService: [...byService.values()].sort((a, b) => b.jobs - a.jobs) };
}

export function summarizeAnalysis(history, nameOf = id => id) {
  const byService = new Map(), byTitle = new Map();
  let errors = 0, totalMs = 0, timed = 0;
  for (const run of history.runs) for (const job of run.jobs ?? []) {
    const id = job.serviceId ?? null;
    const service = byService.get(id) ?? { id, name: nameOf(id) ?? '—', jobs: 0, attempts: 0, errors: 0, ms: 0, timed: 0 };
    service.jobs++;
    const startedAt = stamp(job.startedAt), finishedAt = stamp(job.finishedAt);
    if (startedAt > 0 || ['done', 'error', 'cancelled', 'interrupted'].includes(job.status)) service.attempts++;
    if (startedAt > 0 && Number.isFinite(finishedAt) && finishedAt >= startedAt) {
      service.ms += finishedAt - startedAt; service.timed++; totalMs += finishedAt - startedAt; timed++;
    }
    if (job.status === 'error') {
      service.errors++; errors++;
      byTitle.set(job.title, (byTitle.get(job.title) ?? 0) + 1);
    }
    byService.set(id, service);
  }
  const errorTitles = [...byTitle].map(([title, value]) => ({ title, count: value })).sort((a, b) => b.count - a.count).slice(0, 5);
  const services = [...byService.values()].map(service => ({ ...service,
    avgMs: service.timed ? Math.round(service.ms / service.timed) : 0,
    errorRate: service.attempts ? Math.round(service.errors / service.attempts * 100) : 0,
  })).sort((a, b) => b.jobs - a.jobs);
  const insights = [];
  if (errorTitles.length) insights.push(`Hyppigste fejltitel: “${errorTitles[0].title}” (${errorTitles[0].count} gange). Se de konkrete fejl i kørselshistorikken.`);
  if (timed) insights.push(`Tidsberegningen omfatter ${timed} jobs med registreret start og afslutning, inklusive fejlede forsøg.`);
  return { ...windowInfo(history), runs: history.runs.length, errors, avgJobMs: timed ? Math.round(totalMs / timed) : 0, errorTitles, services, insights };
}

import type { SwarmJob, SwarmRun } from './swarm';

export const runLabels: Record<string, string> = {
  running: 'Arbejder', awaiting_approval: 'Afventer din beslutning', done: 'Leveret',
  error: 'Fejlet', blocked: 'Blokeret', partial: 'Delvist leveret', cancelled: 'Stoppet',
  interrupted: 'Afbrudt', queued: 'I kø', skipped: 'Sprunget over',
};

export function timestamp(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** Preserve saved facts; absent historical timestamps remain unknown. */
export function presentRun(raw: SwarmRun): SwarmRun {
  const results = raw.results ?? [];
  return {
    ...raw,
    startedAt: timestamp(raw.startedAt) ?? 0,
    finishedAt: timestamp(raw.finishedAt),
    heartbeatAt: timestamp(raw.heartbeatAt) ?? undefined,
    notes: raw.notes ?? [],
    jobs: (raw.jobs ?? []).map(job => {
      const result = results.find(r => r.jobId === job.id);
      return { ...job, dependsOn: job.dependsOn ?? [], status: job.status ?? 'interrupted',
        startedAt: timestamp(job.startedAt), finishedAt: timestamp(job.finishedAt),
        notes: job.notes ?? [], liveText: job.liveText ?? '', deltaCount: job.deltaCount ?? 0,
        lastDeltaAt: timestamp(job.lastDeltaAt), text: result?.text ?? job.text ?? '',
        artifacts: result?.artifacts ?? job.artifacts ?? [], error: job.error ?? null,
      };
    }),
  };
}

/** Longest dependency path, with a guard for invalid legacy plans. */
export function jobStages(jobs: SwarmJob[]): number[] {
  const stages = new Map<number, number>();
  const visiting = new Set<number>();
  const visit = (index: number): number => {
    if (stages.has(index)) return stages.get(index)!;
    if (visiting.has(index) || !jobs[index]) return 0;
    visiting.add(index);
    const stage = (jobs[index].dependsOn ?? []).reduce((max, dependency) =>
      Number.isInteger(dependency) && dependency >= 0 && dependency < jobs.length && dependency !== index
        ? Math.max(max, visit(dependency) + 1) : max, 0);
    visiting.delete(index); stages.set(index, stage); return stage;
  };
  return jobs.map((_, index) => visit(index));
}

export function waitingReason(job: SwarmJob, run: SwarmRun): string {
  if (job.error) return job.error;
  if (run.status === 'awaiting_approval' && job.status === 'queued') return 'Planen venter på din beslutning.';
  const dependencies = job.dependsOn.map(index => run.jobs[index]).filter(Boolean);
  const failed = dependencies.filter(j => ['error', 'blocked', 'cancelled', 'interrupted', 'skipped'].includes(j.status));
  if (failed.length && ['queued', 'blocked'].includes(job.status)) return `Kan ikke starte: ${failed.map(j => j.title).join(', ')} er ikke leveret.`;
  const pending = dependencies.filter(j => j.status !== 'done');
  if (job.status === 'queued' && pending.length) return `Venter på ${pending.map(j => j.title).join(', ')}.`;
  if (job.status === 'queued') return run.status === 'running' ? 'Klar, når den igangværende opgave er afsluttet.' : 'Afventer genoptagelse af kørslen.';
  if (job.status === 'running') return job.actions?.at(-1)?.label ?? job.notes.at(-1) ?? 'Tjenesten arbejder. Ingen værktøjshændelse modtaget endnu.';
  return runLabels[job.status] ?? job.status;
}

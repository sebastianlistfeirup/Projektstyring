import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  Check,
  CircleHelp,
  Crown,
  Grip,
  Hourglass,
  Loader2,
  Play,
  Plus,
  Radar,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useLang, t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { streamOrchestrate } from '../lib/aiApi';
import { connectSwarm, useSwarm } from '../lib/swarm';
import type { AiAgent, AiJob, AiJobStatus, AiPhase } from '../lib/types';

/* ---------- metadata ---------- */

const PHASES: { key: AiPhase; gradient: string }[] = [
  { key: 'concept', gradient: 'from-sky-400 to-indigo-500' },
  { key: 'design', gradient: 'from-indigo-400 to-violet-500' },
  { key: 'prototype', gradient: 'from-violet-400 to-fuchsia-500' },
  { key: 'production', gradient: 'from-fuchsia-400 to-rose-500' },
  { key: 'testing', gradient: 'from-amber-400 to-orange-500' },
  { key: 'polish', gradient: 'from-emerald-400 to-teal-500' },
  { key: 'release', gradient: 'from-teal-400 to-sky-500' },
];

const STATUS_STYLE: Record<AiJobStatus, string> = {
  queued: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300',
  inprogress: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300',
  review: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
  blocked: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  done: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
};

/* ---------- live sværm-banner: viser aktive AI-kørsler med link til swarm ---------- */

function SwarmLiveBar() {
  const run = useSwarm((s) => s.run);
  const connected = useSwarm((s) => s.connected);
  useLang();
  if (!run || run.status !== 'running') return null;
  const running = run.jobs.filter((j) => j.status === 'running').length;
  const done = run.jobs.filter((j) => j.status === 'done').length;
  const names = run.jobs
    .filter((j) => j.status === 'running')
    .slice(0, 3)
    .map((j) => j.serviceId ?? '?')
    .join(', ');
  return (
    <Link
      to="/swarm"
      className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 transition hover:bg-emerald-400/15"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
      </span>
      <Radar className="h-4 w-4 shrink-0 text-emerald-400" />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-emerald-200 dark:text-emerald-300">
        {connected ? (
          <>
            <b>{running}</b> {t('swarm.agents').toLowerCase()} live{names ? ` (${names})` : ''} · {done}/{run.jobs.length}
          </>
        ) : (
          t('swarm.noCompanionShort')
        )}
      </span>
      <span className="shrink-0 text-[11px] font-semibold text-emerald-300">{t('swarm.title')} →</span>
    </Link>
  );
}

const kindLabel = (kind: AiAgent['kind']) => t(`ai.kind.${kind}`);

function AgentDot({ agent, size = 'md' }: { agent?: AiAgent | null; size?: 'sm' | 'md' }) {
  if (!agent) return null;
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-lg font-bold text-white',
        size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-6 w-6 text-[11px]',
        `bg-${agent.color}-500`,
      )}
      title={`${agent.name} · ${agent.provider}`}
    >
      {agent.name.charAt(0)}
    </span>
  );
}

/* ---------- job-kort i pipelinen ---------- */

function JobCard({ job, agents, jobs, onEdit }: { job: AiJob; agents: AiAgent[]; jobs: AiJob[]; onEdit: (job: AiJob) => void }) {
  const projects = useStore((s) => s.projects);
  const project = projects.find((p) => p.id === job.projectId);
  const agent = agents.find((a) => a.id === job.agentId);
  const deps = job.dependsOn
    .map((id) => jobs.find((j) => j.id === id))
    .filter((j): j is AiJob => Boolean(j));
  const waiting = deps.filter((d) => d.status !== 'done').length;
  const hasQuestion = !!job.question.trim() && !job.answer.trim();

  return (
    <button
      onClick={() => onEdit(job)}
      className={cn(
        'glass-panel card-hover w-full rounded-2xl p-3 text-left',
        job.status === 'done' && 'opacity-60',
        job.status === 'blocked' && 'ring-1 ring-rose-500/40',
      )}
    >
      <div className="flex items-start gap-2">
        <AgentDot agent={agent} />
        <div className="min-w-0 flex-1">
          <p className={cn('text-[13px] font-medium leading-snug', job.status === 'done' && 'line-through')}>
            {job.title}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            {agent ? <span>{agent.name}</span> : <span className="italic">{t('ai.noAgent')}</span>}
            <span aria-hidden>·</span>
            <span className="max-w-[6rem] truncate">{project?.name ?? t('tasks.noProject')}</span>
          </p>
        </div>
        {hasQuestion && (
          <span title={job.question} className="shrink-0 text-amber-500">
            <CircleHelp className="h-4 w-4" />
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', STATUS_STYLE[job.status])}>
          {t(`ai.status.${job.status}`)}
        </span>
        {job.status === 'inprogress' && <Loader2 className="h-3 w-3 animate-spin text-indigo-400" />}
        {deps.length > 0 && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]',
              waiting > 0
                ? 'border-amber-500/30 text-amber-600 dark:text-amber-400'
                : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
            )}
            title={deps.map((d) => d.title).join(' → ')}
          >
            {waiting > 0 ? <Hourglass className="h-3 w-3" /> : <Check className="h-3 w-3" />}
            {waiting > 0 ? t('ai.waitingOn').replace('{n}', String(waiting)) : t('ai.depsReady')}
          </span>
        )}
        {job.result.trim() && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            {t('ai.hasResult')}
          </span>
        )}
      </div>
    </button>
  );
}

/* ---------- opret/redigér job ---------- */

function JobModal({
  job,
  defaultPhase,
  onClose,
}: {
  job: AiJob | null;
  defaultPhase: AiPhase;
  onClose: () => void;
}) {
  const projects = useStore((s) => s.projects);
  const agents = useStore((s) => s.aiAgents);
  const addAiJob = useStore((s) => s.addAiJob);
  const updateAiJob = useStore((s) => s.updateAiJob);
  const deleteAiJob = useStore((s) => s.deleteAiJob);
  const aiJobs = useStore((s) => s.aiJobs);

  const activeProjects = projects.filter((p) => !p.archived);
  const [form, setForm] = useState({
    title: job?.title ?? '',
    projectId: job?.projectId ?? activeProjects[0]?.id ?? '',
    agentId: job?.agentId ?? '',
    phase: job?.phase ?? defaultPhase,
    status: job?.status ?? ('queued' as AiJobStatus),
    description: job?.description ?? '',
    question: job?.question ?? '',
    answer: job?.answer ?? '',
    result: job?.result ?? '',
    dependsOn: job?.dependsOn ?? [] as string[],
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const candidates = aiJobs.filter((j) => j.projectId === form.projectId && j.id !== job?.id);

  const submit = () => {
    if (!form.title.trim() || !form.projectId) return;
    if (job) {
      updateAiJob(job.id, { ...form, agentId: form.agentId || null });
    } else {
      addAiJob({ ...form, agentId: form.agentId || null });
    }
    onClose();
  };

  const remove = () => {
    if (job && window.confirm(t('ai.confirmDelete'))) {
      deleteAiJob(job.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-4" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm" onClick={onClose} />
      <div className="glass-panel animate-fade-in relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-zinc-900 dark:text-white">
            {job ? t('ai.editJob') : t('ai.newJob')}
          </h3>
          <button onClick={onClose} className="btn-ghost rounded-lg p-1.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <input
            autoFocus
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={t('ai.jobTitlePlaceholder')}
            className="input"
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {t('ai.project')}
              </span>
              <select value={form.projectId} onChange={(e) => { set('projectId', e.target.value); set('dependsOn', []); }} className="input">
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {t('ai.agent')}
              </span>
              <select value={form.agentId} onChange={(e) => set('agentId', e.target.value)} className="input">
                <option value="">{t('ai.chooseAgent')}</option>
                {agents.filter((a) => a.active).map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({kindLabel(a.kind)})</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {t('ai.phase')}
              </span>
              <select value={form.phase} onChange={(e) => set('phase', e.target.value as AiPhase)} className="input">
                {PHASES.map((p) => (
                  <option key={p.key} value={p.key}>{t(`ai.phase.${p.key}`)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {t('ai.status')}
              </span>
              <select value={form.status} onChange={(e) => set('status', e.target.value as AiJobStatus)} className="input">
                {(['queued', 'inprogress', 'review', 'blocked', 'done'] as const).map((s) => (
                  <option key={s} value={s}>{t(`ai.status.${s}`)}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {t('ai.description')}
            </span>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              placeholder={t('ai.descriptionPlaceholder')}
              className="input resize-none"
            />
          </label>

          {candidates.length > 0 && (
            <div>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {t('ai.dependsOn')}
              </span>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-xl border border-zinc-200 p-2 dark:border-white/10">
                {candidates.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-white/[0.04]">
                    <input
                      type="checkbox"
                      checked={form.dependsOn.includes(c.id)}
                      onChange={(e) =>
                        set('dependsOn', e.target.checked ? [...form.dependsOn, c.id] : form.dependsOn.filter((id) => id !== c.id))
                      }
                      className="accent-indigo-500"
                    />
                    <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">{c.title}</span>
                    <span className={cn('rounded-full px-1.5 py-px text-[10px]', STATUS_STYLE[c.status])}>{t(`ai.status.${c.status}`)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                <CircleHelp className="h-3 w-3" /> {t('ai.question')}
              </span>
              <textarea
                value={form.question}
                onChange={(e) => set('question', e.target.value)}
                rows={2}
                placeholder={t('ai.questionPlaceholder')}
                className="input resize-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                {t('ai.answer')}
              </span>
              <textarea
                value={form.answer}
                onChange={(e) => set('answer', e.target.value)}
                rows={2}
                placeholder={t('ai.answerPlaceholder')}
                className="input resize-none"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {t('ai.result')}
            </span>
            <textarea
              value={form.result}
              onChange={(e) => set('result', e.target.value)}
              rows={2}
              placeholder={t('ai.resultPlaceholder')}
              className="input resize-none"
            />
          </label>
        </div>

        <div className="mt-5 flex items-center gap-2">
          {job && (
            <button onClick={remove} className="btn-ghost rounded-xl text-rose-600 hover:text-rose-500">
              <Trash2 className="h-4 w-4" />
              {t('ai.delete')}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} className="btn-outline rounded-xl">{t('ai.cancel')}</button>
            <button onClick={submit} className="btn-primary rounded-xl">
              <Check className="h-4 w-4" />
              {job ? t('ai.save') : t('ai.create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- hovedview ---------- */

export default function AiWorkshopView() {
  useLang();
  const projects = useStore((s) => s.projects);
  const agents = useStore((s) => s.aiAgents);
  const jobs = useStore((s) => s.aiJobs);
  const orchestratorId = useStore((s) => s.orchestratorId);
  const setOrchestrator = useStore((s) => s.setOrchestrator);
  const toggleAiAgent = useStore((s) => s.toggleAiAgent);
  const updateAiJob = useStore((s) => s.updateAiJob);
  const bibles = useStore((s) => s.bibles);

  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [modal, setModal] = useState<{ job: AiJob | null; phase: AiPhase } | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);

  const filteredJobs = useMemo(
    () => jobs.filter((j) => projectFilter === 'all' || j.projectId === projectFilter),
    [jobs, projectFilter],
  );

  const orchestrator = agents.find((a) => a.id === orchestratorId);
  const openQuestions = filteredJobs.filter((j) => j.question.trim() && !j.answer.trim() && j.status !== 'done');
  const running = filteredJobs.filter((j) => j.status === 'inprogress');
  const blocked = filteredJobs.filter((j) => j.status === 'blocked');
  const doneCount = filteredJobs.filter((j) => j.status === 'done').length;
  const pct = filteredJobs.length ? Math.round((doneCount / filteredJobs.length) * 100) : 0;

  // Kør alle kø-jobs i pipelinen via AI-motoren (companion).
  const runPipeline = async () => {
    const queued = filteredJobs.filter((j) => j.status === 'queued' && j.agentId);
    if (!queued.length || pipelineRunning) return;
    setPipelineRunning(true);
    connectSwarm(); // så swarm-visningen kan følge med live, mens pipelinen kører
    const serviceOf = (agentId: string | null) => agentId?.replace(/^ai-/, '') ?? null;
    const idx = new Map(queued.map((j, i) => [j.id, i]));
    const predefinedJobs = queued.map((j, i) => ({
      id: `job-${i}`,
      title: j.title,
      serviceId: serviceOf(j.agentId),
      phase: j.phase,
      dependsOn: j.dependsOn.map((d) => idx.get(d)).filter((n): n is number => n !== undefined),
      description: j.description || j.title,
    }));
    const goal = `Pipeline: ${queued.map((j) => j.title).join('; ')}`;
    const bible = projectFilter !== 'all' ? bibles[projectFilter] ?? '' : '';
    queued.forEach((j) => updateAiJob(j.id, { status: 'inprogress' }));
    await streamOrchestrate(
      { goal, bible: bible || undefined, jobs: predefinedJobs },
      {
        onEvent: (evt) => {
          if (evt.type === 'job_done') {
            const r = evt.result as { jobId: string; text: string };
            const local = queued[Number(String(r.jobId).replace('job-', ''))];
            if (local) updateAiJob(local.id, { status: 'review', result: r.text.slice(0, 4000) });
          } else if (evt.type === 'job_error') {
            const local = queued[Number(String((evt as { jobId?: string }).jobId ?? '').replace('job-', ''))];
            if (local) updateAiJob(local.id, { status: 'blocked', question: String(evt.error ?? '') });
          }
        },
        onError: () => queued.forEach((j) => updateAiJob(j.id, { status: 'blocked' })),
      },
      new AbortController().signal,
    );
    setPipelineRunning(false);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] p-4 lg:p-6">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
              {t('ai.title')}
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('ai.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="input w-auto rounded-xl text-xs"
            >
              <option value="all">{t('ai.allProjects')}</option>
              {projects.filter((p) => !p.archived).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={runPipeline}
              disabled={pipelineRunning || !filteredJobs.some((j) => j.status === 'queued' && j.agentId)}
              className="btn-primary rounded-xl disabled:opacity-40"
              title={t('ai.runPipelineHint')}
            >
              {pipelineRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {t('ai.runPipeline')}
            </button>
            <button onClick={() => setModal({ job: null, phase: 'concept' })} className="btn-primary rounded-xl">
              <Plus className="h-4 w-4" />
              {t('ai.newJob')}
            </button>
          </div>
        </div>

        {/* Live sværm-banner */}
        <SwarmLiveBar />

        {/* Agent-roster */}
        <div className="mb-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {agents.map((agent) => {
            const workload = jobs.filter((j) => j.agentId === agent.id && j.status !== 'done').length;
            const isOrchestrator = agent.id === orchestratorId;
            return (
              <div
                key={agent.id}
                className={cn(
                  'glass-panel card-hover relative rounded-2xl p-3 transition-opacity',
                  !agent.active && 'opacity-45',
                )}
              >
                <div className="flex items-start gap-2.5">
                  <AgentDot agent={agent} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-zinc-900 dark:text-white">{agent.name}</p>
                    <p className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">{agent.provider}</p>
                  </div>
                  {agent.canOrchestrate && (
                    <button
                      onClick={() => setOrchestrator(isOrchestrator ? null : agent.id)}
                      title={isOrchestrator ? t('ai.orchestratorIs').replace('{name}', agent.name) : t('ai.makeOrchestrator')}
                      className={cn(
                        'shrink-0 rounded-lg p-1 transition-colors',
                        isOrchestrator ? 'bg-amber-500/15 text-amber-500' : 'text-zinc-400 hover:text-amber-500',
                      )}
                    >
                      <Crown className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="rounded-full bg-zinc-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {kindLabel(agent.kind)}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-px text-[9px] font-semibold tabular-nums',
                      workload > 0 ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' : 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
                    )}
                  >
                    {workload > 0 ? t('ai.workload').replace('{n}', String(workload)) : t('ai.idle')}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {agent.strengths.slice(0, 3).map((s) => (
                    <span key={s} className="rounded-md bg-zinc-500/[0.07] px-1.5 py-px text-[9px] text-zinc-500 dark:text-zinc-400">
                      {s}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => toggleAiAgent(agent.id)}
                  className={cn(
                    'absolute bottom-2 right-2 h-2 w-2 rounded-full transition-colors',
                    agent.active ? `bg-${agent.color}-500` : 'bg-zinc-400/40',
                  )}
                  title={agent.active ? t('ai.deactivate') : t('ai.activate')}
                />
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-5 xl:flex-row">
          {/* Pipeline */}
          <div className="glass-panel flex-1 overflow-x-auto rounded-3xl">
            <div className="flex min-h-[420px] min-w-max gap-3 p-4">
              {PHASES.map((phase) => {
                const phaseJobs = filteredJobs.filter((j) => j.phase === phase.key);
                const phaseDone = phaseJobs.filter((j) => j.status === 'done').length;
                return (
                  <section key={phase.key} className="flex w-60 flex-col">
                    <header className="mb-2 flex items-center gap-2">
                      <span className={cn('h-6 w-1 rounded-full bg-gradient-to-b', phase.gradient)} />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                        {t(`ai.phase.${phase.key}`)}
                      </h3>
                      <span className="rounded bg-zinc-500/10 px-1.5 py-px text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                        {phaseDone}/{phaseJobs.length}
                      </span>
                      <button
                        onClick={() => setModal({ job: null, phase: phase.key })}
                        className="ml-auto grid h-5 w-5 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-500/10 hover:text-zinc-700 dark:hover:text-zinc-200"
                        title={t('ai.addToPhase')}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </header>
                    <div className="flex-1 space-y-2 rounded-2xl bg-zinc-500/[0.04] p-2 dark:bg-white/[0.02]">
                      {phaseJobs.length === 0 ? (
                        <p className="px-2 pt-6 text-center text-[11px] italic text-zinc-500/70 dark:text-zinc-500">
                          {t('ai.emptyPhase')}
                        </p>
                      ) : (
                        phaseJobs.map((job) => (
                          <JobCard key={job.id} job={job} agents={agents} jobs={filteredJobs} onEdit={(j) => setModal({ job: j, phase: j.phase })} />
                        ))
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>

          {/* Højre panel */}
          <aside className="flex w-full shrink-0 flex-col gap-4 xl:w-72">
            {/* Fremskridt */}
            <div className="glass-panel rounded-3xl p-4">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                <Grip className="h-3.5 w-3.5" />
                {t('ai.progress')}
              </h3>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-500/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-emerald-400 transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-white">{pct}%</span>
              </div>
              <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                {doneCount} {t('ai.of')} {filteredJobs.length} {t('ai.jobsDone')}
              </p>
            </div>

            {/* Orkestrator */}
            <div className="glass-panel rounded-3xl p-4">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                <Crown className="h-3.5 w-3.5" />
                {t('ai.orchestrator')}
              </h3>
              {orchestrator ? (
                <div className="flex items-center gap-2.5">
                  <AgentDot agent={orchestrator} />
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white">{orchestrator.name}</p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('ai.orchestrating')}</p>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('ai.noOrchestrator')}</p>
              )}
              <p className="mt-2 rounded-xl bg-amber-500/[0.07] p-2.5 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                {t('ai.orchestratorHint')}
              </p>
            </div>

            {/* Mangler afklaring */}
            <div className="glass-panel rounded-3xl p-4">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                <CircleHelp className="h-3.5 w-3.5" />
                {t('ai.needsClarification')}
                {openQuestions.length > 0 && (
                  <span className="rounded-full bg-rose-500/10 px-1.5 text-[10px] tabular-nums">{openQuestions.length}</span>
                )}
              </h3>
              {openQuestions.length === 0 ? (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('ai.noQuestions')}</p>
              ) : (
                <div className="space-y-1.5">
                  {openQuestions.map((j) => (
                    <button
                      key={j.id}
                      onClick={() => setModal({ job: j, phase: j.phase })}
                      className="w-full rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-2.5 text-left transition-colors hover:bg-amber-500/10"
                    >
                      <p className="text-[12px] font-medium text-zinc-800 dark:text-zinc-100">{j.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500 dark:text-zinc-400">{j.question}</p>
                    </button>
                  ))}
                </div>
              )}
              {blocked.length > 0 && (
                <p className="mt-2 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  {t('ai.blockedCount').replace('{n}', String(blocked.length))}
                </p>
              )}
            </div>

            {/* I gang lige nu */}
            {running.length > 0 && (
              <div className="glass-panel rounded-3xl p-4">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
                  <Play className="h-3.5 w-3.5" />
                  {t('ai.runningNow')}
                </h3>
                <div className="space-y-1.5">
                  {running.map((j) => {
                    const agent = agents.find((a) => a.id === j.agentId);
                    return (
                      <button
                        key={j.id}
                        onClick={() => setModal({ job: j, phase: j.phase })}
                        className="flex w-full items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.05] p-2 text-left transition-colors hover:bg-indigo-500/10"
                      >
                        <AgentDot agent={agent} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-800 dark:text-zinc-100">{j.title}</span>
                        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-indigo-400" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Råd */}
            <div className="rounded-3xl border border-dashed border-zinc-300 p-4 text-[11px] leading-relaxed text-zinc-500 dark:border-white/10 dark:text-zinc-400">
              <Bot className="mb-1.5 h-4 w-4 text-zinc-400" />
              {t('ai.tip')}
            </div>
          </aside>
        </div>
      </div>

      {modal && <JobModal job={modal.job} defaultPhase={modal.phase} onClose={() => setModal(null)} />}
    </div>
  );
}

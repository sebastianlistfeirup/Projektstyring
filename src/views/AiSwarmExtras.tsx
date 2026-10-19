import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Gavel,
  LineChart,
  Link2,
  Loader2,
  RotateCcw,
  Scale,
  Search,
  Sparkles,
  Unlink,
  X,
} from 'lucide-react';
import { useLang, t } from '../lib/i18n';
import { cn } from '../lib/utils';
import {
  fetchAnalysis,
  fetchRunHistory,
  resumeRun,
  runExportUrl,
  type AiAnalysis,
  type RunHistoryItem,
} from '../lib/aiApi';
import { serviceName, type SwarmJob, type SwarmRun } from '../lib/swarm';
import type { AiServiceInfo } from '../lib/aiApi';
import { useStore } from '../store/useStore';

function fmtDur(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}t ${m % 60}m`;
}

/* ================= dommer-panel: kandidater side om side (race/debate/vote) ================= */

export function JudgePanel({ run, services }: { run: SwarmRun; services: Record<string, AiServiceInfo> | null }) {
  const mode = run.mode ?? 'standard';
  if (!['race', 'debate', 'vote'].includes(mode)) return null;
  const jobs = run.jobs;
  if (jobs.length < 3) return null;
  const judge = jobs[jobs.length - 1];
  const candidates = jobs.slice(0, -1);
  const best = candidates.reduce<(typeof candidates)[number] | null>((acc, j) => (j.score !== null && j.score !== undefined && (acc === null || (acc.score ?? -1) < j.score) ? j : acc), null);

  return (
    <div className="rounded-2xl border border-amber-400/25 bg-amber-500/[0.05] p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-amber-300 flex items-center gap-1.5 mb-2">
        <Gavel size={12} /> {t('swarm.judgePanel')}
      </h3>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(candidates.length, 3)}, minmax(0,1fr))` }}>
        {candidates.map((j) => (
          <div
            key={j.id}
            className={cn(
              'rounded-xl border p-2.5 transition-all',
              best && j.id === best.id && j.status === 'done'
                ? 'border-emerald-400/50 bg-emerald-400/[0.07] shadow-[0_0_24px_-8px_rgba(52,211,153,.6)]'
                : 'border-white/10 bg-black/10 dark:bg-white/[0.03]',
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold flex-1 truncate">{serviceName(services, j.serviceId)}</span>
              {j.score !== null && j.score !== undefined ? (
                <span
                  className={cn(
                    'text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums',
                    j.score >= 8 ? 'bg-emerald-400/15 text-emerald-300' : j.score >= 6 ? 'bg-amber-400/15 text-amber-300' : 'bg-rose-400/15 text-rose-300',
                  )}
                >
                  {j.score}/10
                </span>
              ) : j.status === 'running' ? (
                <Loader2 size={11} className="animate-spin text-emerald-400" />
              ) : null}
            </div>
            <p className="text-[10px] opacity-70 mt-1 line-clamp-3 leading-snug">{j.status === 'done' ? j.text : j.status === 'error' ? `⚠ ${j.error ?? ''}` : t('ai.status.queued')}</p>
            {best && j.id === best.id && j.status === 'done' && (
              <p className="text-[9px] text-emerald-300 mt-1.5 flex items-center gap-1"><CheckCircle2 size={9} /> {t('swarm.judgeWinner')}</p>
            )}
          </div>
        ))}
      </div>
      {judge.status === 'done' && (
        <div className="mt-2 rounded-xl border border-white/10 bg-black/15 dark:bg-black/25 p-2.5">
          <p className="text-[9.5px] uppercase tracking-wider opacity-45 mb-1">{t('swarm.judgeVerdict')}</p>
          <p className="text-[11px] leading-relaxed opacity-80 line-clamp-6">{judge.text}</p>
        </div>
      )}
    </div>
  );
}

/* ================= fejl- og mønsteranalyse ================= */

export function AnalysisPanel() {
  useLang();
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  useEffect(() => { if (open && !analysis) void fetchAnalysis().then(setAnalysis); }, [open, analysis]);
  return (
    <div className="rounded-2xl border border-white/10 glass-panel p-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-left">
        <LineChart size={13} className="opacity-60" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider opacity-60 flex-1">{t('swarm.analysis')}</h3>
        {analysis && <span className={cn('text-[10px]', analysis.errors > 0 ? 'text-rose-400' : 'text-emerald-400')}>{analysis.errors} ⚠</span>}
      </button>
      {open && (
        <div className="mt-2.5 space-y-2">
          {!analysis ? (
            <p className="text-[10.5px] opacity-45">{t('swarm.analysisEmpty')}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10.5px]">
                <span className="opacity-60">{t('swarm.costRuns')}: <b>{analysis.runs}</b></span>
                <span className="opacity-60">{t('swarm.analysisAvg')}: <b>{fmtDur(analysis.avgJobMs)}</b></span>
                <span className={analysis.errors > 0 ? 'text-rose-400' : 'text-emerald-400'}>{t('swarm.analysisErrors')}: <b>{analysis.errors}</b></span>
              </div>
              {analysis.services.slice(0, 6).map((s) => (
                <div key={String(s.id)} className="flex items-center gap-2 text-[10.5px]">
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="opacity-50 tabular-nums">{s.jobs} {t('swarm.costJobsShort')}</span>
                  <span className="opacity-50 tabular-nums">{fmtDur(s.avgMs)}</span>
                  {s.errorRate > 0 && (
                    <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full border', s.errorRate >= 25 ? 'border-rose-400/40 text-rose-300' : 'border-amber-400/40 text-amber-300')}>
                      {s.errorRate}%
                    </span>
                  )}
                </div>
              ))}
              {analysis.insights.length > 0 && (
                <div className="space-y-1 pt-1">
                  {analysis.insights.map((ins, i) => (
                    <p key={i} className="text-[10px] leading-snug text-sky-300/90 flex gap-1.5">
                      <Sparkles size={10} className="mt-0.5 shrink-0" /> {ins}
                    </p>
                  ))}
                </div>
              )}
              {analysis.errorTitles.length > 0 && (
                <div className="pt-1">
                  <p className="text-[9.5px] uppercase tracking-wider opacity-45 mb-1">{t('swarm.analysisFailing')}</p>
                  {analysis.errorTitles.map((e) => (
                    <div key={e.title} className="flex items-center gap-1.5 text-[10px]">
                      <AlertTriangle size={9} className="text-rose-400 shrink-0" />
                      <span className="truncate opacity-70">{e.title}</span>
                      <span className="text-rose-400 tabular-nums">×{e.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ================= sammenligning af to kørsler ================= */

function runStats(r: RunHistoryItem | null) {
  if (!r) return null;
  const jobs = (r.jobs ?? []) as { status?: string; startedAt?: number | null; finishedAt?: number | null }[];
  const done = (r.results ?? []).length;
  const errors = jobs.filter((j) => j.status === 'error').length;
  const started = jobs.map((j) => j.startedAt).filter((x): x is number => typeof x === 'number');
  const finished = jobs.map((j) => j.finishedAt).filter((x): x is number => typeof x === 'number');
  const dur = started.length && finished.length ? Math.max(...finished) - Math.min(...started) : null;
  const judged = (r.results ?? []).filter((x) => x.score !== null && x.score !== undefined);
  const avgScore = judged.length ? judged.reduce((a, x) => a + (x.score ?? 0), 0) / judged.length : null;
  return { jobs: jobs.length, done, errors, dur, avgScore };
}

export function CompareRunsPanel() {
  useLang();
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunHistoryItem[]>([]);
  const [a, setA] = useState<string>('');
  const [b, setB] = useState<string>('');
  useEffect(() => { if (open) void fetchRunHistory(12).then(setRuns); }, [open]);
  const ra = runs.find((r) => r.runId === a) ?? null;
  const rb = runs.find((r) => r.runId === b) ?? null;
  const sa = runStats(ra);
  const sb = runStats(rb);
  const rows: { label: string; va: string; vb: string }[] = sa && sb ? [
    { label: t('swarm.compareJobs'), va: String(sa.jobs), vb: String(sb.jobs) },
    { label: t('swarm.compareDelivered'), va: String(sa.done), vb: String(sb.done) },
    { label: t('swarm.compareErrors'), va: String(sa.errors), vb: String(sb.errors) },
    { label: t('swarm.compareDuration'), va: fmtDur(sa.dur), vb: fmtDur(sb.dur) },
    { label: t('swarm.compareScore'), va: sa.avgScore !== null ? `${sa.avgScore.toFixed(1)}/10` : '—', vb: sb.avgScore !== null ? `${sb.avgScore.toFixed(1)}/10` : '—' },
  ] : [];

  return (
    <div className="rounded-2xl border border-white/10 glass-panel p-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-left">
        <Scale size={13} className="opacity-60" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider opacity-60 flex-1">{t('swarm.compareRuns')}</h3>
      </button>
      {open && (
        <div className="mt-2.5 space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            {([['a', a, setA], ['b', b, setB]] as const).map(([key, val, set]) => (
              <select key={key} value={val} onChange={(e) => set(e.target.value)} className="rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-[10.5px] outline-none">
                <option value="">{key === 'a' ? t('swarm.comparePickA') : t('swarm.comparePickB')}</option>
                {runs.map((r) => <option key={r.runId} value={r.runId}>{r.goal.slice(0, 40) || r.runId}</option>)}
              </select>
            ))}
          </div>
          {rows.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-black/10 dark:bg-white/[0.03] overflow-hidden">
              <div className="grid grid-cols-[1.2fr_1fr_1fr] text-[9.5px] uppercase tracking-wider opacity-45 px-2.5 py-1.5 border-b border-white/10">
                <span />
                <span className="truncate">{(ra?.goal ?? '').slice(0, 22)}</span>
                <span className="truncate">{(rb?.goal ?? '').slice(0, 22)}</span>
              </div>
              {rows.map((row) => (
                <div key={row.label} className="grid grid-cols-[1.2fr_1fr_1fr] text-[10.5px] px-2.5 py-1">
                  <span className="opacity-60">{row.label}</span>
                  <span className="tabular-nums">{row.va}</span>
                  <span className="tabular-nums">{row.vb}</span>
                </div>
              ))}
            </div>
          )}
          {runs.length < 2 && <p className="text-[10px] opacity-45">{t('swarm.compareNeedTwo')}</p>}
        </div>
      )}
    </div>
  );
}

/* ================= minimap: overblik + hop til jobkort ================= */

export function MiniMap({ jobs }: { jobs: SwarmJob[] }) {
  const [flash, setFlash] = useState<string | null>(null);
  if (!jobs.length) return null;
  const jump = (id: string) => {
    const el = document.getElementById(`jobcard-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(id);
    setTimeout(() => setFlash(null), 1600);
  };
  return (
    <div className="absolute right-3 top-3 z-10 rounded-xl border border-white/10 bg-black/30 dark:bg-black/45 backdrop-blur px-2 py-1.5">
      <div className="grid grid-cols-6 gap-1">
        {jobs.map((j) => (
          <button
            key={j.id}
            onClick={() => jump(j.id)}
            title={j.title}
            className={cn(
              'h-2.5 w-2.5 rounded-[3px] transition-all',
              j.status === 'running' && 'bg-emerald-400 animate-pulse',
              j.status === 'done' && 'bg-emerald-700/80',
              j.status === 'queued' && 'bg-white/20',
              j.status === 'error' && 'bg-rose-500',
              flash === j.id && 'ring-2 ring-amber-300 scale-125',
            )}
          />
        ))}
      </div>
    </div>
  );
}

/* ================= kørselshandlinger: genoptag, eksport, link til opgave ================= */

export function RunActionsBar({ run, onToast }: { run: SwarmRun; onToast?: (msg: string) => void }) {
  useLang();
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const aiTaskLinks = useStore((s) => s.aiTaskLinks);
  const linkTaskToRun = useStore((s) => s.linkTaskToRun);
  const unlinkTaskFromRun = useStore((s) => s.unlinkTaskFromRun);
  const [linkOpen, setLinkOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [resuming, setResuming] = useState(false);
  const linked = Object.entries(aiTaskLinks).find(([, v]) => v.runId === run.runId);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return tasks
      .filter((task) => `${task.title} ${projects.find((p) => p.id === task.projectId)?.key ?? ''}-${task.number}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, tasks, projects]);

  const unfinished = run.jobs.filter((j) => j.status !== 'done').length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {unfinished > 0 && (
        <button
          onClick={async () => {
            setResuming(true);
            const r = await resumeRun(run.runId);
            setResuming(false);
            onToast?.(r.ok ? t('swarm.resumed') : (r.reason ?? t('swarm.resumeFailed')));
          }}
          disabled={resuming}
          className="rounded-lg border border-sky-400/40 text-sky-300 px-2 py-1 text-[10px] hover:bg-sky-400/10 transition disabled:opacity-40 flex items-center gap-1"
        >
          {resuming ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
          {t('swarm.resumeRun')} ({unfinished})
        </button>
      )}
      <a
        href={runExportUrl(run.runId)}
        download
        className="rounded-lg border border-white/15 px-2 py-1 text-[10px] hover:bg-white/5 transition flex items-center gap-1"
      >
        <Download size={10} /> {t('swarm.exportRun')}
      </a>
      {linked ? (
        <button
          onClick={() => unlinkTaskFromRun(linked[0])}
          title={`${t('swarm.unlinkTask')}: ${tasks.find((x) => x.id === linked[0])?.title ?? linked[0]}`}
          className="rounded-lg border border-emerald-400/40 text-emerald-300 px-2 py-1 text-[10px] hover:bg-emerald-400/10 transition flex items-center gap-1"
        >
          <Unlink size={10} /> {t('swarm.linkedToTask')}
        </button>
      ) : (
        <button
          onClick={() => setLinkOpen((o) => !o)}
          className="rounded-lg border border-white/15 px-2 py-1 text-[10px] hover:bg-white/5 transition flex items-center gap-1"
        >
          <Link2 size={10} /> {t('swarm.linkToTask')}
        </button>
      )}
      <button
        onClick={async () => { try { await navigator.clipboard.writeText(run.goal); onToast?.(t('chat.copied')); } catch { /* */ } }}
        className="rounded-lg border border-white/15 px-2 py-1 text-[10px] hover:bg-white/5 transition flex items-center gap-1"
      >
        <Copy size={10} /> {t('chat.copy')}
      </button>
      {linkOpen && (
        <div className="relative w-full sm:w-64">
          <div className="flex items-center gap-1.5 rounded-lg bg-black/30 border border-white/10 px-2 py-1">
            <Search size={10} className="opacity-40 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('swarm.linkToTaskHint')}
              className="flex-1 min-w-0 bg-transparent outline-none text-[10.5px]"
            />
            <button onClick={() => { setLinkOpen(false); setQuery(''); }} className="opacity-40 hover:opacity-100"><X size={10} /></button>
          </div>
          {matches.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-xl border border-white/10 bg-zinc-900 dark:bg-zinc-900 shadow-2xl overflow-hidden">
              {matches.map((task) => (
                <button
                  key={task.id}
                  onClick={() => {
                    linkTaskToRun(task.id, run.runId, run.goal);
                    setLinkOpen(false);
                    setQuery('');
                    onToast?.(t('swarm.taskLinked'));
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[10.5px] hover:bg-white/10 transition"
                >
                  <Check size={10} className="opacity-40 shrink-0" />
                  <span className="truncate">{task.title}</span>
                  <span className="opacity-40 shrink-0">{projects.find((p) => p.id === task.projectId)?.key ?? ''}-{task.number}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================= hjælper: hent-leverance til opgavebeskrivelse (kopier tekst) ================= */

export function CopyDeliverableButton({ text }: { text: string }) {
  useLang();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
      }}
      className="rounded-lg border border-white/15 px-2 py-1 text-[10px] hover:bg-white/5 transition flex items-center gap-1"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />} {copied ? t('chat.copied') : t('swarm.copyDeliverable')}
    </button>
  );
}

/* ================= årshjul: AI-planlægningsknap leveres via YearWheelView ================= */


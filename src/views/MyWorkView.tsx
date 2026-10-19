import { useEffect, useMemo, useState } from 'react';
import { format, differenceInDays, parseISO, startOfWeek, subWeeks } from 'date-fns';
import { da } from 'date-fns/locale';
import {
  Brain,
  CalendarDays,
  CalendarClock,
  Calculator,
  Check,
  CircleAlert,
  ClipboardPen,
  ListTodo,
  Loader2,
  Sparkles,
  Unlink,
  Wand2,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useStore } from '../store/useStore';
import { useLang, t } from '../lib/i18n';
import { cn, formatDateShort, isOverdue, taskRef, timeAgo } from '../lib/utils';
import { EmptyState, PriorityBadge, ProgressBar, StatusBadge, ViewHeader } from '../components/common';
import { taskProgress } from '../components/table/taskProgress';
import {
  estimateTask,
  parseTasksFromText,
  prioritizeTasks,
  splitTask,
} from '../lib/aiApi';
import type { Priority, Task } from '../lib/types';

const COMPANION = 'http://127.0.0.1:4310';

function dueInfo(task: Task): { overdue: boolean; label: string } | null {
  if (!task.dueDate) return null;
  const overdue = isOverdue(task);
  const days = differenceInDays(parseISO(task.dueDate), new Date());
  const label = overdue
    ? t('mywork.overdue')
    : days <= 0
      ? t('mywork.dueToday')
      : days === 1
        ? t('mywork.dueTomorrow')
        : t('mywork.dueInDays').replace('{n}', String(days));
  return { overdue, label };
}

/* ---------- AI-status for opgaver der er kædet til en kørsel ---------- */

function useAiStatuses() {
  const links = useStore((s) => s.aiTaskLinks);
  const [statuses, setStatuses] = useState<Record<string, 'running' | 'done' | 'error' | 'unknown'>>({});
  useEffect(() => {
    const entries = Object.entries(links);
    if (!entries.length) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [sw, hist] = await Promise.all([
          fetch(`${COMPANION}/api/ai/swarm`).then((r) => r.json()).catch(() => null),
          fetch(`${COMPANION}/api/ai/runs`).then((r) => r.json()).catch(() => null),
        ]);
        if (cancelled) return;
        const map: Record<string, 'running' | 'done' | 'error' | 'unknown'> = {};
        for (const [taskId, link] of entries) {
          if (sw?.ok && sw?.run?.runId === link.runId) {
            map[taskId] = sw.run.status === 'running' ? 'running' : sw.run.status === 'error' ? 'error' : 'done';
          } else {
            const h = (hist?.runs ?? []).find((r: { runId: string }) => r.runId === link.runId);
            map[taskId] = h ? 'done' : 'unknown';
          }
        }
        setStatuses(map);
      } catch { /* companion offline */ }
    };
    void load();
    const id = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [links]);
  return { links, statuses };
}

/* ---------- opgave-række med AI-handlinger ---------- */

function TaskRow({ task, aiStatus }: { task: Task; aiStatus?: 'running' | 'done' | 'error' | 'unknown' }) {
  const projects = useStore((s) => s.projects);
  const tasks = useStore((s) => s.tasks);
  const selectTask = useStore((s) => s.selectTask);
  const addSubtask = useStore((s) => s.addSubtask);
  const updateTask = useStore((s) => s.updateTask);
  const unlink = useStore((s) => s.unlinkTaskFromRun);
  const project = projects.find((p) => p.id === task.projectId);
  const info = dueInfo(task);
  const progress = taskProgress(task);
  const [aiBusy, setAiBusy] = useState<'split' | 'estimate' | null>(null);

  // Afventer-andre: opgaver der blokeres af åbne forudsætninger.
  const blockers = (task.blockedBy ?? [])
    .map((id) => tasks.find((x) => x.id === id))
    .filter((x): x is Task => Boolean(x && x.status !== 'done' && x.status !== 'canceled'));

  const runSplit = async () => {
    if (aiBusy) return;
    setAiBusy('split');
    const r = await splitTask(task.title, task.description ?? '');
    setAiBusy(null);
    if (r.ok && r.subtasks?.length) {
      for (const st of r.subtasks.slice(0, 8)) addSubtask(task.id, st.estimate ? `${st.title} (${st.estimate}p)` : st.title);
    }
  };

  const runEstimate = async () => {
    if (aiBusy) return;
    setAiBusy('estimate');
    const similar = tasks
      .filter((x) => x.id !== task.id && x.estimate !== null && x.status === 'done')
      .slice(0, 8)
      .map((x) => ({ title: x.title, estimate: x.estimate! }));
    const r = await estimateTask({ title: task.title, description: task.description ?? '', similar });
    setAiBusy(null);
    if (r.ok && r.estimate) updateTask(task.id, { estimate: r.estimate }, 'sat AI-estimat');
  };

  return (
    <div className="glass-panel card-hover flex items-center gap-3 rounded-xl px-4 py-3">
      <span className="shrink-0 text-xs font-bold tabular-nums text-zinc-500 dark:text-zinc-400">
        {taskRef(task, projects)}
      </span>
      <button
        onClick={() => selectTask(task.id)}
        title={task.title}
        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-zinc-800 transition-colors hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-300"
      >
        {task.title}
      </button>

      {/* AI-handlinger: del op / estimér */}
      <span className="hidden shrink-0 items-center gap-0.5 md:inline-flex">
        <button
          onClick={() => void runSplit()}
          disabled={aiBusy !== null}
          title={t('mywork.aiSplit')}
          className="rounded-lg p-1.5 text-violet-500 opacity-30 transition hover:bg-violet-500/10 hover:opacity-100 disabled:opacity-50 dark:text-violet-400"
        >
          {aiBusy === 'split' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
        </button>
        <button
          onClick={() => void runEstimate()}
          disabled={aiBusy !== null}
          title={t('mywork.aiEstimate')}
          className="rounded-lg p-1.5 text-sky-500 opacity-30 transition hover:bg-sky-500/10 hover:opacity-100 disabled:opacity-50 dark:text-sky-400"
        >
          {aiBusy === 'estimate' ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />}
        </button>
      </span>

      {aiStatus && (
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px]',
            aiStatus === 'running' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
            aiStatus === 'done' && 'border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
            aiStatus === 'error' && 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
            aiStatus === 'unknown' && 'border-zinc-300 text-zinc-500 dark:border-white/10 dark:text-zinc-400',
          )}
          title={t('mywork.aiLinked')}
        >
          <Brain size={10} />
          {aiStatus === 'running' ? t('mywork.aiRunning') : aiStatus === 'done' ? t('mywork.aiDone') : aiStatus === 'error' ? t('mywork.aiError') : 'AI'}
          <button onClick={() => unlink(task.id)} className="opacity-40 hover:opacity-100" title={t('mywork.aiUnlink')}>
            <Unlink size={9} />
          </button>
        </span>
      )}

      {blockers.length > 0 && (
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400"
          title={blockers.map((b) => b.title).join(' · ')}
        >
          <CircleAlert size={10} />
          {t('mywork.awaiting').replace('{n}', String(blockers.length))}
        </span>
      )}

      {project && (
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-white/10 dark:text-zinc-300 md:inline-flex">
          <span className={cn('h-1.5 w-1.5 rounded-full', `bg-${project.color}-500`)} />
          <span className="max-w-[8rem] truncate">{project.name}</span>
        </span>
      )}
      <span className="hidden shrink-0 sm:block">
        <StatusBadge status={task.status} />
      </span>
      <span className="hidden shrink-0 lg:block">
        <PriorityBadge priority={task.priority} />
      </span>
      {task.estimate !== null && (
        <span className="hidden shrink-0 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400 xl:block" title={t('mywork.estimate')}>
          {task.estimate}p
        </span>
      )}
      {info && (
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] tabular-nums',
            info.overdue
              ? 'border-rose-500/30 bg-rose-500/10 font-medium text-rose-600 dark:text-rose-400'
              : 'border-zinc-200 text-zinc-600 dark:border-white/10 dark:text-zinc-300',
          )}
        >
          <CalendarDays className="h-3 w-3" />
          {formatDateShort(task.dueDate)} · {info.label}
        </span>
      )}
      {task.subtasks.length > 0 && (
        <div className="hidden w-24 shrink-0 items-center gap-1.5 sm:flex">
          <ProgressBar value={progress} />
          <span className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">{progress}%</span>
        </div>
      )}
    </div>
  );
}

/* ---------- fremdrift: oprettet vs færdig pr. uge + prognose ---------- */

function ProgressChart({ tasks }: { tasks: Task[] }) {
  const data = useMemo(() => {
    const weeks: { week: string; oprettet: number; faerdig: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const w0 = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 });
      const w1 = startOfWeek(subWeeks(new Date(), i - 1), { weekStartsOn: 1 });
      const inWeek = (iso: string) => {
        const d = new Date(iso);
        return d >= w0 && d < w1;
      };
      weeks.push({
        week: format(w0, 'd/M', { locale: da }),
        oprettet: tasks.filter((x) => inWeek(x.createdAt)).length,
        faerdig: tasks.filter((x) => x.status === 'done' && inWeek(x.updatedAt)).length,
      });
    }
    return weeks;
  }, [tasks]);

  const forecast = useMemo(() => {
    const open = tasks.filter((x) => x.status !== 'done' && x.status !== 'canceled').length;
    const recentDone = data.slice(-4).reduce((a, w) => a + w.faerdig, 0);
    const weekly = recentDone / 4;
    if (!weekly || !open) return null;
    return Math.ceil(open / weekly);
  }, [tasks, data]);

  return (
    <div className="glass-panel rounded-xl p-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{t('mywork.progressTitle')}</h3>
        {forecast !== null && (
          <span className="text-[10.5px] text-indigo-600 dark:text-indigo-400">
            {t('mywork.forecast').replace('{n}', String(forecast))}
          </span>
        )}
      </div>
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2}>
            <XAxis dataKey="week" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval={1} />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: 'rgba(120,120,140,0.08)' }}
              contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid rgba(120,120,140,0.25)' }}
              labelStyle={{ fontWeight: 600 }}
            />
            <Bar dataKey="oprettet" name={t('mywork.created')} fill="#818cf8" radius={[2, 2, 0, 0]} />
            <Bar dataKey="faerdig" name={t('mywork.completed')} fill="#34d399" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ---------- prioriteringsagent ---------- */

function PrioritizeModal({ openTasks, onClose }: { openTasks: Task[]; onClose: () => void }) {
  const projects = useStore((s) => s.projects);
  const updateTask = useStore((s) => s.updateTask);
  const [busy, setBusy] = useState(false);
  const [ranked, setRanked] = useState<{ ref: string; reason: string; suggestedPriority: string | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refs = useMemo(() => new Map(openTasks.map((x) => [`${projects.find((p) => p.id === x.projectId)?.key ?? ''}-${x.number}`, x])), [openTasks, projects]);

  const run = async () => {
    setBusy(true);
    setError(null);
    const payload = openTasks.slice(0, 30).map((x) => ({
      ref: `${projects.find((p) => p.id === x.projectId)?.key ?? ''}-${x.number}`,
      title: x.title,
      dueDate: x.dueDate,
      priority: x.priority,
      status: x.status,
    }));
    const r = await prioritizeTasks(payload);
    setBusy(false);
    if (r.ok && r.ranked) setRanked(r.ranked);
    else setError(r.reason ?? t('mywork.aiError'));
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm" onClick={onClose} />
      <div className="glass-panel animate-fade-in relative max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={15} className="text-violet-500" />
          <h3 className="text-sm font-bold flex-1">{t('mywork.prioritizeTitle')}</h3>
          <button onClick={onClose} className="opacity-40 hover:opacity-100"><X size={15} /></button>
        </div>
        {!ranked ? (
          <>
            <p className="text-[11.5px] opacity-60 leading-relaxed mb-3">{t('mywork.prioritizeHint').replace('{n}', String(openTasks.length))}</p>
            {error && <p className="text-[11px] text-rose-500 mb-2">{error}</p>}
            <button onClick={() => void run()} disabled={busy || openTasks.length === 0} className="btn-primary rounded-xl px-3 py-2 text-[12px] flex items-center gap-1.5 disabled:opacity-40">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {busy ? t('mywork.aiWorking') : t('mywork.prioritizeAction')}
            </button>
          </>
        ) : (
          <div className="space-y-1.5">
            {ranked.map((r, i) => {
              const task = refs.get(r.ref);
              return (
                <div key={r.ref} className="flex items-start gap-2 rounded-xl border border-zinc-200 dark:border-white/10 px-2.5 py-2">
                  <span className="text-[11px] font-bold text-violet-500 tabular-nums w-5 shrink-0">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium truncate">{task?.title ?? r.ref}</p>
                    <p className="text-[10px] opacity-55 leading-snug">{r.reason}</p>
                  </div>
                  {r.suggestedPriority && (
                    <button
                      onClick={() => task && updateTask(task.id, { priority: r.suggestedPriority as Priority }, 'sat AI-prioritet')}
                      title={t('mywork.applyPriority')}
                      className="shrink-0 rounded-lg border border-indigo-400/40 text-indigo-500 dark:text-indigo-300 px-2 py-0.5 text-[10px] hover:bg-indigo-500/10 transition"
                    >
                      {r.suggestedPriority}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- batch-oprettelse fra mødenoter ---------- */

function NotesModal({ onClose }: { onClose: () => void }) {
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const addTask = useStore((s) => s.addTask);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<{ title: string; description: string; priority: string | null; dueDate: string | null }[] | null>(null);
  const [projectId, setProjectId] = useState<string>(activeProjectId || 'p-app');
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!notes.trim()) return;
    setBusy(true);
    setError(null);
    const r = await parseTasksFromText(notes);
    setBusy(false);
    if (r.ok && r.tasks) setParsed(r.tasks);
    else setError(r.reason ?? t('mywork.aiError'));
  };

  const create = () => {
    if (!parsed) return;
    for (const item of parsed) {
      addTask({
        projectId,
        title: item.title.slice(0, 120),
        description: item.description ?? '',
        priority: (item.priority as Priority | null) ?? 'medium',
        dueDate: item.dueDate ?? null,
        status: 'todo',
        assigneeId: useStore.getState().currentUserId,
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm" onClick={onClose} />
      <div className="glass-panel animate-fade-in relative max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ClipboardPen size={15} className="text-violet-500" />
          <h3 className="text-sm font-bold flex-1">{t('mywork.notesTitle')}</h3>
          <button onClick={onClose} className="opacity-40 hover:opacity-100"><X size={15} /></button>
        </div>
        {!parsed ? (
          <>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={7}
              placeholder={t('mywork.notesPlaceholder')}
              className="w-full rounded-xl bg-black/5 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2 text-[12.5px] outline-none focus:border-violet-400/60 resize-y"
            />
            {error && <p className="text-[11px] text-rose-500">{error}</p>}
            <div className="flex items-center gap-2">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded-xl border border-zinc-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-[12px] outline-none">
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button onClick={() => void run()} disabled={busy || !notes.trim()} className="btn-primary rounded-xl px-3 py-1.5 text-[12px] flex items-center gap-1.5 disabled:opacity-40">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {busy ? t('mywork.aiWorking') : t('mywork.notesParse')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[11px] opacity-60">{t('mywork.notesPreview').replace('{n}', String(parsed.length))}</p>
            <div className="space-y-1.5">
              {parsed.map((item, i) => (
                <div key={i} className="rounded-xl border border-zinc-200 dark:border-white/10 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium flex-1">{item.title}</span>
                    {item.priority && <PriorityBadge priority={item.priority as Priority} />}
                    {item.dueDate && <span className="text-[10px] tabular-nums opacity-60">{formatDateShort(item.dueDate)}</span>}
                  </div>
                  {item.description && <p className="text-[10px] opacity-55 mt-0.5 line-clamp-2">{item.description}</p>}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={create} className="btn-primary rounded-xl px-4 py-2 text-[12px] flex items-center gap-1.5">
                <Check size={13} /> {t('mywork.notesCreate').replace('{n}', String(parsed.length))}
              </button>
              <button onClick={() => setParsed(null)} className="rounded-xl border border-zinc-200 dark:border-white/15 px-3 py-2 text-[12px] hover:bg-white/5 transition">
                {t('mywork.notesBack')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- hovedvisning ---------- */

export default function MyWorkView() {
  useLang();
  const tasks = useStore((s) => s.tasks);
  const users = useStore((s) => s.users);
  const currentUserId = useStore((s) => s.currentUserId);
  const selectTask = useStore((s) => s.selectTask);
  const { links, statuses } = useAiStatuses();
  const [prioritizeOpen, setPrioritizeOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const me = users.find((u) => u.id === currentUserId);
  const firstName = me?.name.split(' ')[0] ?? '';

  const { open, overdue, thisWeek, upcoming, unscheduled, recentlyDone } = useMemo(() => {
    const mine = tasks.filter((t) => t.assigneeId === currentUserId);
    const openTasks = mine.filter((t) => t.status !== 'done' && t.status !== 'canceled');
    const now = new Date();
    const withinWeek = (t: Task) =>
      !isOverdue(t) && !!t.dueDate && differenceInDays(parseISO(t.dueDate), now) <= 7;
    const doneTasks = mine
      .filter((t) => t.status === 'done')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);
    return {
      open: openTasks,
      overdue: openTasks.filter(isOverdue),
      thisWeek: openTasks.filter(withinWeek),
      upcoming: openTasks.filter((t) => !isOverdue(t) && !!t.dueDate && differenceInDays(parseISO(t.dueDate), now) > 7),
      unscheduled: openTasks.filter((t) => !t.dueDate),
      recentlyDone: doneTasks,
    };
  }, [tasks, currentUserId]);

  const dateLabel = format(new Date(), 'EEEE d. MMMM', { locale: da });
  const capitalizedDate = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);

  const sections = [
    { id: 'overdue', title: t('mywork.overdue'), tasks: overdue, accent: true },
    { id: 'thisweek', title: t('mywork.thisWeek'), tasks: thisWeek, accent: false },
    { id: 'upcoming', title: t('mywork.upcoming'), tasks: upcoming, accent: false },
    { id: 'unscheduled', title: t('mywork.unscheduled'), tasks: unscheduled, accent: false },
  ].filter((s) => s.tasks.length > 0);

  const stats = [
    {
      label: t('mywork.statOpen'),
      value: open.length,
      Icon: ListTodo,
      iconCls: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    },
    {
      label: t('mywork.statOverdue'),
      value: overdue.length,
      Icon: CircleAlert,
      iconCls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    },
    {
      label: t('mywork.statThisWeek'),
      value: thisWeek.length,
      Icon: CalendarClock,
      iconCls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4 lg:p-6">
        <ViewHeader
          title={t('mywork.title')}
          subtitle={firstName ? t('mywork.subtitleHello').replace('{name}', firstName).replace('{date}', capitalizedDate) : capitalizedDate}
        />

        <div className="space-y-6">
        {/* AI-handlinger */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setPrioritizeOpen(true)}
            className="rounded-xl border border-violet-400/40 text-violet-600 dark:text-violet-300 px-3 py-1.5 text-[12px] hover:bg-violet-500/10 transition flex items-center gap-1.5"
          >
            <Sparkles size={13} /> {t('mywork.prioritizeAction')}
          </button>
          <button
            onClick={() => setNotesOpen(true)}
            className="rounded-xl border border-zinc-300 dark:border-white/15 px-3 py-1.5 text-[12px] hover:bg-white/5 transition flex items-center gap-1.5"
          >
            <ClipboardPen size={13} /> {t('mywork.notesAction')}
          </button>
        </div>

        {/* Stat-kort */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {stats.map(({ label, value, Icon, iconCls }) => (
            <div key={label} className="glass-panel card-hover flex items-center gap-3 rounded-xl p-4">
              <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', iconCls)}>
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Fremdrift + prognose */}
        <ProgressChart tasks={tasks.filter((x) => x.assigneeId === currentUserId)} />

        {open.length === 0 ? (
          <EmptyState
            icon={<ListTodo className="h-6 w-6" />}
            title={t('mywork.emptyTitle')}
            description={t('mywork.emptyDesc')}
          />
        ) : (
          sections.map((section) => (
            <section key={section.id} className="animate-fade-in">
              <h3
                className={cn(
                  'mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider',
                  section.accent ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-500 dark:text-zinc-400',
                )}
              >
                {section.title}
                <span className="rounded bg-zinc-200/70 px-1.5 py-px text-[10px] tabular-nums text-zinc-500 dark:bg-white/[0.07] dark:text-zinc-400">
                  {section.tasks.length}
                </span>
              </h3>
              <div className="group/rows space-y-2">
                {section.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} aiStatus={links[task.id] ? statuses[task.id] ?? 'unknown' : undefined} />
                ))}
              </div>
            </section>
          ))
        )}

        {recentlyDone.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {t('mywork.recentlyDone')}
            </h3>
            <div className="glass-panel divide-y divide-zinc-200/70 overflow-hidden rounded-xl dark:divide-white/[0.05]">
              {recentlyDone.map((task) => (
                <button
                  key={task.id}
                  onClick={() => selectTask(task.id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.03]"
                >
                  <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-200">
                    {task.title}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                    {t('mywork.completedAgo').replace('{ago}', timeAgo(task.updatedAt))}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        </div>
      </div>

      {prioritizeOpen && <PrioritizeModal openTasks={open} onClose={() => setPrioritizeOpen(false)} />}
      {notesOpen && <NotesModal onClose={() => setNotesOpen(false)} />}
    </div>
  );
}

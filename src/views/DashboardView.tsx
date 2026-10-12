import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { AlarmClock, CalendarDays, CheckCircle2, HeartPulse, LayoutDashboard, ListTodo, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { addDays, differenceInCalendarDays, format, isBefore, parseISO } from 'date-fns';
import { da } from 'date-fns/locale';
import { useStore } from '../store/useStore';
import { PRIORITY_META, STATUS_META } from '../lib/constants';
import { computeHealth, healthTone } from '../lib/health';
import { estimateVsActual, formatMinutes, sprintVelocity } from '../lib/stats';
import { aiComplete } from '../lib/companion';
import { useLang, t } from '../lib/i18n';
import type { Priority, Sprint, Task, TaskStatus } from '../lib/types';
import { cn, formatDateShort, isOverdue, taskRef, timeAgo } from '../lib/utils';
import { Avatar, EmptyState, ProgressBar, ViewHeader } from '../components/common';
import CountUp from '../components/CountUp';

const CHART = {
  indigo: '#818cf8',
  sky: '#38bdf8',
  emerald: '#34d399',
  amber: '#fbbf24',
  rose: '#fb7185',
  orange: '#fb923c',
  zinc: '#a1a1aa',
  violet: '#a78bfa',
} as const;

const STATUS_HEX: Record<TaskStatus, string> = {
  backlog: CHART.zinc,
  todo: CHART.sky,
  inprogress: CHART.indigo,
  inreview: CHART.amber,
  done: CHART.emerald,
  canceled: CHART.rose,
};

const PRIORITY_HEX: Record<Priority, string> = {
  urgent: CHART.rose,
  high: CHART.orange,
  medium: CHART.amber,
  low: CHART.sky,
  none: CHART.zinc,
};

const TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: '#1e1f24',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  fontSize: 12,
};

const AXIS_TICK = { fontSize: 11, fill: '#a1a1aa' };

function Panel({
  title,
  subtitle,
  action,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('glass-panel card-hover animate-fade-in rounded-xl p-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
          {subtitle && <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="pt-3">{children}</div>
    </section>
  );
}

function ChartLegend({ items }: { items: { name: string; value: number; color: string }[] }) {
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 pt-2">
      {items.map((item) => (
        <li key={item.name} className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
          {item.name}
          <span className="font-medium tabular-nums text-zinc-400 dark:text-zinc-500">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

function BurndownChart({ sprint, tasks }: { sprint: Sprint; tasks: Task[] }) {
  const [today] = useState(() => new Date());
  const data = useMemo(() => {
    const sprintTasks = tasks.filter((t) => t.sprintId === sprint.id && t.estimate != null);
    const total = sprintTasks.reduce((sum, t) => sum + (t.estimate ?? 0), 0);
    const start = parseISO(sprint.startDate);
    const end = parseISO(sprint.endDate);
    const totalDays = Math.max(1, differenceInCalendarDays(end, start));
    const rows: { day: string; Ideal: number; Resterende?: number }[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const burned = sprintTasks
        .filter((t) => t.status === 'done' && isBefore(parseISO(t.updatedAt), addDays(d, 1)))
        .reduce((sum, t) => sum + (t.estimate ?? 0), 0);
      rows.push({
        day: format(d, 'd. MMM', { locale: da }),
        Ideal: Math.max(0, Math.round(total * (1 - differenceInCalendarDays(d, start) / totalDays))),
        Resterende: d <= today ? total - burned : undefined,
      });
    }
    return { rows, total };
  }, [sprint, tasks, today]);

  if (data.total === 0) {
    return (
      <p className="py-10 text-center text-xs text-zinc-500 dark:text-zinc-400">
        {t('dashboard.burndownEmpty')}
      </p>
    );
  }

  const start = parseISO(sprint.startDate);
  const end = parseISO(sprint.endDate);
  const showToday = today >= start && today <= end;
  const todayLabel = format(today, 'd. MMM', { locale: da });

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data.rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#71717a" strokeOpacity={0.18} vertical={false} />
          <XAxis
            dataKey="day"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: '#71717a', strokeOpacity: 0.3 }}
            interval="preserveStartEnd"
          />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: '#71717a', strokeOpacity: 0.35 }} />
          {showToday && <ReferenceLine x={todayLabel} stroke={CHART.rose} strokeDasharray="4 4" />}
          <Area
            type="monotone"
            dataKey="Resterende"
            name="Resterende"
            stroke={CHART.indigo}
            strokeWidth={2.5}
            fill={CHART.indigo}
            fillOpacity={0.12}
            connectNulls={false}
          />
          <Line type="monotone" dataKey="Ideal" name="Ideal" stroke={CHART.zinc} strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function DueChip({ task }: { task: Task }) {
  useLang();
  const [today] = useState(() => new Date());
  const days = differenceInCalendarDays(parseISO(task.dueDate!), today);
  const overdue = isOverdue(task);
  const text = overdue
    ? t('dashboard.dueOverdue').replace('{n}', String(Math.abs(days)))
    : days === 0
      ? t('dashboard.dueToday')
      : days === 1
        ? t('dashboard.dueTomorrow')
        : t('dashboard.dueInDays').replace('{n}', String(days));
  return (
    <span
      title={formatDateShort(task.dueDate)}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
        overdue
          ? 'bg-rose-500/10 text-rose-600 dark:bg-rose-400/10 dark:text-rose-400'
          : days === 0
            ? 'bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400'
            : 'bg-zinc-500/10 text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300',
      )}
    >
      {text}
    </span>
  );
}

export default function DashboardView() {
  useLang();
  const tasks = useStore((s) => s.tasks);
  const sprints = useStore((s) => s.sprints);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const timeEntries = useStore((s) => s.timeEntries);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const selectTask = useStore((s) => s.selectTask);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const hourlyRate = useStore((s) => s.hourlyRate);
  const setHourlyRate = useStore((s) => s.setHourlyRate);
  const updateProject = useStore((s) => s.updateProject);

  const [aiBusyId, setAiBusyId] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ projectId: string; name: string; text: string } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const filtered = useMemo(
    () => (activeProjectId ? tasks.filter((t) => t.projectId === activeProjectId) : tasks),
    [tasks, activeProjectId],
  );

  // Projekt-puls: altid på tværs af alle ikke-arkiverede projekter
  const health = useMemo(() => computeHealth(tasks, projects, users, sprints), [tasks, projects, users, sprints]);

  // Beregningen er billig; keys skal følge sproget, så den memo'eres ikke
  const velocity = sprintVelocity(tasks, sprints, activeProjectId);
  const plannedKey = t('dashboard.velocityPlanned');
  const completedKey = t('dashboard.velocityCompleted');
  const velocityData = velocity.map((v) => ({
    name: v.name,
    [plannedKey]: v.planned,
    [completedKey]: v.completed,
  }));

  const effortRows = useMemo(() => estimateVsActual(tasks, timeEntries).slice(0, 8), [tasks, timeEntries]);

  // Økonomi: forbrug pr. aktivt projekt (registreret tid × timepris)
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );
  const spentMinutes = useMemo(() => {
    if (!activeProjectId) return 0;
    const taskIds = new Set(tasks.filter((task) => task.projectId === activeProjectId).map((task) => task.id));
    const nowMs = Date.now();
    return timeEntries
      .filter((e) => taskIds.has(e.taskId))
      .reduce((sum, e) => sum + Math.round(((e.endedAt ? new Date(e.endedAt).getTime() : nowMs) - new Date(e.startedAt).getTime()) / 60000), 0);
  }, [tasks, timeEntries, activeProjectId]);
  const spentKr = Math.round((spentMinutes * hourlyRate) / 60);
  const budget = activeProject?.budget ?? null;
  const budgetPct = budget && budget > 0 ? Math.round((spentKr / budget) * 100) : null;
  const fmtKr = (n: number) => n.toLocaleString('da-DK');

  const analyze = async (projectId: string) => {
    const h = health.find((x) => x.projectId === projectId);
    if (!h || aiBusyId) return;
    setAiBusyId(projectId);
    setAiError(null);
    const r = await aiComplete([
      {
        role: 'system',
        content:
          'Du er en dansk projektleder. Giv en kort risikovurdering (max 3 sætninger) med det vigtigste næste skridt.',
      },
      {
        role: 'user',
        content: `Projekt: ${h.name}\nScore: ${h.score}/100\nÅbne: ${h.openCount}\nOverskredne: ${h.overdueCount}\nFærdig-ratio: ${h.doneRatio}%\nFaktorer: ${h.factors.map((f) => f.label).join(', ') || 'ingen'}`,
      },
    ]);
    setAiBusyId(null);
    if (r.ok && r.content) {
      setAiResult({ projectId, name: h.name, text: r.content });
    } else {
      setAiError(r.reason ?? null);
    }
  };

  const activeSprints = useMemo(
    () => sprints.filter((sp) => sp.status === 'active' && (!activeProjectId || sp.projectId === activeProjectId)),
    [sprints, activeProjectId],
  );

  const statusData = useMemo(
    () =>
      (Object.keys(STATUS_META) as TaskStatus[])
        .map((status) => ({
          name: STATUS_META[status].label,
          value: filtered.filter((t) => t.status === status).length,
          color: STATUS_HEX[status],
        }))
        .filter((d) => d.value > 0),
    [filtered],
  );

  const priorityData = useMemo(
    () =>
      (Object.keys(PRIORITY_META) as Priority[])
        .map((priority) => ({
          name: PRIORITY_META[priority].label,
          value: filtered.filter((t) => t.priority === priority).length,
          color: PRIORITY_HEX[priority],
        }))
        .filter((d) => d.value > 0),
    [filtered],
  );

  const workload = (() => {
    const entries = users
      .map((u) => ({ name: u.name, value: filtered.filter((t) => t.assigneeId === u.id && t.status !== 'done' && t.status !== 'canceled').length }))
      .filter((d) => d.value > 0);
    const unassigned = filtered.filter((t) => !t.assigneeId && t.status !== 'done' && t.status !== 'canceled').length;
    if (unassigned > 0) entries.push({ name: t('common.notAssigned'), value: unassigned });
    return entries.sort((a, b) => a.value - b.value);
  })();

  const upcoming = useMemo(
    () =>
      filtered
        .filter((t) => t.dueDate && t.status !== 'done' && t.status !== 'canceled')
        .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
        .slice(0, 6),
    [filtered],
  );

  const openTasks = filtered.filter((t) => t.status !== 'done' && t.status !== 'canceled');
  const [now] = useState(() => new Date());
  const doneThisMonth = filtered.filter((t) => {
    if (t.status !== 'done') return false;
    const d = parseISO(t.updatedAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const overdueTasks = filtered.filter(isOverdue);
  const latestDone = doneThisMonth.reduce<Task | null>(
    (acc, t) => (!acc || parseISO(t.updatedAt) > parseISO(acc.updatedAt) ? t : acc),
    null,
  );
  const monthName = format(now, 'MMMM', { locale: da });

  const stats: { label: string; value: number; icon: LucideIcon; iconClass: string; sub: string }[] = [
    {
      label: t('dashboard.statOpen'),
      value: openTasks.length,
      icon: ListTodo,
      iconClass: 'bg-indigo-500/10 text-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300',
      sub: t('dashboard.statOpenSub').replace('{pct}', String(Math.round((openTasks.length / Math.max(1, filtered.length)) * 100))),
    },
    {
      label: t('dashboard.statDoneMonth'),
      value: doneThisMonth.length,
      icon: CheckCircle2,
      iconClass: 'bg-emerald-500/10 text-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-300',
      sub: latestDone ? t('dashboard.statDoneLatest').replace('{ago}', timeAgo(latestDone.updatedAt)) : t('dashboard.statDoneNone').replace('{month}', monthName),
    },
    {
      label: t('dashboard.statOverdue'),
      value: overdueTasks.length,
      icon: AlarmClock,
      iconClass: 'bg-rose-500/10 text-rose-500 dark:bg-rose-400/10 dark:text-rose-300',
      sub: overdueTasks.length > 0 ? t('dashboard.statOverdueAttention') : t('dashboard.statOverdueOk'),
    },
    {
      label: t('dashboard.statActiveSprints'),
      value: activeSprints.length,
      icon: Zap,
      iconClass: 'bg-amber-500/10 text-amber-500 dark:bg-amber-400/10 dark:text-amber-300',
      sub: activeSprints.length > 0 ? activeSprints.map((sp) => sp.name).join(' · ') : t('dashboard.statNoActiveSprints'),
    },
  ];

  const toneChip: Record<'rose' | 'amber' | 'emerald', string> = {
    rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  };
  const toneDot: Record<'rose' | 'amber' | 'emerald', string> = {
    rose: 'bg-rose-500',
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
  };

  const pulseSection = (
    <Panel
      title={t('dashboard.pulseTitle')}
      subtitle={t('dashboard.pulseSub')}
      action={
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-500/10 text-indigo-500 dark:text-indigo-400">
          <HeartPulse className="h-4 w-4" />
        </span>
      }
    >
      {health.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">{t('dashboard.pulseEmpty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {health.map((h) => {
            const tone = healthTone(h.score);
            return (
              <li key={h.projectId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2 transition-colors hover:bg-zinc-200/50 dark:hover:bg-white/[0.04]">
                <button
                  onClick={() => setActiveProject(h.projectId)}
                  title={h.name}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', toneDot[tone])} />
                  <span className="max-w-[12rem] truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    {h.name}
                  </span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums', toneChip[tone])}>
                    {t('dashboard.pulseScore').replace('{score}', String(h.score))}
                  </span>
                  <span className="hidden min-w-24 flex-1 sm:block">
                    <ProgressBar value={h.score} />
                  </span>
                </button>
                <span className="flex flex-wrap gap-1">
                  {h.factors.map((f) => (
                    <span
                      key={f.label}
                      className="rounded bg-rose-500/10 px-1.5 py-px text-[11px] text-rose-600 dark:text-rose-400"
                    >
                      {f.label}
                    </span>
                  ))}
                </span>
                <button
                  onClick={() => void analyze(h.projectId)}
                  disabled={aiBusyId !== null}
                  className="btn-ghost px-2 py-1 text-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {aiBusyId === h.projectId ? t('dashboard.aiAnalyzing') : t('dashboard.aiAnalyze')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {aiResult && (
        <div className="glass-panel mt-3 rounded-xl p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-300">
            <Sparkles className="h-3.5 w-3.5" />
            {t('dashboard.aiResultTitle').replace('{name}', aiResult.name)}
          </p>
          <p className="pt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
            {aiResult.text}
          </p>
        </div>
      )}
      {aiError && <p className="pt-2 text-[11px] text-rose-600 dark:text-rose-400">{aiError}</p>}
    </Panel>
  );

  if (filtered.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="p-4 lg:p-6">
          <ViewHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
          <div className="mx-auto flex max-w-7xl flex-col gap-4">
            {pulseSection}
            <EmptyState
              icon={<LayoutDashboard className="h-6 w-6" />}
              title={t('dashboard.emptyTitle')}
              description={t('dashboard.emptyDesc')}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 lg:p-6">
        <ViewHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
        {pulseSection}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className="glass-panel card-hover animate-slide-up rounded-xl border-t-2 border-indigo-500/60 p-4"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-center gap-3">
                <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full', stat.iconClass)}>
                  <stat.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{stat.label}</p>
                  <p className="text-2xl font-bold leading-tight tabular-nums text-zinc-900 dark:text-zinc-50">
                    <CountUp value={stat.value} />
                  </p>
                </div>
              </div>
              <p className="mt-2 truncate text-xs text-zinc-500 dark:text-zinc-400">{stat.sub}</p>
            </div>
          ))}
        </div>

        {/* Økonomi: timepris, budget og forbrug for det aktive projekt */}
        <Panel title={t('economy.title')} subtitle={t('economy.subtitle')}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {t('economy.hourlyRate')}
                </span>
                <input
                  type="number"
                  min={0}
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(Number(e.target.value))}
                  className="input w-40 py-1.5 tabular-nums"
                />
              </label>
              {activeProject ? (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {t('economy.budget')} · {activeProject.name}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={activeProject.budget ?? ''}
                    onChange={(e) =>
                      updateProject(activeProject.id, { budget: e.target.value ? Number(e.target.value) : null })
                    }
                    className="input w-40 py-1.5 tabular-nums"
                  />
                </label>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('economy.noProject')}</p>
              )}
            </div>
            {activeProject && (
              <div className="space-y-2">
                {budget != null && budget > 0 && budgetPct != null ? (
                  <>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('economy.spent')}</span>
                      <span
                        className={cn(
                          'text-lg font-bold tabular-nums',
                          budgetPct > 100 ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-900 dark:text-zinc-50',
                        )}
                      >
                        {fmtKr(spentKr)} kr.
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-300',
                          budgetPct > 100 ? 'bg-rose-500' : 'bg-indigo-500',
                        )}
                        style={{ width: `${Math.min(100, budgetPct)}%` }}
                      />
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t('economy.ofBudget')
                        .replace('{spent}', fmtKr(spentKr))
                        .replace('{budget}', fmtKr(budget))
                        .replace('{pct}', String(budgetPct))}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t('economy.logged')}: {formatMinutes(spentMinutes)}
                    </p>
                    {budgetPct > 100 && (
                      <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                        {t('economy.over').replace('{amount}', fmtKr(spentKr - budget))}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('economy.noBudget')}</p>
                )}
              </div>
            )}
          </div>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={t('dashboard.byStatus')}>
            <div className="relative">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={86}
                      paddingAngle={3}
                      strokeWidth={0}
                      cornerRadius={5}
                    >
                      {statusData.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{openTasks.length}</p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('dashboard.openLabel')}</p>
                </div>
              </div>
            </div>
            <ChartLegend items={statusData} />
          </Panel>

          <Panel title={t('dashboard.byPriority')}>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={priorityData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#71717a" strokeOpacity={0.15} vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={{ stroke: '#71717a', strokeOpacity: 0.3 }}
                  />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(129,140,248,0.08)' }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={34}>
                    {priorityData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title={t('dashboard.workload')} subtitle={t('dashboard.workloadSub')}>
            <div style={{ height: Math.max(160, workload.length * 32) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={workload} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#71717a" strokeOpacity={0.15} horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={100} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(129,140,248,0.08)' }} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={14}>
                    {workload.map((d) => (
                      <Cell key={d.name} fill={d.name === t('common.notAssigned') ? CHART.zinc : CHART.indigo} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {activeSprints.map((sprint) => (
            <Panel
              key={sprint.id}
              title={t('dashboard.burndownTitle').replace('{name}', sprint.name)}
              subtitle={`${formatDateShort(sprint.startDate)} – ${formatDateShort(sprint.endDate)}`}
              action={
                <div className="flex shrink-0 items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded bg-[#a1a1aa]" />
                    {t('dashboard.legendIdeal')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded bg-[#818cf8]" />
                    {t('dashboard.legendRemaining')}
                  </span>
                </div>
              }
            >
              <BurndownChart sprint={sprint} tasks={filtered} />
            </Panel>
          ))}
        </div>

        {/* Velocity + estimat vs. faktisk tid */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={t('dashboard.velocityTitle')} subtitle={t('dashboard.velocitySub')}>
            {velocity.length === 0 ? (
              <p className="py-10 text-center text-xs text-zinc-500 dark:text-zinc-400">{t('dashboard.velocityEmpty')}</p>
            ) : (
              <>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={velocityData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="#71717a" strokeOpacity={0.15} vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={AXIS_TICK}
                        tickLine={false}
                        axisLine={{ stroke: '#71717a', strokeOpacity: 0.3 }}
                      />
                      <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(129,140,248,0.08)' }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey={plannedKey} fill={CHART.zinc} radius={[4, 4, 0, 0]} barSize={18} />
                      <Bar dataKey={completedKey} fill={CHART.indigo} radius={[4, 4, 0, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </Panel>

          <Panel title={t('dashboard.effortTitle')} subtitle={t('dashboard.effortSub')}>
            {effortRows.length === 0 ? (
              <p className="py-10 text-center text-xs text-zinc-500 dark:text-zinc-400">{t('dashboard.effortEmpty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                      <th className="pb-2 pr-4 font-medium">{t('dashboard.effortColTitle')}</th>
                      <th className="pb-2 pr-4 text-right font-medium">{t('dashboard.effortColEstimate')}</th>
                      <th className="pb-2 text-right font-medium">{t('dashboard.effortColLogged')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {effortRows.map((row) => (
                      <tr key={row.taskId} className="border-t border-zinc-100 dark:border-white/[0.06]">
                        <td className="max-w-0 w-1/2 truncate py-2 pr-4">
                          <span className="flex items-center gap-2">
                            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_META[row.status].dot)} />
                            <button
                              onClick={() => selectTask(row.taskId)}
                              title={row.title}
                              className="truncate text-left text-zinc-800 transition-colors hover:text-indigo-600 dark:text-zinc-200 dark:hover:text-indigo-300"
                            >
                              {row.title}
                            </button>
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                          {row.estimate ?? '—'}
                        </td>
                        <td className="py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                          {formatMinutes(row.minutes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <Panel title={t('dashboard.upcoming')} subtitle={t('dashboard.upcomingSub')}>
          {upcoming.length === 0 ? (
            <EmptyState
              icon={<CalendarDays className="h-6 w-6" />}
              title={t('dashboard.upcomingEmpty')}
              description={t('dashboard.upcomingEmptyDesc')}
            />
          ) : (
            <ul className="divide-y divide-zinc-200/70 dark:divide-white/[0.05]">
              {upcoming.map((task) => (
                <li key={task.id}>
                  <button
                    onClick={() => selectTask(task.id)}
                    className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-zinc-200/60 dark:hover:bg-white/[0.04]"
                  >
                    <span className="w-16 shrink-0 truncate text-[11px] font-semibold tabular-nums text-zinc-400 dark:text-zinc-500">
                      {taskRef(task, projects)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 transition-colors group-hover:text-zinc-900 dark:text-zinc-200 dark:group-hover:text-white">
                      {task.title}
                    </span>
                    <DueChip task={task} />
                    <Avatar user={users.find((u) => u.id === task.assigneeId)} size="xs" className="shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

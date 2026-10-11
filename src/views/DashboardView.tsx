import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { AlarmClock, CalendarDays, CheckCircle2, LayoutDashboard, ListTodo, Zap, type LucideIcon } from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
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
import type { Priority, Sprint, Task, TaskStatus } from '../lib/types';
import { cn, formatDateShort, isOverdue, taskRef, timeAgo } from '../lib/utils';
import { Avatar, EmptyState } from '../components/common';

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
        Ingen estimerede opgaver i dette sprint endnu.
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
  const [today] = useState(() => new Date());
  const days = differenceInCalendarDays(parseISO(task.dueDate!), today);
  const overdue = isOverdue(task);
  const text = overdue
    ? `${Math.abs(days)} d. overskredet`
    : days === 0
      ? 'I dag'
      : days === 1
        ? 'I morgen'
        : `Om ${days} dage`;
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
  const tasks = useStore((s) => s.tasks);
  const sprints = useStore((s) => s.sprints);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const selectTask = useStore((s) => s.selectTask);

  const filtered = useMemo(
    () => (activeProjectId ? tasks.filter((t) => t.projectId === activeProjectId) : tasks),
    [tasks, activeProjectId],
  );

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

  const workload = useMemo(() => {
    const entries = users
      .map((u) => ({ name: u.name, value: filtered.filter((t) => t.assigneeId === u.id && t.status !== 'done' && t.status !== 'canceled').length }))
      .filter((d) => d.value > 0);
    const unassigned = filtered.filter((t) => !t.assigneeId && t.status !== 'done' && t.status !== 'canceled').length;
    if (unassigned > 0) entries.push({ name: 'Ikke tildelt', value: unassigned });
    return entries.sort((a, b) => a.value - b.value);
  }, [filtered, users]);

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
      label: 'Åbne opgaver',
      value: openTasks.length,
      icon: ListTodo,
      iconClass: 'bg-indigo-500/10 text-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300',
      sub: `${Math.round((openTasks.length / Math.max(1, filtered.length)) * 100)}% af alle opgaver`,
    },
    {
      label: 'Afsluttet denne måned',
      value: doneThisMonth.length,
      icon: CheckCircle2,
      iconClass: 'bg-emerald-500/10 text-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-300',
      sub: latestDone ? `Senest ${timeAgo(latestDone.updatedAt)}` : `Ingen i ${monthName}`,
    },
    {
      label: 'Overskredne frister',
      value: overdueTasks.length,
      icon: AlarmClock,
      iconClass: 'bg-rose-500/10 text-rose-500 dark:bg-rose-400/10 dark:text-rose-300',
      sub: overdueTasks.length > 0 ? 'Kræver opmærksomhed nu' : 'Alle frister er overholdt',
    },
    {
      label: 'Aktive sprints',
      value: activeSprints.length,
      icon: Zap,
      iconClass: 'bg-amber-500/10 text-amber-500 dark:bg-amber-400/10 dark:text-amber-300',
      sub: activeSprints.length > 0 ? activeSprints.map((sp) => sp.name).join(' · ') : 'Ingen aktive sprints',
    },
  ];

  if (filtered.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <EmptyState
          icon={<LayoutDashboard className="h-6 w-6" />}
          title="Intet at vise endnu"
          description="Der er ingen opgaver i det valgte projekt. Opret en opgave for at se statistik, diagrammer og kommende frister her."
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className="glass-panel card-hover animate-slide-up rounded-xl p-4"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-center gap-3">
                <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full', stat.iconClass)}>
                  <stat.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{stat.label}</p>
                  <p className="text-2xl font-bold leading-tight tabular-nums text-zinc-900 dark:text-zinc-50">{stat.value}</p>
                </div>
              </div>
              <p className="mt-2 truncate text-xs text-zinc-500 dark:text-zinc-400">{stat.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Opgaver pr. status">
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
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">åbne</p>
                </div>
              </div>
            </div>
            <ChartLegend items={statusData} />
          </Panel>

          <Panel title="Opgaver pr. prioritet">
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

          <Panel title="Arbejdsbelastning" subtitle="Åbne opgaver pr. teammedlem">
            <div style={{ height: Math.max(160, workload.length * 32) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={workload} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#71717a" strokeOpacity={0.15} horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={100} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(129,140,248,0.08)' }} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={14}>
                    {workload.map((d) => (
                      <Cell key={d.name} fill={d.name === 'Ikke tildelt' ? CHART.zinc : CHART.indigo} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {activeSprints.map((sprint) => (
            <Panel
              key={sprint.id}
              title={`Burndown · ${sprint.name}`}
              subtitle={`${formatDateShort(sprint.startDate)} – ${formatDateShort(sprint.endDate)}`}
              action={
                <div className="flex shrink-0 items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded bg-[#a1a1aa]" />
                    Ideal
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded bg-[#818cf8]" />
                    Resterende
                  </span>
                </div>
              }
            >
              <BurndownChart sprint={sprint} tasks={filtered} />
            </Panel>
          ))}
        </div>

        <Panel title="Kommende frister" subtitle="De nærmeste 6 deadlines på tværs af status">
          {upcoming.length === 0 ? (
            <EmptyState
              icon={<CalendarDays className="h-6 w-6" />}
              title="Ingen kommende frister"
              description="Ingen åbne opgaver med en frist lige nu."
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

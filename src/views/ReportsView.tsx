import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { nanoid } from 'nanoid';
import { addDays, differenceInCalendarDays, format, isBefore, parseISO } from 'date-fns';
import { da } from 'date-fns/locale';
import {
  AlarmClock,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Copy,
  GripVertical,
  HeartPulse,
  LayoutDashboard,
  ListTodo,
  PieChart as PieChartIcon,
  Plus,
  Printer,
  Save,
  Table2,
  TrendingDown,
  Type,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
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
import { useStore } from '../store/useStore';
import { PRIORITY_META, STATUS_META } from '../lib/constants';
import { computeHealth, healthTone } from '../lib/health';
import { cn, formatDateShort, isOverdue, taskRef } from '../lib/utils';
import type { Priority, Sprint, Task, TaskStatus } from '../lib/types';
import { Avatar, EmptyState, ProgressBar, ViewHeader } from '../components/common';
import CountUp from '../components/CountUp';

// Diagram-stil som i DashboardView
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

const REPORTS_KEY = 'orbit-reports';
const BRAND_KEY = 'orbit-brand';

type WidgetType = 'kpi' | 'status-chart' | 'prioritet-chart' | 'burndown' | 'deadlines' | 'health' | 'text' | 'tasks-table';

interface ReportWidget {
  id: string;
  type: WidgetType;
  config: { text?: string };
}

interface ReportTemplate {
  id: string;
  name: string;
  widgets: ReportWidget[];
}

interface ReportsFile {
  templates: ReportTemplate[];
  widgets?: ReportWidget[];
}

const WIDGET_META: Record<WidgetType, { label: string; title: string; icon: LucideIcon }> = {
  kpi: { label: 'Nøgletal', title: 'Nøgletal', icon: LayoutDashboard },
  'status-chart': { label: 'Status-diagram', title: 'Opgaver pr. status', icon: PieChartIcon },
  'prioritet-chart': { label: 'Prioritets-diagram', title: 'Opgaver pr. prioritet', icon: BarChart3 },
  burndown: { label: 'Burndown', title: 'Burndown', icon: TrendingDown },
  deadlines: { label: 'Frister', title: 'Kommende frister', icon: CalendarDays },
  health: { label: 'Projekt-puls', title: 'Projekt-puls', icon: HeartPulse },
  text: { label: 'Fri tekst', title: 'Tekst', icon: Type },
  'tasks-table': { label: 'Opgavetabel', title: 'Åbne opgaver', icon: Table2 },
};

function loadReports(): ReportsFile {
  try {
    const raw = localStorage.getItem(REPORTS_KEY);
    if (!raw) return { templates: [] };
    const parsed = JSON.parse(raw) as ReportsFile;
    return { templates: parsed.templates ?? [], widgets: parsed.widgets };
  } catch {
    return { templates: [] };
  }
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

function BurndownMini({ sprint, tasks }: { sprint: Sprint; tasks: Task[] }) {
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
    return <p className="py-10 text-center text-xs text-zinc-500 dark:text-zinc-400">Ingen estimerede opgaver i dette sprint endnu.</p>;
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
          <XAxis dataKey="day" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#71717a', strokeOpacity: 0.3 }} interval="preserveStartEnd" />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: '#71717a', strokeOpacity: 0.35 }} />
          {showToday && <ReferenceLine x={todayLabel} stroke={CHART.rose} strokeDasharray="4 4" />}
          <Area type="monotone" dataKey="Resterende" name="Resterende" stroke={CHART.indigo} strokeWidth={2.5} fill={CHART.indigo} fillOpacity={0.12} connectNulls={false} />
          <Line type="monotone" dataKey="Ideal" name="Ideal" stroke={CHART.zinc} strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function SortableWidget({
  id,
  title,
  onRemove,
  children,
}: {
  id: string;
  title: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('report-widget glass-panel card-hover animate-fade-in rounded-xl p-4', isDragging && 'opacity-60')}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button
            {...attributes}
            {...listeners}
            title="Træk for at flytte"
            className="print:hidden cursor-grab touch-none rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-200/70 hover:text-zinc-700 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h3>
        </div>
        <button
          onClick={onRemove}
          title="Fjern widget"
          className="print:hidden grid h-6 w-6 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-200/70 hover:text-rose-500 dark:hover:bg-white/[0.06] dark:hover:text-rose-400"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="pt-3">{children}</div>
    </section>
  );
}

export default function ReportsView() {
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const sprints = useStore((s) => s.sprints);
  const risks = useStore((s) => s.risks);
  const issues = useStore((s) => s.issues);
  const selectTask = useStore((s) => s.selectTask);

  const [initial] = useState(loadReports);
  const [widgets, setWidgets] = useState<ReportWidget[]>(initial.widgets ?? []);
  const [templates, setTemplates] = useState<ReportTemplate[]>(initial.templates);
  const [brand, setBrand] = useState(() => localStorage.getItem(BRAND_KEY) ?? '');
  const [addOpen, setAddOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Gem rapport-lærred og skabeloner lokalt
  useEffect(() => {
    try {
      localStorage.setItem(REPORTS_KEY, JSON.stringify({ templates, widgets }));
    } catch {
      /* lager kan være fyldt op – ignorer */
    }
  }, [templates, widgets]);

  useEffect(() => {
    try {
      localStorage.setItem(BRAND_KEY, brand);
    } catch {
      /* ignorer */
    }
  }, [brand]);

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
  }, []);

  // Nøgletal og diagramdata – på tværs af alle projekter
  const openTasks = useMemo(() => tasks.filter((t) => t.status !== 'done' && t.status !== 'canceled'), [tasks]);
  const overdueTasks = useMemo(() => tasks.filter(isOverdue), [tasks]);
  const activeSprints = useMemo(() => sprints.filter((sp) => sp.status === 'active'), [sprints]);
  const [now] = useState(() => new Date());
  const doneThisMonth = tasks.filter((t) => {
    if (t.status !== 'done') return false;
    const d = parseISO(t.updatedAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const monthName = format(now, 'MMMM', { locale: da });
  const openByDue = useMemo(
    () => [...openTasks].sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31')),
    [openTasks],
  );
  const upcoming = useMemo(() => openByDue.filter((t) => t.dueDate).slice(0, 8), [openByDue]);

  const statusData = useMemo(
    () =>
      (Object.keys(STATUS_META) as TaskStatus[])
        .map((status) => ({
          name: STATUS_META[status].label,
          value: tasks.filter((t) => t.status === status).length,
          color: STATUS_HEX[status],
        }))
        .filter((d) => d.value > 0),
    [tasks],
  );

  const priorityData = useMemo(
    () =>
      (Object.keys(PRIORITY_META) as Priority[])
        .map((priority) => ({
          name: PRIORITY_META[priority].label,
          value: tasks.filter((t) => t.priority === priority).length,
          color: PRIORITY_HEX[priority],
        }))
        .filter((d) => d.value > 0),
    [tasks],
  );

  const health = useMemo(() => computeHealth(tasks, projects, users, sprints, risks, issues), [tasks, projects, users, sprints, risks, issues]);

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

  const stats = [
    {
      label: 'Åbne opgaver',
      value: openTasks.length,
      icon: ListTodo,
      iconClass: 'bg-indigo-500/10 text-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300',
      sub: `${Math.round((openTasks.length / Math.max(1, tasks.length)) * 100)}% af alle opgaver`,
    },
    {
      label: 'Overskredne frister',
      value: overdueTasks.length,
      icon: AlarmClock,
      iconClass: 'bg-rose-500/10 text-rose-500 dark:bg-rose-400/10 dark:text-rose-300',
      sub: overdueTasks.length > 0 ? 'Kræver opmærksomhed nu' : 'Alle frister er overholdt',
    },
    {
      label: 'Afsluttet denne måned',
      value: doneThisMonth.length,
      icon: CheckCircle2,
      iconClass: 'bg-emerald-500/10 text-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-300',
      sub: monthName,
    },
    {
      label: 'Aktive sprints',
      value: activeSprints.length,
      icon: Zap,
      iconClass: 'bg-amber-500/10 text-amber-500 dark:bg-amber-400/10 dark:text-amber-300',
      sub: activeSprints.length > 0 ? activeSprints.map((sp) => sp.name).join(' · ') : 'Ingen aktive sprints',
    },
  ];

  const addWidget = (type: WidgetType) => {
    setWidgets((ws) => [...ws, { id: `w-${nanoid(8)}`, type, config: {} }]);
    setAddOpen(false);
  };

  const removeWidget = (id: string) => setWidgets((ws) => ws.filter((w) => w.id !== id));

  const updateText = (id: string, text: string) =>
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, config: { ...w.config, text } } : w)));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setWidgets((ws) => {
      const from = ws.findIndex((w) => w.id === active.id);
      const to = ws.findIndex((w) => w.id === over.id);
      if (from < 0 || to < 0) return ws;
      return arrayMove(ws, from, to);
    });
  };

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    setTemplates((ts) => [...ts.filter((t) => t.name !== name), { id: `rt-${nanoid(8)}`, name, widgets }]);
    setTemplateName('');
  };

  const loadTemplate = (tpl: ReportTemplate) => setWidgets(tpl.widgets.map((w) => ({ ...w, id: `w-${nanoid(8)}` })));

  const deleteTemplate = (id: string) => setTemplates((ts) => ts.filter((t) => t.id !== id));

  const buildMarkdown = () => {
    const lines: string[] = [`# ${brand.trim() || 'Orbit rapport'}`, '', `_${format(new Date(), 'd. MMMM yyyy', { locale: da })}_`, ''];
    for (const w of widgets) {
      switch (w.type) {
        case 'kpi':
          lines.push('## Nøgletal', '', ...stats.map((s) => `- ${s.label}: ${s.value}`), '');
          break;
        case 'status-chart':
          lines.push('## Opgaver pr. status', '', ...statusData.map((d) => `- ${d.name}: ${d.value}`), '');
          break;
        case 'prioritet-chart':
          lines.push('## Opgaver pr. prioritet', '', ...priorityData.map((d) => `- ${d.name}: ${d.value}`), '');
          break;
        case 'burndown': {
          const sprint = activeSprints[0];
          lines.push(`## Burndown${sprint ? ` · ${sprint.name}` : ''}`, '', sprint ? `- ${formatDateShort(sprint.startDate)} – ${formatDateShort(sprint.endDate)} (se diagram i appen)` : '- Intet aktivt sprint lige nu.', '');
          break;
        }
        case 'deadlines':
          lines.push('## Kommende frister', '', ...(upcoming.length ? upcoming.map((t) => `- ${taskRef(t, projects)} ${t.title} (frist ${formatDateShort(t.dueDate)})`) : ['- Ingen kommende frister']), '');
          break;
        case 'health':
          lines.push('## Projekt-puls', '', ...health.map((h) => `- ${h.name}: ${h.score}/100${h.factors.length ? ` – ${h.factors.map((f) => f.label).join('; ')}` : ''}`), '');
          break;
        case 'text':
          if (w.config.text?.trim()) lines.push('## Noter', '', w.config.text.trim(), '');
          break;
        case 'tasks-table':
          lines.push('## Åbne opgaver', '', ...openByDue.slice(0, 8).map((t) => `- ${taskRef(t, projects)} ${t.title} – ${users.find((u) => u.id === t.assigneeId)?.name ?? 'Ikke tildelt'} – frist ${formatDateShort(t.dueDate)}`), '');
          break;
      }
    }
    return lines.join('\n');
  };

  const copyAsText = async () => {
    try {
      await navigator.clipboard.writeText(buildMarkdown());
      setCopyMsg('Rapporten er kopieret som tekst.');
    } catch {
      setCopyMsg('Kunne ikke kopiere – prøv igen.');
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyMsg(null), 2500);
  };

  const renderWidgetContent = (widget: ReportWidget) => {
    switch (widget.type) {
      case 'kpi':
        return (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-xl border border-zinc-200/80 bg-white/60 p-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
                <div className="flex items-center gap-2.5">
                  <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', stat.iconClass)}>
                    <stat.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{stat.label}</p>
                    <p className="text-xl font-bold leading-tight tabular-nums text-zinc-900 dark:text-zinc-50">
                      <CountUp value={stat.value} />
                    </p>
                  </div>
                </div>
                <p className="mt-1.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">{stat.sub}</p>
              </div>
            ))}
          </div>
        );
      case 'status-chart':
        return (
          <div className="relative">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={86} paddingAngle={3} strokeWidth={0} cornerRadius={5}>
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
            <ChartLegend items={statusData} />
          </div>
        );
      case 'prioritet-chart':
        return (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={priorityData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#71717a" strokeOpacity={0.15} vertical={false} />
                <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#71717a', strokeOpacity: 0.3 }} />
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
        );
      case 'burndown': {
        const sprint = activeSprints[0];
        if (!sprint) {
          return <p className="py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">Intet aktivt sprint lige nu.</p>;
        }
        return (
          <div>
            <BurndownMini sprint={sprint} tasks={tasks} />
            <p className="pt-2 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
              {sprint.name} · {formatDateShort(sprint.startDate)} – {formatDateShort(sprint.endDate)}
            </p>
          </div>
        );
      }
      case 'deadlines':
        return upcoming.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">Ingen åbne opgaver med en frist lige nu.</p>
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
        );
      case 'health':
        return health.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">Ingen aktive projekter at vurdere.</p>
        ) : (
          <ul className="space-y-1.5">
            {health.map((h) => {
              const tone = healthTone(h.score);
              return (
                <li key={h.projectId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2">
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', toneDot[tone])} />
                  <span className="max-w-[14rem] truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{h.name}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums', toneChip[tone])}>{h.score}/100</span>
                  <span className="hidden min-w-24 flex-1 sm:block">
                    <ProgressBar value={h.score} />
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {h.factors.map((f) => (
                      <span key={f.label} className="rounded bg-rose-500/10 px-1.5 py-px text-[11px] text-rose-600 dark:text-rose-400">
                        {f.label}
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        );
      case 'text':
        return (
          <textarea
            value={widget.config.text ?? ''}
            onChange={(e) => updateText(widget.id, e.target.value)}
            placeholder="Skriv en bemærkning til rapporten …"
            rows={4}
            className="input resize-y"
          />
        );
      case 'tasks-table': {
        const rows = openByDue.slice(0, 8);
        return rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">Ingen åbne opgaver.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  <th className="pb-2 pr-4 font-medium">Ref</th>
                  <th className="pb-2 pr-4 font-medium">Titel</th>
                  <th className="pb-2 pr-4 font-medium">Ansvarlig</th>
                  <th className="pb-2 text-right font-medium">Frist</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((task) => (
                  <tr key={task.id} className="border-t border-zinc-100 dark:border-white/[0.06]">
                    <td className="py-2 pr-4 text-[11px] font-semibold tabular-nums text-zinc-400 dark:text-zinc-500">
                      {taskRef(task, projects)}
                    </td>
                    <td className="max-w-0 w-1/2 truncate py-2 pr-4 text-zinc-700 dark:text-zinc-200">{task.title}</td>
                    <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-300">
                      {users.find((u) => u.id === task.assigneeId)?.name ?? '—'}
                    </td>
                    <td className="py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{formatDateShort(task.dueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
    }
  };

  return (
    <div className="report-page h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 lg:p-6">
        {/* Vises kun ved print */}
        <div className="print-header">
          <h1 className="text-2xl font-bold">{brand.trim() || 'Orbit'}</h1>
          <p className="text-sm text-zinc-500">
            Rapport · {format(now, 'd. MMMM yyyy', { locale: da })}
          </p>
        </div>

        <ViewHeader
          title="Rapporter"
          subtitle="Byg dit eget ledelsesoverblik"
          actions={
            <>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Virksomhedsnavn …"
                title="Vises i toppen af den printede rapport"
                className="input w-44"
              />
              <div className="relative">
                <button onClick={() => setAddOpen((v) => !v)} className="btn-primary print:hidden">
                  <Plus className="h-4 w-4" />
                  Tilføj widget
                </button>
                {addOpen && (
                  <>
                    <button className="fixed inset-0 z-20 cursor-default" onClick={() => setAddOpen(false)} aria-label="Luk menu" />
                    <div className="glass-panel absolute right-0 z-30 mt-1 w-56 rounded-xl p-1 shadow-panel animate-scale-in">
                      {(Object.keys(WIDGET_META) as WidgetType[]).map((type) => {
                        const Icon = WIDGET_META[type].icon;
                        return (
                          <button
                            key={type}
                            onClick={() => addWidget(type)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-200/70 dark:text-zinc-200 dark:hover:bg-white/[0.06]"
                          >
                            <Icon className="h-4 w-4 shrink-0 text-indigo-500 dark:text-indigo-300" />
                            {WIDGET_META[type].label}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              <button onClick={() => window.print()} className="btn-outline print:hidden">
                <Printer className="h-4 w-4" />
                Udskriv / PDF
              </button>
              <button onClick={() => void copyAsText()} className="btn-outline print:hidden">
                <Copy className="h-4 w-4" />
                Kopiér som tekst
              </button>
            </>
          }
        />

        {/* Skabeloner */}
        <div className="print:hidden flex flex-wrap items-center gap-2">
          <input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTemplate();
            }}
            placeholder="Skabelonnavn …"
            className="input w-44"
          />
          <button onClick={saveTemplate} disabled={!templateName.trim()} className="btn-ghost">
            <Save className="h-4 w-4" />
            Gem skabelon
          </button>
          {templates.map((tpl) => (
            <span
              key={tpl.id}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white py-1 pl-3 pr-1 text-xs font-medium text-zinc-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
            >
              <button onClick={() => loadTemplate(tpl)} title={`Indlæs skabelonen "${tpl.name}"`} className="transition-colors hover:text-indigo-600 dark:hover:text-indigo-300">
                {tpl.name}
              </button>
              <button
                onClick={() => deleteTemplate(tpl.id)}
                title="Slet skabelon"
                className="grid h-4 w-4 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        {copyMsg && <p className="print:hidden text-xs text-emerald-600 dark:text-emerald-400">{copyMsg}</p>}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={widgets.map((w) => w.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-4">
              {widgets.map((widget) => (
                <SortableWidget key={widget.id} id={widget.id} title={WIDGET_META[widget.type].title} onRemove={() => removeWidget(widget.id)}>
                  {renderWidgetContent(widget)}
                </SortableWidget>
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {widgets.length === 0 && (
          <EmptyState
            icon={<BarChart3 className="h-6 w-6" />}
            title="Rapporten er tom"
            description="Tilføj widgets fra menuen ovenfor for at bygge dit eget ledelsesoverblik – og gem det som en skabelon, du kan genbruge."
          />
        )}
      </div>
    </div>
  );
}

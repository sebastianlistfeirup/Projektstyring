import { useMemo, useState } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { format, parseISO, differenceInDays } from 'date-fns';
import { da } from 'date-fns/locale';
import {
  Check,
  ChevronDown,
  CircleAlert,
  CalendarDays,
  GripVertical,
  ListChecks,
  ListTodo,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useLang, t } from '../lib/i18n';
import { cn, formatDateShort, isOverdue } from '../lib/utils';
import { EmptyState, PriorityBadge } from '../components/common';
import ProgressRing from '../components/ProgressRing';
import type { Priority, Project, Task } from '../lib/types';

type Grouping = 'project' | 'due' | 'priority' | 'list';

interface TaskGroup {
  key: string;
  title: string;
  dot?: string; // tailwind bg-klasse
  hex?: string;
  tasks: Task[];
}

const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];

const PRIORITY_HEX: Record<Priority, string> = {
  urgent: '#f43f5e',
  high: '#f97316',
  medium: '#818cf8',
  low: '#34d399',
  none: '#a1a1aa',
};

/* ---------- afkrydsningsfelt med tegne-animation (genbruger .draw-check) ---------- */
function DrawCheckbox({ checked, onToggle, title }: { checked: boolean; onToggle: () => void; title?: string }) {
  return (
    <label className="draw-check shrink-0" title={title} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="box">
        <svg viewBox="0 0 16 16">
          <path d="M3 8.5l3.2 3L13 4.5" />
        </svg>
      </span>
    </label>
  );
}

/* ---------- underopgave-række ---------- */
function SubtaskRow({ task, subId, title, done }: { task: Task; subId: string; title: string; done: boolean }) {
  const toggleSubtask = useStore((s) => s.toggleSubtask);
  return (
    <div className="group/sub flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-zinc-100/80 dark:hover:bg-white/[0.04]">
      <DrawCheckbox checked={done} onToggle={() => toggleSubtask(task.id, subId)} />
      <span
        className={cn(
          'min-w-0 flex-1 text-[13px] transition-colors',
          done ? 'text-zinc-400 line-through dark:text-zinc-500' : 'text-zinc-700 dark:text-zinc-200',
        )}
      >
        {title}
      </span>
    </div>
  );
}

/* ---------- én opgave-række (sortérbar) ---------- */
function SortableTaskRow({
  task,
  project,
  showProject,
  labels,
}: {
  task: Task;
  project?: Project;
  showProject: boolean;
  labels: { id: string; name: string; color: string }[];
}) {
  const updateTask = useStore((s) => s.updateTask);
  const selectTask = useStore((s) => s.selectTask);
  const addSubtask = useStore((s) => s.addSubtask);
  const [expanded, setExpanded] = useState(false);
  const [subInput, setSubInput] = useState('');
  const done = task.status === 'done' || task.status === 'canceled';
  const subDone = task.subtasks.filter((s) => s.done).length;
  const subPct = task.subtasks.length ? Math.round((subDone / task.subtasks.length) * 100) : 0;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  const toggleDone = () => {
    updateTask(task.id, { status: done ? 'todo' : 'done' }, done ? 'gjenåbnede' : 'afsluttede');
  };

  const submitSubtask = () => {
    const v = subInput.trim();
    if (!v) return;
    addSubtask(task.id, v);
    setSubInput('');
  };

  const overdue = !done && isOverdue(task);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group glass-panel rounded-2xl transition-shadow',
        isDragging ? 'z-20 scale-[1.01] shadow-panel' : 'card-hover',
        done && 'opacity-70',
      )}
    >
      <div className="flex items-center gap-2.5 px-4 py-3">
        <button
          {...attributes}
          {...listeners}
          className="shrink-0 cursor-grab touch-none text-zinc-300 opacity-0 transition-opacity hover:text-zinc-500 active:cursor-grabbing group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-400"
          title="Træk for at sortere"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <DrawCheckbox checked={done} onToggle={toggleDone} title={done ? t('tasks.reopenTask') : t('tasks.completeTask')} />

        <button
          onClick={() => selectTask(task.id)}
          className={cn(
            'min-w-0 flex-1 truncate text-left text-sm font-medium transition-colors',
            done
              ? 'text-zinc-400 line-through dark:text-zinc-500'
              : 'text-zinc-800 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-300',
          )}
        >
          {task.emoji && <span className="mr-1.5">{task.emoji}</span>}
          {task.title}
        </button>

        {/* etiketter */}
        {task.labelIds.slice(0, 3).map((lid) => {
          const label = labels.find((l) => l.id === lid);
          if (!label) return null;
          return (
            <span
              key={lid}
              className={cn(
                'hidden shrink-0 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-white/10 dark:text-zinc-300 md:inline-block',
              )}
            >
              {label.name}
            </span>
          );
        })}

        {/* frist */}
        {task.dueDate && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] tabular-nums',
              overdue
                ? 'border-rose-500/30 bg-rose-500/10 font-medium text-rose-600 dark:text-rose-400'
                : differenceInDays(parseISO(task.dueDate), new Date()) === 0
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'border-zinc-200 text-zinc-600 dark:border-white/10 dark:text-zinc-300',
            )}
          >
            <CalendarDays className="h-3 w-3" />
            <span className="hidden sm:inline">{formatDateShort(task.dueDate)}</span>
            <span className="sm:hidden">{format(parseISO(task.dueDate), 'd/M')}</span>
          </span>
        )}

        <span className="hidden shrink-0 lg:block">
          <PriorityBadge priority={task.priority} />
        </span>

        {/* projekt-chip */}
        {showProject && project && (
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-white/10 dark:text-zinc-300 sm:inline-flex">
            <span className={cn('h-1.5 w-1.5 rounded-full', `bg-${project.color}-500`)} />
            <span className="max-w-[7rem] truncate">{project.name}</span>
          </span>
        )}

        {/* underopgaver: ring + ekspandér */}
        {task.subtasks.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] tabular-nums text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            title={expanded ? t('tasks.collapse') : t('tasks.expand')}
          >
            <ProgressRing value={subPct} size={20} stroke={2.5} />
            <span>
              {subDone}/{task.subtasks.length}
            </span>
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
      </div>

      {/* udvidet underopgave-liste */}
      {expanded && (
        <div className="animate-fade-in border-t border-zinc-200/70 px-4 pb-3 pt-2 dark:border-white/[0.06]">
          <div className="ml-9 space-y-0.5">
            {task.subtasks.map((st) => (
              <SubtaskRow key={st.id} task={task} subId={st.id} title={st.title} done={st.done} />
            ))}
            <div className="flex items-center gap-2.5 px-2 pt-1">
              <Plus className="h-3.5 w-3.5 text-zinc-400" />
              <input
                value={subInput}
                onChange={(e) => setSubInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitSubtask()}
                placeholder={t('tasks.subtaskAdd')}
                className="w-full bg-transparent text-[13px] text-zinc-700 placeholder-zinc-400 outline-none dark:text-zinc-200 dark:placeholder-zinc-500"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- gruppering ---------- */
function groupTasks(tasks: Task[], grouping: Grouping, projects: Project[]): TaskGroup[] {
  if (grouping === 'list') return [{ key: 'all', title: '', tasks }];

  if (grouping === 'project') {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      const list = map.get(task.projectId) ?? [];
      list.push(task);
      map.set(task.projectId, list);
    }
    return [...map.entries()]
      .map(([pid, list]) => {
        const p = projects.find((x) => x.id === pid);
        return { key: pid, title: p?.name ?? t('tasks.noProject'), dot: p ? `bg-${p.color}-500` : undefined, tasks: list };
      })
      .sort((a, b) => a.title.localeCompare(b.title, 'da'));
  }

  if (grouping === 'priority') {
    const map = new Map<Priority, Task[]>();
    for (const task of tasks) {
      const list = map.get(task.priority) ?? [];
      list.push(task);
      map.set(task.priority, list);
    }
    return PRIORITY_ORDER.filter((p) => map.has(p)).map((p) => ({
      key: p,
      title: t(`tasks.priority.${p}`),
      hex: PRIORITY_HEX[p],
      tasks: map.get(p)!,
    }));
  }

  // grouping === 'due'
  const now = new Date();
  const buckets: { key: string; title: string; match: (task: Task) => boolean }[] = [
    { key: 'overdue', title: t('tasks.overdue'), match: (task) => isOverdue(task) },
    {
      key: 'today',
      title: t('tasks.today'),
      match: (task) => !!task.dueDate && !isOverdue(task) && differenceInDays(parseISO(task.dueDate), now) <= 0,
    },
    {
      key: 'tomorrow',
      title: t('tasks.tomorrow'),
      match: (task) => !!task.dueDate && differenceInDays(parseISO(task.dueDate), now) === 1,
    },
    {
      key: 'week',
      title: t('tasks.thisWeek'),
      match: (task) => !!task.dueDate && differenceInDays(parseISO(task.dueDate), now) > 1 && differenceInDays(parseISO(task.dueDate), now) <= 7,
    },
    {
      key: 'later',
      title: t('tasks.later'),
      match: (task) => !!task.dueDate && differenceInDays(parseISO(task.dueDate), now) > 7,
    },
    { key: 'nodue', title: t('tasks.noDue'), match: (task) => !task.dueDate },
  ];
  return buckets
    .map((b) => ({ key: b.key, title: b.title, tasks: tasks.filter(b.match) }))
    .filter((g) => g.tasks.length > 0);
}

/* ---------- hovedview ---------- */
export default function TasksView() {
  useLang();
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const labels = useStore((s) => s.labels);
  const users = useStore((s) => s.users);
  const currentUserId = useStore((s) => s.currentUserId);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const addTask = useStore((s) => s.addTask);
  const mineOrder = useStore((s) => s.mineOrder);
  const setMineOrder = useStore((s) => s.setMineOrder);

  const [grouping, setGrouping] = useState<Grouping>('project');
  const [showDone, setShowDone] = useState(false);
  const [query, setQuery] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newProjectId, setNewProjectId] = useState<string>('');

  const me = users.find((u) => u.id === currentUserId);
  const firstName = me?.name.split(' ')[0] ?? '';
  const dateLabel = format(new Date(), 'EEEE d. MMMM yyyy', { locale: da });
  const capitalizedDate = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);

  const defaultProjectId = newProjectId || activeProjectId || projects.find((p) => !p.archived)?.id || '';

  const mine = useMemo(() => tasks.filter((x) => x.assigneeId === currentUserId), [tasks, currentUserId]);

  // Personlig rækkefølge: mineOrder styrer, nyoprettede øverst
  const rank = useMemo(() => {
    const map = new Map<string, number>();
    mineOrder.forEach((id, i) => map.set(id, i));
    return (task: Task) => {
      const i = map.get(task.id);
      return i !== undefined ? i : Number.MAX_SAFE_INTEGER - new Date(task.createdAt).getTime() / 1e10;
    };
  }, [mineOrder]);

  const sortedMine = useMemo(
    () => [...mine].sort((a, b) => rank(a) - rank(b) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.createdAt.localeCompare(a.createdAt)),
    [mine, rank],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = sortedMine;
    if (q) {
      list = list.filter(
        (x) =>
          x.title.toLowerCase().includes(q) ||
          x.subtasks.some((st) => st.title.toLowerCase().includes(q)) ||
          (projects.find((p) => p.id === x.projectId)?.name.toLowerCase().includes(q) ?? false),
      );
    }
    const open = list.filter((x) => x.status !== 'done' && x.status !== 'canceled');
    const doneList = list.filter((x) => x.status === 'done' || x.status === 'canceled');
    return { open, done: doneList };
  }, [sortedMine, query, projects]);

  const groups = useMemo(() => {
    const base = groupTasks(visible.open, grouping, projects);
    return showDone && visible.done.length
      ? [...base, { key: '__done', title: t('tasks.completed'), tasks: visible.done }]
      : base;
  }, [visible, grouping, projects, showDone]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const subTotal = visible.open.reduce((acc, x) => acc + x.subtasks.length, 0);
    const subDone = visible.open.reduce((acc, x) => acc + x.subtasks.filter((s) => s.done).length, 0);
    return [
      {
        label: t('tasks.statOpen'),
        value: visible.open.length,
        Icon: ListTodo,
        iconCls: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
      },
      {
        label: t('tasks.statOverdue'),
        value: visible.open.filter(isOverdue).length,
        Icon: CircleAlert,
        iconCls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
      },
      {
        label: t('tasks.statDoneToday'),
        value: mine.filter((x) => x.status === 'done' && x.updatedAt.slice(0, 10) === today).length,
        Icon: Check,
        iconCls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      },
      {
        label: t('tasks.statSubtasks'),
        value: subTotal ? `${subDone}/${subTotal}` : '–',
        Icon: ListChecks,
        iconCls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      },
    ];
  }, [visible, mine]);

  const submitNew = () => {
    const title = newTitle.trim();
    if (!title || !defaultProjectId) return;
    const task = addTask({
      title,
      projectId: defaultProjectId,
      assigneeId: currentUserId,
      status: 'todo',
      priority: 'medium',
    });
    setMineOrder([task.id, ...mineOrder.filter((id) => id !== task.id)]);
    setNewTitle('');
  };

  const onDragEnd = (event: DragEndEvent, group: TaskGroup) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = group.tasks.map((x) => x.id);
    const old = mineOrder.filter((id) => !ids.includes(id));
    const newGroup = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    const dragged = String(active.id);
    const overIndex = newGroup.indexOf(String(over.id));
    let next: string[];
    if (overIndex <= 0) {
      next = [dragged, ...old];
    } else {
      const beforeId = newGroup[overIndex - 1];
      const pos = old.indexOf(beforeId);
      next = pos === -1 ? [...old, dragged] : [...old.slice(0, pos + 1), dragged, ...old.slice(pos + 1)];
    }
    setMineOrder(next);
  };

  const groupings: { key: Grouping; label: string }[] = [
    { key: 'project', label: t('tasks.group.project') },
    { key: 'due', label: t('tasks.group.due') },
    { key: 'priority', label: t('tasks.group.priority') },
    { key: 'list', label: t('tasks.group.list') },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4 lg:p-6">
        {/* Hero med hurtig tilføjelse */}
        <div className="hero-panel relative mb-6 overflow-hidden rounded-3xl p-6 lg:p-8">
          <div className="relative">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                  {t('tasks.title')}
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {firstName
                    ? t('tasks.subtitleHello').replace('{name}', firstName).replace('{date}', capitalizedDate)
                    : capitalizedDate}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{t('tasks.heroHint')}</span>
              </div>
            </div>

            {/* Hurtig tilføjelse */}
            <div className="mt-5 flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-zinc-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur transition-colors focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/25 dark:border-white/10 dark:bg-white/[0.05] dark:focus-within:border-indigo-400/60">
                <Plus className="h-5 w-5 shrink-0 text-zinc-400" />
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitNew()}
                  placeholder={t('tasks.addPlaceholder')}
                  className="w-full bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100 dark:placeholder-zinc-500"
                />
              </div>
              <select
                value={defaultProjectId}
                onChange={(e) => setNewProjectId(e.target.value)}
                title={t('tasks.addToTitle')}
                className="shrink-0 cursor-pointer rounded-2xl border border-zinc-200 bg-white/90 px-3 py-3 text-sm text-zinc-700 shadow-sm backdrop-blur transition-colors hover:border-zinc-300 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-200 dark:hover:border-white/20"
              >
                {projects
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <button onClick={submitNew} className="btn-primary shrink-0 rounded-2xl px-4 py-3">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t('tasks.addButton')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Stat-kort */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(({ label, value, Icon, iconCls }) => (
            <div key={label} className="glass-panel card-hover flex items-center gap-3 rounded-2xl p-4">
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

        {/* Værktøjslinje: gruppering + søg + vis færdige */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-zinc-200 bg-white/70 p-1 dark:border-white/10 dark:bg-white/[0.04]">
            {groupings.map((g) => (
              <button
                key={g.key}
                onClick={() => setGrouping(g.key)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                  grouping === g.key
                    ? 'bg-indigo-500 text-white shadow-sm'
                    : 'text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-white/[0.06]',
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-1.5 transition-colors focus-within:border-indigo-400 dark:border-white/10 dark:bg-white/[0.04] sm:max-w-64">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('tasks.search')}
              className="w-full bg-transparent text-xs text-zinc-800 placeholder-zinc-400 outline-none dark:text-zinc-200 dark:placeholder-zinc-500"
            />
          </div>
          <button
            onClick={() => setShowDone((v) => !v)}
            aria-pressed={showDone}
            className={cn(
              'btn-ghost rounded-xl text-xs',
              showDone && 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400',
            )}
          >
            <Check className="h-3.5 w-3.5" />
            {showDone ? t('tasks.hideDone') : t('tasks.showDone')}
            {visible.done.length > 0 && (
              <span className="rounded-full bg-zinc-200/80 px-1.5 text-[10px] tabular-nums text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
                {visible.done.length}
              </span>
            )}
          </button>
        </div>

        {/* Grupper */}
        {groups.every((g) => g.tasks.length === 0) ? (
          <EmptyState
            icon={<ListTodo className="h-6 w-6" />}
            title={query ? t('tasks.emptySearch') : t('tasks.emptyTitle')}
            description={query ? undefined : t('tasks.emptyDesc')}
          />
        ) : (
          <div className="space-y-7">
            {groups
              .filter((g) => g.tasks.length > 0)
              .map((group) => {
                const groupDone = group.tasks.filter((x) => x.status === 'done' || x.status === 'canceled').length;
                return (
                  <section key={group.key} className="animate-fade-in">
                    {group.title && (
                      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        {group.dot && <span className={cn('h-2.5 w-2.5 rounded-sm', group.dot)} />}
                        {group.hex && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.hex }} />}
                        {group.title}
                        <span className="rounded bg-zinc-200/70 px-1.5 py-px text-[10px] tabular-nums text-zinc-500 dark:bg-white/[0.07] dark:text-zinc-400">
                          {group.tasks.length}
                        </span>
                        {groupDone > 0 && (
                          <span className="text-[10px] font-normal normal-case tracking-normal text-emerald-600 dark:text-emerald-400">
                            · {groupDone} {t('tasks.completedLower')}
                          </span>
                        )}
                      </h3>
                    )}
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => onDragEnd(e, group)}>
                      <SortableContext items={group.tasks.map((x) => x.id)} strategy={verticalListSortingStrategy}>
                        <div className="space-y-2">
                          {group.tasks.map((task) => (
                            <SortableTaskRow
                              key={task.id}
                              task={task}
                              project={projects.find((p) => p.id === task.projectId)}
                              showProject={grouping !== 'project'}
                              labels={labels}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  </section>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

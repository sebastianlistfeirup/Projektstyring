import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, Search, Table2 } from 'lucide-react';
import { parseISO } from 'date-fns';
import { useStore } from '../store/useStore';
import { PRIORITY_META, STATUS_META, STATUS_ORDER } from '../lib/constants';
import { cn, formatDateShort, isOverdue, taskRef } from '../lib/utils';
import { Avatar, EmptyState, LabelChip, PriorityBadge, ProgressBar, StatusBadge } from '../components/common';
import { taskProgress } from '../components/table/taskProgress';
import type { Priority, Task, TaskStatus, User } from '../lib/types';

type SortKey = 'title' | 'status' | 'priority' | 'assignee' | 'due' | 'points' | 'progress';
type GroupBy = 'none' | 'status' | 'project' | 'assignee';

interface Group {
  id: string;
  name: string;
  tasks: Task[];
  points: number;
}

function compareTasks(a: Task, b: Task, key: SortKey, users: User[]): number {
  switch (key) {
    case 'title':
      return a.title.localeCompare(b.title, 'da') || a.number - b.number;
    case 'status':
      return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    case 'priority':
      return PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank;
    case 'assignee': {
      const au = users.find((u) => u.id === a.assigneeId);
      const bu = users.find((u) => u.id === b.assigneeId);
      if (!au && !bu) return 0;
      if (!au) return 1;
      if (!bu) return -1;
      return au.name.localeCompare(bu.name, 'da');
    }
    case 'due': {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime();
    }
    case 'points': {
      if (a.estimate == null && b.estimate == null) return 0;
      if (a.estimate == null) return 1;
      if (b.estimate == null) return -1;
      return a.estimate - b.estimate;
    }
    case 'progress':
      return taskProgress(a) - taskProgress(b);
  }
}

function HeaderCell({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey | null;
  dir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th className={cn('px-3 py-2.5 first:pl-4 last:pr-4', className)}>
      <button
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors',
          active ? 'text-indigo-600 dark:text-indigo-300' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200',
        )}
      >
        {label}
        {active &&
          (dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}

function PlainHeaderCell({ label, className }: { label: string; className?: string }) {
  return (
    <th
      className={cn(
        'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 first:pl-4 last:pr-4 dark:text-zinc-400',
        className,
      )}
    >
      {label}
    </th>
  );
}

export default function TableView() {
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const labels = useStore((s) => s.labels);
  const sprints = useStore((s) => s.sprints);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const selectTask = useStore((s) => s.selectTask);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = activeProjectId ? tasks.filter((t) => t.projectId === activeProjectId) : [...tasks];
    if (q) {
      list = list.filter((t) => {
        const ref = taskRef(t, projects).toLowerCase();
        return t.title.toLowerCase().includes(q) || ref.includes(q) || String(t.number) === q;
      });
    }
    if (statusFilter !== 'all') list = list.filter((t) => t.status === statusFilter);
    if (priorityFilter !== 'all') list = list.filter((t) => t.priority === priorityFilter);
    if (sortKey) {
      const factor = sortDir === 'asc' ? 1 : -1;
      list.sort((a, b) => compareTasks(a, b, sortKey, users) * factor);
    }
    return list;
  }, [tasks, activeProjectId, query, statusFilter, priorityFilter, sortKey, sortDir, projects, users]);

  const groups = useMemo<Group[]>(() => {
    const pointsOf = (list: Task[]) => list.reduce((sum, t) => sum + (t.estimate ?? 0), 0);
    if (groupBy === 'none') {
      return [{ id: 'all', name: '', tasks: filtered, points: pointsOf(filtered) }];
    }
    if (groupBy === 'status') {
      return STATUS_ORDER.map((status) => {
        const list = filtered.filter((t) => t.status === status);
        return { id: status, name: STATUS_META[status].label, tasks: list, points: pointsOf(list) };
      }).filter((g) => g.tasks.length > 0);
    }
    if (groupBy === 'project') {
      return projects
        .map((p) => {
          const list = filtered.filter((t) => t.projectId === p.id);
          return { id: p.id, name: p.name, tasks: list, points: pointsOf(list) };
        })
        .filter((g) => g.tasks.length > 0);
    }
    const byUser = new Map<string, Task[]>();
    for (const t of filtered) {
      const key = t.assigneeId ?? 'none';
      byUser.set(key, [...(byUser.get(key) ?? []), t]);
    }
    return [...byUser.entries()]
      .map(([id, list]): Group => {
        const user = users.find((u) => u.id === id);
        return { id, name: user?.name ?? 'Ikke tildelt', tasks: list, points: pointsOf(list) };
      })
      .sort((a, b) => {
        if (a.id === 'none') return 1;
        if (b.id === 'none') return -1;
        return a.name.localeCompare(b.name, 'da');
      });
  }, [filtered, groupBy, projects, users]);

  const renderRow = (task: Task) => {
    const project = projects.find((p) => p.id === task.projectId);
    const assignee = users.find((u) => u.id === task.assigneeId);
    const sprint = sprints.find((sp) => sp.id === task.sprintId);
    const taskLabels = task.labelIds
      .map((id) => labels.find((l) => l.id === id))
      .filter((l): l is NonNullable<typeof l> => Boolean(l));
    const overdue = isOverdue(task);
    const progress = taskProgress(task);
    return (
      <tr
        key={task.id}
        onClick={() => selectTask(task.id)}
        className="cursor-pointer border-b border-zinc-200/70 transition-colors last:border-0 hover:bg-zinc-50 dark:border-white/[0.05] dark:hover:bg-white/[0.03]"
      >
        <td className="px-3 py-2.5 first:pl-4 last:pr-4">
          <div className="flex items-center gap-2.5">
            <span className={cn('h-2 w-2 shrink-0 rounded-sm', project ? `bg-${project.color}-500` : 'bg-zinc-400')} />
            <span className="min-w-0">
              <span className="block text-[11px] font-bold tabular-nums text-zinc-500 dark:text-zinc-400">
                {taskRef(task, projects)}
              </span>
              <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                {task.title}
              </span>
            </span>
          </div>
        </td>
        <td className="px-3 py-2.5 first:pl-4 last:pr-4">
          <StatusBadge status={task.status} />
        </td>
        <td className="px-3 py-2.5 first:pl-4 last:pr-4">
          <span className="md:hidden">
            <PriorityBadge priority={task.priority} showLabel={false} />
          </span>
          <span className="hidden md:inline">
            <PriorityBadge priority={task.priority} />
          </span>
        </td>
        <td className="px-3 py-2.5 first:pl-4 last:pr-4">
          <div className="flex items-center gap-2">
            <Avatar user={assignee} size="sm" />
            <span className="hidden max-w-[7rem] truncate text-sm text-zinc-600 dark:text-zinc-300 md:inline">
              {assignee?.name ?? 'Ikke tildelt'}
            </span>
          </div>
        </td>
        <td className="hidden px-3 py-2.5 first:pl-4 last:pr-4 xl:table-cell">
          <div className="flex flex-wrap gap-1">
            {taskLabels.slice(0, 2).map((l) => (
              <LabelChip key={l.id} name={l.name} color={l.color} />
            ))}
            {taskLabels.length > 2 && (
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                +{taskLabels.length - 2}
              </span>
            )}
          </div>
        </td>
        <td className="hidden px-3 py-2.5 text-sm text-zinc-600 dark:text-zinc-300 lg:table-cell">
          {sprint?.name ?? <span className="text-zinc-400 dark:text-zinc-600">—</span>}
        </td>
        <td className="hidden px-3 py-2.5 text-sm tabular-nums text-zinc-600 dark:text-zinc-300 md:table-cell">
          {task.startDate ? formatDateShort(task.startDate) : '—'}
        </td>
        <td className="px-3 py-2.5 first:pl-4 last:pr-4">
          {task.dueDate ? (
            <span className="flex flex-col gap-0.5">
              <span
                className={cn(
                  'text-sm tabular-nums',
                  overdue ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-zinc-600 dark:text-zinc-300',
                )}
              >
                {formatDateShort(task.dueDate)}
              </span>
              {overdue && (
                <span className="w-fit rounded bg-rose-500/10 px-1 py-px text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                  Overskredet
                </span>
              )}
            </span>
          ) : (
            <span className="text-zinc-400 dark:text-zinc-600">—</span>
          )}
        </td>
        <td className="hidden px-3 py-2.5 text-sm tabular-nums text-zinc-600 dark:text-zinc-300 sm:table-cell">
          {task.estimate ?? '—'}
        </td>
        <td className="px-3 py-2.5 first:pl-4 last:pr-4">
          <div className="flex items-center gap-2">
            <ProgressBar value={progress} className="w-20" />
            <span className="w-9 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{progress}%</span>
          </div>
        </td>
      </tr>
    );
  };

  const showGroupHeaders = groupBy !== 'none';

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-4 lg:p-6">
        {/* Filter-bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Søg efter titel eller reference …"
              className="input w-64 py-1.5 pl-9 text-sm"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | TaskStatus)}
            className="input w-auto cursor-pointer py-1.5 pr-8 text-sm"
            title="Filtrér efter status"
          >
            <option value="all">Alle statusser</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as 'all' | Priority)}
            className="input w-auto cursor-pointer py-1.5 pr-8 text-sm"
            title="Filtrér efter prioritet"
          >
            <option value="all">Alle prioriteter</option>
            {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_META[p].label}
              </option>
            ))}
          </select>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            className="input w-auto cursor-pointer py-1.5 pr-8 text-sm"
            title="Gruppér opgaver"
          >
            <option value="none">Gruppér: Ingen</option>
            <option value="status">Gruppér: Pr. status</option>
            <option value="project">Gruppér: Pr. projekt</option>
            <option value="assignee">Gruppér: Pr. ansvarlig</option>
          </select>
          <span className="ml-auto text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
            {filtered.length} {filtered.length === 1 ? 'opgave' : 'opgaver'}
          </span>
        </div>

        {/* Tabel */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Table2 className="h-6 w-6" />}
            title="Ingen opgaver matcher filtrene"
            description="Prøv at justere søgningen eller ryd filtrene for at se flere opgaver."
          />
        ) : (
          <div className="glass-panel rounded-xl">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-spacing-0 text-left">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-zinc-200/80 bg-white/95 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[#1e1f24]/95">
                    <HeaderCell label="Opgave" sortKey="title" activeKey={sortKey} dir={sortDir} onSort={onSort} />
                    <HeaderCell label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={onSort} />
                    <HeaderCell label="Prioritet" sortKey="priority" activeKey={sortKey} dir={sortDir} onSort={onSort} />
                    <HeaderCell label="Ansvarlig" sortKey="assignee" activeKey={sortKey} dir={sortDir} onSort={onSort} />
                    <PlainHeaderCell label="Etiketter" className="hidden xl:table-cell" />
                    <PlainHeaderCell label="Sprint" className="hidden lg:table-cell" />
                    <PlainHeaderCell label="Start" className="hidden md:table-cell" />
                    <HeaderCell label="Frist" sortKey="due" activeKey={sortKey} dir={sortDir} onSort={onSort} />
                    <HeaderCell label="Points" sortKey="points" activeKey={sortKey} dir={sortDir} onSort={onSort} className="hidden sm:table-cell" />
                    <HeaderCell label="Fremdrift" sortKey="progress" activeKey={sortKey} dir={sortDir} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <GroupRows key={group.id} group={group} showHeader={showGroupHeaders} renderRow={renderRow} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupRows({
  group,
  showHeader,
  renderRow,
}: {
  group: Group;
  showHeader: boolean;
  renderRow: (task: Task) => ReactNode;
}) {
  return (
    <>
      {showHeader && (
        <tr className="border-b border-zinc-200/70 bg-zinc-50/80 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <td colSpan={10} className="px-4 py-2">
            <span className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                {group.name}
              </span>
              <span className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
                {group.tasks.length} {group.tasks.length === 1 ? 'opgave' : 'opgaver'}
              </span>
              <span className="rounded bg-zinc-200/70 px-1.5 py-px text-[10px] font-semibold tabular-nums text-zinc-500 dark:bg-white/[0.07] dark:text-zinc-400">
                {group.points} pts
              </span>
            </span>
          </td>
        </tr>
      )}
      {group.tasks.map(renderRow)}
    </>
  );
}

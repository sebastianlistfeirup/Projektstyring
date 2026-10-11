import { useMemo, useState } from 'react';
import { isToday, isYesterday, parseISO } from 'date-fns';
import {
  Activity,
  ArrowRightCircle,
  Check,
  Dot,
  FilePlus,
  ListChecks,
  MessageSquare,
  Play,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn, formatDate, timeAgo } from '../lib/utils';
import { Avatar, EmptyState } from '../components/common';
import type { ActivityEntry } from '../lib/types';

type Filter = 'all' | 'comments' | 'moves' | 'created' | 'sprints';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Alle' },
  { id: 'comments', label: 'Kommentarer' },
  { id: 'moves', label: 'Flytninger' },
  { id: 'created', label: 'Opprettelser' },
  { id: 'sprints', label: 'Sprints' },
];

function matchesFilter(entry: ActivityEntry, filter: Filter): boolean {
  const action = entry.action;
  switch (filter) {
    case 'all':
      return true;
    case 'comments':
      return action.startsWith('kommenterede');
    case 'moves':
      return (
        action.startsWith('flyttede') ||
        action.startsWith('planlagde i') ||
        action.startsWith('fjernede fra sprint')
      );
    case 'created':
      return action.startsWith('oprettede');
    case 'sprints':
      return action.includes('sprint');
  }
}

function iconFor(action: string): { Icon: LucideIcon; cls: string } {
  if (action.startsWith('kommenterede')) {
    return { Icon: MessageSquare, cls: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' };
  }
  if (action.includes('sprint')) {
    return { Icon: ListChecks, cls: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' };
  }
  if (action.startsWith('flyttede') || action.startsWith('planlagde') || action.startsWith('fjernede')) {
    return { Icon: ArrowRightCircle, cls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' };
  }
  if (action.startsWith('oprettede')) {
    return { Icon: FilePlus, cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' };
  }
  if (action.startsWith('påbegyndte')) {
    return { Icon: Play, cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' };
  }
  if (action.startsWith('afsluttede')) {
    return { Icon: Check, cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' };
  }
  if (action.startsWith('slettede')) {
    return { Icon: Trash2, cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' };
  }
  if (action.startsWith('tildelte')) {
    return { Icon: UserPlus, cls: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' };
  }
  return { Icon: Dot, cls: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400' };
}

interface DayGroup {
  label: string;
  entries: ActivityEntry[];
}

export default function ActivityView() {
  const activity = useStore((s) => s.activity);
  const tasks = useStore((s) => s.tasks);
  const users = useStore((s) => s.users);
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const selectTask = useStore((s) => s.selectTask);

  const [filter, setFilter] = useState<Filter>('all');

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const groups = useMemo<DayGroup[]>(() => {
    const list = activity.filter(
      (e) =>
        matchesFilter(e, filter) && (activeProjectId === null || e.projectId === activeProjectId),
    );
    const result: DayGroup[] = [];
    for (const entry of list) {
      const date = parseISO(entry.timestamp);
      const label = isToday(date) ? 'I dag' : isYesterday(date) ? 'I går' : formatDate(entry.timestamp);
      const last = result[result.length - 1];
      if (last && last.label === label) {
        last.entries.push(entry);
      } else {
        result.push({ label, entries: [entry] });
      }
    }
    return result;
  }, [activity, filter, activeProjectId]);

  const openEntry = (entry: ActivityEntry) => {
    if (!entry.taskId) return;
    const task = tasks.find((t) => t.id === entry.taskId);
    if (!task) return;
    setActiveProject(task.projectId);
    selectTask(task.id);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-4 lg:p-6">
        {/* Filtre */}
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                filter === f.id
                  ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                  : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-white/10 dark:text-zinc-300 dark:hover:border-white/20',
              )}
            >
              {f.label}
            </button>
          ))}
          {activeProject && (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] text-zinc-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-400">
              <ListChecks className="h-3 w-3" />
              Viser kun aktivitet for {activeProject.name}
            </span>
          )}
        </div>

        {groups.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-6 w-6" />}
            title="Ingen aktivitet at vise"
            description="Der er ingen hændelser, der matcher de valgte filtre."
          />
        ) : (
          groups.map((group) => (
            <section key={group.label} className="animate-fade-in">
              <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {group.label}
              </h3>
              <div className="glass-panel divide-y divide-zinc-200/70 overflow-hidden rounded-xl dark:divide-white/[0.05]">
                {group.entries.map((entry) => {
                  const user = users.find((u) => u.id === entry.userId);
                  const task = entry.taskId ? tasks.find((t) => t.id === entry.taskId) : undefined;
                  const clickable = !!task;
                  const { Icon, cls } = iconFor(entry.action);
                  return (
                    <div
                      key={entry.id}
                      onClick={() => openEntry(entry)}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3 transition-colors',
                        clickable && 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-white/[0.03]',
                        !clickable && entry.taskId && 'opacity-60',
                      )}
                    >
                      <span className="relative shrink-0">
                        <Avatar user={user} size="sm" />
                        <span
                          className={cn(
                            'absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full border border-white dark:border-[#17181c]',
                            cls,
                          )}
                        >
                          <Icon className="h-2.5 w-2.5" />
                        </span>
                      </span>
                      <p className="min-w-0 flex-1 text-sm leading-6">
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {user?.name ?? 'Ukendt bruger'}
                        </span>{' '}
                        <span className="text-zinc-600 dark:text-zinc-300">{entry.action}</span>
                        {entry.detail && (
                          <>
                            {' '}
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                              {entry.detail}
                            </span>
                          </>
                        )}
                      </p>
                      <span className="shrink-0 pt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {timeAgo(entry.timestamp)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

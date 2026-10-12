import { useMemo } from 'react';
import { format, differenceInDays, parseISO } from 'date-fns';
import { da } from 'date-fns/locale';
import { CalendarDays, CalendarClock, Check, CircleAlert, ListTodo } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useLang, t } from '../lib/i18n';
import { cn, formatDateShort, isOverdue, taskRef, timeAgo } from '../lib/utils';
import { EmptyState, PriorityBadge, ProgressBar, StatusBadge, ViewHeader } from '../components/common';
import { taskProgress } from '../components/table/taskProgress';
import type { Task } from '../lib/types';

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

function TaskRow({ task }: { task: Task }) {
  const projects = useStore((s) => s.projects);
  const selectTask = useStore((s) => s.selectTask);
  const project = projects.find((p) => p.id === task.projectId);
  const info = dueInfo(task);
  const progress = taskProgress(task);

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

export default function MyWorkView() {
  useLang();
  const tasks = useStore((s) => s.tasks);
  const users = useStore((s) => s.users);
  const currentUserId = useStore((s) => s.currentUserId);
  const selectTask = useStore((s) => s.selectTask);

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
              <div className="space-y-2">
                {section.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} />
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
    </div>
  );
}

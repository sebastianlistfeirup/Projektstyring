import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Flame, Play, Sparkles, Square } from 'lucide-react';
import { useStore } from '../store/useStore';
import { aiComplete } from '../lib/companion';
import { useLang, t } from '../lib/i18n';
import { cn, formatDateShort, isOverdue, taskRef, timeAgo } from '../lib/utils';
import { Avatar, EmptyState, PriorityBadge, StatusBadge, ViewHeader } from '../components/common';

function scoreTask(task: (ReturnType<typeof useStore.getState>['tasks'])[number], today: string): number {
  let score = 0;
  if (task.status === 'inprogress') score += 50;
  if (isOverdue(task)) score += 40;
  else if (task.dueDate === today) score += 30;
  else if (task.dueDate && task.dueDate <= today.slice(0, 8) + '99') score += 15;
  if (task.priority === 'urgent') score += 25;
  if (task.priority === 'high') score += 15;
  if (task.priority === 'medium') score += 5;
  return score;
}

function isBlocked(task: ReturnType<typeof useStore.getState>['tasks'][number], tasks: ReturnType<typeof useStore.getState>['tasks']): boolean {
  return (task.blockedBy ?? []).some((id) => {
    const blocker = tasks.find((t) => t.id === id);
    return blocker && blocker.status !== 'done';
  });
}

function TimerChip({ taskId }: { taskId: string }) {
  const timeEntries = useStore((s) => s.timeEntries);
  const startTimer = useStore((s) => s.startTimer);
  const stopTimer = useStore((s) => s.stopTimer);
  const active = timeEntries.find((e) => e.taskId === taskId && e.endedAt === null);
  const [, force] = useState(0);
  useLang();

  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => force((v) => v + 1), 15000);
    return () => window.clearInterval(t);
  }, [active]);

  if (active) {
    const mins = Math.max(1, Math.round((Date.now() - new Date(active.startedAt).getTime()) / 60000));
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          stopTimer();
        }}
        title={t('today.stopTime')}
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
      >
        <Square className="h-3 w-3" />
        {mins >= 60 ? `${Math.floor(mins / 60)}t ${mins % 60}m` : `${mins}m`}
      </button>
    );
  }
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        startTimer(taskId);
      }}
      title={t('today.startTime')}
      className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-indigo-500/10 hover:text-indigo-500 dark:text-zinc-400 dark:hover:text-indigo-300"
    >
      <Play className="h-3 w-3" />
      {t('today.time')}
    </button>
  );
}

export default function TodayView() {
  useLang();
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const currentUserId = useStore((s) => s.currentUserId);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const selectTask = useStore((s) => s.selectTask);
  const timeEntries = useStore((s) => s.timeEntries);

  const [aiPick, setAiPick] = useState<{ title: string; reason: string; taskId: string | null } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const me = users.find((u) => u.id === currentUserId);

  const { queue, blocked } = useMemo(() => {
    const open = tasks.filter(
      (t) => t.assigneeId === currentUserId && t.status !== 'done' && t.status !== 'canceled' && (!activeProjectId || t.projectId === activeProjectId),
    );
    const blockedList = open.filter((t) => isBlocked(t, tasks));
    const free = open
      .filter((t) => !isBlocked(t, tasks))
      .sort((a, b) => scoreTask(b, today) - scoreTask(a, today) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
    return { queue: free, blocked: blockedList };
  }, [tasks, currentUserId, activeProjectId, today]);

  const inProgress = queue.filter((t) => t.status === 'inprogress');
  const urgent = queue.filter((t) => t.status !== 'inprogress' && (isOverdue(t) || t.dueDate === today));
  const next = queue.filter((t) => t.status !== 'inprogress' && !urgent.includes(t)).slice(0, 8);
  const activeTimer = timeEntries.find((e) => e.endedAt === null);

  const suggest = async () => {
    setAiBusy(true);
    setAiError(null);
    const candidate = inProgress[0] ?? urgent[0] ?? queue[0];
    if (!candidate) {
      setAiBusy(false);
      return;
    }
    const list = queue.slice(0, 8).map((t) => `- ${t.title} (status: ${t.status}, prioritet: ${t.priority}, frist: ${t.dueDate ?? 'ingen'})`).join('\n');
    const r = await aiComplete([
      {
        role: 'system',
        content:
          'Du er en dansk projektassistent. Vælg DEN opgave fra listen, brugeren bør tage nu, og begrund det kort (maks. 2 sætninger) ud fra status, prioritet og frist. Svar i formatet: TITEL | BEGRUNDELSE',
      },
      { role: 'user', content: `Mine aktuelle opgaver:\n${list}` },
    ]);
    setAiBusy(false);
    if (r.ok && r.content) {
      const [title = candidate.title, reason = ''] = r.content.split('|').map((s) => s.trim());
      const match = queue.find((t) => title.toLowerCase().includes(t.title.toLowerCase().slice(0, 25)) || t.title.toLowerCase().includes(title.toLowerCase().slice(0, 25)));
      setAiPick({ title: match?.title ?? title, reason, taskId: match?.id ?? candidate.id });
    } else {
      setAiPick({ title: candidate.title, reason: 'Top-scoret ud fra prioritet og frist (AI ikke konfigureret).', taskId: candidate.id });
      if (r.reason && !/konfigurer/i.test(r.reason)) setAiError(r.reason);
    }
  };

  const renderRow = (task: (typeof queue)[number]) => {
    const project = projects.find((p) => p.id === task.projectId);
    const overdue = isOverdue(task);
    return (
      <div
        key={task.id}
        className="glass-panel card-hover flex items-center gap-3 rounded-xl px-4 py-3"
      >
        <span className="shrink-0 text-xs font-bold tabular-nums text-zinc-500 dark:text-zinc-400">{taskRef(task, projects)}</span>
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
        {task.dueDate && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] tabular-nums',
              overdue
                ? 'border-rose-500/30 bg-rose-500/10 font-medium text-rose-600 dark:text-rose-400'
                : 'border-zinc-200 text-zinc-600 dark:border-white/10 dark:text-zinc-300',
            )}
          >
            <CalendarClock className="h-3 w-3" />
            {formatDateShort(task.dueDate)}
            {overdue && ` · ${t('today.overdue')}`}
          </span>
        )}
        <TimerChip taskId={task.id} />
        <Avatar user={users.find((u) => u.id === task.assigneeId)} size="xs" className="hidden sm:grid" />
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-4 lg:p-6">
        <ViewHeader
          title={t('today.title')}
          subtitle={me?.name ? t('today.subtitleHello').replace('{name}', me.name.split(' ')[0]) : t('today.subtitlePlain')}
        />

        {/* AI-forslag */}
        <section className="glass-panel animate-fade-in rounded-xl p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t('today.aiTitle')}</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {activeTimer
                  ? t('today.aiSubTimer').replace('{ago}', timeAgo(activeTimer.startedAt))
                  : t('today.aiSubIdle')}
              </p>
            </div>
            <button onClick={() => void suggest()} disabled={aiBusy || queue.length === 0} className="btn-primary">
              <Sparkles className="h-4 w-4" />
              {aiBusy ? t('today.analyzing') : t('today.suggest')}
            </button>
          </div>
          {aiPick && (
            <div className="mt-4 animate-slide-up rounded-xl border border-indigo-500/30 bg-indigo-500/[0.06] p-4">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{aiPick.title}</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{aiPick.reason}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {aiPick.taskId && (
                  <>
                    <button onClick={() => selectTask(aiPick.taskId)} className="btn-primary py-1 text-xs">
                      {t('today.openTask')}
                    </button>
                    <TimerChip taskId={aiPick.taskId} />
                  </>
                )}
              </div>
            </div>
          )}
          {aiError && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{aiError}</p>}
        </section>

        {queue.length === 0 && blocked.length === 0 ? (
          <EmptyState
            icon={<Flame className="h-6 w-6" />}
            title={t('today.emptyTitle')}
            description={t('today.emptyDesc')}
          />
        ) : (
          <>
            {inProgress.length > 0 && (
              <section className="animate-fade-in">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  {t('today.inProgress')}
                  <span className="ml-2 rounded bg-indigo-500/10 px-1.5 py-px text-[10px] tabular-nums">{inProgress.length}</span>
                </h3>
                <div className="space-y-2">{inProgress.map(renderRow)}</div>
              </section>
            )}
            {urgent.length > 0 && (
              <section className="animate-fade-in">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                  {t('today.urgent')}
                  <span className="rounded bg-rose-500/10 px-1.5 py-px text-[10px] tabular-nums">{urgent.length}</span>
                </h3>
                <div className="space-y-2">{urgent.map(renderRow)}</div>
              </section>
            )}
            {next.length > 0 && (
              <section className="animate-fade-in">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  {t('today.next')}
                  <span className="ml-2 rounded bg-zinc-500/10 px-1.5 py-px text-[10px] tabular-nums">{next.length}</span>
                </h3>
                <div className="space-y-2">{next.map(renderRow)}</div>
              </section>
            )}
            {blocked.length > 0 && (
              <section className="animate-fade-in">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  {t('today.blocked')}
                  <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-px text-[10px] tabular-nums">{blocked.length}</span>
                </h3>
                <div className="space-y-2">{blocked.map(renderRow)}</div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

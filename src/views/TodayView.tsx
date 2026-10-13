import { useEffect, useMemo, useState } from 'react';
import { addDays, format } from 'date-fns';
import { da } from 'date-fns/locale';
import { CalendarClock, Flame, Pin, Play, Radar, Send, Sparkles, Square, Sunset } from 'lucide-react';
import { useStore } from '../store/useStore';
import { aiComplete, companionTeams } from '../lib/companion';
import { deadlineRisks } from '../lib/radar';
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

function NovaAvatar() {
  return (
    <div className="relative h-11 w-11 shrink-0" title="Nova – din daglige assistent">
      <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 shadow-glow">
        <span className="absolute left-[13px] top-[15px] h-1.5 w-1.5 rounded-full bg-white" />
        <span className="absolute right-[13px] top-[15px] h-1.5 w-1.5 rounded-full bg-white" />
        <span className="absolute bottom-[10px] left-1/2 h-2.5 w-4 -translate-x-1/2 rounded-b-full border-b-[2.5px] border-white" />
      </div>
      <span
        aria-hidden
        className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-white text-[9px] leading-none text-indigo-600 shadow"
      >
        ✦
      </span>
    </div>
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
  const novaLog = useStore((s) => s.novaLog);
  const answerNova = useStore((s) => s.answerNova);
  const updateTask = useStore((s) => s.updateTask);
  const togglePinDay = useStore((s) => s.togglePinDay);

  const [aiPick, setAiPick] = useState<{ title: string; reason: string; taskId: string | null } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [novaDraft, setNovaDraft] = useState('');
  const [closeDayOpen, setCloseDayOpen] = useState(false);
  const [teamsBusy, setTeamsBusy] = useState(false);
  const [teamsFeedback, setTeamsFeedback] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

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

  // Daglig Orbit: hilsen, dagens spørgsmål, frist-radar og luk-dagen
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'God morgen' : 'God dag';
  const firstName = me?.name.split(' ')[0] ?? '';
  const dateRaw = format(new Date(), 'EEEE d. MMMM', { locale: da });
  const dateLabel = dateRaw.charAt(0).toUpperCase() + dateRaw.slice(1);
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
  const novaToday = novaLog[0]?.date === today ? novaLog[0] : null;
  const dueTodayCount = queue.filter((t) => t.dueDate === today).length;
  const overdueCount = queue.filter((t) => isOverdue(t)).length;

  const projectTasks = useMemo(
    () => tasks.filter((t) => !activeProjectId || t.projectId === activeProjectId),
    [tasks, activeProjectId],
  );
  const radarRisks = useMemo(() => deadlineRisks(projectTasks), [projectTasks]);

  const doneToday = projectTasks.filter((t) => t.status === 'done' && t.updatedAt.slice(0, 10) === today);
  const rollover = projectTasks.filter(
    (t) => t.status !== 'done' && t.status !== 'canceled' && t.dueDate !== null && t.dueDate <= today,
  );
  const tomorrowTop = queue.slice(0, 3);

  const saveNova = () => {
    if (!novaDraft.trim()) return;
    answerNova('Hvad er dagens vigtigste?', novaDraft.trim());
    setNovaDraft('');
  };

  const sendDaySummary = async () => {
    setTeamsBusy(true);
    setTeamsFeedback(null);
    const lines = [
      `Orbit – dagen sluttet (${dateLabel})`,
      '',
      `Afsluttet i dag (${doneToday.length}):`,
      ...(doneToday.length > 0
        ? doneToday.map((task) => `• ${taskRef(task, projects)} ${task.title}`)
        : ['• Ingen']),
      '',
      `Ruller over (${rollover.length}):`,
      ...(rollover.length > 0
        ? rollover.map((task) => `• ${taskRef(task, projects)} ${task.title} (frist ${formatDateShort(task.dueDate)})`)
        : ['• Ingen']),
      '',
      'Morgendagens fokus:',
      ...(tomorrowTop.length > 0
        ? tomorrowTop.map((task, i) => `${i + 1}. ${taskRef(task, projects)} ${task.title}`)
        : ['Ingen opgaver i køen.']),
    ];
    const r = await companionTeams('Orbit – dagen sluttet', lines.join('\n'));
    setTeamsBusy(false);
    setTeamsFeedback(
      r.ok
        ? { text: 'Opsummeringen er sendt til Teams.', tone: 'ok' }
        : { text: r.reason ?? 'Opsummeringen kunne ikke sendes til Teams.', tone: 'error' },
    );
  };

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
          actions={
            <button
              onClick={() => setCloseDayOpen((v) => !v)}
              aria-pressed={closeDayOpen}
              className={cn(
                'btn-outline',
                closeDayOpen && 'border-indigo-400 text-indigo-600 dark:border-indigo-500/60 dark:text-indigo-300',
              )}
            >
              <Sunset className="h-4 w-4" />
              Luk dagen
            </button>
          }
        />

        {/* Luk dagen */}
        {closeDayOpen && (
          <section className="glass-panel animate-slide-up rounded-2xl p-5">
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Luk dagen</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{dateLabel} – gør status og gør klar til i morgen.</p>
              </div>
              <span className="flex-1" />
              <button onClick={() => setCloseDayOpen(false)} className="btn-ghost px-2 py-1 text-xs">
                Luk
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {/* Afsluttet i dag */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  I dag afsluttet · {doneToday.length}
                </h3>
                {doneToday.length === 0 ? (
                  <p className="text-sm text-zinc-400">Ingen opgaver afsluttet endnu.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {doneToday.map((task) => (
                      <li key={task.id}>
                        <button
                          onClick={() => selectTask(task.id)}
                          title={task.title}
                          className="flex w-full items-center gap-2 text-left text-sm text-zinc-700 transition-colors hover:text-indigo-600 dark:text-zinc-200 dark:hover:text-indigo-300"
                        >
                          <span className="shrink-0 font-mono text-[11px] font-semibold text-zinc-400 dark:text-zinc-500">
                            {taskRef(task, projects)}
                          </span>
                          <span className="truncate">{task.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Ruller over */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Ruller over · {rollover.length}
                </h3>
                {rollover.length === 0 ? (
                  <p className="text-sm text-zinc-400">Ingen åbne frister i dag.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {rollover.map((task) => (
                      <li key={task.id} className="flex items-center gap-2">
                        <button
                          onClick={() => selectTask(task.id)}
                          title={task.title}
                          className="min-w-0 flex-1 truncate text-left text-sm text-zinc-700 transition-colors hover:text-indigo-600 dark:text-zinc-200 dark:hover:text-indigo-300"
                        >
                          <span className="mr-1 font-mono text-[11px] font-semibold text-zinc-400 dark:text-zinc-500">
                            {taskRef(task, projects)}
                          </span>
                          {task.title}
                        </button>
                        <button
                          onClick={() => updateTask(task.id, { dueDate: tomorrow }, 'flyttede til i morgen')}
                          className="btn-outline shrink-0 px-2 py-0.5 text-[11px]"
                        >
                          Flyt til i morgen
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Morgendagens tre */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Morgendagens tre
                </h3>
                {tomorrowTop.length === 0 ? (
                  <p className="text-sm text-zinc-400">Ingen opgaver i køen.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {tomorrowTop.map((task) => {
                      const pinned = task.pinnedDay === today;
                      return (
                        <li key={task.id} className="flex items-center gap-2">
                          <button
                            onClick={() => selectTask(task.id)}
                            title={task.title}
                            className="min-w-0 flex-1 truncate text-left text-sm text-zinc-700 transition-colors hover:text-indigo-600 dark:text-zinc-200 dark:hover:text-indigo-300"
                          >
                            <span className="mr-1 font-mono text-[11px] font-semibold text-zinc-400 dark:text-zinc-500">
                              {taskRef(task, projects)}
                            </span>
                            {task.title}
                          </button>
                          <button
                            onClick={() => togglePinDay(task.id)}
                            title="Fastgør til Min dag"
                            className={cn(
                              'flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
                              pinned
                                ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
                                : 'border-zinc-200 text-zinc-500 hover:bg-zinc-500/10 dark:border-white/10 dark:text-zinc-400',
                            )}
                          >
                            <Pin className="h-3 w-3" fill={pinned ? 'currentColor' : 'none'} />
                            {pinned ? 'Fastgjort' : 'Fastgør'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-200/70 pt-3 dark:border-white/[0.06]">
              <button onClick={() => void sendDaySummary()} disabled={teamsBusy} className="btn-primary py-1.5 text-xs">
                <Send className="h-3.5 w-3.5" />
                {teamsBusy ? 'Sender …' : 'Send opsummering til Teams'}
              </button>
              {teamsFeedback && (
                <p
                  className={cn(
                    'text-xs font-medium',
                    teamsFeedback.tone === 'ok'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400',
                  )}
                >
                  {teamsFeedback.text}
                </p>
              )}
            </div>
          </section>
        )}

        {/* Nova – daglig assistent */}
        <section className="glass-panel animate-fade-in rounded-2xl p-5">
          <div className="flex items-start gap-3.5">
            <NovaAvatar />
            <div className="min-w-0 flex-1">
              <div className="rounded-2xl rounded-tl-md border border-indigo-500/20 bg-indigo-500/[0.06] p-4 dark:bg-indigo-400/[0.06]">
                <p className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-100">
                  {greeting} {firstName} — {dateLabel}. Du har {dueTodayCount}{' '}
                  {dueTodayCount === 1 ? 'opgave' : 'opgaver'} i dag, {overdueCount} overskredne.
                </p>
                {activeTimer && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {t('today.aiSubTimer').replace('{ago}', timeAgo(activeTimer.startedAt))}
                  </p>
                )}
                {!novaToday && (
                  <div className="mt-3 border-t border-indigo-500/10 pt-3 dark:border-white/[0.06]">
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                      Nova spørger: Hvad er dagens vigtigste?
                    </p>
                    <div className="mt-1.5 flex gap-2">
                      <input
                        value={novaDraft}
                        onChange={(e) => setNovaDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveNova();
                        }}
                        placeholder="Fx 'færdiggøre tilbuddet til kunden' …"
                        className="input flex-1 py-1.5 text-sm"
                      />
                      <button onClick={saveNova} disabled={!novaDraft.trim()} className="btn-primary px-3 py-1.5 text-xs">
                        Gem
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {aiPick && (
                <div className="mt-3 animate-slide-up rounded-2xl rounded-tl-md border border-indigo-500/30 bg-indigo-500/[0.08] p-4">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{aiPick.title}</p>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{aiPick.reason}</p>
                </div>
              )}
              {aiError && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{aiError}</p>}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={() => void suggest()} disabled={aiBusy || queue.length === 0} className="btn-primary">
                  <Sparkles className="h-4 w-4" />
                  {aiBusy ? 'Analyserer …' : 'Foreslå rækkefølge'}
                </button>
                {aiPick?.taskId && (
                  <>
                    <button onClick={() => selectTask(aiPick.taskId)} className="btn-outline py-1 text-xs">
                      {t('today.openTask')}
                    </button>
                    <TimerChip taskId={aiPick.taskId} />
                  </>
                )}
              </div>
            </div>
          </div>
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
            {/* Frist-radar */}
            {radarRisks.length > 0 && (
              <section className="animate-fade-in rounded-xl border border-amber-500/40 bg-amber-500/[0.05] p-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    <Radar className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">Frist-radar</h3>
                    <p className="text-xs text-amber-700/80 dark:text-amber-200/70">
                      {radarRisks.length} {radarRisks.length === 1 ? 'opgave når' : 'opgaver når'} ikke fristen med
                      jeres nuværende hastighed ({radarRisks[0].pointsPerDay} points/dag)
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {radarRisks.map((risk) => {
                    const task = projectTasks.find((t) => t.id === risk.taskId);
                    if (!task) return null;
                    return (
                      <div
                        key={risk.taskId}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-white/70 px-3 py-2 dark:bg-white/[0.04]"
                      >
                        <button
                          onClick={() => selectTask(task.id)}
                          title={task.title}
                          className="min-w-0 flex-1 truncate text-left text-sm font-medium text-zinc-800 transition-colors hover:text-amber-700 dark:text-zinc-100 dark:hover:text-amber-300"
                        >
                          <span className="mr-1.5 font-mono text-xs font-semibold text-zinc-400 dark:text-zinc-500">
                            {taskRef(task, projects)}
                          </span>
                          {risk.title}
                        </button>
                        <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                          skal nås på {risk.daysLeft} dage · kræver {risk.neededDays}
                        </span>
                        <span className="flex shrink-0 gap-1.5">
                          <button
                            onClick={() =>
                              updateTask(
                                task.id,
                                { dueDate: format(addDays(new Date(`${risk.dueDate}T12:00:00`), 3), 'yyyy-MM-dd') },
                                'flyttede frist +3 dage',
                              )
                            }
                            className="rounded-md border border-amber-500/40 px-2 py-0.5 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-300"
                          >
                            Flyt +3 dage
                          </button>
                          <button
                            onClick={() => updateTask(task.id, { priority: 'low' }, 'nedprioriterede')}
                            className="rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-500/10 dark:border-white/10 dark:text-zinc-400"
                          >
                            Nedprioritér
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Dagens vigtigste (fastgjort af Nova) */}
            {novaToday && (
              <div className="flex animate-fade-in items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm text-violet-700 dark:text-violet-300">
                <Sparkles className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">
                  <span className="font-semibold">Dagens vigtigste:</span> {novaToday.answer}
                </span>
              </div>
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

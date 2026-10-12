import { useMemo, useState } from 'react';
import { addDays, differenceInCalendarDays, format, isWeekend, parseISO, startOfDay } from 'date-fns';
import { da } from 'date-fns/locale';
import { CalendarRange } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { TaskStatus } from '../lib/types';
import { cn, formatDateShort, taskRef } from '../lib/utils';
import { Avatar, EmptyState, ViewHeader } from '../components/common';

const DAY_W = 36;
const LABEL_W = 256;

const STATUS_HEX: Record<TaskStatus, string> = {
  backlog: '#a1a1aa',
  todo: '#38bdf8',
  inprogress: '#818cf8',
  inreview: '#fbbf24',
  done: '#34d399',
  canceled: '#fb7185',
};

const BAR_TEXT: Record<TaskStatus, string> = {
  backlog: 'text-zinc-800',
  todo: 'text-sky-950',
  inprogress: 'text-white',
  inreview: 'text-amber-950',
  done: 'text-emerald-950',
  canceled: 'text-white',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function TimelineView() {
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const sprints = useStore((s) => s.sprints);
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

  const [today] = useState(() => new Date());

  const rows = useMemo(() => {
    const dated = filtered
      .filter((t) => t.startDate || t.dueDate)
      .map((t) => {
        const end = t.dueDate ? parseISO(t.dueDate) : parseISO(t.startDate!);
        const start = t.startDate ? parseISO(t.startDate) : addDays(end, -3);
        return { task: t, start, end };
      });
    dated.sort(
      (a, b) => a.start.getTime() - b.start.getTime() || taskRef(a.task, projects).localeCompare(taskRef(b.task, projects)),
    );
    return dated;
  }, [filtered, projects]);

  const timeline = useMemo(() => {
    if (rows.length === 0) return { days: [] as Date[], windowStart: startOfDay(today), todayIndex: -1 };
    const minStart = rows.reduce((m, r) => (r.start < m ? r.start : m), rows[0].start);
    const maxEnd = rows.reduce((m, r) => (r.end > m ? r.end : m), rows[0].end);
    const windowStart = addDays(startOfDay(minStart), -2);
    const windowEnd = addDays(startOfDay(maxEnd), 7);
    const days: Date[] = [];
    for (let d = windowStart; d <= windowEnd; d = addDays(d, 1)) days.push(d);
    const todayIndex = differenceInCalendarDays(startOfDay(today), windowStart);
    return { days, windowStart, todayIndex };
  }, [rows, today]);

  if (rows.length === 0) {
    return (
      <div className="h-full overflow-auto">
        <div className="p-4 lg:p-6">
          <ViewHeader title="Tidslinje" subtitle="Se opgaver og sprints spredt ud over tid" />
          <EmptyState
            icon={<CalendarRange className="h-6 w-6" />}
            title="Ingen opgaver med datoer"
            description="Tidslinjen viser opgaver med start- eller slutdato. Tilføj datoer på opgaver for at se dem her."
          />
        </div>
      </div>
    );
  }

  const { days, windowStart, todayIndex } = timeline;
  const totalWidth = days.length * DAY_W;
  const windowEnd = days[days.length - 1];
  const showToday = todayIndex >= 0 && todayIndex < days.length;

  const monthSpans: { key: string; label: string; count: number }[] = [];
  for (const d of days) {
    const key = format(d, 'yyyy-MM');
    const last = monthSpans[monthSpans.length - 1];
    if (last && last.key === key) last.count += 1;
    else monthSpans.push({ key, label: cap(format(d, 'MMMM yyyy', { locale: da })), count: 1 });
  }

  const bands = activeSprints
    .map((sp) => {
      const left = Math.max(0, differenceInCalendarDays(parseISO(sp.startDate), windowStart) * DAY_W);
      const right = Math.min(totalWidth, (differenceInCalendarDays(parseISO(sp.endDate), windowStart) + 1) * DAY_W);
      return { sprint: sp, left, width: right - left };
    })
    .filter((b) => b.width > 0);

  const offsetOf = (d: Date) => differenceInCalendarDays(d, windowStart) * DAY_W;

  return (
    <div className="h-full overflow-auto">
      <div className="p-4 lg:p-6">
        <ViewHeader title="Tidslinje" subtitle="Se opgaver og sprints spredt ud over tid" />
        <div className="w-max min-w-full">
        <div className="sticky top-0 z-30 flex">
          <div className="sticky left-0 top-0 z-40 flex h-full w-64 shrink-0 items-end bg-zinc-100 pb-2 pl-2 dark:bg-[#17181c]">
            <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
              Opgave · {rows.length}
            </span>
          </div>
          <div>
            <div className="flex h-6 items-end">
              {monthSpans.map((m) => (
                <div
                  key={m.key}
                  className="overflow-hidden whitespace-nowrap text-[11px] font-semibold text-zinc-500 dark:text-zinc-400"
                  style={{ width: m.count * DAY_W }}
                >
                  {m.label}
                </div>
              ))}
            </div>
            <div className="flex h-9 border-b border-zinc-300/70 dark:border-white/[0.08]">
              {days.map((d, i) => {
                const weekend = isWeekend(d);
                const isToday = i === todayIndex;
                return (
                  <div
                    key={i}
                    title={cap(format(d, 'EEEE d. MMMM', { locale: da }))}
                    className={cn('flex w-9 items-center justify-center', weekend && 'bg-zinc-500/5 dark:bg-white/[0.02]')}
                  >
                    <span
                      className={cn(
                        'text-[11px] tabular-nums',
                        isToday
                          ? 'font-bold text-indigo-500 dark:text-indigo-400'
                          : weekend
                            ? 'text-zinc-500 dark:text-zinc-500'
                            : 'text-zinc-600 dark:text-zinc-300',
                      )}
                    >
                      {format(d, 'd')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="relative">
          <div
            className="pointer-events-none absolute bottom-0 left-64 top-0 z-10 flex"
            style={{ width: totalWidth }}
          >
            {days.map((d, i) => (
              <div
                key={i}
                className={cn(
                  'h-full w-9 border-l border-zinc-500/10 dark:border-white/[0.06]',
                  isWeekend(d) && 'bg-zinc-500/5 dark:bg-white/[0.02]',
                )}
              />
            ))}
          </div>

          {showToday && (
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]"
              style={{ left: LABEL_W + todayIndex * DAY_W }}
            >
              <span className="absolute left-1 top-0 rounded-b-md bg-indigo-400 px-1.5 py-0.5 text-[9px] font-bold text-white">
                I dag
              </span>
            </div>
          )}

          {bands.map((band, i) => (
            <div key={band.sprint.id} className="relative flex h-8 border-b border-zinc-200/70 dark:border-white/[0.05]">
              <div className="sticky left-0 z-20 flex w-64 shrink-0 items-center bg-zinc-100 pl-2 dark:bg-[#17181c]">
                {i === 0 && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Aktive sprints
                  </span>
                )}
              </div>
              <div className="relative" style={{ width: totalWidth }}>
                <div
                  title={`${band.sprint.name} · ${formatDateShort(band.sprint.startDate)} – ${formatDateShort(band.sprint.endDate)}`}
                  className="absolute inset-y-1 flex items-center overflow-hidden rounded bg-indigo-500/[0.07] ring-1 ring-inset ring-indigo-500/15 dark:bg-indigo-400/[0.08] dark:ring-indigo-400/20"
                  style={{ left: band.left, width: band.width }}
                >
                  <span className="truncate px-1.5 text-[10px] font-medium text-indigo-600/90 dark:text-indigo-300/90">
                    {band.sprint.name}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {rows.map(({ task, start, end }) => {
            const clampedStart = start < windowStart ? windowStart : start;
            const clampedEnd = end > windowEnd ? windowEnd : end;
            const left = offsetOf(clampedStart);
            const width = Math.max(10, (differenceInCalendarDays(clampedEnd, clampedStart) + 1) * DAY_W - 3);
            const done = task.status === 'done';
            return (
              <div key={task.id} className="relative flex h-11 border-b border-zinc-200/70 dark:border-white/[0.05]">
                <div className="sticky left-0 z-20 flex w-64 shrink-0 items-center gap-2 bg-zinc-100 px-2 dark:bg-[#17181c]">
                  <button
                    onClick={() => selectTask(task.id)}
                    title={task.title}
                    className="group flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="w-14 shrink-0 truncate text-[11px] font-semibold tabular-nums text-zinc-400 dark:text-zinc-500">
                      {taskRef(task, projects)}
                    </span>
                    <span className="truncate text-[13px] text-zinc-700 transition-colors group-hover:text-indigo-600 dark:text-zinc-200 dark:group-hover:text-indigo-300">
                      {task.title}
                    </span>
                  </button>
                  <Avatar user={users.find((u) => u.id === task.assigneeId)} size="xs" className="shrink-0" />
                </div>
                <div className="relative" style={{ width: totalWidth }}>
                  <div
                    title={`${taskRef(task, projects)} · ${task.title} · ${formatDateShort(clampedStart)} – ${formatDateShort(clampedEnd)}`}
                    className={cn(
                      'absolute top-1/2 flex h-3 -translate-y-1/2 items-center overflow-hidden rounded-full',
                      BAR_TEXT[task.status],
                      done && 'opacity-60',
                    )}
                    style={{ left, width, backgroundColor: STATUS_HEX[task.status] }}
                  >
                    {width >= 64 && (
                      <span className="truncate px-1.5 text-[10px] font-medium leading-none">{task.title}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
}

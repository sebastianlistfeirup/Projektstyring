import { useMemo } from 'react';
import { format } from 'date-fns';
import { CalendarDays, Gauge, Palmtree, UserCheck, Users } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { Task, User } from '../lib/types';
import { cn, isOverdue } from '../lib/utils';
import { Avatar, ProgressBar, ViewHeader } from '../components/common';

interface MemberLoad {
  user: User;
  open: number;
  points: number;
  inProgress: number;
  overdue: number;
  capacity: number;
  utilization: number;
  onVacation: boolean;
}

function loadColor(pct: number): string {
  if (pct > 100) return 'bg-rose-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

const isOpenTask = (t: Task) => t.status !== 'done' && t.status !== 'canceled';
const pointsOf = (t: Task) => t.estimate ?? 1;

function isOnVacation(u: User, todayStr: string): boolean {
  const until = u.vacationUntil?.slice(0, 10);
  return !!until && until >= todayStr;
}

export default function TeamView() {
  const users = useStore((s) => s.users);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const updateUser = useStore((s) => s.updateUser);

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const loads: MemberLoad[] = useMemo(
    () =>
      users.map((u) => {
        const mine = tasks.filter(
          (t) => (activeProjectId ? t.projectId === activeProjectId : true) && t.assigneeId === u.id && isOpenTask(t),
        );
        const points = mine.reduce((sum, t) => sum + pointsOf(t), 0);
        const capacity = u.capacity ?? 8;
        return {
          user: u,
          open: mine.length,
          points,
          inProgress: mine.filter((t) => t.status === 'inprogress').length,
          overdue: mine.filter(isOverdue).length,
          capacity,
          utilization: capacity > 0 ? Math.round((points / capacity) * 100) : points > 0 ? 100 : 0,
          onVacation: isOnVacation(u, todayStr),
        };
      }),
    [users, tasks, activeProjectId, todayStr],
  );

  const totalPoints = loads.reduce((sum, l) => sum + l.points, 0);
  const totalCapacity = loads.filter((l) => !l.onVacation).reduce((sum, l) => sum + l.capacity, 0);
  const totalPct = totalCapacity > 0 ? Math.round((totalPoints / totalCapacity) * 100) : 0;
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const candidates = loads.filter((l) => !l.onVacation).sort((a, b) => a.utilization - b.utilization).slice(0, 3);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 lg:p-6">
        <ViewHeader title="Team & kapacitet" subtitle="Belastning og kapacitet på tværs af teamet" />

        {/* Overskriftsrække: samlet belastning */}
        <div className="glass-panel animate-fade-in rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <Gauge className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Samlet belastning</h2>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {activeProject ? activeProject.name : 'Alle projekter'} · åbne opgaver
                </p>
              </div>
            </div>
            <div className="flex items-center gap-5">
              <div>
                <p className="text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">{totalPoints}</p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">points tilbage</p>
              </div>
              <span className="text-xl text-zinc-300 dark:text-zinc-600">/</span>
              <div>
                <p className="text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">{totalCapacity}</p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">points pr. uge</p>
              </div>
            </div>
            <div className="min-w-44 flex-1">
              <ProgressBar value={totalPct} />
              <p className="pt-1 text-right text-[11px] font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
                {totalPct}% belastet
              </p>
            </div>
          </div>
        </div>

        {/* Teammedlemmer */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {loads.map((load) => (
            <div key={load.user.id} className="glass-panel card-hover animate-fade-in rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Avatar user={load.user} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">{load.user.name}</p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{load.user.role}</p>
                </div>
                {load.onVacation && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    <Palmtree className="h-3 w-3" />
                    På ferie
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-3">
                <label className="block">
                  <span className="pb-1 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    Kapacitet (points/uge)
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={load.user.capacity ?? 8}
                    onChange={(e) => {
                      const v = e.target.valueAsNumber;
                      updateUser(load.user.id, { capacity: Number.isNaN(v) ? 0 : Math.max(0, v) });
                    }}
                    className="input py-1.5 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="pb-1 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Feriedato</span>
                  <input
                    type="date"
                    value={load.user.vacationUntil ?? ''}
                    onChange={(e) => updateUser(load.user.id, { vacationUntil: e.target.value || null })}
                    className="input py-1.5 text-sm"
                  />
                </label>
              </div>

              <div className="grid grid-cols-4 gap-1.5 pt-3">
                {(
                  [
                    ['Åbne', load.open],
                    ['Points tilbage', load.points],
                    ['I gang', load.inProgress],
                    ['Overskredet', load.overdue],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-zinc-100 px-2 py-1.5 text-center dark:bg-white/[0.04]">
                    <p
                      className={cn(
                        'text-sm font-semibold tabular-nums',
                        label === 'Overskredet' && value > 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-zinc-800 dark:text-zinc-100',
                      )}
                    >
                      {value}
                    </p>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{label}</p>
                  </div>
                ))}
              </div>

              <div className="pt-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-300',
                      load.onVacation ? 'bg-zinc-400 dark:bg-zinc-600' : loadColor(load.utilization),
                    )}
                    style={{ width: `${Math.min(100, load.utilization)}%` }}
                  />
                </div>
                <p className="pt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {load.onVacation ? (
                    'På ferie'
                  ) : (
                    <>
                      <span className="font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
                        {load.utilization}%
                      </span>{' '}
                      belastet · {load.points} points / {load.capacity} points pr. uge
                    </>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Kapacitet til nye opgaver */}
        <section className="glass-panel animate-fade-in rounded-xl p-4">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Hvem har plads til en ny opgave?</h2>
          </div>
          <p className="flex items-center gap-1.5 pt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <CalendarDays className="h-3.5 w-3.5" />
            Sorteret efter laveste belastning – medlemmer på ferie er sprunget over.
          </p>
          <div className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-3">
            {candidates.map((load, i) => (
              <div
                key={load.user.id}
                className="glass-panel card-hover flex items-center gap-3 rounded-xl p-3 animate-slide-up"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span className="w-4 text-center text-xs font-semibold tabular-nums text-zinc-400 dark:text-zinc-500">
                  {i + 1}
                </span>
                <Avatar user={load.user} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{load.user.name}</p>
                  <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{load.user.role}</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                    load.utilization > 100
                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : load.utilization >= 70
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                  )}
                >
                  {load.utilization}% belastet
                </span>
              </div>
            ))}
            {candidates.length === 0 && (
              <p className="col-span-full flex items-center gap-2 py-4 text-sm text-zinc-500 dark:text-zinc-400">
                <Users className="h-4 w-4" />
                Ingen aktive teammedlemmer med kapacitet.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

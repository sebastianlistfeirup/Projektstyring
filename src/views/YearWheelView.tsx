import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { da } from 'date-fns/locale';
import { CalendarDays, CircleDashed, MousePointerClick, TrendingUp } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useLang, t } from '../lib/i18n';
import { cn, formatDateShort } from '../lib/utils';
import type { Project, Task } from '../lib/types';

/* ---------- farvehjælp ---------- */
export const PROJECT_HEX: Record<string, string> = {
  violet: '#8b5cf6',
  sky: '#0ea5e9',
  amber: '#f59e0b',
  emerald: '#10b981',
  rose: '#f43f5e',
  cyan: '#06b6d4',
  indigo: '#6366f1',
  pink: '#ec4899',
  orange: '#f97316',
  teal: '#14b8a6',
  red: '#ef4444',
  slate: '#64748b',
};

const hex = (p?: Project) => (p ? (PROJECT_HEX[p.color] ?? '#818cf8') : '#818cf8');

/* ---------- geometri ---------- */
const CX = 360;
const CY = 360;
const R_OUT = 322;
const R_IN = 96;
const GAP = 2.2;

const polar = (r: number, angleDeg: number): [number, number] => {
  const rad = (angleDeg * Math.PI) / 180;
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
};

const arcPath = (r: number, a0: number, a1: number): string => {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

const sectorPath = (r0: number, r1: number, a0: number, a1: number): string => {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r1.toFixed(2)} ${r1.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(
    2,
  )} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${r0.toFixed(2)} ${r0.toFixed(2)} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
};

/** Vinkel for en dato i året: 0 % = toppen (1. januar, kl. 12) */
const angleOfDate = (iso: string, daysInYear: number): number => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const start = new Date(`${iso.slice(0, 4)}-01-01T12:00:00`);
  const day = Math.max(0, Math.round((d.getTime() - start.getTime()) / 86400000));
  return -90 + (day / daysInYear) * 360;
};

/* ---------- hovedkomponent ---------- */
export default function YearWheelView() {
  useLang();
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const updateTask = useStore((s) => s.updateTask);
  const selectTask = useStore((s) => s.selectTask);

  const now = new Date();
  const year = now.getFullYear();
  const daysInYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
  const monthIndex = now.getMonth();
  const [selectedMonth, setSelectedMonth] = useState<number>(monthIndex);
  const [hoverTask, setHoverTask] = useState<string | null>(null);

  const activeProjects = useMemo(
    () => projects.filter((p) => !p.archived).slice(0, 7),
    [projects],
  );

  const yearTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status !== 'canceled' &&
          !task.projectId.startsWith('__') &&
          (task.startDate?.startsWith(String(year)) || task.dueDate?.startsWith(String(year))),
      ),
    [tasks, year],
  );

  /* opgaver pr. måned (start ELLER frist ligger i måneden) */
  const tasksByMonth = useMemo(() => {
    const buckets: Task[][] = Array.from({ length: 12 }, () => []);
    for (const task of yearTasks) {
      const months = new Set<number>();
      if (task.startDate?.startsWith(String(year))) months.add(parseISO(task.startDate).getMonth());
      if (task.dueDate?.startsWith(String(year))) months.add(parseISO(task.dueDate).getMonth());
      for (const m of months) buckets[m].push(task);
    }
    for (const list of buckets) {
      list.sort((a, b) => (a.dueDate ?? a.startDate ?? '').localeCompare(b.dueDate ?? b.startDate ?? ''));
    }
    return buckets;
  }, [yearTasks, year]);

  const selectedTasks = tasksByMonth[selectedMonth];
  const selectedDone = selectedTasks.filter((x) => x.status === 'done').length;
  const selectedPct = selectedTasks.length ? Math.round((selectedDone / selectedTasks.length) * 100) : 0;

  const yearDone = yearTasks.filter((x) => x.status === 'done').length;
  const yearPct = yearTasks.length ? Math.round((yearDone / yearTasks.length) * 100) : 0;
  const elapsedPct = Math.round(((now.getTime() - new Date(year, 0, 1).getTime()) / (new Date(year + 1, 0, 1).getTime() - new Date(year, 0, 1).getTime())) * 100);

  const monthNames = useMemo(
    () => Array.from({ length: 12 }, (_, m) => format(new Date(year, m, 1), 'MMMM', { locale: da })),
    [year],
  );
  const monthNamesShort = useMemo(
    () => Array.from({ length: 12 }, (_, m) => format(new Date(year, m, 1), 'MMM', { locale: da })),
    [year],
  );

  const todayAngle = angleOfDate(now.toISOString().slice(0, 10), daysInYear);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-4 lg:p-6">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
              {t('wheel.title')} {year}
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('wheel.subtitle')}</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              {t('wheel.yearProgress').replace('{pct}', String(elapsedPct))}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CircleDashed className="h-3.5 w-3.5 text-indigo-500" />
              {t('wheel.tasksTotal').replace('{n}', String(yearTasks.length)).replace('{pct}', String(yearPct))}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Hjulet */}
          <div className="glass-panel relative flex-1 rounded-3xl p-4 lg:p-6">
            <svg viewBox="0 0 720 720" className="mx-auto w-full max-w-[640px] select-none">
              {/* Månedssegmenter */}
              {Array.from({ length: 12 }, (_, m) => {
                const a0 = -90 + m * 30 + GAP / 2;
                const a1 = -90 + (m + 1) * 30 - GAP / 2;
                const isSel = m === selectedMonth;
                const isNow = m === monthIndex;
                return (
                  <path
                    key={m}
                    d={sectorPath(R_IN + 26, R_OUT, a0, a1)}
                    className="cursor-pointer transition-colors"
                    fill={
                      isSel
                        ? 'color-mix(in srgb, var(--acc-500) 14%, transparent)'
                        : isNow
                          ? 'rgba(120,120,130,0.07)'
                          : m % 2 === 0
                            ? 'rgba(120,120,130,0.035)'
                            : 'transparent'
                    }
                    stroke={isSel ? 'var(--acc-500)' : 'transparent'}
                    strokeOpacity={isSel ? 0.5 : 0}
                    strokeWidth={1.5}
                    onClick={() => setSelectedMonth(m)}
                  >
                    <title>{monthNames[m]}</title>
                  </path>
                );
              })}

              {/* Månedstaljer */}
              {Array.from({ length: 12 }, (_, m) => {
                const mid = -90 + m * 30 + 15;
                const [x, y] = polar(R_OUT + 22, mid);
                const anchor = Math.abs(((mid % 360) + 360) % 360 - 180) < 30 ? 'middle' : ((mid % 360) + 360) % 360 < 180 ? 'start' : 'end';
                return (
                  <text
                    key={m}
                    x={x}
                    y={y}
                    textAnchor={anchor}
                    dominantBaseline="middle"
                    className="cursor-pointer fill-zinc-500 text-[13px] font-semibold uppercase tracking-wider dark:fill-zinc-400"
                    onClick={() => setSelectedMonth(m)}
                  >
                    {monthNamesShort[m]}
                  </text>
                );
              })}

              {/* I dag-markør (under buerne, så den ikke støjer) */}
              <line
                x1={polar(R_IN - 2, todayAngle)[0]}
                y1={polar(R_IN - 2, todayAngle)[1]}
                x2={polar(R_OUT + 6, todayAngle)[0]}
                y2={polar(R_OUT + 6, todayAngle)[1]}
                stroke="var(--acc-500)"
                strokeWidth={2}
                strokeLinecap="round"
                opacity={0.55}
              />

              {/* Opgave-buer pr. projekt-ring */}
              {activeProjects.map((project, ringIdx) => {
                const ringTasks = yearTasks.filter((x) => x.projectId === project.id);
                if (ringTasks.length === 0) return null;
                const rOuter = R_OUT - 6 - ringIdx * 30;
                const r = rOuter - 12;
                const color = hex(project);
                const open = ringTasks.filter((x) => x.status !== 'done');
                const doneList = ringTasks.filter((x) => x.status === 'done');
                return (
                  <g key={project.id}>
                    {/* Ring-baseline */}
                    <circle cx={CX} cy={CY} r={r} fill="none" stroke={color} strokeOpacity={0.08} strokeWidth={26} />
                    {doneList.map((task) => (
                      <TaskArc key={task.id} task={task} r={r} color={color} year={year} daysInYear={daysInYear} dim hovered={hoverTask === task.id} onHover={setHoverTask} onOpen={() => selectTask(task.id)} />
                    ))}
                    {open.map((task) => (
                      <TaskArc key={task.id} task={task} r={r} color={color} year={year} daysInYear={daysInYear} hovered={hoverTask === task.id} onHover={setHoverTask} onOpen={() => selectTask(task.id)} />
                    ))}
                  </g>
                );
              })}

              {/* Års-fremskridt i centertunnelen */}
              <circle cx={CX} cy={CY} r={R_IN - 18} fill="none" stroke="rgba(120,120,130,0.15)" strokeWidth={7} />
              <circle
                cx={CX}
                cy={CY}
                r={R_IN - 18}
                fill="none"
                stroke="var(--acc-500)"
                strokeWidth={7}
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * (R_IN - 18)}
                strokeDashoffset={2 * Math.PI * (R_IN - 18) * (1 - elapsedPct / 100)}
                transform={`rotate(-90 ${CX} ${CY})`}
                opacity={0.85}
              />

              {/* Center-tekst */}
              <text x={CX} y={CY - 24} textAnchor="middle" className="fill-zinc-900 font-display text-[46px] font-bold dark:fill-white">
                {year}
              </text>
              <text x={CX} y={CY + 4} textAnchor="middle" className="fill-zinc-500 text-[13px] dark:fill-zinc-400">
                {t('wheel.today').replace('{date}', format(now, 'd. MMMM', { locale: da }))}
              </text>
              <text x={CX} y={CY + 26} textAnchor="middle" className="fill-zinc-400 text-[12px] dark:fill-zinc-500">
                {monthNames[selectedMonth]} · {selectedTasks.length} {t('wheel.tasksUnit')}
              </text>
            </svg>

            {/* Signatur */}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
              {activeProjects.map((p) => {
                const count = yearTasks.filter((x) => x.projectId === p.id).length;
                if (count === 0) return null;
                return (
                  <span key={p.id} className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: hex(p) }} />
                    {p.name}
                    <span className="tabular-nums text-zinc-400 dark:text-zinc-500">{count}</span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Månedspanel */}
          <aside className="glass-panel flex w-full shrink-0 flex-col rounded-3xl lg:w-80">
            <div className="border-b border-zinc-200/70 p-4 dark:border-white/[0.06]">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-lg font-bold capitalize text-zinc-900 dark:text-white">
                  {monthNames[selectedMonth]} {year}
                </h3>
                {selectedMonth === monthIndex && (
                  <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    {t('wheel.thisMonth')}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200/80 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${selectedPct}%` }}
                  />
                </div>
                <span className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                  {selectedDone}/{selectedTasks.length}
                </span>
              </div>
            </div>

            <div className="max-h-[520px] flex-1 overflow-y-auto p-2">
              {selectedTasks.length === 0 ? (
                <div className="px-3 py-10 text-center">
                  <MousePointerClick className="mx-auto mb-2 h-5 w-5 text-zinc-400" />
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('wheel.noTasks')}</p>
                </div>
              ) : (
                selectedTasks.map((task) => {
                  const project = projects.find((p) => p.id === task.projectId);
                  const done = task.status === 'done';
                  return (
                    <div
                      key={task.id}
                      className={cn(
                        'group flex items-start gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-zinc-100/80 dark:hover:bg-white/[0.04]',
                        done && 'opacity-60',
                      )}
                    >
                      <label className="draw-check mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={done}
                          onChange={() => updateTask(task.id, { status: done ? 'todo' : 'done' }, done ? 'gjenåbnede' : 'afsluttede')}
                        />
                        <span className="box">
                          <svg viewBox="0 0 16 16">
                            <path d="M3 8.5l3.2 3L13 4.5" />
                          </svg>
                        </span>
                      </label>
                      <button onClick={() => selectTask(task.id)} className="min-w-0 flex-1 text-left">
                        <span
                          className={cn(
                            'block truncate text-[13px] font-medium',
                            done
                              ? 'text-zinc-400 line-through dark:text-zinc-500'
                              : 'text-zinc-800 dark:text-zinc-100',
                          )}
                        >
                          {task.emoji && <span className="mr-1">{task.emoji}</span>}
                          {task.title}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: hex(project) }} />
                          <span className="max-w-[6rem] truncate">{project?.name}</span>
                          {task.startDate && (
                            <span className="inline-flex items-center gap-0.5">
                              <CalendarDays className="h-3 w-3" />
                              {formatDateShort(task.startDate)}
                              {task.dueDate && task.dueDate !== task.startDate && ` → ${formatDateShort(task.dueDate)}`}
                            </span>
                          )}
                          {!task.startDate && task.dueDate && (
                            <span className="inline-flex items-center gap-0.5">
                              <CalendarDays className="h-3 w-3" />
                              {formatDateShort(task.dueDate)}
                            </span>
                          )}
                        </span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ---------- én opgave som bue på ringen ---------- */
function TaskArc({
  task,
  r,
  color,
  year,
  daysInYear,
  dim,
  hovered,
  onHover,
  onOpen,
}: {
  task: Task;
  r: number;
  color: string;
  year: number;
  daysInYear: number;
  dim?: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onOpen: () => void;
}) {
  const startIso = task.startDate ?? task.dueDate!;
  const endIso = task.dueDate ?? task.startDate!;
  let a0 = angleOfDate(startIso, daysInYear);
  let a1 = angleOfDate(endIso, daysInYear);
  // Opgaver, der løber over årsskiftet, klippes til hjulets kanter
  if (a0 < -90 + GAP) a0 = -90 + GAP;
  if (a1 > 270 - GAP) a1 = 270 - GAP;
  if (a1 < a0) [a0, a1] = [a1, a0];
  const inYear = (iso?: string | null) => iso?.startsWith(String(year));
  if (!inYear(task.startDate) && !inYear(task.dueDate)) return null;

  const span = a1 - a0;
  const tooSmall = span < 1.6;
  const path = tooSmall ? undefined : arcPath(r, a0, a1);
  const [dx, dy] = polar(r, a1);
  const title = `${task.title}${
    task.startDate && task.dueDate && task.startDate !== task.dueDate
      ? ` (${formatDateShort(task.startDate)} – ${formatDateShort(task.dueDate)})`
      : task.dueDate
        ? ` (${formatDateShort(task.dueDate)})`
        : ''
  }`;

  return (
    <g
      className="cursor-pointer"
      onMouseEnter={() => onHover(task.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onOpen}
      opacity={dim ? 0.3 : hovered ? 1 : 0.92}
    >
      {path ? (
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={hovered ? 20 : 15}
          strokeLinecap="round"
          style={{ transition: 'stroke-width .12s ease' }}
        >
          <title>{title}</title>
        </path>
      ) : (
        <circle cx={dx} cy={dy} r={hovered ? 9 : 7} fill={color}>
          <title>{title}</title>
        </circle>
      )}
    </g>
  );
}

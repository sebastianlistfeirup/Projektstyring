import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { CalendarClock, Presentation, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { computeHealth, healthTone } from '../lib/health';
import { cn, formatDateShort, isOverdue, taskRef } from '../lib/utils';
import CountUp from './CountUp';

const SLIDES = 3;
const ROTATE_MS = 15_000;

const TONE_BAR: Record<string, string> = {
  rose: 'bg-rose-400',
  amber: 'bg-amber-400',
  emerald: 'bg-emerald-400',
};

/**
 * Præsentationstilstand: læsevenligt fuldskærms-overblik til skærme/møder.
 * Auto-roterer mellem tre slides hvert 15. sekund. Indholdet er interaktionsfrit
 * (pointer-events-none) – kun exit-knappen øverst til højre og Esc virker.
 */
export function PresentationToggle() {
  const [active, setActive] = useState(false);
  const [slide, setSlide] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const activeRef = useRef(false);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const sprints = useStore((s) => s.sprints);
  const risks = useStore((s) => s.risks);
  const issues = useStore((s) => s.issues);

  const exit = useCallback(() => {
    if (!activeRef.current) return;
    setActive(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  const start = () => {
    setSlide(0);
    setActive(true);
    void document.documentElement.requestFullscreen().catch(() => {});
  };

  // Auto-rotation mellem slides hvert 15. sekund
  useEffect(() => {
    if (!active) return;
    const i = window.setInterval(() => setSlide((s) => (s + 1) % SLIDES), ROTATE_MS);
    return () => window.clearInterval(i);
  }, [active]);

  // Ur i headeren
  useEffect(() => {
    if (!active) return;
    const i = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(i);
  }, [active]);

  // Esc afslutter; browserens egen fullscreen-exit (Esc i fullscreen) afslutter også
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit();
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement && activeRef.current) exit();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [active, exit]);

  if (!active) {
    return (
      <button onClick={start} title="Præsentationstilstand" className="btn-ghost px-2">
        <Presentation className="h-4 w-4" />
        <span className="hidden lg:inline">Præsentation</span>
      </button>
    );
  }

  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'canceled');
  const done = tasks.filter((t) => t.status === 'done');
  const overdue = open.filter(isOverdue);
  const health = computeHealth(tasks, projects, users, sprints, risks, issues);
  const upcoming = open
    .filter((t) => t.dueDate)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
    .slice(0, 5);

  return (
    <div className="fixed inset-0 z-[86] grid place-items-center overflow-hidden bg-[#17181c] p-12">
      {/* Header */}
      <div className="pointer-events-none absolute left-12 top-8 flex items-baseline gap-4">
        <h2 className="text-2xl font-bold tracking-tight text-white">Orbit – præsentation</h2>
        <span className="text-xl tabular-nums text-zinc-500">{format(now, 'HH:mm')}</span>
      </div>
      <button
        onClick={exit}
        title="Afslut præsentation (Esc)"
        className="absolute right-8 top-6 flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-white/10"
      >
        <X className="h-4 w-4" />
        Afslut
      </button>

      {/* Slides – indholdet er rent visuelt (ingen interaktion) */}
      <div className="pointer-events-none w-full max-w-5xl" key={slide}>
        {slide === 0 && (
          <div className="animate-fade-in">
            <p className="text-center text-lg font-medium uppercase tracking-[0.3em] text-zinc-500">Projekt-puls</p>
            <div className="mt-10 space-y-9">
              {health.slice(0, 3).map((h) => (
                <div key={h.projectId} className="flex items-center gap-5">
                  <span className={cn('h-4 w-4 shrink-0 rounded-sm', `bg-${h.color}-500`)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-4">
                      <p className="truncate text-3xl font-semibold text-white">{h.name}</p>
                      <p className="shrink-0 text-5xl font-bold tabular-nums text-white">{h.score}</p>
                    </div>
                    <div className="mt-2.5 h-3 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={cn('h-full rounded-full', TONE_BAR[healthTone(h.score)])}
                        style={{ width: `${h.score}%` }}
                      />
                    </div>
                    {h.factors[0] && <p className="mt-1.5 truncate text-sm text-zinc-500">{h.factors[0].label}</p>}
                  </div>
                </div>
              ))}
              {health.length === 0 && <p className="text-center text-3xl text-zinc-500">Ingen aktive projekter.</p>}
            </div>
          </div>
        )}

        {slide === 1 && (
          <div className="animate-fade-in">
            <p className="text-center text-lg font-medium uppercase tracking-[0.3em] text-zinc-500">Status lige nu</p>
            <div className="mt-14 grid grid-cols-3 gap-10 text-center">
              <div>
                <CountUp value={open.length} durationMs={900} className="text-7xl font-bold text-white" />
                <p className="mt-2 text-xl text-zinc-400">Åbne opgaver</p>
              </div>
              <div>
                <CountUp value={done.length} durationMs={900} className="text-7xl font-bold text-emerald-400" />
                <p className="mt-2 text-xl text-zinc-400">Færdige</p>
              </div>
              <div>
                <CountUp value={overdue.length} durationMs={900} className="text-7xl font-bold text-rose-400" />
                <p className="mt-2 text-xl text-zinc-400">Overskredne</p>
              </div>
            </div>
          </div>
        )}

        {slide === 2 && (
          <div className="animate-fade-in">
            <p className="text-center text-lg font-medium uppercase tracking-[0.3em] text-zinc-500">Kommende frister</p>
            {upcoming.length === 0 ? (
              <p className="mt-14 text-center text-3xl text-zinc-500">Ingen kommende frister.</p>
            ) : (
              <ul className="mx-auto mt-12 max-w-3xl space-y-5">
                {upcoming.map((t) => (
                  <li key={t.id} className="flex items-baseline gap-4">
                    <span className="shrink-0 font-mono text-xl font-semibold text-zinc-500">{taskRef(t, projects)}</span>
                    <span className="min-w-0 flex-1 truncate text-2xl text-white">{t.title}</span>
                    <span
                      className={cn(
                        'flex shrink-0 items-center gap-1.5 text-xl tabular-nums',
                        isOverdue(t) ? 'font-semibold text-rose-400' : 'text-zinc-400',
                      )}
                    >
                      <CalendarClock className="h-5 w-5" />
                      {formatDateShort(t.dueDate)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Slide-indikatorer */}
      <div className="pointer-events-none absolute bottom-8 flex items-center gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn('h-1.5 rounded-full transition-all', i === slide ? 'w-6 bg-indigo-400' : 'w-1.5 bg-zinc-600')}
          />
        ))}
      </div>
    </div>
  );
}

export default PresentationToggle;

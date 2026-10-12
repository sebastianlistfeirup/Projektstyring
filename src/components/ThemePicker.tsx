import { useEffect, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { Accent } from '../lib/types';
import { cn } from '../lib/utils';

const ACCENTS: { id: Accent; name: string; color: string }[] = [
  { id: 'indigo', name: 'Indigo', color: '#6366f1' },
  { id: 'violet', name: 'Violet', color: '#8b5cf6' },
  { id: 'emerald', name: 'Skovgrøn', color: '#10b981' },
  { id: 'sunset', name: 'Solnedgang', color: '#f97316' },
  { id: 'graphite', name: 'Graphit', color: '#71717a' },
  { id: 'ocean', name: 'Ocean', color: '#0ea5e9' },
];

const DENSITIES = [
  { id: 'comfortable' as const, name: 'Komfortabel' },
  { id: 'compact' as const, name: 'Kompakt' },
];

export default function ThemePicker() {
  const accent = useStore((s) => s.accent);
  const density = useStore((s) => s.density);
  const simpleMode = useStore((s) => s.simpleMode);
  const setAccent = useStore((s) => s.setAccent);
  const setDensity = useStore((s) => s.setDensity);
  const toggleSimpleMode = useStore((s) => s.toggleSimpleMode);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Luk ved klik udenfor eller Escape
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Tema & visning"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn('btn-ghost px-2', open && 'bg-zinc-200/70 dark:bg-white/[0.08]')}
      >
        <Palette className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Tema & visning"
          className="glass-panel animate-scale-in absolute right-0 z-50 mt-2 w-64 rounded-xl p-3 shadow-panel"
        >
          {/* Accent */}
          <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Accent
          </p>
          <div className="flex items-center gap-2 px-1 pb-3">
            {ACCENTS.map((a) => {
              const active = accent === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setAccent(a.id)}
                  title={a.name}
                  aria-label={`Accent: ${a.name}`}
                  aria-pressed={active}
                  className={cn(
                    'grid h-7 w-7 place-items-center rounded-full transition-transform duration-150 hover:scale-110',
                  )}
                  style={{
                    backgroundColor: a.color,
                    ...(active ? { outline: `2px solid ${a.color}`, outlineOffset: '2px' } : {}),
                  }}
                >
                  {active && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                </button>
              );
            })}
          </div>

          {/* Tæthed */}
          <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Tæthed
          </p>
          <div className="grid grid-cols-2 gap-1.5 px-1 pb-3">
            {DENSITIES.map((d) => (
              <button
                key={d.id}
                onClick={() => setDensity(d.id)}
                aria-pressed={density === d.id}
                className={cn(
                  'rounded-lg border px-2 py-1.5 text-sm transition-colors duration-150',
                  density === d.id
                    ? 'border-indigo-500 bg-indigo-500/10 font-medium text-indigo-600 dark:text-indigo-300'
                    : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-white/10 dark:text-zinc-300 dark:hover:border-white/20',
                )}
              >
                {d.name}
              </button>
            ))}
          </div>

          {/* Visning */}
          <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Visning
          </p>
          <div className="flex items-start justify-between gap-3 px-1 pb-1">
            <div className="min-w-0">
              <p className="text-sm">Enkel tilstand</p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Skjuler avancerede moduler</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={simpleMode}
              onClick={toggleSimpleMode}
              className={cn(
                'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
                simpleMode ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-600',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
                  simpleMode ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

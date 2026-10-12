import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';

// Velkomst-splash med roterende orbit-ring, der toner ud
export default function Splash() {
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>('in');

  useEffect(() => {
    const t1 = window.setTimeout(() => setPhase('out'), 750);
    const t2 = window.setTimeout(() => setPhase('gone'), 1350);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  if (phase === 'gone') return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] grid place-items-center bg-[#17181c] transition-all duration-500 ease-out',
        phase === 'out' && 'pointer-events-none scale-[1.03] opacity-0',
      )}
      aria-hidden
    >
      <div className="flex flex-col items-center gap-6">
        <div className="relative h-24 w-24">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 shadow-glow" />
          <div className="absolute -inset-3 animate-spin-slow">
            <svg viewBox="0 0 100 100" className="h-full w-full">
              <ellipse
                cx="50"
                cy="50"
                rx="48"
                ry="18"
                fill="none"
                stroke="#818cf8"
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeDasharray="200 110"
                transform="rotate(-24 50 50)"
              />
            </svg>
          </div>
          <span className="absolute inset-0 grid select-none place-items-center text-3xl font-bold text-white">O</span>
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-zinc-300">Orbit</p>
          <p className="mt-1 text-[11px] tracking-wide text-zinc-500">Projektstyring</p>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Keyboard, MousePointerClick, Search, Sparkles, Sun, X } from 'lucide-react';
import { cn } from '../lib/utils';

// Førstegangs-tur + genvejsoversigt (?)
const TOUR_KEY = 'orbit-toured';

const TOUR_STEPS = [
  {
    icon: Sun,
    title: 'Velkommen til Orbit',
    text: 'Din nye forside er "I dag" – den viser det vigtigste fra alle dine opgaver, rangeret efter prioritet og frist.',
  },
  {
    icon: Search,
    title: 'Søg og opret med Ctrl+K',
    text: 'Tryk Ctrl+K hvor som helst: søg i opgaver, opret nye med det samme og naviger mellem sider uden mus.',
  },
  {
    icon: MousePointerClick,
    title: 'Alt er ét klik væk',
    text: 'Tavlen viser dit arbejde med træk-og-slip. Klik på en opgave for detaljer, tid, afhængigheder og AI-hjælp.',
  },
  {
    icon: Sparkles,
    title: 'Integrationer gør det magisk',
    text: 'Under Integrationer finder du Teams, Outlook, AI-assistent, backup og automatisering. Sæt det op, når du er klar.',
  },
];

export function Tour() {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (localStorage.getItem(TOUR_KEY) === '1') return;
    const t = window.setTimeout(() => setStep(0), 1700);
    return () => window.clearTimeout(t);
  }, []);

  if (step === null) return null;
  const current = TOUR_STEPS[step];
  const Icon = current.icon;
  const last = step === TOUR_STEPS.length - 1;

  const finish = () => {
    localStorage.setItem(TOUR_KEY, '1');
    setStep(null);
  };

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-zinc-950/50 p-4 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-panel animate-scale-in dark:border-white/10 dark:bg-[#1e1f24]">
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300">
          <Icon className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{current.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{current.text}</p>
        <div className="mt-5 flex items-center gap-1.5">
          {TOUR_STEPS.map((_, i) => (
            <span
              key={i}
              className={cn('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-indigo-500' : 'w-1.5 bg-zinc-300 dark:bg-zinc-600')}
            />
          ))}
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={finish} className="btn-ghost text-sm">
            Spring over
          </button>
          <span className="flex-1" />
          <button onClick={() => (last ? finish() : setStep(step + 1))} className="btn-primary text-sm">
            {last ? 'Kom i gang' : 'Næste'}
          </button>
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl', 'K'], label: 'Søg, opret opgave og naviger' },
  { keys: ['?'], label: 'Denne genvejsoversigt' },
  { keys: ['Esc'], label: 'Luk dialoger og opgavedetalje' },
  { keys: ['Enter'], label: 'Send kommentar (i kommentarfelt)' },
  { keys: ['↑', '↓'], label: 'Navigér i kommandopaletten' },
  { keys: ['Ctrl', 'K → titel → Enter'], label: 'Opret en opgave på 3 sekunder' },
];

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center bg-zinc-950/50 p-4 backdrop-blur-sm animate-fade-in" onMouseDown={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-panel animate-scale-in dark:border-white/10 dark:bg-[#1e1f24]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300">
            <Keyboard className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">Genveje</h2>
          <span className="flex-1" />
          <button onClick={onClose} className="btn-ghost px-2 py-1">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="space-y-2.5">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center gap-3">
              <span className="flex shrink-0 gap-1">
                {s.keys.map((k, i) => (
                  <kbd
                    key={`${k}-${i}`}
                    className="rounded-md border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
              <span className="text-sm text-zinc-600 dark:text-zinc-300">{s.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

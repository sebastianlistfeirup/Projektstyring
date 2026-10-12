import { useEffect, useState } from 'react';
import { GitMerge, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';

// Banner ved synkroniseringskonflikter (mobil-paritet / flere brugere)
export default function SyncConflictsBanner() {
  const conflicts = useStore((s) => s.syncConflicts);
  const resolveSyncConflict = useStore((s) => s.resolveSyncConflict);
  const selectTask = useStore((s) => s.selectTask);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (conflicts.length > 0) setDismissed(false);
  }, [conflicts.length]);

  if (conflicts.length === 0 || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[70] w-80 animate-slide-up">
      <div className="glass-panel rounded-xl border-amber-500/40 p-4 shadow-panel">
        <div className="flex items-center gap-2">
          <GitMerge className="h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {conflicts.length === 1 ? '1 synkroniseringskonflikt' : `${conflicts.length} synkroniseringskonflikter`}
          </p>
          <button onClick={() => setDismissed(true)} className="ml-auto text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Den samme opgave blev ændret her og et andet sted. Vælg hvilken version der gælder.
        </p>
        <ul className="mt-2 space-y-2">
          {conflicts.slice(0, 4).map((c) => (
            <li key={c.taskId} className="rounded-lg bg-zinc-100 p-2 dark:bg-white/[0.04]">
              <button
                onClick={() => selectTask(c.taskId)}
                className="block w-full truncate text-left text-xs font-medium text-zinc-800 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-300"
                title={c.local.title}
              >
                {c.local.title}
              </button>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={() => resolveSyncConflict(c.taskId, 'local')}
                  className={cn(
                    'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                    'bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 dark:text-indigo-300',
                  )}
                >
                  Behold min version
                </button>
                <button
                  onClick={() => resolveSyncConflict(c.taskId, 'remote')}
                  className="flex-1 rounded-md bg-zinc-200/70 px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-300 dark:bg-white/10 dark:text-zinc-300 dark:hover:bg-white/20"
                >
                  Brug den anden
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

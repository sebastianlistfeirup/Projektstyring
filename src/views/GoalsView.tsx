import { useState } from 'react';
import { Plus, Target, Trash2, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { ViewHeader, EmptyState, ProgressBar } from '../components/common';

// OKR-ligt målmodul: mål med key results koblet til opgaver
export default function GoalsView() {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const addGoal = useStore((s) => s.addGoal);
  const updateGoal = useStore((s) => s.updateGoal);
  const deleteGoal = useStore((s) => s.deleteGoal);
  const selectTask = useStore((s) => s.selectTask);

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [krDrafts, setKrDrafts] = useState<Record<string, string>>({});

  const krProgress = (taskIds: string[]) => {
    if (taskIds.length === 0) return null;
    const done = taskIds.filter((id) => tasks.find((t) => t.id === id)?.status === 'done').length;
    return Math.round((done / taskIds.length) * 100);
  };

  const goalProgress = (goalId: string) => {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal || goal.keyResults.length === 0) return null;
    const parts = goal.keyResults.map((kr) => krProgress(kr.taskIds) ?? 0);
    return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  };

  const openTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'canceled');

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 p-4 lg:p-6">
        <ViewHeader title="Mål" subtitle="OKR-ligt: mål med key results koblet til opgaver – status opdateres automatisk" />

        <div className="glass-panel flex flex-col gap-2 rounded-xl p-4 sm:flex-row">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nyt mål, fx 'Lancere version 2.0' …"
            className="input flex-1 py-1.5 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                addGoal(title, note);
                setTitle('');
                setNote('');
              }
            }}
          />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (valgfri)" className="input flex-1 py-1.5 text-sm" />
          <button
            onClick={() => {
              addGoal(title, note);
              setTitle('');
              setNote('');
            }}
            disabled={!title.trim()}
            className="btn-primary shrink-0 py-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Tilføj mål
          </button>
        </div>

        {goals.length === 0 ? (
          <EmptyState
            icon={<Target className="h-6 w-6" />}
            title="Ingen mål endnu"
            description="Opret jeres første mål og kobl key results til konkrete opgaver – så følger fremskridtet sig selv."
          />
        ) : (
          goals.map((goal) => {
            const pct = goalProgress(goal.id);
            return (
              <section key={goal.id} className="glass-panel animate-fade-in rounded-xl p-5">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300">
                    <Target className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{goal.title}</h2>
                    {goal.note && <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{goal.note}</p>}
                  </div>
                  {pct !== null && (
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                        pct >= 80
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : pct >= 40
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            : 'bg-zinc-500/10 text-zinc-500',
                      )}
                    >
                      {pct}%
                    </span>
                  )}
                  <button
                    onClick={() => {
                      if (window.confirm(`Slet målet "${goal.title}"?`)) deleteGoal(goal.id);
                    }}
                    className="btn-ghost shrink-0 px-2 py-1 text-xs text-rose-600 dark:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {pct !== null && <ProgressBar value={pct} className="mt-3" />}

                <ul className="mt-4 space-y-2">
                  {goal.keyResults.map((kr) => {
                    const krPct = krProgress(kr.taskIds);
                    return (
                      <li key={kr.id} className="rounded-lg border border-zinc-200/70 px-3 py-2 dark:border-white/[0.06]">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{kr.title}</span>
                          {krPct !== null && (
                            <span className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-500">{krPct}%</span>
                          )}
                          <button
                            onClick={() =>
                              updateGoal(goal.id, {
                                keyResults: goal.keyResults.filter((k) => k.id !== kr.id),
                              })
                            }
                            className="text-zinc-400 hover:text-rose-500"
                            title="Fjern key result"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {kr.taskIds.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {kr.taskIds.map((id) => {
                              const task = tasks.find((t) => t.id === id);
                              if (!task) return null;
                              return (
                                <button
                                  key={id}
                                  onClick={() => selectTask(id)}
                                  className="flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-white/10 dark:text-zinc-300"
                                  title={task.title}
                                >
                                  <span className={cn('h-1.5 w-1.5 rounded-full', task.status === 'done' ? 'bg-emerald-500' : 'bg-zinc-400')} />
                                  <span className="max-w-[10rem] truncate">{task.title}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    value={krDrafts[goal.id] ?? ''}
                    onChange={(e) => setKrDrafts((d) => ({ ...d, [goal.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      const value = (krDrafts[goal.id] ?? '').trim();
                      if (!value) return;
                      updateGoal(goal.id, {
                        keyResults: [
                          ...goal.keyResults,
                          { id: `kr-${Math.random().toString(36).slice(2, 8)}`, title: value, taskIds: [] },
                        ],
                      });
                      setKrDrafts((d) => ({ ...d, [goal.id]: '' }));
                    }}
                    placeholder="Nyt key result + Enter …"
                    className="input flex-1 py-1 text-xs"
                  />
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const taskId = e.target.value;
                      if (!taskId) return;
                      const lastKr = goal.keyResults[goal.keyResults.length - 1];
                      if (!lastKr) return;
                      if (lastKr.taskIds.includes(taskId)) return;
                      updateGoal(goal.id, {
                        keyResults: goal.keyResults.map((k) =>
                          k.id === lastKr.id ? { ...k, taskIds: [...k.taskIds, taskId] } : k,
                        ),
                      });
                      e.target.value = '';
                    }}
                    className="input w-40 py-1 text-xs"
                    title="Kobl opgave til sidste key result"
                  >
                    <option value="">+ Kobl opgave …</option>
                    {openTasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {projects.find((p) => p.id === t.projectId)?.key}-{t.number} {t.title.slice(0, 30)}
                      </option>
                    ))}
                  </select>
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

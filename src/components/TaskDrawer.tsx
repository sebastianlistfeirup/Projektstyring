import { useEffect, useState } from 'react';
import { CalendarClock, Check, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { PRIORITY_META, STATUS_META } from '../lib/constants';
import { cn, formatDateShort, isOverdue, taskRef } from '../lib/utils';
import { aiComplete } from '../lib/companion';
import type { Priority, TaskStatus } from '../lib/types';
import { Avatar, LabelChip, ProgressBar, StatusBadge } from '../components/common';

export default function TaskDrawer() {
  const task = useStore((s) => s.tasks.find((t) => t.id === s.selectedTaskId));
  const selectTask = useStore((s) => s.selectTask);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const labels = useStore((s) => s.labels);
  const sprints = useStore((s) => s.sprints);
  const updateTask = useStore((s) => s.updateTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const addComment = useStore((s) => s.addComment);
  const addSubtask = useStore((s) => s.addSubtask);
  const toggleSubtask = useStore((s) => s.toggleSubtask);
  const me = useStore((s) => s.users.find((u) => u.id === s.currentUserId));

  const [comment, setComment] = useState('');
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [aiBusy, setAiBusy] = useState<'subtasks' | 'summary' | null>(null);
  const [aiFeedback, setAiFeedback] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [summary, setSummary] = useState('');

  useEffect(() => {
    if (!task) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selectTask(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [task, selectTask]);

  if (!task) return null;

  const project = projects.find((p) => p.id === task.projectId);
  const assignee = users.find((u) => u.id === task.assigneeId);
  const projectSprints = sprints.filter((sp) => sp.projectId === task.projectId);
  const overdue = isOverdue(task);
  const subtaskDone = task.subtasks.filter((st) => st.done).length;
  const subtaskPct = task.subtasks.length ? Math.round((subtaskDone / task.subtasks.length) * 100) : task.status === 'done' ? 100 : 0;

  const close = () => selectTask(null);

  const submitComment = () => {
    if (!comment.trim()) return;
    addComment(task.id, comment);
    setComment('');
  };

  const submitSubtask = () => {
    if (!subtaskTitle.trim()) return;
    addSubtask(task.id, subtaskTitle);
    setSubtaskTitle('');
  };

  const suggestSubtasks = async () => {
    setAiBusy('subtasks');
    setAiFeedback(null);
    try {
      const r = await aiComplete([
        {
          role: 'system',
          content:
            'Du er en dansk projektassistent. Foreslå 3-6 konkrete, handlingsrettede delopgaver til opgaven. Svar KUN med én delopgave pr. linje. Ingen overskrift, ingen nummerering, ingen tomme linjer.',
        },
        { role: 'user', content: `${task.title}\n${task.description || ''}` },
      ]);
      if (r.ok && r.content) {
        const titles = r.content
          .split('\n')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 8);
        for (const t of titles) addSubtask(task.id, t);
        setAiFeedback({ text: `${titles.length} underopgaver tilføjet`, tone: 'ok' });
      } else {
        setAiFeedback({ text: aiErrorText(r.reason), tone: 'error' });
      }
    } finally {
      setAiBusy(null);
    }
  };

  const summarizeComments = async () => {
    if (task.comments.length === 0) return;
    setAiBusy('summary');
    setAiFeedback(null);
    try {
      const thread = task.comments
        .map((c) => `${users.find((u) => u.id === c.authorId)?.name ?? 'Ukendt'}: ${c.text}`)
        .join('\n');
      const r = await aiComplete([
        {
          role: 'system',
          content: 'Opsummér følgende kommentartråd på dansk på maks. 3 sætninger. Fokusér på beslutninger og næste skridt.',
        },
        { role: 'user', content: thread },
      ]);
      if (r.ok && r.content) {
        setSummary(r.content.trim());
      } else {
        setAiFeedback({ text: aiErrorText(r.reason), tone: 'error' });
      }
    } finally {
      setAiBusy(null);
    }
  };

  const insertSummary = () => {
    if (!summary) return;
    addComment(task.id, `Opsummering (AI): ${summary}`);
    setAiFeedback({ text: 'Opsummering tilføjet som kommentar.', tone: 'ok' });
  };

  const toggleLabel = (labelId: string) => {
    const next = task.labelIds.includes(labelId)
      ? task.labelIds.filter((id) => id !== labelId)
      : [...task.labelIds, labelId];
    updateTask(task.id, { labelIds: next });
  };

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-zinc-950/30 backdrop-blur-[2px] animate-fade-in" onClick={close} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[540px] flex-col border-l border-zinc-200 bg-white shadow-panel animate-slide-in-right dark:border-white/[0.07] dark:bg-[#1b1c20]">
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-zinc-200/80 px-5 py-3.5 dark:border-white/[0.06]">
          <span className="font-mono text-xs font-bold text-zinc-400 dark:text-zinc-500">
            {taskRef(task, projects)}
          </span>
          {project && (
            <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <span className={cn('h-2 w-2 rounded-sm', `bg-${project.color}-500`)} />
              {project.name}
            </span>
          )}
          <span className="flex-1" />
          <StatusBadge status={task.status} />
          <button
            onClick={close}
            title="Luk (Esc)"
            className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/[0.07] dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* Titel */}
          <input
            value={task.title}
            onChange={(e) => updateTask(task.id, { title: e.target.value })}
            className="w-full bg-transparent text-xl font-semibold leading-tight outline-none placeholder:text-zinc-400"
            placeholder="Opgavetitel"
          />

          {/* Egenskaber */}
          <div className="grid grid-cols-[104px_1fr] items-center gap-x-4 gap-y-3 text-sm">
            <FieldLabel>Status</FieldLabel>
            <select
              value={task.status}
              onChange={(e) => {
                const status = e.target.value as TaskStatus;
                updateTask(task.id, { status }, `flyttede til ${STATUS_META[status].label}`);
              }}
              className="input w-fit py-1.5"
            >
              {Object.entries(STATUS_META).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </select>

            <FieldLabel>Ansvarlig</FieldLabel>
            <div className="flex items-center gap-2">
              <Avatar user={assignee} size="sm" />
              <select
                value={task.assigneeId ?? ''}
                onChange={(e) => updateTask(task.id, { assigneeId: e.target.value || null })}
                className="input flex-1 py-1.5"
              >
                <option value="">Ikke tildelt</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>

            <FieldLabel>Prioritet</FieldLabel>
            <select
              value={task.priority}
              onChange={(e) => updateTask(task.id, { priority: e.target.value as Priority })}
              className="input w-fit py-1.5"
            >
              {Object.entries(PRIORITY_META).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </select>

            <FieldLabel>Sprint</FieldLabel>
            <select
              value={task.sprintId ?? ''}
              onChange={(e) => updateTask(task.id, { sprintId: e.target.value || null })}
              className="input w-fit py-1.5"
            >
              <option value="">Ingen sprint</option>
              {projectSprints.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </select>

            <FieldLabel>Start</FieldLabel>
            <input
              type="date"
              value={task.startDate ?? ''}
              onChange={(e) => updateTask(task.id, { startDate: e.target.value || null })}
              className="input w-fit py-1.5 [color-scheme:light] dark:[color-scheme:dark]"
            />

            <FieldLabel>Frist</FieldLabel>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={task.dueDate ?? ''}
                onChange={(e) => updateTask(task.id, { dueDate: e.target.value || null })}
                className="input w-fit py-1.5 [color-scheme:light] dark:[color-scheme:dark]"
              />
              {task.dueDate && (
                <span
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium',
                    overdue
                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : 'bg-zinc-100 text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400',
                  )}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  {overdue ? 'Overskredet' : formatDateShort(task.dueDate)}
                </span>
              )}
            </div>

            <FieldLabel>Gentagelse</FieldLabel>
            <select
              value={task.recurrence ?? ''}
              onChange={(e) => {
                const value = e.target.value as '' | 'daily' | 'weekly' | 'monthly';
                updateTask(task.id, { recurrence: value || null });
              }}
              className="input w-fit py-1.5"
            >
              <option value="">Ingen</option>
              <option value="daily">Daglig</option>
              <option value="weekly">Ugentlig</option>
              <option value="monthly">Månedlig</option>
            </select>

            <FieldLabel>Points</FieldLabel>
            <input
              type="number"
              min={0}
              value={task.estimate ?? ''}
              onChange={(e) => updateTask(task.id, { estimate: e.target.value ? Number(e.target.value) : null })}
              placeholder="—"
              className="input w-24 py-1.5"
            />

            <FieldLabel>Etiketter</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {labels.map((l) => (
                <button
                  key={l.id}
                  onClick={() => toggleLabel(l.id)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition-all',
                    task.labelIds.includes(l.id)
                      ? 'border-transparent'
                      : 'border-zinc-300 opacity-45 hover:opacity-80 dark:border-white/10',
                  )}
                >
                  <LabelChip name={l.name} color={l.color} className="bg-transparent px-0 py-0" />
                </button>
              ))}
            </div>
          </div>

          {/* Beskrivelse */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Beskrivelse
            </h3>
            <textarea
              value={task.description}
              onChange={(e) => updateTask(task.id, { description: e.target.value })}
              rows={task.description ? Math.max(2, Math.min(10, task.description.split('\n').length + 1)) : 2}
              placeholder="Tilføj en beskrivelse …"
              className="input resize-none leading-relaxed"
            />
          </section>

          {/* AI-assistent */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              <Sparkles className="h-3.5 w-3.5" />
              AI-assistent
            </h3>
            <div className="glass-panel rounded-xl p-3.5">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void suggestSubtasks()}
                  disabled={aiBusy !== null}
                  className="btn-outline text-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {aiBusy === 'subtasks' ? 'Analyserer …' : 'Foreslå underopgaver'}
                </button>
                <button
                  onClick={() => void summarizeComments()}
                  disabled={aiBusy !== null || task.comments.length === 0}
                  className="btn-outline text-xs"
                >
                  Opsummér kommentarer
                </button>
              </div>
              {summary && (
                <div className="mt-3">
                  <p className="whitespace-pre-wrap rounded-lg bg-zinc-100 px-3 py-2 text-sm leading-relaxed dark:bg-white/[0.05]">
                    {summary}
                  </p>
                  <button onClick={insertSummary} className="btn-outline mt-2 text-xs">
                    Indsæt som kommentar
                  </button>
                </div>
              )}
            </div>
            {aiFeedback && (
              <p
                className={cn(
                  'mt-1.5 text-xs font-medium',
                  aiFeedback.tone === 'ok'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400',
                )}
              >
                {aiFeedback.text}
              </p>
            )}
          </section>

          {/* Delopgaver */}
          <section>
            <div className="mb-2 flex items-center gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Delopgaver
              </h3>
              {task.subtasks.length > 0 && (
                <span className="text-[11px] tabular-nums text-zinc-400">
                  {subtaskDone} af {task.subtasks.length}
                </span>
              )}
              {task.subtasks.length > 0 && <ProgressBar value={subtaskPct} className="w-24" />}
            </div>
            {task.subtasks.length > 0 && (
              <ul className="mb-2 space-y-1">
                {task.subtasks.map((st) => (
                  <li key={st.id} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-white/[0.04]">
                    <button
                      onClick={() => toggleSubtask(task.id, st.id)}
                      title={st.done ? 'Markér som ikke færdig' : 'Markér som færdig'}
                      className={cn(
                        'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors',
                        st.done
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-zinc-300 hover:border-indigo-400 dark:border-zinc-600',
                      )}
                    >
                      {st.done && <Check className="h-3 w-3" strokeWidth={3} />}
                    </button>
                    <span
                      className={cn(
                        'text-sm',
                        st.done && 'text-zinc-400 line-through decoration-zinc-400/60',
                      )}
                    >
                      {st.title}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2 px-2">
              <Plus className="h-4 w-4 text-zinc-400" />
              <input
                value={subtaskTitle}
                onChange={(e) => setSubtaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitSubtask();
                }}
                placeholder="Tilføj delopgave …"
                className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-zinc-400"
              />
            </div>
          </section>

          {/* Kommentarer */}
          <section>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Kommentarer · {task.comments.length}
            </h3>
            <div className="space-y-4">
              {task.comments.map((c) => {
                const author = users.find((u) => u.id === c.authorId);
                return (
                  <div key={c.id} className="flex gap-3">
                    <Avatar user={author} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs">
                        <span className="font-semibold text-zinc-800 dark:text-zinc-100">{author?.name ?? 'Ukendt'}</span>{' '}
                        <span className="text-zinc-400">{formatDateShort(c.createdAt)}</span>
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap rounded-lg rounded-tl-none bg-zinc-100 px-3 py-2 text-sm leading-relaxed dark:bg-white/[0.05]">
                        {c.text}
                      </p>
                    </div>
                  </div>
                );
              })}
              {task.comments.length === 0 && (
                <p className="text-sm text-zinc-400">Ingen kommentarer endnu. Start samtalen.</p>
              )}
            </div>
            <div className="mt-4 flex items-start gap-3">
              <Avatar user={me} size="sm" />
              <div className="flex-1">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitComment();
                    }
                  }}
                  rows={Math.max(1, Math.min(5, comment.split('\n').length))}
                  placeholder="Skriv en kommentar … (Enter for at sende)"
                  className="input resize-none"
                />
                {comment.trim() && (
                  <button onClick={submitComment} className="btn-primary mt-2 px-3 py-1 text-xs">
                    Kommentér
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-zinc-200/80 px-5 py-3 dark:border-white/[0.06]">
          <span className="text-[11px] text-zinc-400">
            Oprettet {formatDateShort(task.createdAt)} · opdateret {formatDateShort(task.updatedAt)}
          </span>
          <span className="flex-1" />
          <button
            onClick={() => {
              if (window.confirm('Slet denne opgave? Handlingen kan ikke fortrydes.')) {
                deleteTask(task.id);
              }
            }}
            className="btn-ghost px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Slet opgave
          </button>
        </div>
      </aside>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{children}</span>
  );
}

function aiErrorText(reason?: string): string {
  if (reason && /not configured|konfigurer/i.test(reason)) {
    return 'AI-assistenten er ikke konfigureret – se Integrationer-fanen.';
  }
  return reason ?? 'AI-assistenten kunne ikke svare.';
}

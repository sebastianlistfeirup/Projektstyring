import { useEffect, useState } from 'react';
import { CalendarClock, Check, Play, Plus, Sparkles, Square, Trash2, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { PRIORITY_META, STATUS_META } from '../lib/constants';
import { cn, formatDateShort, isOverdue, taskRef } from '../lib/utils';
import { aiComplete } from '../lib/companion';
import type { CustomFieldDef, Priority, Task, TaskStatus } from '../lib/types';
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
  const timeEntries = useStore((s) => s.timeEntries);
  const startTimer = useStore((s) => s.startTimer);
  const stopTimer = useStore((s) => s.stopTimer);
  const currentUserId = useStore((s) => s.currentUserId);
  const allTasks = useStore((s) => s.tasks);
  const fieldDefs = useStore((s) => s.fieldDefs);
  const addFieldDef = useStore((s) => s.addFieldDef);
  const removeFieldDef = useStore((s) => s.removeFieldDef);
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

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const [depOpen, setDepOpen] = useState(false);
  const [depSearch, setDepSearch] = useState('');
  const [newFieldOpen, setNewFieldOpen] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<'text' | 'number' | 'select'>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');

  if (!task) return null;

  const project = projects.find((p) => p.id === task.projectId);
  const assignee = users.find((u) => u.id === task.assigneeId);
  const projectSprints = sprints.filter((sp) => sp.projectId === task.projectId);
  const overdue = isOverdue(task);
  const subtaskDone = task.subtasks.filter((st) => st.done).length;
  const subtaskPct = task.subtasks.length ? Math.round((subtaskDone / task.subtasks.length) * 100) : task.status === 'done' ? 100 : 0;

  // Tidsregistrering
  const todayStr = new Date().toISOString().slice(0, 10);
  const taskEntries = timeEntries.filter((e) => e.taskId === task.id);
  const activeEntry = taskEntries.find((e) => e.endedAt === null) ?? null;
  const timerMine = activeEntry !== null && activeEntry.userId === currentUserId;
  const timerOtherUser = activeEntry && !timerMine ? users.find((u) => u.id === activeEntry.userId) : null;
  const entryMs = (e: (typeof taskEntries)[number]) => new Date(e.endedAt ?? now).getTime() - new Date(e.startedAt).getTime();
  const todayMs = taskEntries.filter((e) => e.startedAt.slice(0, 10) === todayStr).reduce((s, e) => s + entryMs(e), 0);
  const totalMs = taskEntries.reduce((s, e) => s + entryMs(e), 0);

  // Afhængigheder
  const blockedBy = task.blockedBy ?? [];
  const blockerTasks = blockedBy.map((id) => allTasks.find((t) => t.id === id)).filter((t): t is Task => Boolean(t));
  const openBlockers = blockerTasks.filter((b) => b.status !== 'done').length;
  const depCandidates = allTasks.filter(
    (t) => t.projectId === task.projectId && t.id !== task.id && !blockedBy.includes(t.id),
  );
  const depSearchTrimmed = depSearch.trim().toLowerCase();
  const depFiltered = depSearchTrimmed
    ? depCandidates.filter((t) => t.title.toLowerCase().includes(depSearchTrimmed))
    : depCandidates;

  // Tilpassede felter
  const projectFieldDefs = fieldDefs.filter((f) => f.projectId === task.projectId);

  const close = () => selectTask(null);

  const addBlocker = (id: string) => {
    updateTask(task.id, { blockedBy: [...blockedBy, id] }, 'opdaterede afhængigheder');
  };

  const removeBlocker = (id: string) => {
    updateTask(task.id, { blockedBy: blockedBy.filter((b) => b !== id) }, 'opdaterede afhængigheder');
  };

  const submitNewField = () => {
    if (!newFieldName.trim()) return;
    const options =
      newFieldType === 'select'
        ? newFieldOptions.split(',').map((o) => o.trim()).filter(Boolean)
        : undefined;
    addFieldDef(task.projectId, newFieldName, newFieldType, options);
    setNewFieldName('');
    setNewFieldOptions('');
    setNewFieldType('text');
    setNewFieldOpen(false);
  };

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

            <FieldLabel>Blokeret af</FieldLabel>
            <div className="relative">
              <div className="flex flex-wrap items-center gap-1.5">
                {blockerTasks.map((b) => (
                  <span
                    key={b.id}
                    className="flex items-center gap-1 rounded-md bg-zinc-100 py-1 pl-2 pr-1 text-[11px] font-medium text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300"
                  >
                    <span className="max-w-[10rem] truncate" title={`${taskRef(b, projects)} · ${b.title}`}>
                      {taskRef(b, projects)} · {b.title}
                    </span>
                    <button
                      onClick={() => removeBlocker(b.id)}
                      title="Fjern blokering"
                      className="grid h-4 w-4 place-items-center rounded text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <button onClick={() => setDepOpen((o) => !o)} className="btn-outline px-2 py-1 text-[11px]">
                  <Plus className="h-3 w-3" />
                  Tilføj…
                </button>
              </div>
              {depOpen && (
                <div className="glass-panel absolute left-0 top-full z-30 mt-1 w-72 rounded-xl p-2 shadow-panel">
                  <input
                    autoFocus
                    value={depSearch}
                    onChange={(e) => setDepSearch(e.target.value)}
                    placeholder="Søg efter opgave …"
                    className="input mb-1.5 w-full py-1.5 text-xs"
                  />
                  <div className="max-h-44 overflow-y-auto">
                    {depFiltered.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          addBlocker(t.id);
                          setDepSearch('');
                          setDepOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-white/[0.06]"
                      >
                        <span className="shrink-0 font-mono text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">
                          {taskRef(t, projects)}
                        </span>
                        <span className="truncate">{t.title}</span>
                      </button>
                    ))}
                    {depFiltered.length === 0 && (
                      <p className="px-2 py-1.5 text-xs text-zinc-400">Ingen opgaver at tilføje.</p>
                    )}
                  </div>
                </div>
              )}
              {blockerTasks.length > 0 &&
                (openBlockers > 0 ? (
                  <p className="mt-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                    {openBlockers} af {blockerTasks.length} blokere er ikke færdige
                  </p>
                ) : (
                  <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5" />
                    Alle blokere færdige
                  </p>
                ))}
            </div>

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

            {projectFieldDefs.map((field) => (
              <div key={field.id} className="contents">
                <FieldLabel>
                  <span className="flex items-center gap-1">
                    {field.name}
                    <button
                      onClick={() => {
                        if (window.confirm(`Slet feltet "${field.name}"? Værdier fjernes fra opgaverne.`)) {
                          removeFieldDef(field.id);
                        }
                      }}
                      title="Slet felt"
                      className="text-zinc-400 transition-colors hover:text-rose-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                </FieldLabel>
                <CustomFieldInput field={field} task={task} />
              </div>
            ))}
            <div className="contents">
              <span />
              <div>
                {newFieldOpen ? (
                  <div className="glass-panel space-y-2 rounded-xl p-3">
                    <input
                      autoFocus
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitNewField();
                        if (e.key === 'Escape') setNewFieldOpen(false);
                      }}
                      placeholder="Feltnavn …"
                      className="input w-full py-1.5 text-xs"
                    />
                    <div className="flex items-center gap-2">
                      <select
                        value={newFieldType}
                        onChange={(e) => setNewFieldType(e.target.value as 'text' | 'number' | 'select')}
                        className="input w-auto cursor-pointer py-1.5 text-xs"
                        title="Felttype"
                      >
                        <option value="text">Tekst</option>
                        <option value="number">Tal</option>
                        <option value="select">Valgliste</option>
                      </select>
                      {newFieldType === 'select' && (
                        <input
                          value={newFieldOptions}
                          onChange={(e) => setNewFieldOptions(e.target.value)}
                          placeholder="Muligheder, adskilt af komma …"
                          className="input w-full py-1.5 text-xs"
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={submitNewField} className="btn-primary px-2.5 py-1 text-xs">
                        Tilføj
                      </button>
                      <button onClick={() => setNewFieldOpen(false)} className="btn-ghost px-2 py-1 text-xs">
                        Annullér
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setNewFieldOpen(true)} className="btn-outline text-xs">
                    <Plus className="h-3.5 w-3.5" />
                    Nyt felt
                  </button>
                )}
              </div>
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

          {/* Tidsregistrering */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Tidsregistrering
            </h3>
            <div className="glass-panel rounded-xl p-3.5">
              <div className="flex items-center gap-3">
                {!activeEntry && (
                  <button onClick={() => startTimer(task.id)} className="btn-outline text-xs">
                    <Play className="h-3.5 w-3.5" />
                    Start tid
                  </button>
                )}
                {activeEntry && timerMine && (
                  <>
                    <button onClick={stopTimer} className="btn-primary text-xs">
                      <Square className="h-3.5 w-3.5" />
                      Stop tid
                    </button>
                    <span className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {fmtHM(now - new Date(activeEntry.startedAt).getTime())}
                    </span>
                  </>
                )}
                {activeEntry && !timerMine && timerOtherUser && (
                  <span className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    {timerOtherUser.name} registrerer tid nu
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                I dag: {fmtHM(todayMs)} · Samlet: {fmtHours(totalMs)}
              </p>
            </div>
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

function CustomFieldInput({ field, task }: { field: CustomFieldDef; task: Task }) {
  const setTaskFieldValue = useStore((s) => s.setTaskFieldValue);
  const raw = task.customFields?.[field.id];
  const [draft, setDraft] = useState(raw == null ? '' : String(raw));

  useEffect(() => {
    setDraft(raw == null ? '' : String(raw));
  }, [raw]);

  if (field.type === 'select') {
    return (
      <select
        value={raw == null ? '' : String(raw)}
        onChange={(e) => setTaskFieldValue(task.id, field.id, e.target.value || null)}
        className="input w-fit py-1.5"
      >
        <option value="">—</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  const save = () => {
    if (draft.trim() === '') {
      setTaskFieldValue(task.id, field.id, null);
      return;
    }
    const value = field.type === 'number' ? Number(draft) : draft;
    setTaskFieldValue(task.id, field.id, typeof value === 'number' && Number.isNaN(value) ? null : value);
  };

  return (
    <input
      type={field.type === 'number' ? 'number' : 'text'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      placeholder="—"
      className="input w-40 py-1.5"
    />
  );
}

function fmtHM(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}t ${m}m`;
}

function fmtHours(ms: number): string {
  const rounded = Math.round((ms / 3600000) * 10) / 10;
  return `${rounded.toLocaleString('da-DK', { maximumFractionDigits: 1 })}t`;
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

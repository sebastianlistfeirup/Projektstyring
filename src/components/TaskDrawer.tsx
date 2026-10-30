import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CalendarClock, CalendarPlus, Check, ChevronRight, ClipboardCheck, Copy, FileText, FolderInput, History, Paperclip, Pin, PinOff, Play, Plus, Sparkles, Square, Trash2, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { PRIORITY_META, STATUS_META } from '../lib/constants';
import { cn, formatDateShort, isOverdue, taskRef, timeAgo } from '../lib/utils';
import { useLang, t } from '../lib/i18n';
import { celebrate } from '../components/Confetti';
import {
  aiComplete,
  attachmentUrl,
  createCalendarEvent,
  deleteAttachment,
  listAttachments,
  openAttachment,
  uploadAttachment,
  type AttachmentMeta,
} from '../lib/companion';
import type { Comment, CustomFieldDef, Priority, Sprint, Task, TaskStatus, User } from '../lib/types';
import { estimateSuggestion } from '../lib/radar';
import { Avatar, LabelChip, ProgressBar, StatusBadge } from '../components/common';
import TaskExecutionPanel from './TaskExecutionPanel';

export default function TaskDrawer() {
  useLang();
  const task = useStore((s) => s.tasks.find((t) => t.id === s.selectedTaskId));
  const selectTask = useStore((s) => s.selectTask);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const labels = useStore((s) => s.labels);
  const sprints = useStore((s) => s.sprints);
  const updateTask = useStore((s) => s.updateTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const duplicateTask = useStore((s) => s.duplicateTask);
  const moveTaskToProject = useStore((s) => s.moveTaskToProject);
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
  const requestApproval = useStore((s) => s.requestApproval);
  const clearApproval = useStore((s) => s.clearApproval);
  const togglePinDay = useStore((s) => s.togglePinDay);
  const setTaskEmoji = useStore((s) => s.setTaskEmoji);
  const setReminder = useStore((s) => s.setReminder);
  const toggleMilestone = useStore((s) => s.toggleMilestone);
  const addKudo = useStore((s) => s.addKudo);

  const [comment, setComment] = useState('');
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [aiBusy, setAiBusy] = useState<'subtasks' | 'summary' | null>(null);
  const [aiFeedback, setAiFeedback] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [summary, setSummary] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // AI-estimatforslag fra lignende afsluttede opgaver (vises kun mens estimate mangler)
  const estimateHint = useMemo(() => {
    if (!task || task.estimate != null) return null;
    return estimateSuggestion(allTasks, task.title);
  }, [task, allTasks]);

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

  // Vedhæftninger
  const [files, setFiles] = useState<AttachmentMeta[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attFeedback, setAttFeedback] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // @-omtaler i kommentarfeltet
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionClosed, setMentionClosed] = useState(false);

  // Footer: flyt til projekt + Outlook-kalender
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');
  const [calBusy, setCalBusy] = useState(false);
  const [calFeedback, setCalFeedback] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  // Footer: kundegodkendelse via offentligt link
  const [approvalFeedback, setApprovalFeedback] = useState<string | null>(null);

  const taskId = task?.id;
  const refreshAttachments = useCallback(async () => {
    if (!taskId) return;
    setAttLoading(true);
    try {
      const r = await listAttachments(taskId);
      setFiles(r.ok && r.files ? r.files : []);
    } finally {
      setAttLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    setFiles([]);
    setAttFeedback(null);
    setApprovalFeedback(null);
    setEmojiOpen(false);
    if (taskId) void refreshAttachments();
  }, [taskId, refreshAttachments]);

  if (!task) return null;

  const project = projects.find((p) => p.id === task.projectId);
  const assignee = users.find((u) => u.id === task.assigneeId);
  const projectSprints = sprints.filter((sp) => sp.projectId === task.projectId);
  const overdue = isOverdue(task);
  const subtaskDone = task.subtasks.filter((st) => st.done).length;
  const subtaskPct = task.subtasks.length ? Math.round((subtaskDone / task.subtasks.length) * 100) : task.status === 'done' ? 100 : 0;

  // Tidsregistrering
  const todayStr = new Date().toISOString().slice(0, 10);
  const pinnedToday = task.pinnedDay === todayStr;
  const reminderLocal = task.reminderAt
    ? (() => {
        const d = new Date(task.reminderAt);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      })()
    : '';
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

  // Kommentarer: kun topniveau vises – svar hænger under deres forælder
  const topLevelComments = task.comments.filter(
    (c) => !c.replyToId || !task.comments.some((p) => p.id === c.replyToId),
  );

  // @-omtale-autocomplete i kommentarfeltet (regex på hele teksten)
  const mentionMatch = comment.match(/@(\w*)$/);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : '';
  const mentionUsers =
    mentionMatch && !mentionClosed
      ? users.filter((u) => u.name.split(' ')[0].toLowerCase().startsWith(mentionQuery))
      : [];
  const showMentions = mentionUsers.length > 0;
  const activeMentionIndex = Math.min(mentionIndex, Math.max(0, mentionUsers.length - 1));

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
    setMentionClosed(false);
    setMentionIndex(0);
  };

  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) {
      setAttFeedback({ text: 'Filen er større end 40 MB og kan ikke uploades.', tone: 'error' });
      return;
    }
    setAttLoading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = String(reader.result ?? '').split(',')[1] ?? '';
        const r = await uploadAttachment(task.id, file.name, base64);
        if (r.ok) {
          setAttFeedback({ text: `${file.name} er uploadet.`, tone: 'ok' });
          await refreshAttachments();
        } else {
          setAttFeedback({ text: r.reason ?? 'Upload mislykkedes.', tone: 'error' });
        }
      } finally {
        setAttLoading(false);
      }
    };
    reader.onerror = () => {
      setAttLoading(false);
      setAttFeedback({ text: 'Filen kunne ikke læses.', tone: 'error' });
    };
    reader.readAsDataURL(file);
  };

  const removeAttachment = async (name: string) => {
    if (!window.confirm(`Slet vedhæftningen "${name}"?`)) return;
    await deleteAttachment(task.id, name);
    await refreshAttachments();
  };

  const insertMention = (user: (typeof users)[number]) => {
    const m = comment.match(/@(\w*)$/);
    if (!m) return;
    const firstName = user.name.split(' ')[0];
    const start = m.index ?? comment.length - m[0].length;
    setComment(`${comment.slice(0, start)}@${firstName} ${comment.slice(start + m[0].length)}`);
    setMentionIndex(0);
    setMentionClosed(false);
  };

  const addToCalendar = async () => {
    if (!task.dueDate) return;
    setCalBusy(true);
    try {
      const r = await createCalendarEvent(`${taskRef(task, projects)}: ${task.title}`, task.dueDate, assignee?.email);
      setCalFeedback(
        r.ok
          ? { text: 'Begivenhed oprettet i din kalender', tone: 'ok' }
          : { text: r.reason ?? 'Begivenheden kunne ikke oprettes.', tone: 'error' },
      );
    } finally {
      setCalBusy(false);
    }
  };

  const openMovePopup = () => {
    setMoveTarget(projects.find((p) => p.id !== task.projectId)?.id ?? '');
    setMoveOpen(true);
  };

  const submitMove = () => {
    if (!moveTarget) return;
    moveTaskToProject(task.id, moveTarget);
    setMoveOpen(false);
  };

  // Kundegodkendelse: offentligt link på companion-serveren
  const approvalLink = (token: string) => `http://${window.location.hostname}:4310/public/approve/${token}`;

  const copyApprovalLink = async (token: string, message: string) => {
    try {
      await navigator.clipboard.writeText(approvalLink(token));
      setApprovalFeedback(message);
    } catch {
      setApprovalFeedback(approvalLink(token));
    }
  };

  const onRequestApproval = () => {
    const token = requestApproval(task.id);
    if (token) void copyApprovalLink(token, t('drawer.approvalLinkCopied'));
  };

  const onResetApproval = () => {
    if (window.confirm(t('drawer.approvalConfirmReset'))) clearApproval(task.id);
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

          {/* Emoji-markør */}
          <div className="relative">
            <button
              onClick={() => setEmojiOpen((o) => !o)}
              title="Vælg emoji til opgaven"
              className="grid h-8 w-8 place-items-center rounded-lg text-lg transition-colors hover:bg-zinc-100 dark:hover:bg-white/[0.07]"
            >
              <span aria-hidden="true">{task.emoji ?? '🏷️'}</span>
            </button>
            {emojiOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setEmojiOpen(false)} />
                <div className="glass-panel absolute right-0 top-full z-50 mt-1 w-56 rounded-xl p-2 shadow-panel">
                  <div className="grid grid-cols-4 gap-1">
                    {TASK_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => {
                          setTaskEmoji(task.id, emoji);
                          setEmojiOpen(false);
                        }}
                        className={cn(
                          'grid h-9 w-full place-items-center rounded-lg text-lg transition-colors hover:bg-zinc-100 dark:hover:bg-white/[0.08]',
                          task.emoji === emoji && 'bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/40',
                        )}
                      >
                        <span aria-hidden="true">{emoji}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      setTaskEmoji(task.id, null);
                      setEmojiOpen(false);
                    }}
                    className="btn-ghost mt-1.5 w-full justify-center px-2 py-1 text-xs"
                  >
                    Fjern
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Fastgør til Min dag */}
          <button
            onClick={() => togglePinDay(task.id)}
            title="Fastgør til Min dag i dag"
            className={cn(
              'grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-zinc-100 dark:hover:bg-white/[0.07]',
              pinnedToday ? 'text-indigo-500 dark:text-indigo-400' : 'text-zinc-500 dark:text-zinc-400',
            )}
          >
            {pinnedToday ? <Pin className="h-4 w-4" fill="currentColor" /> : <PinOff className="h-4 w-4" />}
          </button>
          {pinnedToday && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-300">
              <Pin className="h-3 w-3" />
              Fastgjort til i dag
            </span>
          )}

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

            {task.dueDate && (
              <div className="contents">
                <FieldLabel>Outlook</FieldLabel>
                <div>
                  <button onClick={() => void addToCalendar()} disabled={calBusy} className="btn-outline px-2.5 py-1.5 text-xs">
                    <CalendarPlus className="h-3.5 w-3.5" />
                    Tilføj til Outlook-kalender
                  </button>
                  {calFeedback && (
                    <p
                      className={cn(
                        'mt-1 text-xs font-medium',
                        calFeedback.tone === 'ok'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400',
                      )}
                    >
                      {calFeedback.text}
                    </p>
                  )}
                </div>
              </div>
            )}

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

            <FieldLabel>Påmindelse</FieldLabel>
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={reminderLocal}
                onChange={(e) => setReminder(task.id, e.target.value ? new Date(e.target.value).toISOString() : null)}
                className="input w-fit py-1.5 [color-scheme:light] dark:[color-scheme:dark]"
              />
              {task.reminderAt && (
                <button
                  onClick={() => setReminder(task.id, null)}
                  title="Fjern påmindelse"
                  className="grid h-6 w-6 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/[0.07] dark:hover:text-zinc-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

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
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={task.estimate ?? ''}
                onChange={(e) => updateTask(task.id, { estimate: e.target.value ? Number(e.target.value) : null })}
                placeholder="—"
                className="input w-24 py-1.5"
              />
              {task.estimate == null && estimateHint !== null && (
                <button
                  onClick={() => updateTask(task.id, { estimate: estimateHint })}
                  title="Brug AI-forslag baseret på gennemsnittet af lignende afsluttede opgaver"
                  className="flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[11px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-500/20 dark:text-indigo-300"
                >
                  <Sparkles className="h-3 w-3" />
                  AI: ~{estimateHint} points
                </button>
              )}
            </div>

            <FieldLabel>Milepæl</FieldLabel>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleMilestone(task.id)}
                title="Vis som milepæl på tidslinjen"
                role="checkbox"
                aria-checked={Boolean(task.isMilestone)}
                className={cn(
                  'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors',
                  task.isMilestone
                    ? 'border-indigo-500 bg-indigo-500 text-white'
                    : 'border-zinc-300 hover:border-indigo-400 dark:border-zinc-600',
                )}
              >
                {task.isMilestone && <Check className="h-3 w-3" strokeWidth={3} />}
              </button>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {task.isMilestone ? 'Vises som milepæl på tidslinjen' : 'Ikke en milepæl'}
              </span>
            </div>

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
          <TaskExecutionPanel key={task.id} task={task} />
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

          {/* Vedhæftninger */}
          <section>
            <div className="mb-2 flex items-center gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Vedhæftninger
              </h3>
              {files.length > 0 && <span className="text-[11px] text-zinc-400">{files.length}</span>}
              <span className="flex-1" />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={attLoading}
                className="btn-outline px-2 py-1 text-[11px]"
              >
                <Paperclip className="h-3 w-3" />
                Upload
              </button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePicked} />
            </div>
            {attFeedback && (
              <p
                className={cn(
                  'mb-1.5 text-xs font-medium',
                  attFeedback.tone === 'ok'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400',
                )}
              >
                {attFeedback.text}
              </p>
            )}
            {files.length === 0 ? (
              <p className="text-sm text-zinc-400">{attLoading ? 'Henter vedhæftninger …' : 'Ingen vedhæftninger'}</p>
            ) : (
              <ul className="space-y-1">
                {files.map((f) => (
                  <li
                    key={f.name}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-white/[0.04]"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-800 dark:text-zinc-100" title={f.name}>
                        {f.name}
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        {fmtSize(f.size)} · {timeAgo(f.mtime)}
                      </p>
                    </div>
                    <button onClick={() => void openAttachment(task.id, f.name)} className="btn-ghost px-2 py-1 text-[11px]">
                      Åbn
                    </button>
                    <a
                      href={attachmentUrl(task.id, f.name)}
                      download={f.name}
                      className="btn-ghost px-2 py-1 text-[11px]"
                    >
                      Hent
                    </a>
                    <button
                      onClick={() => void removeAttachment(f.name)}
                      className="btn-ghost px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                    >
                      Slet
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* High five – kun for afsluttede opgaver */}
          {task.status === 'done' && (
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                High five
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                {KUDO_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      addKudo(task.id, emoji);
                      celebrate(task.id);
                    }}
                    title="Giv et high five for leverancen"
                    className="btn-ghost px-2.5 py-1 text-base"
                  >
                    <span aria-hidden="true">{emoji}</span>
                  </button>
                ))}
                <div className="flex flex-wrap items-center gap-1.5">
                  {KUDO_EMOJIS.map((emoji) => {
                    const list = (task.kudos ?? []).filter((k) => k.emoji === emoji);
                    if (list.length === 0) return null;
                    return (
                      <span
                        key={emoji}
                        className="flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 py-0.5 pl-1 pr-2 text-xs dark:border-white/10 dark:bg-white/[0.04]"
                      >
                        <span className="flex -space-x-1.5">
                          {list.slice(0, 4).map((k, i) => (
                            <Avatar key={`${k.userId}-${i}`} user={users.find((u) => u.id === k.userId)} size="xs" />
                          ))}
                        </span>
                        <span aria-hidden="true">{emoji}</span>
                        <span className="text-[10px] font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">
                          {list.length}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* Kommentarer */}
          <section>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Kommentarer · {task.comments.length}
            </h3>
            <div className="space-y-4">
              {topLevelComments.map((c) => (
                <CommentItem
                  key={c.id}
                  taskId={task.id}
                  comment={c}
                  replies={task.comments.filter((r) => r.replyToId === c.id)}
                />
              ))}
              {task.comments.length === 0 && (
                <p className="text-sm text-zinc-400">Ingen kommentarer endnu. Start samtalen.</p>
              )}
            </div>
            <div className="mt-4 flex items-start gap-3">
              <Avatar user={me} size="sm" />
              <div className="relative flex-1">
                {showMentions && (
                  <div className="glass-panel absolute bottom-full left-0 right-0 z-30 mb-1 max-h-40 overflow-y-auto rounded-xl p-1 shadow-panel">
                    {mentionUsers.map((u, i) => (
                      <button
                        key={u.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          insertMention(u);
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                          i === activeMentionIndex
                            ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                            : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/[0.06]',
                        )}
                      >
                        <Avatar user={u} size="xs" />
                        <span className="truncate">{u.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  value={comment}
                  onChange={(e) => {
                    setComment(e.target.value);
                    setMentionClosed(false);
                    setMentionIndex(0);
                  }}
                  onKeyDown={(e) => {
                    if (showMentions) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setMentionIndex((i) => (i + 1) % mentionUsers.length);
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setMentionIndex((i) => (i - 1 + mentionUsers.length) % mentionUsers.length);
                        return;
                      }
                      if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault();
                        insertMention(mentionUsers[activeMentionIndex]);
                        return;
                      }
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setMentionClosed(true);
                        return;
                      }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitComment();
                    }
                  }}
                  rows={Math.max(1, Math.min(5, comment.split('\n').length))}
                  placeholder="Skriv en kommentar … (@ for at nævne nogen, Enter for at sende)"
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

          {/* Versionshistorik */}
          <section>
            <button
              onClick={() => setHistoryOpen((o) => !o)}
              className="flex w-full items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              <History className="h-3.5 w-3.5" />
              Historik
              {(task.history?.length ?? 0) > 0 && (
                <span className="rounded bg-zinc-500/10 px-1.5 py-px text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                  {task.history?.length}
                </span>
              )}
              <span className="flex-1" />
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', historyOpen && 'rotate-90')} />
            </button>
            {historyOpen && (
              <div className="mt-2.5">
                {(task.history?.length ?? 0) === 0 ? (
                  <p className="text-sm text-zinc-400">Ingen ændringer endnu.</p>
                ) : (
                  <ol className="relative space-y-3 border-l border-zinc-200 dark:border-white/[0.08]">
                    {(task.history ?? []).slice(0, 8).map((h, i) => (
                      <li key={`${h.at}-${i}`} className="relative ml-4">
                        <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-indigo-400 ring-4 ring-white dark:ring-[#1b1c20]" />
                        <p className="text-sm text-zinc-700 dark:text-zinc-200">
                          <span className="font-medium">{h.field}:</span>{' '}
                          <span className="text-zinc-400 dark:text-zinc-500">
                            {historyValueLabel(h.field, h.from, users, sprints)}
                          </span>
                          {' → '}
                          <span>{historyValueLabel(h.field, h.to, users, sprints)}</span>
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <Avatar user={users.find((u) => u.id === h.userId)} size="xs" />
                          <span className="text-[11px] text-zinc-400">{timeAgo(h.at)}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="relative border-t border-zinc-200/80 px-5 py-3 dark:border-white/[0.06]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-zinc-400">
              Oprettet {formatDateShort(task.createdAt)} · opdateret {formatDateShort(task.updatedAt)}
            </span>
            <span className="flex-1" />
            <button
              onClick={openMovePopup}
              title="Flyt opgaven til et andet projekt"
              className="btn-ghost px-2.5 py-1.5 text-xs"
            >
              <FolderInput className="h-3.5 w-3.5" />
              Flyt til projekt
            </button>
            <button
              onClick={() => {
                duplicateTask(task.id);
                selectTask(null);
              }}
              title="Opret en kopi af opgaven"
              className="btn-ghost px-2.5 py-1.5 text-xs"
            >
              <Copy className="h-3.5 w-3.5" />
              Duplikér
            </button>

            {/* Kundegodkendelse */}
            {!task.approval && (
              <button
                onClick={onRequestApproval}
                title={t('drawer.approvalRequest')}
                className="btn-ghost px-2.5 py-1.5 text-xs"
              >
                <ClipboardCheck className="h-3.5 w-3.5" />
                {t('drawer.approvalRequest')}
              </button>
            )}
            {task.approval?.status === 'pending' && (
              <>
                <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                  {t('drawer.approvalPending')}
                </span>
                <button
                  onClick={() => {
                    if (task.approval) void copyApprovalLink(task.approval.token, t('drawer.approvalCopied'));
                  }}
                  className="btn-ghost px-2.5 py-1.5 text-xs"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t('drawer.approvalCopyLink')}
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(t('drawer.approvalConfirmCancel'))) clearApproval(task.id);
                  }}
                  className="btn-ghost px-2.5 py-1.5 text-xs"
                >
                  {t('drawer.approvalCancel')}
                </button>
              </>
            )}
            {task.approval?.status === 'approved' && (
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                <Check className="h-3.5 w-3.5" />
                {task.approval.by
                  ? t('drawer.approvalApprovedBy').replace('{name}', task.approval.by)
                  : t('drawer.approvalApproved')}
                <button
                  onClick={onResetApproval}
                  title={t('drawer.approvalResetTitle')}
                  className="grid h-4 w-4 place-items-center rounded-full text-emerald-700/50 transition-colors hover:bg-emerald-500/20 hover:text-emerald-800 dark:text-emerald-300/50 dark:hover:text-emerald-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {task.approval?.status === 'changes' && (
              <span
                title={task.approval.comment}
                className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300"
              >
                <span className="max-w-56 truncate">
                  {task.approval.comment
                    ? t('drawer.approvalChangesComment').replace('{comment}', task.approval.comment)
                    : t('drawer.approvalChanges')}
                </span>
                <button
                  onClick={onResetApproval}
                  title={t('drawer.approvalResetTitle')}
                  className="grid h-4 w-4 place-items-center rounded-full text-amber-700/50 transition-colors hover:bg-amber-500/20 hover:text-amber-800 dark:text-amber-300/50 dark:hover:text-amber-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

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
          {approvalFeedback && (
            <p className="mt-1.5 truncate text-xs font-medium text-emerald-600 dark:text-emerald-400">{approvalFeedback}</p>
          )}
          {moveOpen && (
            <div className="glass-panel absolute bottom-full right-4 z-50 mb-2 w-64 rounded-xl p-3 shadow-panel">
              <p className="mb-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">Flyt til projekt</p>
              <select
                value={moveTarget}
                onChange={(e) => setMoveTarget(e.target.value)}
                className="input w-full py-1.5 text-xs"
              >
                {projects
                  .filter((p) => p.id !== task.projectId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <div className="mt-2 flex items-center gap-1.5">
                <button onClick={submitMove} disabled={!moveTarget} className="btn-primary px-2.5 py-1 text-xs">
                  Flyt
                </button>
                <button onClick={() => setMoveOpen(false)} className="btn-ghost px-2 py-1 text-xs">
                  Annullér
                </button>
              </div>
            </div>
          )}
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

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const REACTION_EMOJIS = ['👍', '🎉', '❤️'];
const KUDO_EMOJIS = ['👏', '🎉', '💪'];
const TASK_EMOJIS = ['🚀', '✅', '📞', '📦', '🎨', '💰', '🔧', '📣', '🐛', '📚', '🏠', '✈️', '🎉', '⏰', '🔒', '🌱'];

function CommentItem({
  taskId,
  comment,
  replies,
  isReply = false,
}: {
  taskId: string;
  comment: Comment;
  replies: Comment[];
  isReply?: boolean;
}) {
  const users = useStore((s) => s.users);
  const currentUserId = useStore((s) => s.currentUserId);
  const toggleReaction = useStore((s) => s.toggleReaction);
  const replyComment = useStore((s) => s.replyComment);
  const editComment = useStore((s) => s.editComment);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  const author = users.find((u) => u.id === comment.authorId);
  const isMine = comment.authorId === currentUserId;
  const reactions = comment.reactions ?? {};

  const submitReply = () => {
    if (!replyText.trim()) return;
    replyComment(taskId, comment.id, replyText);
    setReplyText('');
    setReplyOpen(false);
  };

  return (
    <div className={cn(isReply && 'ml-8 border-l-2 border-zinc-200 pl-3 dark:border-white/[0.08]')}>
      <div className="flex gap-3">
        <Avatar user={author} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-xs">
            <span className="font-semibold text-zinc-800 dark:text-zinc-100">{author?.name ?? 'Ukendt'}</span>{' '}
            <span className="text-zinc-400">{formatDateShort(comment.createdAt)}</span>
            {comment.editedAt && <span className="text-[10px] text-zinc-400"> (redigeret)</span>}
          </p>
          {editing ? (
            <div className="mt-0.5">
              <textarea
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={Math.max(2, Math.min(6, editText.split('\n').length))}
                className="input resize-none"
              />
              <div className="mt-1.5 flex items-center gap-1.5">
                <button
                  onClick={() => {
                    if (!editText.trim()) return;
                    editComment(taskId, comment.id, editText);
                    setEditing(false);
                  }}
                  className="btn-primary px-2.5 py-1 text-xs"
                >
                  Gem
                </button>
                <button onClick={() => setEditing(false)} className="btn-ghost px-2 py-1 text-xs">
                  Annullér
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-0.5 whitespace-pre-wrap rounded-lg rounded-tl-none bg-zinc-100 px-3 py-2 text-sm leading-relaxed dark:bg-white/[0.05]">
              {comment.text}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {REACTION_EMOJIS.map((emoji) => {
              const list = reactions[emoji] ?? [];
              const active = list.includes(currentUserId);
              return (
                <button
                  key={emoji}
                  onClick={() => toggleReaction(taskId, comment.id, emoji)}
                  title={active ? 'Fjern reaktion' : 'Reagér'}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
                    active
                      ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                      : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-white/10 dark:text-zinc-400 dark:hover:border-white/20',
                  )}
                >
                  <span>{emoji}</span>
                  {list.length > 0 && (
                    <span className="text-[10px] font-semibold tabular-nums">{list.length}</span>
                  )}
                </button>
              );
            })}
            {!isReply && (
              <button
                onClick={() => setReplyOpen((o) => !o)}
                className="ml-1 text-xs font-medium text-zinc-400 transition-colors hover:text-indigo-500 dark:hover:text-indigo-300"
              >
                Svar
              </button>
            )}
            {isMine && !editing && (
              <button
                onClick={() => {
                  setEditText(comment.text);
                  setEditing(true);
                }}
                className="text-xs font-medium text-zinc-400 transition-colors hover:text-indigo-500 dark:hover:text-indigo-300"
              >
                Redigér
              </button>
            )}
          </div>
          {replyOpen && !isReply && (
            <div className="mt-2">
              <textarea
                autoFocus
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitReply();
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setReplyOpen(false);
                  }
                }}
                rows={2}
                placeholder="Skriv et svar … (Enter for at sende, Esc for at lukke)"
                className="input resize-none"
              />
            </div>
          )}
        </div>
      </div>
      {replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {replies.map((r) => (
            <CommentItem key={r.id} taskId={taskId} comment={r} replies={[]} isReply />
          ))}
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{children}</span>
  );
}

function historyValueLabel(field: string, value: string, users: User[], sprints: Sprint[]): string {
  if (value === '' || value === '—') return '—';
  if (field === 'Status') return STATUS_META[value as TaskStatus]?.label ?? value;
  if (field === 'Prioritet') return PRIORITY_META[value as Priority]?.label ?? value;
  if (field === 'Ansvarlig') return users.find((u) => u.id === value)?.name ?? 'Ukendt';
  if (field === 'Sprint') return sprints.find((sp) => sp.id === value)?.name ?? value;
  if (field === 'Frist') return /^\d{4}-\d{2}-\d{2}/.test(value) ? formatDateShort(value) : value;
  return value;
}

function aiErrorText(reason?: string): string {
  if (reason && /not configured|konfigurer/i.test(reason)) {
    return 'AI-assistenten er ikke konfigureret – se Integrationer-fanen.';
  }
  return reason ?? 'AI-assistenten kunne ikke svare.';
}

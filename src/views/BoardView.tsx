import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarClock, Check, ChevronDown, ChevronRight, GripVertical, Lock, MessageSquare, Plus, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STATUS_META, PRIORITY_META } from '../lib/constants';
import { useLang, t } from '../lib/i18n';
import { cn, formatDateShort, isOverdue, taskRef } from '../lib/utils';
import type { Priority, Task, TaskStatus } from '../lib/types';
import { Avatar, LabelChip, PriorityBadge, ViewHeader } from '../components/common';
import ProgressRing from '../components/ProgressRing';
import Confetti from '../components/Confetti';

const PRIORITY_CYCLE: Priority[] = ['none', 'low', 'medium', 'high', 'urgent'];

const BOARD_COLUMNS: TaskStatus[] = ['todo', 'inprogress', 'inreview', 'done'];

// A full-height empty column has distant bottom corners. Nearest corners alone
// can therefore select a card in the previous column even while the moving
// card is visibly inside the empty one. Prefer actual overlap for both sensors.
const boardCollision: CollisionDetection = (args) => {
  const intersections = rectIntersection(args);
  return intersections.length ? intersections : closestCorners(args);
};

const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return sortableKeyboardCoordinates(event, args);
  const { collisionRect, droppableContainers, droppableRects } = args.context;
  if (!collisionRect) return;
  event.preventDefault();
  const columns = droppableContainers.getEnabled()
    .filter(item => /^(col:|col-uge-)/.test(String(item.id)))
    .flatMap(item => { const rect = droppableRects.get(item.id); return rect ? [rect] : []; })
    .sort((a, b) => a.left - b.left);
  const center = collisionRect.left + collisionRect.width / 2;
  const current = columns.findIndex(rect => center >= rect.left && center <= rect.right);
  if (current < 0) return;
  const target = columns[current + (event.code === 'ArrowRight' ? 1 : -1)];
  if (!target) return;
  // Adjacent columns are explicit keyboard destinations. The generic getter
  // otherwise sees the current column's padded edge as a move to the left.
  return { x: target.left + 8, y: Math.max(target.top + 8, Math.min(collisionRect.top, target.bottom - collisionRect.height - 8)) };
};

const PRIORITY_STRIPE: Record<Priority, string> = {
  urgent: 'bg-rose-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-400',
  low: 'bg-sky-400',
  none: 'bg-transparent',
};

interface WeekColumnDef {
  key: string;
  label: string;
  dropDate: string | null;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function BoardView() {
  useLang();
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const reorderTask = useStore((s) => s.reorderTask);
  const addTask = useStore((s) => s.addTask);
  const updateTask = useStore((s) => s.updateTask);

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [creating, setCreating] = useState<TaskStatus | null>(null);
  const [title, setTitle] = useState('');
  const [freshId, setFreshId] = useState<string | null>(null);
  const [boardMode, setBoardMode] = useState<'status' | 'week'>('status');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
  );

  const visible = useMemo(
    () =>
      tasks
        .filter((t) => (activeProjectId ? t.projectId === activeProjectId : true))
        .filter((t) => BOARD_COLUMNS.includes(t.status))
        .sort((a, b) => a.order - b.order),
    [tasks, activeProjectId],
  );

  const columnTasks = (status: TaskStatus) => visible.filter((t) => t.status === status);

  // "Min uge": opgaver grupperes efter frist – færdige filtreres fra
  const baseToday = startOfToday();
  const offsetDate = (offset: number) => {
    const d = new Date(baseToday);
    d.setDate(d.getDate() + offset);
    return toDateStr(d);
  };
  const weekColumns: WeekColumnDef[] = [
    { key: 'today', label: 'I dag', dropDate: offsetDate(0) },
    { key: 'tomorrow', label: 'I morgen', dropDate: offsetDate(1) },
    { key: 'later', label: 'Senere', dropDate: offsetDate(3) },
    { key: 'nextweek', label: 'Næste uge', dropDate: offsetDate(8) },
    { key: 'nodate', label: 'Uden frist', dropDate: null },
  ];
  const weekBucket = (task: Task): string => {
    if (!task.dueDate) return 'nodate';
    const diff = Math.round((new Date(`${task.dueDate}T00:00:00`).getTime() - baseToday.getTime()) / 86400000);
    if (diff <= 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff <= 7) return 'later';
    return 'nextweek';
  };
  const weekVisible = useMemo(
    () =>
      tasks
        .filter((t) => (activeProjectId ? t.projectId === activeProjectId : true))
        .filter((t) => t.status !== 'done')
        .sort((a, b) => a.order - b.order),
    [tasks, activeProjectId],
  );

  const toggleExpanded = (taskId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const submitCreate = (status: TaskStatus) => {
    const trimmed = title.trim();
    const projectId = activeProjectId ?? projects[0]?.id;
    if (!trimmed || !projectId) return;
    const task = addTask({ title: trimmed, projectId, status });
    setFreshId(task.id);
    setTitle('');
    setCreating(null);
  };

  const onDragStart = (e: DragStartEvent) => {
    const task = tasks.find((t) => t.id === e.active.id);
    setActiveTask(task ?? null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = e;
    if (!over) return;
    const taskId = String(active.id);
    const overId = String(over.id);
    if (taskId === overId) return;

    if (boardMode === 'week') {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      let colKey: string | null = null;
      if (overId.startsWith('col-uge-')) {
        colKey = overId.slice('col-uge-'.length);
      } else {
        const overTask = tasks.find((t) => t.id === overId);
        if (overTask) colKey = weekBucket(overTask);
      }
      const col = colKey ? weekColumns.find((c) => c.key === colKey) : undefined;
      if (!col || (task.dueDate ?? null) === col.dropDate) return;
      updateTask(taskId, { dueDate: col.dropDate });
      return;
    }

    let targetStatus: TaskStatus;
    let targetIndex: number;

    if (overId.startsWith('col:')) {
      targetStatus = overId.slice(4) as TaskStatus;
      targetIndex = columnTasks(targetStatus).filter((t) => t.id !== taskId).length;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask) return;
      targetStatus = overTask.status;
      // The target is its original index. Filtering the active task first
      // made a one-step downward move resolve back to its existing position.
      targetIndex = columnTasks(targetStatus).findIndex((t) => t.id === overId);
      if (targetIndex < 0) targetIndex = columnTasks(targetStatus).length;
    }
    reorderTask(taskId, targetStatus, targetIndex);
  };

  const destinationLabel = (id: string) => {
    if (id.startsWith('col:')) return STATUS_META[id.slice(4) as TaskStatus]?.label;
    if (id.startsWith('col-uge-')) return weekColumns.find(column => column.key === id.slice(8))?.label;
    const task = tasks.find(item => item.id === id);
    if (!task) return undefined;
    const column = boardMode === 'week' ? weekColumns.find(item => item.key === weekBucket(task))?.label : STATUS_META[task.status].label;
    return `${column}, ved ${task.title}`;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4 lg:px-6 lg:pt-6">
        <ViewHeader
          title={t('board.title')}
          subtitle={t('board.subtitle')}
          actions={
            <div className="flex items-center gap-0.5 rounded-full border border-zinc-200 bg-zinc-50 p-0.5 dark:border-white/10 dark:bg-white/[0.03]">
              <button
                type="button"
                aria-pressed={boardMode === 'status'}
                onClick={() => setBoardMode('status')}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                  boardMode === 'status'
                    ? 'bg-indigo-500 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100',
                )}
              >
                Status
              </button>
              <button
                type="button"
                aria-pressed={boardMode === 'week'}
                onClick={() => setBoardMode('week')}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                  boardMode === 'week'
                    ? 'bg-indigo-500 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100',
                )}
              >
                Min uge
              </button>
            </div>
          }
        />
      </div>
      <p className="px-4 pb-3 text-xs text-zinc-500 dark:text-zinc-400 lg:px-6">Åbn en opgave på titlen. Brug flyttegrebet med musen eller mellemrum og piletaster; Escape annullerer.</p>
      <DndContext sensors={sensors} collisionDetection={boardCollision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveTask(null)}
        accessibility={{
          screenReaderInstructions: { draggable: 'Tryk mellemrum eller Enter på flyttegrebet for at flytte opgaven. Brug piletaster til at vælge position og kolonne. Tryk mellemrum eller Enter for at placere den, eller Escape for at annullere.' },
          announcements: {
            onDragStart: ({ active }) => `Flytter ${tasks.find(task => task.id === active.id)?.title ?? 'opgave'}. Brug piletasterne.`,
            onDragOver: ({ over }) => over ? `Valgt placering: ${destinationLabel(String(over.id)) ?? 'opgavens position'}.` : 'Ingen placering valgt.',
            onDragEnd: ({ active }) => {
              const task = useStore.getState().tasks.find(item => item.id === active.id);
              return task ? `Flytning afsluttet. ${task.title} ligger i ${boardMode === 'week' ? weekColumns.find(column => column.key === weekBucket(task))?.label : STATUS_META[task.status].label}.` : 'Flytning afsluttet.';
            },
            onDragCancel: () => 'Flytningen er annulleret. Opgaven er ikke ændret.',
          },
        }}>
        <div className="flex flex-1 gap-4 overflow-x-auto px-4 pb-4 lg:px-6 lg:pb-6">
          {boardMode === 'status'
            ? BOARD_COLUMNS.map((status) => (
                <BoardColumn
                  key={status}
                  status={status}
                  tasks={columnTasks(status)}
                  creating={creating === status}
                  draft={creating === status ? title : ''}
                  freshId={freshId}
                  expandedIds={expandedIds}
                  onToggleExpand={toggleExpanded}
                  onDraftChange={setTitle}
                  onStartCreate={() => {
                    setCreating(status);
                    setTitle('');
                  }}
                  onCancelCreate={() => setCreating(null)}
                  onSubmit={() => submitCreate(status)}
                />
              ))
            : weekColumns.map((col) => (
                <WeekColumn
                  key={col.key}
                  column={col}
                  tasks={weekVisible.filter((t) => weekBucket(t) === col.key)}
                  expandedIds={expandedIds}
                  onToggleExpand={toggleExpanded}
                />
              ))}
        </div>
        <DragOverlay>{activeTask && <div aria-hidden="true" className="rounded-2xl border border-indigo-400 bg-white p-4 shadow-panel dark:bg-[#232429]"><p className="text-sm font-medium">{activeTask.title}</p><p className="mt-1 text-xs text-zinc-500">{STATUS_META[activeTask.status].label}</p></div>}</DragOverlay>
      </DndContext>
      <Confetti />
    </div>
  );
}

function BoardColumn({
  status,
  tasks,
  creating,
  draft,
  freshId,
  expandedIds,
  onToggleExpand,
  onDraftChange,
  onStartCreate,
  onCancelCreate,
  onSubmit,
}: {
  status: TaskStatus;
  tasks: Task[];
  creating: boolean;
  draft: string;
  freshId: string | null;
  expandedIds: Set<string>;
  onToggleExpand: (taskId: string) => void;
  onDraftChange: (v: string) => void;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onSubmit: () => void;
}) {
  const meta = STATUS_META[status];
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  const projectCount = tasks.length;
  const activeProjectId = useStore((s) => s.activeProjectId);
  useLang();

  return (
    <section aria-label={`Kolonne: ${meta.label}`} className="flex w-[300px] shrink-0 flex-col rounded-2xl border border-zinc-200/80 bg-zinc-50/80 dark:border-white/[0.05] dark:bg-white/[0.02]">
      <header className="flex items-center gap-2 px-3.5 pb-2 pt-3">
        <span className={cn('h-2 w-2 rounded-full', meta.dot)} />
        <h2 className="text-[13px] font-semibold">{meta.label}</h2>
        <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-zinc-200/80 px-1.5 py-px text-center text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
          {projectCount}
        </span>
        <button
          onClick={onStartCreate}
          title={t('board.addTask')}
          aria-label={`Tilføj opgave i ${meta.label}`}
          className="ml-auto grid h-6 w-6 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200/80 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100"
        >
          <Plus className="h-4 w-4" />
        </button>
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto rounded-b-2xl p-2 transition-colors',
          isOver && 'bg-indigo-500/[0.04] ring-1 ring-inset ring-indigo-500/20',
        )}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="stagger flex flex-col gap-2" key={activeProjectId ?? 'alle'}>
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                fresh={task.id === freshId}
                expanded={expandedIds.has(task.id)}
                onToggleExpand={onToggleExpand}
              />
            ))}
          </div>
        </SortableContext>

        {creating && (
          <div className="animate-fade-in rounded-xl border border-indigo-500/40 bg-white p-2.5 shadow-card dark:bg-[#232429]">
            <input
              autoFocus
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSubmit();
                if (e.key === 'Escape') onCancelCreate();
              }}
              placeholder={t('board.taskTitlePlaceholder')}
              className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
            />
            <div className="mt-2 flex items-center gap-1.5">
              <button onClick={onSubmit} className="btn-primary px-2.5 py-1 text-xs">
                {t('board.create')}
              </button>
              <button onClick={onCancelCreate} className="btn-ghost px-2 py-1 text-xs">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {tasks.length === 0 && !creating && (
          <button
            onClick={onStartCreate}
            className="grid flex-1 place-items-center rounded-xl border border-dashed border-zinc-300 py-6 text-xs text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-500 dark:border-white/10 dark:text-zinc-500 dark:hover:border-white/20"
          >
            {t('board.emptyColumn')}
          </button>
        )}
      </div>
    </section>
  );
}

function WeekColumn({
  column,
  tasks,
  expandedIds,
  onToggleExpand,
}: {
  column: WeekColumnDef;
  tasks: Task[];
  expandedIds: Set<string>;
  onToggleExpand: (taskId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-uge-${column.key}` });
  const activeProjectId = useStore((s) => s.activeProjectId);

  return (
    <section aria-label={`Kolonne: ${column.label}`} className="flex w-[300px] shrink-0 flex-col rounded-2xl border border-zinc-200/80 bg-zinc-50/80 dark:border-white/[0.05] dark:bg-white/[0.02]">
      <header className="flex items-center gap-2 px-3.5 pb-2 pt-3">
        <h2 className="text-[13px] font-semibold">{column.label}</h2>
        <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-zinc-200/80 px-1.5 py-px text-center text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
          {tasks.length}
        </span>
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto rounded-b-2xl p-2 transition-colors',
          isOver && 'bg-indigo-500/[0.04] ring-1 ring-inset ring-indigo-500/20',
        )}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="stagger flex flex-col gap-2" key={activeProjectId ?? 'alle'}>
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                expanded={expandedIds.has(task.id)}
                onToggleExpand={onToggleExpand}
              />
            ))}
          </div>
        </SortableContext>

        {tasks.length === 0 && (
          <div className="grid flex-1 place-items-center rounded-xl border border-dashed border-zinc-300 py-6 text-xs text-zinc-400 dark:border-white/10 dark:text-zinc-500">
            Træk opgaver hertil
          </div>
        )}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  fresh = false,
  expanded = false,
  onToggleExpand,
}: {
  task: Task;
  fresh?: boolean;
  expanded?: boolean;
  onToggleExpand?: (taskId: string) => void;
}) {
  useLang();
  const selectTask = useStore((s) => s.selectTask);
  const updateTask = useStore((s) => s.updateTask);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const labels = useStore((s) => s.labels);
  const allTasks = useStore((s) => s.tasks);
  const timeEntries = useStore((s) => s.timeEntries);
  const addSubtask = useStore((s) => s.addSubtask);
  const toggleSubtask = useStore((s) => s.toggleSubtask);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const [subtaskDraft, setSubtaskDraft] = useState('');

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const assignee = users.find((u) => u.id === task.assigneeId);
  const overdue = isOverdue(task);
  const subtaskDone = task.subtasks.filter((st) => st.done).length;
  const subtaskPct = task.subtasks.length ? Math.round((subtaskDone / task.subtasks.length) * 100) : task.status === 'done' ? 100 : 0;
  const taskLabels = labels.filter((l) => task.labelIds.includes(l.id));
  const subtasksOpen = expanded && task.subtasks.length > 0;

  const activeEntry = timeEntries.find((e) => e.taskId === task.id && e.endedAt === null) ?? null;
  const blockedIds = task.blockedBy ?? [];
  const hasBlockers = blockedIds.length > 0;
  const hasOpenBlocker = hasBlockers && blockedIds.some((id) => allTasks.find((t) => t.id === id)?.status !== 'done');

  const cyclePriority = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(task.priority) + 1) % PRIORITY_CYCLE.length];
    updateTask(task.id, { priority: next });
  };

  const submitSubtask = () => {
    if (!subtaskDraft.trim()) return;
    addSubtask(task.id, subtaskDraft);
    setSubtaskDraft('');
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      aria-label={task.title}
      onClick={() => selectTask(task.id)}
      className={cn(
        'card-luxe group relative cursor-pointer select-none rounded-2xl border border-zinc-200/90 bg-white p-3 pl-4 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-panel dark:border-white/[0.07] dark:bg-[#232429] dark:hover:border-white/[0.15]',
        fresh && 'animate-fade-in',
        task.status === 'done' && 'celebrate-pulse',
        isDragging && 'opacity-30',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute left-0 top-3 bottom-3 w-[3px] rounded-full', PRIORITY_STRIPE[task.priority])}
      />

      {taskLabels.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {taskLabels.slice(0, 3).map((l) => (
            <LabelChip key={l.id} name={l.name} color={l.color} />
          ))}
          {taskLabels.length > 3 && (
            <span className="text-[10px] text-zinc-400">+{taskLabels.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-start gap-1.5">
        <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
          aria-label={`Flyt opgave: ${task.title}`} title="Flyt opgave · mellemrum og piletaster"
          onClick={event => event.stopPropagation()}
          className="-ml-1 grid h-6 w-6 shrink-0 cursor-grab touch-none place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 active:cursor-grabbing dark:hover:bg-white/10">
          <GripVertical size={15} aria-hidden="true" />
        </button>
        {task.subtasks.length > 0 && onToggleExpand && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(task.id);
            }}
            title={subtasksOpen ? 'Skjul underopgaver' : 'Vis underopgaver'}
            aria-expanded={subtasksOpen}
            className="grid h-4 w-4 shrink-0 place-items-center rounded text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            {subtasksOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        )}
        {task.emoji && (
          <span className="text-base leading-none" aria-hidden="true">
            {task.emoji}
          </span>
        )}
        <button type="button" aria-label={`Åbn opgave: ${task.title}`} onClick={event => { event.stopPropagation(); selectTask(task.id); }} className="min-w-0 flex-1 rounded text-left text-[13px] font-medium leading-snug text-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-zinc-100">{task.title}</button>
      </div>

      <div className="mt-3 flex items-center gap-2.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        {task.aiDelivery && <span className={cn('rounded px-1.5 py-0.5 text-[10px]', task.aiDelivery.status === 'done' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : ['running', 'awaiting_approval'].includes(task.aiDelivery.status) ? 'bg-indigo-500/10 text-indigo-500' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400')} title={`Orbit-kørsel ${task.aiDelivery.runId}`}>Orbit · {({ running: 'arbejder', awaiting_approval: 'afventer plan', done: 'leveret', error: 'fejlet', blocked: 'blokeret', partial: 'delvist leveret', cancelled: 'stoppet', interrupted: 'afbrudt' } as Record<string, string>)[task.aiDelivery.status] ?? task.aiDelivery.status}</span>}
        <span className="font-mono text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">
          {taskRef(task, projects)}
        </span>

        {task.subtasks.length > 0 && (
          <span
            className="flex items-center gap-1"
            title={t('board.subtasksTitle').replace('{done}', String(subtaskDone)).replace('{total}', String(task.subtasks.length))}
          >
            <ProgressRing value={subtaskPct} size={18} stroke={2.5} />
            <span className="text-[10px] tabular-nums">
              {subtaskDone}/{task.subtasks.length}
            </span>
          </span>
        )}
        {task.comments.length > 0 && (
          <span className="flex items-center gap-1" title={t('board.commentsTitle').replace('{count}', String(task.comments.length))}>
            <MessageSquare className="h-3.5 w-3.5" />
            {task.comments.length}
          </span>
        )}

        <span className="flex-1" />

        {activeEntry && (
          <span
            title={t('board.timeTracking')}
            className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            {fmtHM(now - new Date(activeEntry.startedAt).getTime())}
          </span>
        )}
        {hasBlockers && (
          <span title={t('board.hasDependencies')} className="shrink-0">
            <Lock
              className={cn(
                'h-3.5 w-3.5',
                hasOpenBlocker ? 'text-amber-500 dark:text-amber-400' : 'text-zinc-400 dark:text-zinc-500',
              )}
            />
          </span>
        )}

        <button
          onClick={cyclePriority}
          title={t('board.priorityTitle').replace('{label}', PRIORITY_META[task.priority].label)}
          className="shrink-0 rounded p-0.5 transition-transform hover:scale-125"
        >
          <PriorityBadge priority={task.priority} showLabel={false} />
        </button>

        {task.dueDate && (
          <span
            title={t('board.dueTitle').replace('{date}', formatDateShort(task.dueDate))}
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium',
              overdue
                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                : 'bg-zinc-100 text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400',
            )}
          >
            <CalendarClock className="h-3 w-3" />
            {formatDateShort(task.dueDate)}
          </span>
        )}
        <Avatar user={assignee} size="xs" />
      </div>

      {subtasksOpen && (
        <div className="mt-2.5 space-y-1 border-t border-zinc-100 pt-2 dark:border-white/[0.06]">
          {task.subtasks.map((st) => (
            <div key={st.id} className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSubtask(task.id, st.id);
                }}
                title={st.done ? 'Markér som ikke færdig' : 'Markér som færdig'}
                aria-label={`${st.done ? 'Markér som ikke færdig' : 'Markér som færdig'}: ${st.title}`}
                aria-pressed={st.done}
                className={cn(
                  'grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border transition-colors',
                  st.done
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-zinc-300 hover:border-indigo-400 dark:border-zinc-600',
                )}
              >
                {st.done && <Check className="h-3 w-3" strokeWidth={3} />}
              </button>
              <span className={cn('truncate text-xs', st.done && 'text-zinc-400 line-through decoration-zinc-400/60')}>
                {st.title}
              </span>
            </div>
          ))}
          <div
            className="flex items-center gap-2 pt-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Plus className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <input
              value={subtaskDraft}
              onChange={(e) => setSubtaskDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitSubtask();
                }
              }}
              placeholder="Tilføj underopgave …"
              className="w-full bg-transparent py-0.5 text-xs outline-none placeholder:text-zinc-400"
            />
          </div>
        </div>
      )}
    </article>
  );
}

function fmtHM(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}t ${m}m`;
}

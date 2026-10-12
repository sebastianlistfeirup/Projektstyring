import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarClock, CheckSquare, MessageSquare, Plus, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STATUS_META, PRIORITY_META } from '../lib/constants';
import { cn, formatDateShort, isOverdue, taskRef } from '../lib/utils';
import type { Priority, Task, TaskStatus } from '../lib/types';
import { Avatar, LabelChip, PriorityBadge, ProgressBar, ViewHeader } from '../components/common';

const PRIORITY_CYCLE: Priority[] = ['none', 'low', 'medium', 'high', 'urgent'];

const BOARD_COLUMNS: TaskStatus[] = ['todo', 'inprogress', 'inreview', 'done'];

export default function BoardView() {
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const reorderTask = useStore((s) => s.reorderTask);
  const addTask = useStore((s) => s.addTask);

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [creating, setCreating] = useState<TaskStatus | null>(null);
  const [title, setTitle] = useState('');
  const [freshId, setFreshId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const visible = useMemo(
    () =>
      tasks
        .filter((t) => (activeProjectId ? t.projectId === activeProjectId : true))
        .filter((t) => BOARD_COLUMNS.includes(t.status))
        .sort((a, b) => a.order - b.order),
    [tasks, activeProjectId],
  );

  const columnTasks = (status: TaskStatus) => visible.filter((t) => t.status === status);

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

    let targetStatus: TaskStatus;
    let targetIndex: number;

    if (overId.startsWith('col:')) {
      targetStatus = overId.slice(4) as TaskStatus;
      targetIndex = columnTasks(targetStatus).filter((t) => t.id !== taskId).length;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask) return;
      targetStatus = overTask.status;
      targetIndex = columnTasks(targetStatus)
        .filter((t) => t.id !== taskId)
        .findIndex((t) => t.id === overId);
      if (targetIndex < 0) targetIndex = columnTasks(targetStatus).length;
    }
    reorderTask(taskId, targetStatus, targetIndex);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4 lg:px-6 lg:pt-6">
        <ViewHeader title="Tavle" subtitle="Træk opgaver frem mod målet" />
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex flex-1 gap-4 overflow-x-auto px-4 pb-4 lg:px-6 lg:pb-6">
          {BOARD_COLUMNS.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              tasks={columnTasks(status)}
              creating={creating === status}
              draft={creating === status ? title : ''}
              freshId={freshId}
              onDraftChange={setTitle}
              onStartCreate={() => {
                setCreating(status);
                setTitle('');
              }}
              onCancelCreate={() => setCreating(null)}
              onSubmit={() => submitCreate(status)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask && <TaskCard task={activeTask} dragging />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function BoardColumn({
  status,
  tasks,
  creating,
  draft,
  freshId,
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
  onDraftChange: (v: string) => void;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onSubmit: () => void;
}) {
  const meta = STATUS_META[status];
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  const projectCount = tasks.length;

  return (
    <section className="flex w-[300px] shrink-0 flex-col rounded-2xl border border-zinc-200/80 bg-zinc-50/80 dark:border-white/[0.05] dark:bg-white/[0.02]">
      <header className="flex items-center gap-2 px-3.5 pb-2 pt-3">
        <span className={cn('h-2 w-2 rounded-full', meta.dot)} />
        <h2 className="text-[13px] font-semibold">{meta.label}</h2>
        <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-zinc-200/80 px-1.5 py-px text-center text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
          {projectCount}
        </span>
        <button
          onClick={onStartCreate}
          title="Tilføj opgave"
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
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} fresh={task.id === freshId} />
          ))}
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
              placeholder="Opgavetitel …"
              className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
            />
            <div className="mt-2 flex items-center gap-1.5">
              <button onClick={onSubmit} className="btn-primary px-2.5 py-1 text-xs">
                Opret
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
            Træk en opgave hertil, eller opret en
          </button>
        )}
      </div>
    </section>
  );
}

function TaskCard({ task, dragging = false, fresh = false }: { task: Task; dragging?: boolean; fresh?: boolean }) {
  const selectTask = useStore((s) => s.selectTask);
  const updateTask = useStore((s) => s.updateTask);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const labels = useStore((s) => s.labels);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const assignee = users.find((u) => u.id === task.assigneeId);
  const overdue = isOverdue(task);
  const subtaskDone = task.subtasks.filter((st) => st.done).length;
  const subtaskPct = task.subtasks.length ? Math.round((subtaskDone / task.subtasks.length) * 100) : task.status === 'done' ? 100 : 0;
  const taskLabels = labels.filter((l) => task.labelIds.includes(l.id));

  const cyclePriority = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(task.priority) + 1) % PRIORITY_CYCLE.length];
    updateTask(task.id, { priority: next });
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => selectTask(task.id)}
      className={cn(
        'group cursor-grab select-none rounded-xl border border-zinc-200/90 bg-white p-3 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-panel active:cursor-grabbing dark:border-white/[0.07] dark:bg-[#232429] dark:hover:border-white/[0.15]',
        fresh && 'animate-fade-in',
        (isDragging || dragging) && 'rotate-2 opacity-90 shadow-panel',
        isDragging && 'opacity-30',
      )}
    >
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

      <p className="text-[13px] font-medium leading-snug text-zinc-800 dark:text-zinc-100">{task.title}</p>

      <div className="mt-3 flex items-center gap-2.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="font-mono text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">
          {taskRef(task, projects)}
        </span>

        {task.subtasks.length > 0 && (
          <span className="flex items-center gap-1" title={`${subtaskDone}/${task.subtasks.length} delopgaver`}>
            <CheckSquare className="h-3.5 w-3.5" />
            <span className="tabular-nums">
              {subtaskDone}/{task.subtasks.length}
            </span>
          </span>
        )}
        {task.comments.length > 0 && (
          <span className="flex items-center gap-1" title={`${task.comments.length} kommentarer`}>
            <MessageSquare className="h-3.5 w-3.5" />
            {task.comments.length}
          </span>
        )}

        <span className="flex-1" />

        <button
          onClick={cyclePriority}
          title={`Prioritet: ${PRIORITY_META[task.priority].label} – klik for at ændre`}
          className="shrink-0 rounded p-0.5 transition-transform hover:scale-125"
        >
          <PriorityBadge priority={task.priority} showLabel={false} />
        </button>

        {task.dueDate && (
          <span
            title={`Frist: ${formatDateShort(task.dueDate)}`}
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

      {task.subtasks.length > 0 && <ProgressBar value={subtaskPct} className="mt-2.5" />}
    </article>
  );
}

import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { Check, ChevronDown, ChevronRight, GripVertical, ListChecks, Play, Plus } from 'lucide-react';
import { useStore } from '../store/useStore';
import { SPRINT_META, STATUS_META } from '../lib/constants';
import { cn, formatDateShort, taskRef } from '../lib/utils';
import { Avatar, EmptyState, PriorityBadge, ViewHeader } from '../components/common';
import type { Sprint, Task } from '../lib/types';

function pointsOf(tasks: Task[]): number {
  return tasks.reduce((sum, t) => sum + (t.estimate ?? 0), 0);
}

function RowBody({ task }: { task: Task }) {
  const users = useStore((s) => s.users);
  const projects = useStore((s) => s.projects);
  const selectTask = useStore((s) => s.selectTask);
  const assignee = users.find((u) => u.id === task.assigneeId);
  return (
    <>
      <span className="w-14 shrink-0 text-xs font-bold tabular-nums text-zinc-500 dark:text-zinc-400">
        {taskRef(task, projects)}
      </span>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_META[task.status].dot)} />
      <button
        onClick={() => selectTask(task.id)}
        title={task.title}
        className="min-w-0 flex-1 truncate text-left text-sm text-zinc-800 transition-colors hover:text-indigo-600 dark:text-zinc-200 dark:hover:text-indigo-300"
      >
        {task.title}
      </button>
      <span className="flex w-6 shrink-0 justify-end">
        <PriorityBadge priority={task.priority} showLabel={false} />
      </span>
      <span className="w-8 shrink-0 rounded bg-zinc-100 px-1 py-0.5 text-center text-[11px] font-medium tabular-nums text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
        {task.estimate ?? '–'}
      </span>
      <span className="flex w-5 shrink-0 justify-end">
        <Avatar user={assignee} size="xs" />
      </span>
    </>
  );
}

function DraggableRow({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-11 items-center gap-2.5 border-b border-zinc-200/70 px-3 transition-colors last:border-0 dark:border-white/[0.05]',
        isDragging && 'opacity-30',
      )}
    >
      <button
        {...listeners}
        {...attributes}
        title="Træk for at flytte til anden sprint"
        className="grid h-6 w-4 shrink-0 cursor-grab touch-none place-items-center rounded text-zinc-400 transition-colors hover:text-zinc-600 active:cursor-grabbing dark:text-zinc-600 dark:hover:text-zinc-300"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <RowBody task={task} />
    </div>
  );
}

function AddTaskRow({ sprintId }: { sprintId: string | null }) {
  const addTask = useStore((s) => s.addTask);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed || !activeProjectId) return;
    addTask({ title: trimmed, projectId: activeProjectId, sprintId, status: sprintId ? 'todo' : 'backlog' });
    setTitle('');
  };

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="flex w-full items-center gap-2 px-4 py-2 text-sm text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <Plus className="h-4 w-4" />
        Tilføj opgave
      </button>
    );
  }
  return (
    <div className="px-4 py-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') {
            setTitle('');
            setAdding(false);
          }
        }}
        onBlur={() => {
          if (!title.trim()) setAdding(false);
        }}
        placeholder="Opgavetitel … (Enter for at oprette)"
        className="input py-1.5 text-sm"
      />
    </div>
  );
}

function SprintSection({ sprint, droppable }: { sprint: Sprint | null; droppable: boolean }) {
  const tasks = useStore((s) => s.tasks);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setSprintStatus = useStore((s) => s.setSprintStatus);
  const { setNodeRef, isOver } = useDroppable({ id: sprint?.id ?? 'none', disabled: !droppable });

  const sectionTasks = useMemo(() => {
    const list = sprint
      ? tasks.filter((t) => t.sprintId === sprint.id)
      : tasks.filter((t) => t.projectId === activeProjectId && t.sprintId === null);
    return [...list].sort((a, b) => a.order - b.order);
  }, [tasks, sprint, activeProjectId]);

  const points = pointsOf(sectionTasks);

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'glass-panel overflow-hidden rounded-xl transition-shadow',
        isOver && 'ring-2 ring-indigo-500/60 dark:ring-indigo-400/60',
      )}
    >
      {sprint ? (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-200/80 px-4 py-3 dark:border-white/[0.06]">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{sprint.name}</h3>
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', SPRINT_META[sprint.status].badge)}>
            {SPRINT_META[sprint.status].label}
          </span>
          <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            {formatDateShort(sprint.startDate)} – {formatDateShort(sprint.endDate)}
          </span>
          {sprint.goal ? (
            <span
              title={sprint.goal}
              className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400"
            >
              {sprint.goal}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-white/[0.07] dark:text-zinc-300">
            {points} pts
          </span>
          {sprint.status === 'planned' && (
            <button
              className="btn-outline py-1 text-xs"
              onClick={() => {
                if (window.confirm(`Start ${sprint.name}? Sprintet markeres som aktivt.`)) {
                  setSprintStatus(sprint.id, 'active');
                }
              }}
            >
              <Play className="h-3.5 w-3.5" />
              Start sprint
            </button>
          )}
          {sprint.status === 'active' && (
            <button
              className="btn-outline py-1 text-xs"
              onClick={() => {
                if (window.confirm(`Afslut ${sprint.name}? Opgaverne i sprintet beholdes.`)) {
                  setSprintStatus(sprint.id, 'completed');
                }
              }}
            >
              <Check className="h-3.5 w-3.5" />
              Afslut sprint
            </button>
          )}
        </header>
      ) : (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-200/80 px-4 py-3 dark:border-white/[0.06]">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Backlog</h3>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {sectionTasks.length} {sectionTasks.length === 1 ? 'opgave' : 'opgaver'}
          </span>
          <span className="flex-1" />
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-white/[0.07] dark:text-zinc-300">
            {points} pts
          </span>
        </header>
      )}

      <div>
        {sectionTasks.length === 0 && (
          <p className="px-4 py-3 text-sm text-zinc-400 dark:text-zinc-600">
            {sprint ? 'Ingen opgaver i denne sprint endnu.' : 'Backloggen er tom — træk opgaver hertil eller opret en ny.'}
          </p>
        )}
        {sectionTasks.map((t) => (
          <DraggableRow key={t.id} task={t} />
        ))}
      </div>

      <AddTaskRow sprintId={sprint?.id ?? null} />
    </section>
  );
}

function NewSprintForm({ onClose }: { onClose: () => void }) {
  const addSprint = useStore((s) => s.addSprint);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const submit = () => {
    if (!name.trim() || !startDate || !endDate || !activeProjectId) return;
    addSprint(activeProjectId, name.trim(), startDate, endDate, '');
    onClose();
  };

  return (
    <div className="glass-panel animate-slide-up rounded-xl p-4">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Sprint-navn, fx Sprint 17 …"
        className="input text-sm"
      />
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Startdato
          </span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Slutdato
          </span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input text-sm" />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={submit} disabled={!name.trim() || !startDate || !endDate} className="btn-primary">
          <Plus className="h-4 w-4" />
          Opret sprint
        </button>
        <button onClick={onClose} className="btn-ghost">
          Annuller
        </button>
      </div>
    </div>
  );
}

export default function BacklogView() {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const sprints = useStore((s) => s.sprints);
  const tasks = useStore((s) => s.tasks);
  const moveTaskToSprint = useStore((s) => s.moveTaskToSprint);

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [addingSprint, setAddingSprint] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const projectSprints = useMemo(
    () => sprints.filter((sp) => sp.projectId === activeProjectId),
    [sprints, activeProjectId],
  );
  const active = useMemo(
    () => projectSprints.filter((sp) => sp.status === 'active').sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [projectSprints],
  );
  const planned = useMemo(
    () => projectSprints.filter((sp) => sp.status === 'planned').sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [projectSprints],
  );
  const completed = useMemo(
    () => projectSprints.filter((sp) => sp.status === 'completed').sort((a, b) => b.endDate.localeCompare(a.endDate)),
    [projectSprints],
  );
  const completedTasks = useMemo(
    () =>
      completed.map((sp) => ({
        sprint: sp,
        tasks: tasks.filter((t) => t.sprintId === sp.id),
      })),
    [completed, tasks],
  );
  const completedPoints = completedTasks.reduce((sum, g) => sum + pointsOf(g.tasks), 0);

  const activeTask = activeDragId ? tasks.find((t) => t.id === activeDragId) : undefined;

  const onDragStart = (e: DragStartEvent) => setActiveDragId(String(e.active.id));
  const onDragCancel = () => setActiveDragId(null);
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    const taskId = String(e.active.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const target = overId === 'none' ? null : overId;
    if ((task.sprintId ?? null) !== target) {
      moveTaskToSprint(taskId, target);
    }
  };

  if (!activeProjectId) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl p-4 lg:p-6">
          <ViewHeader title="Backlog & Sprints" subtitle="Planlæg sprints og prioritér backloggen" />
          <EmptyState
            icon={<ListChecks className="h-6 w-6" />}
            title="Intet projekt valgt"
            description="Vælg et projekt i venstre sidepanel for at se backlog og sprints."
          />
        </div>
      </div>
    );
  }

  const project = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl p-4 lg:p-6">
        <ViewHeader
          title="Backlog & Sprints"
          subtitle={project ? `${project.name} · Træk opgaver mellem sprints, eller opret nye direkte i en sektion.` : 'Træk opgaver mellem sprints, eller opret nye direkte i en sektion.'}
          actions={
            <button onClick={() => setAddingSprint((v) => !v)} className="btn-outline">
              <Plus className="h-4 w-4" />
              Ny sprint
            </button>
          }
        />

        <div className="space-y-4">
        {addingSprint && <NewSprintForm onClose={() => setAddingSprint(false)} />}

        <DndContext sensors={sensors} onDragStart={onDragStart} onDragCancel={onDragCancel} onDragEnd={onDragEnd}>
          <div className="space-y-4">
            {active.map((sp) => (
              <SprintSection key={sp.id} sprint={sp} droppable />
            ))}
            {planned.map((sp) => (
              <SprintSection key={sp.id} sprint={sp} droppable />
            ))}
            <SprintSection sprint={null} droppable />

            {completed.length > 0 && (
              <section className="glass-panel overflow-hidden rounded-xl">
                <button
                  onClick={() => setShowCompleted((v) => !v)}
                  className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-zinc-700 transition-colors hover:text-zinc-900 dark:text-zinc-200 dark:hover:text-white"
                >
                  {showCompleted ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Afsluttede sprints
                  <span className="text-xs font-normal tabular-nums text-zinc-500 dark:text-zinc-400">
                    {completed.length}
                  </span>
                  <span className="ml-auto rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-500 dark:bg-white/[0.07] dark:text-zinc-400">
                    {completedPoints} pts
                  </span>
                </button>
                {showCompleted && (
                  <div className="space-y-4 border-t border-zinc-200/80 p-4 dark:border-white/[0.06]">
                    {completedTasks.map(({ sprint, tasks: spTasks }) => (
                      <CompletedSprint key={sprint.id} sprint={sprint} tasks={spTasks} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeTask ? (
              <div className="flex h-11 rotate-2 scale-105 items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-3 shadow-panel dark:border-white/10 dark:bg-[#1e1f24]">
                <GripVertical className="h-4 w-4 shrink-0 text-zinc-400" />
                <RowBody task={activeTask} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
        </div>
      </div>
    </div>
  );
}

function CompletedSprint({ sprint, tasks }: { sprint: Sprint; tasks: Task[] }) {
  const sorted = [...tasks].sort((a, b) => a.order - b.order);
  return (
    <section className="glass-panel overflow-hidden rounded-xl opacity-80">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-200/80 px-4 py-2.5 dark:border-white/[0.06]">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{sprint.name}</h3>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', SPRINT_META[sprint.status].badge)}>
          {SPRINT_META[sprint.status].label}
        </span>
        <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {formatDateShort(sprint.startDate)} – {formatDateShort(sprint.endDate)}
        </span>
        {sprint.goal && (
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">{sprint.goal}</span>
        )}
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-500 dark:bg-white/[0.07] dark:text-zinc-400">
          {pointsOf(tasks)} pts
        </span>
      </header>
      <div>
        {sorted.length === 0 && <p className="px-4 py-2.5 text-sm text-zinc-400 dark:text-zinc-600">Ingen opgaver.</p>}
        {sorted.map((t) => (
          <DraggableRow key={t.id} task={t} />
        ))}
      </div>
    </section>
  );
}

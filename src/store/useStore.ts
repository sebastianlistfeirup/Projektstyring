import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import type { ActivityEntry, Priority, Project, Sprint, SprintStatus, Task, TaskStatus, Theme, User, Label } from '../lib/types';
import { seedActivity, seedLabels, seedProjects, seedSprints, seedTasks, seedUsers } from '../data/seed';

export interface NewTaskInput {
  title: string;
  projectId: string;
  status?: TaskStatus;
  sprintId?: string | null;
  assigneeId?: string | null;
  priority?: Priority;
  description?: string;
  dueDate?: string | null;
  estimate?: number | null;
}

interface OrbitState {
  theme: Theme;
  currentUserId: string;
  users: User[];
  labels: Label[];
  projects: Project[];
  sprints: Sprint[];
  tasks: Task[];
  activity: ActivityEntry[];
  activeProjectId: string | null;
  selectedTaskId: string | null;

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setActiveProject: (id: string | null) => void;
  selectTask: (id: string | null) => void;

  addTask: (input: NewTaskInput) => Task;
  updateTask: (id: string, patch: Partial<Task>, log?: string) => void;
  deleteTask: (id: string) => void;
  reorderTask: (taskId: string, newStatus: TaskStatus, toIndex: number) => void;
  moveTaskToSprint: (taskId: string, sprintId: string | null) => void;

  addComment: (taskId: string, text: string) => void;
  addSubtask: (taskId: string, title: string) => void;
  toggleSubtask: (taskId: string, subtaskId: string) => void;

  addProject: (name: string, description?: string) => Project;
  addSprint: (projectId: string, name: string, startDate: string, endDate: string, goal?: string) => void;
  setSprintStatus: (sprintId: string, status: SprintStatus) => void;

  logActivity: (action: string, detail: string, taskId?: string | null, projectId?: string | null) => void;
  resetWorkspace: () => void;
}

function nextTaskNumber(tasks: Task[], projectId: string): number {
  return tasks.filter((t) => t.projectId === projectId).reduce((max, t) => Math.max(max, t.number), 0) + 1;
}

export const useStore = create<OrbitState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      currentUserId: 'u-me',
      users: seedUsers,
      labels: seedLabels,
      projects: seedProjects,
      sprints: seedSprints,
      tasks: seedTasks,
      activity: seedActivity,
      activeProjectId: 'p-app',
      selectedTaskId: null,

      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setActiveProject: (id) => set({ activeProjectId: id }),
      selectTask: (id) => set({ selectedTaskId: id }),

      addTask: (input) => {
        const state = get();
        const now = new Date().toISOString();
        const order = Math.max(0, ...state.tasks.filter((t) => t.projectId === input.projectId && t.status === (input.status ?? 'todo')).map((t) => t.order)) + 1;
        const task: Task = {
          id: `t-${nanoid(8)}`,
          number: nextTaskNumber(state.tasks, input.projectId),
          projectId: input.projectId,
          sprintId: input.sprintId ?? null,
          title: input.title,
          description: input.description ?? '',
          status: input.status ?? 'todo',
          priority: input.priority ?? 'medium',
          assigneeId: input.assigneeId ?? null,
          reporterId: state.currentUserId,
          labelIds: [],
          createdAt: now,
          updatedAt: now,
          startDate: null,
          dueDate: input.dueDate ?? null,
          estimate: input.estimate ?? null,
          subtasks: [],
          comments: [],
          order,
        };
        set((s) => ({
          tasks: [...s.tasks, task],
          activity: [makeEntry(state.currentUserId, 'oprettede', task.title, task.id, task.projectId), ...s.activity],
        }));
        return task;
      },

      updateTask: (id, patch, log) => {
        const state = get();
        const task = state.tasks.find((t) => t.id === id);
        if (!task) return;
        const now = new Date().toISOString();
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now } : t)),
          activity: log
            ? [makeEntry(state.currentUserId, log, task.title, task.id, task.projectId), ...s.activity]
            : s.activity,
        }));
      },

      deleteTask: (id) => {
        const state = get();
        const task = state.tasks.find((t) => t.id === id);
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
          selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
          activity: task
            ? [makeEntry(state.currentUserId, 'slettede', task.title, null, task.projectId), ...s.activity]
            : s.activity,
        }));
      },

      reorderTask: (taskId, newStatus, toIndex) => {
        const state = get();
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task) return;
        const now = new Date().toISOString();
        const column = state.tasks
          .filter((t) => t.projectId === task.projectId && t.status === newStatus && t.id !== taskId)
          .sort((a, b) => a.order - b.order);
        const clamped = Math.max(0, Math.min(toIndex, column.length));
        column.splice(clamped, 0, { ...task, status: newStatus });
        const reordered = new Map(column.map((t, i) => [t.id, { ...t, order: i, updatedAt: now }]));
        const changed = newStatus !== task.status;
        set((s) => ({
          tasks: s.tasks.map((t) => reordered.get(t.id) ?? t),
          activity: changed
            ? [makeEntry(s.currentUserId, `flyttede til ${statusLabel(newStatus)}`, task.title, task.id, task.projectId), ...s.activity]
            : s.activity,
        }));
      },

      moveTaskToSprint: (taskId, sprintId) => {
        const state = get();
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task) return;
        const sprint = sprintId ? state.sprints.find((sp) => sp.id === sprintId) : null;
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, sprintId, updatedAt: new Date().toISOString() } : t)),
          activity: [makeEntry(s.currentUserId, sprintId ? `planlagde i ${sprint?.name ?? 'sprint'}` : 'fjernede fra sprint', task.title, task.id, task.projectId), ...s.activity],
        }));
      },

      addComment: (taskId, text) => {
        const state = get();
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task || !text.trim()) return;
        const comment = { id: `c-${nanoid(6)}`, authorId: state.currentUserId, text: text.trim(), createdAt: new Date().toISOString() };
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, comments: [...t.comments, comment], updatedAt: comment.createdAt } : t)),
          activity: [makeEntry(state.currentUserId, 'kommenterede på', task.title, task.id, task.projectId), ...s.activity],
        }));
      },

      addSubtask: (taskId, title) => {
        if (!title.trim()) return;
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? { ...t, subtasks: [...t.subtasks, { id: `st-${nanoid(6)}`, title: title.trim(), done: false }], updatedAt: new Date().toISOString() }
              : t,
          ),
        }));
      },

      toggleSubtask: (taskId, subtaskId) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? { ...t, subtasks: t.subtasks.map((st) => (st.id === subtaskId ? { ...st, done: !st.done } : st)), updatedAt: new Date().toISOString() }
              : t,
          ),
        }));
      },

      addProject: (name, description = '') => {
        const colors = ['violet', 'sky', 'amber', 'emerald', 'rose', 'cyan'];
        const project: Project = {
          id: `p-${nanoid(8)}`,
          name,
          key: name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'PRJ',
          color: colors[get().projects.length % colors.length],
          description,
        };
        set((s) => ({ projects: [...s.projects, project] }));
        return project;
      },

      addSprint: (projectId, name, startDate, endDate, goal = '') => {
        set((s) => ({
          sprints: [...s.sprints, { id: `s-${nanoid(8)}`, projectId, name, goal, status: 'planned', startDate, endDate }],
        }));
      },

      setSprintStatus: (sprintId, status) => {
        const state = get();
        const sprint = state.sprints.find((sp) => sp.id === sprintId);
        if (!sprint) return;
        const action = status === 'active' ? 'startede sprinten' : status === 'completed' ? 'afsluttede sprinten' : 'planlagde sprinten';
        set((s) => ({
          sprints: s.sprints.map((sp) => (sp.id === sprintId ? { ...sp, status } : sp)),
          activity: [makeEntry(s.currentUserId, action, sprint.name, null, sprint.projectId), ...s.activity],
        }));
      },

      logActivity: (action, detail, taskId = null, projectId = null) => {
        set((s) => ({ activity: [makeEntry(s.currentUserId, action, detail, taskId, projectId), ...s.activity] }));
      },

      resetWorkspace: () =>
        set({
          users: seedUsers,
          labels: seedLabels,
          projects: seedProjects,
          sprints: seedSprints,
          tasks: seedTasks,
          activity: seedActivity,
          activeProjectId: 'p-app',
          selectedTaskId: null,
        }),
    }),
    { name: 'orbit-store-v1' },
  ),
);

function makeEntry(userId: string, action: string, detail: string, taskId: string | null, projectId: string | null): ActivityEntry {
  return { id: `a-${nanoid(8)}`, timestamp: new Date().toISOString(), userId, action, detail, taskId, projectId };
}

function statusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    backlog: 'Backlog',
    todo: 'Planlagt',
    inprogress: 'I gang',
    inreview: 'Gennemgang',
    done: 'Færdig',
    canceled: 'Annulleret',
  };
  return labels[status];
}

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import { addDays, addMonths, format } from 'date-fns';
import type {
  Accent,
  ActivityEntry,
  AgentsSettings,
  AppNotification,
  AutomationSettings,
  Baseline,
  CustomFieldDef,
  Density,
  Goal,
  ImportItem,
  IssueEntry,
  Label,
  NoteEntry,
  NovaEntry,
  Priority,
  Project,
  Risk,
  RulesSettings,
  SavedView,
  Sprint,
  SprintStatus,
  StandupEntry,
  Task,
  TaskStatus,
  Theme,
  TimeEntry,
  TrashItem,
  User,
  AiAgent,
  AiJob,
} from '../lib/types';
import { seedActivity, seedLabels, seedProjects, seedSprints, seedTasks, seedUsers } from '../data/seed';
import { seedAiAgents, seedAiJobs } from '../data/seedAi';
import { PROJECT_TEMPLATES } from '../data/templates';

export interface NewTaskInput {
  title: string;
  projectId: string;
  status?: TaskStatus;
  sprintId?: string | null;
  assigneeId?: string | null;
  priority?: Priority;
  description?: string;
  dueDate?: string | null;
  startDate?: string | null;
  estimate?: number | null;
  recurrence?: Task['recurrence'];
  labelIds?: string[];
  blockedBy?: string[];
  emoji?: string;
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
  timeEntries: TimeEntry[];
  notifications: AppNotification[];
  trash: TrashItem[];
  fieldDefs: CustomFieldDef[];
  savedViews: SavedView[];
  automation: AutomationSettings;
  standups: StandupEntry[];
  notes: NoteEntry[];
  risks: Risk[];
  issues: IssueEntry[];
  hourlyRate: number; // DKK pr. time (økonomi)
  rules: RulesSettings;
  agents: AgentsSettings;
  accent: Accent;
  density: Density;
  simpleMode: boolean;
  goals: Goal[];
  baselines: Baseline[];
  novaLog: NovaEntry[];
  syncConflicts: { taskId: string; local: Task; remote: Task }[];
  activeProjectId: string | null;
  selectedTaskId: string | null;

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setActiveProject: (id: string | null) => void;
  selectTask: (id: string | null) => void;

  addTask: (input: NewTaskInput) => Task;
  updateTask: (id: string, patch: Partial<Task>, log?: string) => void;
  deleteTask: (id: string) => void;
  restoreTask: (trashId: string) => void;
  emptyTrash: () => void;
  reorderTask: (taskId: string, newStatus: TaskStatus, toIndex: number) => void;
  moveTaskToSprint: (taskId: string, sprintId: string | null) => void;
  importTasks: (items: ImportItem[], projectId: string) => number;

  addComment: (taskId: string, text: string) => void;
  replyComment: (taskId: string, parentId: string, text: string) => void;
  editComment: (taskId: string, commentId: string, text: string) => void;
  toggleReaction: (taskId: string, commentId: string, emoji: string) => void;
  addSubtask: (taskId: string, title: string) => void;
  toggleSubtask: (taskId: string, subtaskId: string) => void;
  /** Personlig rækkefølge til "Mine opgaver" */
  mineOrder: string[];
  setMineOrder: (ids: string[]) => void;
  /** AI-værksted */
  aiAgents: AiAgent[];
  aiJobs: AiJob[];
  orchestratorId: string | null;
  setOrchestrator: (agentId: string | null) => void;
  toggleAiAgent: (agentId: string) => void;
  addAiJob: (input: Pick<AiJob, 'title' | 'projectId' | 'phase'> & Partial<AiJob>) => AiJob;
  updateAiJob: (id: string, patch: Partial<AiJob>) => void;
  deleteAiJob: (id: string) => void;

  addProject: (name: string, description?: string) => Project;
  addProjectFromTemplate: (templateId: string, customName?: string) => Project | null;
  deleteProject: (projectId: string) => void;
  addSprint: (projectId: string, name: string, startDate: string, endDate: string, goal?: string) => void;
  setSprintStatus: (sprintId: string, status: SprintStatus) => void;
  updateUser: (id: string, patch: Partial<User>) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  duplicateTask: (id: string) => Task | null;
  moveTaskToProject: (id: string, projectId: string) => void;
  bulkUpdateTasks: (ids: string[], patch: Partial<Task>) => void;
  bulkDeleteTasks: (ids: string[]) => void;
  setTaskExtIds: (taskId: string, ext: NonNullable<Task['extIds']>) => void;
  addStandup: (text: string) => void;

  addNote: (projectId: string, kind: NoteEntry['kind'], title: string, body: string) => void;
  updateNote: (id: string, patch: Partial<NoteEntry>) => void;
  deleteNote: (id: string) => void;
  addRisk: (projectId: string, title: string, probability: number, impact: number, mitigation?: string) => void;
  updateRisk: (id: string, patch: Partial<Risk>) => void;
  deleteRisk: (id: string) => void;
  addIssue: (projectId: string, title: string, severity: IssueEntry['severity'], taskId?: string | null) => void;
  updateIssue: (id: string, patch: Partial<IssueEntry>) => void;
  deleteIssue: (id: string) => void;
  setHourlyRate: (rate: number) => void;
  setRules: (patch: Partial<RulesSettings>) => void;
  setAgents: (patch: Partial<AgentsSettings>) => void;
  requestApproval: (taskId: string) => string | null;
  clearApproval: (taskId: string) => void;
  addSyncConflict: (conflict: { taskId: string; local: Task; remote: Task }) => void;
  resolveSyncConflict: (taskId: string, choice: 'local' | 'remote') => void;
  setAccent: (accent: Accent) => void;
  setDensity: (density: Density) => void;
  toggleSimpleMode: () => void;
  togglePinDay: (taskId: string) => void;
  setTaskEmoji: (taskId: string, emoji: string | null) => void;
  setReminder: (taskId: string, reminderAt: string | null) => void;
  toggleMilestone: (taskId: string) => void;
  addKudo: (taskId: string, emoji: string) => void;
  togglePrivateZone: (projectId: string) => void;
  shareIntake: (projectId: string) => void;
  unshareIntake: (projectId: string) => void;
  addGoal: (title: string, note?: string) => void;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  deleteGoal: (id: string) => void;
  answerNova: (question: string, answer: string) => void;
  saveBaseline: (projectId: string) => void;
  clearBaseline: (projectId: string) => void;
  shareProject: (projectId: string) => void;
  unshareProject: (projectId: string) => void;

  startTimer: (taskId: string) => void;
  stopTimer: () => void;

  addNotification: (userId: string, text: string, taskId?: string | null) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;

  addFieldDef: (projectId: string, name: string, type: CustomFieldDef['type'], options?: string[]) => void;
  setTaskFieldValue: (taskId: string, fieldId: string, value: string | number | null) => void;
  removeFieldDef: (fieldId: string) => void;

  saveView: (name: string, filters: SavedView['filters']) => void;
  deleteView: (id: string) => void;

  setAutomation: (patch: Partial<AutomationSettings>) => void;

  logActivity: (action: string, detail: string, taskId?: string | null, projectId?: string | null) => void;
  resetWorkspace: () => void;
}

function nextTaskNumber(tasks: Task[], projectId: string): number {
  return tasks.filter((t) => t.projectId === projectId).reduce((max, t) => Math.max(max, t.number), 0) + 1;
}

function dateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function shiftDate(iso: string | null | undefined, deltaDays: number): string | null {
  if (!iso) return null;
  return dateStr(addDays(new Date(`${iso}T12:00:00`), deltaDays));
}

function pruneTrash(trash: TrashItem[]): TrashItem[] {
  const cutoff = Date.now() - 30 * 86400000;
  return trash.filter((t) => new Date(t.deletedAt).getTime() > cutoff).slice(0, 100);
}

function collectMentions(state: { users: User[]; currentUserId: string }, text: string, task: Task): AppNotification[] {
  const mentions: AppNotification[] = [];
  for (const user of state.users) {
    if (user.id === state.currentUserId) continue;
    const firstName = user.name.split(' ')[0];
    const re = new RegExp(`@${firstName}(?!\w)`, 'i');
    if (re.test(text)) {
      mentions.push({
        id: `n-${nanoid(8)}`,
        userId: user.id,
        text: `${state.users.find((u) => u.id === state.currentUserId)?.name ?? 'Nogen'} nævnte dig i “${task.title}”`,
        taskId: task.id,
        read: false,
        createdAt: new Date().toISOString(),
      });
    }
  }
  return mentions;
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
      timeEntries: [],
      notifications: [],
      trash: [],
      fieldDefs: [],
      savedViews: [],
      automation: { doneTeams: true, doneNotifyAssignee: true, urgentAssigneeId: null },
      standups: [],
      notes: [],
      risks: [],
      issues: [],
      hourlyRate: 950,
      rules: { wip: { todo: null, inprogress: null, inreview: null }, agingDays: 7, escalate: true },
      agents: { triage: false, stale: true, staleDays: 14 },
      accent: 'indigo',
      density: 'comfortable',
      simpleMode: false,
      goals: [],
      baselines: [],
      novaLog: [],
      syncConflicts: [],
      activeProjectId: 'p-app',
      selectedTaskId: null,
      mineOrder: [],
      aiAgents: seedAiAgents,
      aiJobs: seedAiJobs,
      orchestratorId: 'ai-codex',

      setOrchestrator: (agentId) => {
        const agent = get().aiAgents.find((a) => a.id === agentId);
        if (agentId !== null && (!agent || !agent.canOrchestrate)) return;
        set({ orchestratorId: agentId });
      },
      toggleAiAgent: (agentId) =>
        set((s) => ({
          aiAgents: s.aiAgents.map((a) => (a.id === agentId ? { ...a, active: !a.active } : a)),
        })),
      addAiJob: (input) => {
        const now = new Date().toISOString();
        const job: AiJob = {
          id: `aj-${nanoid(8)}`,
          description: '',
          agentId: null,
          status: 'queued',
          dependsOn: [],
          question: '',
          answer: '',
          result: '',
          createdAt: now,
          updatedAt: now,
          ...input,
        };
        set((s) => ({ aiJobs: [...s.aiJobs, job] }));
        return job;
      },
      updateAiJob: (id, patch) =>
        set((s) => ({
          aiJobs: s.aiJobs.map((j) => (j.id === id ? { ...j, ...patch, updatedAt: new Date().toISOString() } : j)),
        })),
      deleteAiJob: (id) => set((s) => ({ aiJobs: s.aiJobs.filter((j) => j.id !== id) })),

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
          labelIds: input.labelIds ?? [],
          createdAt: now,
          updatedAt: now,
          startDate: input.startDate ?? null,
          dueDate: input.dueDate ?? null,
          estimate: input.estimate ?? null,
          subtasks: [],
          comments: [],
          order,
          recurrence: input.recurrence ?? null,
          blockedBy: input.blockedBy ?? [],
          emoji: input.emoji,
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
        const oldDue = task.dueDate;
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now } : t)),
          activity: log
            ? [makeEntry(state.currentUserId, log, task.title, task.id, task.projectId), ...s.activity]
            : s.activity,
        }));

        // Versionshistorik for fulgte felter
        const HISTORY_FIELDS: Record<string, string> = {
          status: 'Status',
          priority: 'Prioritet',
          assigneeId: 'Ansvarlig',
          dueDate: 'Frist',
          title: 'Titel',
          sprintId: 'Sprint',
        };
        const historyEntries = Object.keys(HISTORY_FIELDS)
          .filter((k) => k in patch)
          .filter((k) => String((patch as Record<string, unknown>)[k] ?? '') !== String((task as unknown as Record<string, unknown>)[k] ?? ''))
          .map((k) => ({
            at: now,
            userId: state.currentUserId,
            field: HISTORY_FIELDS[k],
            from: String((task as unknown as Record<string, unknown>)[k] ?? '—'),
            to: String((patch as Record<string, unknown>)[k] ?? '—'),
          }));
        if (historyEntries.length > 0) {
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id === id ? { ...t, history: [...historyEntries, ...(t.history ?? [])].slice(0, 30) } : t,
            ),
          }));
        }

        // Forskyd afhængige opgaver når datoer rykkes
        const newDue = patch.dueDate !== undefined ? patch.dueDate : oldDue;
        const delta = newDue && oldDue ? Math.round((new Date(`${newDue}T12:00:00`).getTime() - new Date(`${oldDue}T12:00:00`).getTime()) / 86400000) : 0;
        if (delta !== 0) {
          const tasks = get().tasks;
          const visited = new Set<string>([id]);
          let queue = [id];
          const updates = new Map<string, Task>();
          while (queue.length > 0) {
            const next: string[] = [];
            for (const blockerId of queue) {
              for (const dep of tasks) {
                if (visited.has(dep.id) || dep.status === 'done' || dep.status === 'canceled') continue;
                if (!(dep.blockedBy ?? []).includes(blockerId)) continue;
                visited.add(dep.id);
                updates.set(dep.id, {
                  ...dep,
                  startDate: shiftDate(dep.startDate ?? dep.dueDate, delta),
                  dueDate: shiftDate(dep.dueDate, delta),
                  updatedAt: now,
                });
                next.push(dep.id);
              }
            }
            queue = next;
          }
          if (updates.size > 0) {
            set((s) => ({
              tasks: s.tasks.map((t) => updates.get(t.id) ?? t),
              activity: [makeEntry(s.currentUserId, 'forskød afhængige opgaver', task.title, id, task.projectId), ...s.activity],
            }));
          }
        }

        // Tilbagevendende opgave: opret næste instans når den afsluttes
        if (patch.status === 'done' && task.recurrence && task.status !== 'done') {
          const base = task.dueDate ? new Date(`${task.dueDate}T12:00:00`) : new Date();
          const nextBase =
            task.recurrence === 'daily' ? addDays(base, 1) : task.recurrence === 'weekly' ? addDays(base, 7) : addMonths(base, 1);
          const deltaMs = nextBase.getTime() - base.getTime();
          const nextStart = task.startDate ? new Date(new Date(`${task.startDate}T12:00:00`).getTime() + deltaMs) : null;
          const spawned = get().addTask({
            title: task.title,
            projectId: task.projectId,
            sprintId: task.sprintId,
            assigneeId: task.assigneeId,
            priority: task.priority,
            description: task.description,
            estimate: task.estimate,
            status: 'todo',
            startDate: nextStart ? dateStr(nextStart) : null,
            dueDate: dateStr(nextBase),
            recurrence: task.recurrence,
            labelIds: task.labelIds,
          });
          set((s) => ({
            activity: [makeEntry(s.currentUserId, 'oprettede næste instans', spawned.title, spawned.id, spawned.projectId), ...s.activity],
          }));
        }
      },

      deleteTask: (id) => {
        const state = get();
        const task = state.tasks.find((t) => t.id === id);
        if (!task) return;
        const running = state.timeEntries.find((e) => e.taskId === id && e.endedAt === null);
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
          selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
          timeEntries: running ? s.timeEntries.map((e) => (e.id === running.id ? { ...e, endedAt: new Date().toISOString() } : e)) : s.timeEntries,
          trash: pruneTrash([{ task, deletedAt: new Date().toISOString() }, ...s.trash]),
          activity: [makeEntry(state.currentUserId, 'slettede', task.title, null, task.projectId), ...s.activity],
        }));
      },

      restoreTask: (trashId) => {
        const state = get();
        const item = state.trash.find((t) => t.task.id === trashId);
        if (!item) return;
        if (state.tasks.some((t) => t.id === item.task.id)) {
          set((s) => ({ trash: s.trash.filter((t) => t.task.id !== trashId) }));
          return;
        }
        set((s) => ({
          tasks: [...s.tasks, item.task],
          trash: s.trash.filter((t) => t.task.id !== trashId),
          activity: [makeEntry(state.currentUserId, 'gendannede', item.task.title, item.task.id, item.task.projectId), ...s.activity],
        }));
      },

      emptyTrash: () => {
        set((s) => ({
          trash: [],
          activity: [makeEntry(s.currentUserId, 'tømte papirkurven', `${s.trash.length} opgaver`, null, null), ...s.activity],
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

      importTasks: (items, projectId) => {
        const existing = new Set(
          get()
            .tasks.filter((t) => t.projectId === projectId)
            .map((t) => t.title.trim().toLowerCase()),
        );
        let created = 0;
        for (const item of items) {
          const title = item.title?.trim();
          if (!title || existing.has(title.toLowerCase())) continue;
          get().addTask({
            title,
            projectId,
            status: item.status ?? 'todo',
            priority: item.priority ?? 'medium',
            dueDate: item.dueDate ?? null,
            description: item.description ?? '',
          });
          existing.add(title.toLowerCase());
          created += 1;
        }
        return created;
      },

      addComment: (taskId, text) => {
        const state = get();
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task || !text.trim()) return;
        const comment = { id: `c-${nanoid(6)}`, authorId: state.currentUserId, text: text.trim(), createdAt: new Date().toISOString() };
        const mentions = collectMentions(state, text, task);
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, comments: [...t.comments, comment], updatedAt: comment.createdAt } : t)),
          notifications: [...mentions, ...s.notifications].slice(0, 200),
          activity: [makeEntry(state.currentUserId, 'kommenterede på', task.title, task.id, task.projectId), ...s.activity],
        }));
      },

      replyComment: (taskId, parentId, text) => {
        const state = get();
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task || !text.trim()) return;
        const comment = {
          id: `c-${nanoid(6)}`,
          authorId: state.currentUserId,
          text: text.trim(),
          createdAt: new Date().toISOString(),
          replyToId: parentId,
        };
        const mentions = collectMentions(state, text, task);
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, comments: [...t.comments, comment], updatedAt: comment.createdAt } : t)),
          notifications: [...mentions, ...s.notifications].slice(0, 200),
        }));
      },

      editComment: (taskId, commentId, text) => {
        if (!text.trim()) return;
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  comments: t.comments.map((c) => (c.id === commentId ? { ...c, text: text.trim(), editedAt: new Date().toISOString() } : c)),
                  updatedAt: new Date().toISOString(),
                }
              : t,
          ),
        }));
      },

      toggleReaction: (taskId, commentId, emoji) => {
        const me = get().currentUserId;
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  comments: t.comments.map((c) => {
                    if (c.id !== commentId) return c;
                    const reactions = { ...(c.reactions ?? {}) };
                    const users = reactions[emoji] ?? [];
                    reactions[emoji] = users.includes(me) ? users.filter((u) => u !== me) : [...users, me];
                    if (reactions[emoji].length === 0) delete reactions[emoji];
                    return { ...c, reactions };
                  }),
                  updatedAt: new Date().toISOString(),
                }
              : t,
          ),
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

      setMineOrder: (ids) => set({ mineOrder: ids }),

      addProject: (name, description = '') => {
        const colors = ['violet', 'sky', 'amber', 'emerald', 'rose', 'cyan'];
        const project: Project = {
          id: `p-${nanoid(8)}`,
          name,
          key: name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'PRJ',
          color: colors[get().projects.length % colors.length],
          description,
          publicToken: null,
        };
        set((s) => ({ projects: [...s.projects, project] }));
        return project;
      },

      addProjectFromTemplate: (templateId, customName) => {
        const tpl = PROJECT_TEMPLATES.find((t) => t.id === templateId);
        if (!tpl) return null;
        const project = get().addProject(customName?.trim() || tpl.name, tpl.description);
        const base = new Date();
        for (const t of tpl.tasks) {
          const start = addDays(base, t.daysOffset);
          const due = addDays(start, Math.max(0, t.durationDays - 1));
          const assignee = get().users.find((u) => u.role === t.assigneeRole);
          get().addTask({
            title: t.title,
            projectId: project.id,
            status: 'todo',
            priority: t.priority,
            assigneeId: assignee?.id ?? null,
            estimate: t.estimate,
            startDate: dateStr(start),
            dueDate: dateStr(due),
          });
        }
        set((s) => ({
          activity: [makeEntry(s.currentUserId, 'oprettede projekt fra skabelon', project.name, null, project.id), ...s.activity],
        }));
        return project;
      },

      deleteProject: (projectId) => {
        const state = get();
        const project = state.projects.find((p) => p.id === projectId);
        if (!project) return;
        const removedTasks = state.tasks.filter((t) => t.projectId === projectId);
        const trashItems: TrashItem[] = removedTasks.map((task) => ({ task, deletedAt: new Date().toISOString() }));
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== projectId),
          sprints: s.sprints.filter((sp) => sp.projectId !== projectId),
          tasks: s.tasks.filter((t) => t.projectId !== projectId),
          fieldDefs: s.fieldDefs.filter((f) => f.projectId !== projectId),
          trash: pruneTrash([...trashItems, ...s.trash]),
          activeProjectId: s.activeProjectId === projectId ? null : s.activeProjectId,
          selectedTaskId: s.selectedTaskId && removedTasks.some((t) => t.id === s.selectedTaskId) ? null : s.selectedTaskId,
          activity: [makeEntry(s.currentUserId, 'slettede projektet', `${project.name} (${removedTasks.length} opgaver)`, null, projectId), ...s.activity],
        }));
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

      updateUser: (id, patch) => {
        set((s) => ({ users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
      },

      shareProject: (projectId) => {
        set((s) => ({
          projects: s.projects.map((p) => (p.id === projectId ? { ...p, publicToken: nanoid(18) } : p)),
        }));
      },

      unshareProject: (projectId) => {
        set((s) => ({
          projects: s.projects.map((p) => (p.id === projectId ? { ...p, publicToken: null } : p)),
        }));
      },

      startTimer: (taskId) => {
        const now = new Date().toISOString();
        set((s) => {
          const stopped = s.timeEntries.map((e) => (e.endedAt === null ? { ...e, endedAt: now } : e));
          return { timeEntries: [...stopped, { id: `te-${nanoid(8)}`, taskId, userId: s.currentUserId, startedAt: now, endedAt: null }] };
        });
      },

      stopTimer: () => {
        const now = new Date().toISOString();
        set((s) => ({ timeEntries: s.timeEntries.map((e) => (e.endedAt === null ? { ...e, endedAt: now } : e)) }));
      },

      addNotification: (userId, text, taskId = null) => {
        set((s) => ({
          notifications: [
            { id: `n-${nanoid(8)}`, userId, text, taskId, read: false, createdAt: new Date().toISOString() },
            ...s.notifications,
          ].slice(0, 200),
        }));
      },

      markNotificationRead: (id) => {
        set((s) => ({ notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
      },

      markAllNotificationsRead: () => {
        set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) }));
      },

      addFieldDef: (projectId, name, type, options) => {
        if (!name.trim()) return;
        set((s) => ({
          fieldDefs: [...s.fieldDefs, { id: `f-${nanoid(6)}`, projectId, name: name.trim(), type, options }],
        }));
      },

      setTaskFieldValue: (taskId, fieldId, value) => {
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const customFields = { ...(t.customFields ?? {}) };
            if (value === null || value === '') delete customFields[fieldId];
            else customFields[fieldId] = value;
            return { ...t, customFields, updatedAt: new Date().toISOString() };
          }),
        }));
      },

      removeFieldDef: (fieldId) => {
        set((s) => ({
          fieldDefs: s.fieldDefs.filter((f) => f.id !== fieldId),
          tasks: s.tasks.map((t) => {
            if (!t.customFields || !(fieldId in t.customFields)) return t;
            const customFields = { ...t.customFields };
            delete customFields[fieldId];
            return { ...t, customFields };
          }),
        }));
      },

      saveView: (name, filters) => {
        if (!name.trim()) return;
        set((s) => ({
          savedViews: [...s.savedViews.filter((v) => v.name !== name.trim()), { id: `v-${nanoid(6)}`, name: name.trim(), filters, createdAt: new Date().toISOString() }],
        }));
      },

      deleteView: (id) => {
        set((s) => ({ savedViews: s.savedViews.filter((v) => v.id !== id) }));
      },

      setAutomation: (patch) => {
        set((s) => ({ automation: { ...s.automation, ...patch } }));
      },

      updateProject: (id, patch) => {
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
      },

      duplicateTask: (id) => {
        const state = get();
        const task = state.tasks.find((t) => t.id === id);
        if (!task) return null;
        const copy = get().addTask({
          title: `${task.title} (kopi)`,
          projectId: task.projectId,
          status: 'todo',
          sprintId: task.sprintId,
          assigneeId: task.assigneeId,
          priority: task.priority,
          description: task.description,
          dueDate: task.dueDate,
          startDate: task.startDate,
          estimate: task.estimate,
          labelIds: task.labelIds,
          blockedBy: task.blockedBy ?? [],
        });
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === copy.id
              ? { ...t, subtasks: task.subtasks.map((st) => ({ ...st, id: `st-${nanoid(6)}` })), comments: [] }
              : t,
          ),
          activity: [makeEntry(s.currentUserId, 'duplikerede', task.title, copy.id, copy.projectId), ...s.activity],
        }));
        return copy;
      },

      moveTaskToProject: (id, projectId) => {
        const state = get();
        const task = state.tasks.find((t) => t.id === id);
        if (!task || task.projectId === projectId) return;
        const order = Math.max(0, ...state.tasks.filter((t) => t.projectId === projectId && t.status === 'todo').map((t) => t.order)) + 1;
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, projectId, sprintId: null, order, updatedAt: new Date().toISOString() } : t,
          ),
          activity: [makeEntry(s.currentUserId, 'flyttede opgave til andet projekt', task.title, id, projectId), ...s.activity],
        }));
      },

      bulkUpdateTasks: (ids, patch) => {
        const now = new Date().toISOString();
        set((s) => ({
          tasks: s.tasks.map((t) => (ids.includes(t.id) ? { ...t, ...patch, updatedAt: now } : t)),
          activity: ids.length > 0 ? [makeEntry(s.currentUserId, 'ændrede flere opgaver', `${ids.length} opgaver`, null, null), ...s.activity] : s.activity,
        }));
      },

      bulkDeleteTasks: (ids) => {
        for (const id of ids) get().deleteTask(id);
      },

      setTaskExtIds: (taskId, ext) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, extIds: { ...(t.extIds ?? {}), ...ext } } : t,
          ),
        }));
      },

      addStandup: (text) => {
        if (!text.trim()) return;
        set((s) => ({
          standups: [{ id: `su-${nanoid(6)}`, userId: s.currentUserId, text: text.trim(), createdAt: new Date().toISOString() }, ...s.standups].slice(0, 50),
        }));
      },

      addNote: (projectId, kind, title, body) => {
        if (!title.trim()) return;
        const now = new Date().toISOString();
        set((s) => ({
          notes: [{ id: `n-${nanoid(8)}`, projectId, kind, title: title.trim(), body, authorId: s.currentUserId, createdAt: now, updatedAt: now }, ...s.notes],
        }));
      },

      updateNote: (id, patch) => {
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n)),
        }));
      },

      deleteNote: (id) => {
        set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
      },

      addRisk: (projectId, title, probability, impact, mitigation = '') => {
        if (!title.trim()) return;
        set((s) => ({
          risks: [{ id: `r-${nanoid(8)}`, projectId, title: title.trim(), probability, impact, mitigation, status: 'open' }, ...s.risks],
        }));
      },

      updateRisk: (id, patch) => {
        set((s) => ({ risks: s.risks.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
      },

      deleteRisk: (id) => {
        set((s) => ({ risks: s.risks.filter((r) => r.id !== id) }));
      },

      addIssue: (projectId, title, severity, taskId = null) => {
        if (!title.trim()) return;
        set((s) => ({
          issues: [{ id: `i-${nanoid(8)}`, projectId, title: title.trim(), severity, status: 'open', taskId, createdAt: new Date().toISOString() }, ...s.issues],
        }));
      },

      updateIssue: (id, patch) => {
        set((s) => ({ issues: s.issues.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
      },

      deleteIssue: (id) => {
        set((s) => ({ issues: s.issues.filter((i) => i.id !== id) }));
      },

      setHourlyRate: (rate) => {
        set({ hourlyRate: Math.max(0, rate) });
      },

      setRules: (patch) => {
        set((s) => ({ rules: { ...s.rules, ...patch } }));
      },

      setAgents: (patch) => {
        set((s) => ({ agents: { ...s.agents, ...patch } }));
      },

      requestApproval: (taskId) => {
        const token = nanoid(18);
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? { ...t, approval: { token, status: 'pending' }, updatedAt: new Date().toISOString() }
              : t,
          ),
        }));
        return token;
      },

      clearApproval: (taskId) => {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, approval: null, updatedAt: new Date().toISOString() } : t)),
        }));
      },

      addSyncConflict: (conflict) => {
        set((s) => ({
          syncConflicts: [...s.syncConflicts.filter((c) => c.taskId !== conflict.taskId), conflict].slice(0, 20),
        }));
      },

      resolveSyncConflict: (taskId, choice) => {
        const conflict = get().syncConflicts.find((c) => c.taskId === taskId);
        if (!conflict) return;
        if (choice === 'remote') {
          set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? conflict.remote : t)) }));
        }
        set((s) => ({ syncConflicts: s.syncConflicts.filter((c) => c.taskId !== taskId) }));
      },

      setAccent: (accent) => set({ accent }),
      setDensity: (density) => set({ density }),
      toggleSimpleMode: () => set((s) => ({ simpleMode: !s.simpleMode })),

      togglePinDay: (taskId) => {
        const today = new Date().toISOString().slice(0, 10);
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? { ...t, pinnedDay: t.pinnedDay ? null : today, updatedAt: new Date().toISOString() }
              : t,
          ),
        }));
      },

      setTaskEmoji: (taskId, emoji) => {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, emoji: emoji || undefined, updatedAt: new Date().toISOString() } : t)),
        }));
      },

      setReminder: (taskId, reminderAt) => {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, reminderAt, updatedAt: new Date().toISOString() } : t)),
        }));
      },

      toggleMilestone: (taskId) => {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, isMilestone: !t.isMilestone, updatedAt: new Date().toISOString() } : t)),
        }));
      },

      addKudo: (taskId, emoji) => {
        const me = get().currentUserId;
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const kudos = [...(t.kudos ?? []).filter((k) => !(k.userId === me && k.emoji === emoji)), { userId: me, emoji, at: new Date().toISOString() }];
            return { ...t, kudos };
          }),
        }));
      },

      togglePrivateZone: (projectId) => {
        set((s) => ({
          projects: s.projects.map((p) => (p.id === projectId ? { ...p, privateZone: !p.privateZone } : p)),
        }));
      },

      shareIntake: (projectId) => {
        set((s) => ({
          projects: s.projects.map((p) => (p.id === projectId ? { ...p, intakeToken: nanoid(18) } : p)),
        }));
      },

      unshareIntake: (projectId) => {
        set((s) => ({
          projects: s.projects.map((p) => (p.id === projectId ? { ...p, intakeToken: null } : p)),
        }));
      },

      addGoal: (title, note = '') => {
        if (!title.trim()) return;
        set((s) => ({ goals: [...s.goals, { id: `g-${nanoid(8)}`, title: title.trim(), note, keyResults: [] }] }));
      },

      updateGoal: (id, patch) => {
        set((s) => ({ goals: s.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
      },

      deleteGoal: (id) => {
        set((s) => ({ goals: s.goals.filter((g) => g.id !== id) }));
      },

      answerNova: (question, answer) => {
        const date = new Date().toISOString().slice(0, 10);
        set((s) => ({
          novaLog: [{ date, question, answer }, ...s.novaLog.filter((n) => n.date !== date)].slice(0, 90),
        }));
      },

      saveBaseline: (projectId) => {
        const items = get()
          .tasks.filter((t) => t.projectId === projectId && (t.startDate || t.dueDate))
          .map((t) => ({ taskId: t.id, startDate: t.startDate, dueDate: t.dueDate }));
        set((s) => ({
          baselines: [...s.baselines.filter((b) => b.projectId !== projectId), { projectId, savedAt: new Date().toISOString(), items }],
        }));
      },

      clearBaseline: (projectId) => {
        set((s) => ({ baselines: s.baselines.filter((b) => b.projectId !== projectId) }));
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
          timeEntries: [],
          notifications: [],
          trash: [],
          fieldDefs: [],
          savedViews: [],
          automation: { doneTeams: true, doneNotifyAssignee: true, urgentAssigneeId: null },
          standups: [],
          notes: [],
          risks: [],
          issues: [],
          hourlyRate: 950,
          rules: { wip: { todo: null, inprogress: null, inreview: null }, agingDays: 7, escalate: true },
          agents: { triage: false, stale: true, staleDays: 14 },
          accent: 'indigo',
          density: 'comfortable',
          simpleMode: false,
          goals: [],
          baselines: [],
          novaLog: [],
          syncConflicts: [],
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

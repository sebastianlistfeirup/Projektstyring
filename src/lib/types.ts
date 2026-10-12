export type TaskStatus = 'backlog' | 'todo' | 'inprogress' | 'inreview' | 'done' | 'canceled';
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type SprintStatus = 'planned' | 'active' | 'completed';
export type Theme = 'dark' | 'light';

export interface User {
  id: string;
  name: string;
  initials: string;
  color: string; // tailwind color base, fx "indigo", "amber"
  role: string;
  email: string;
  capacity?: number; // estimeret points pr. uge
  vacationUntil?: string | null; // ISO-dato, fravær til og med
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Comment {
  id: string;
  authorId: string;
  text: string;
  createdAt: string; // ISO
  replyToId?: string | null; // svar på anden kommentar
  reactions?: Record<string, string[]>; // emoji -> userIds
  editedAt?: string;
}

export interface Task {
  id: string;
  number: number; // løbenummer pr. projekt, fx 42 -> "APP-42"
  projectId: string;
  sprintId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assigneeId: string | null;
  reporterId: string;
  labelIds: string[];
  createdAt: string;
  updatedAt: string;
  startDate: string | null; // ISO
  dueDate: string | null; // ISO
  estimate: number | null; // story points
  subtasks: Subtask[];
  comments: Comment[];
  order: number; // rækkefølge i kolonne/liste
  recurrence?: 'daily' | 'weekly' | 'monthly' | null; // opret næste instans når opgaven afsluttes
  blockedBy?: string[]; // id'er på opgaver der blokerer denne
  customFields?: Record<string, string | number>; // fieldDefId -> værdi
  extIds?: { todoListId?: string; todoTaskId?: string; adopsId?: number }; // eksterne systemer
}

export interface StandupEntry {
  id: string;
  userId: string;
  text: string;
  createdAt: string; // ISO
}

export interface TimeEntry {
  id: string;
  taskId: string;
  userId: string;
  startedAt: string; // ISO
  endedAt: string | null; // ISO, null = timer kører
}

export interface AppNotification {
  id: string;
  userId: string; // modtager
  text: string;
  taskId: string | null;
  read: boolean;
  createdAt: string; // ISO
}

export interface TrashItem {
  task: Task;
  deletedAt: string; // ISO
}

export interface CustomFieldDef {
  id: string;
  projectId: string;
  name: string;
  type: 'text' | 'number' | 'select';
  options?: string[]; // kun ved select
}

export interface SavedView {
  id: string;
  name: string;
  filters: {
    query: string;
    status: string; // 'all' eller TaskStatus
    priority: string; // 'all' eller Priority
    groupBy: string; // 'none' | 'status' | 'project' | 'assignee'
  };
  createdAt: string;
}

export interface AutomationSettings {
  doneTeams: boolean; // besked til Teams når opgave afsluttes
  doneNotifyAssignee: boolean; // notifikation til ansvarlig ved afslutning
  urgentAssigneeId: string | null; // tildel denne person når prioritet bliver kritisk
}

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  status: SprintStatus;
  startDate: string;
  endDate: string;
}

export interface Project {
  id: string;
  name: string;
  key: string; // fx "APP"
  color: string;
  description: string;
  publicToken?: string | null; // kunde-statusside ( companion /public/status/<token> )
  archived?: boolean; // arkiverede projekter gemmes væk, men kan gendannes
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  userId: string;
  taskId: string | null;
  projectId: string | null;
  action: string; // fx "oprettede opgaven", "flyttede til I gang"
  detail?: string;
}

export interface ImportItem {
  title: string;
  dueDate?: string | null;
  priority?: Priority;
  status?: TaskStatus;
  description?: string;
}

export interface SyncSnapshot {
  tasks: Task[];
  projects: Project[];
  sprints: Sprint[];
  users: User[];
  labels: Label[];
  activity: ActivityEntry[];
  updatedAt: string;
}

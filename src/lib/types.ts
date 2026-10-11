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

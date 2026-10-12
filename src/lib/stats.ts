// Sprint-velocity og estimat-vs-faktisk statistik
import type { Sprint, Task, TimeEntry } from './types';

export interface SprintVelocity {
  sprintId: string;
  name: string;
  status: Sprint['status'];
  planned: number; // points i sprintet
  completed: number; // points afsluttet
}

export interface EstimateVsActual {
  taskId: string;
  title: string;
  estimate: number | null;
  minutes: number;
  status: Task['status'];
}

export function sprintVelocity(tasks: Task[], sprints: Sprint[], projectId: string | null): SprintVelocity[] {
  return sprints
    .filter((sp) => sp.status !== 'planned' && (!projectId || sp.projectId === projectId))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((sp) => {
      const inSprint = tasks.filter((t) => t.sprintId === sp.id);
      const planned = inSprint.reduce((sum, t) => sum + (t.estimate ?? 1), 0);
      const completed = inSprint.filter((t) => t.status === 'done').reduce((sum, t) => sum + (t.estimate ?? 1), 0);
      return { sprintId: sp.id, name: sp.name, status: sp.status, planned, completed };
    });
}

export function estimateVsActual(tasks: Task[], timeEntries: TimeEntry[]): EstimateVsActual[] {
  const minutesByTask = new Map<string, number>();
  for (const e of timeEntries) {
    if (!e.endedAt) continue;
    const ms = new Date(e.endedAt).getTime() - new Date(e.startedAt).getTime();
    minutesByTask.set(e.taskId, (minutesByTask.get(e.taskId) ?? 0) + Math.round(ms / 60000));
  }
  return tasks
    .filter((t) => minutesByTask.has(t.id) || t.status === 'done')
    .map((t) => ({ taskId: t.id, title: t.title, estimate: t.estimate, minutes: minutesByTask.get(t.id) ?? 0, status: t.status }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 12);
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}t` : `${h}t ${m}m`;
}

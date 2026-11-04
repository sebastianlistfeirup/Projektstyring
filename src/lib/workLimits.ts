import type { RulesSettings, Task, TaskStatus } from './types';

export function workLimitReason(tasks: Task[], rules: RulesSettings, task: Task, next: TaskStatus): string | null {
  if (!['todo', 'inprogress', 'inreview'].includes(next)) return null;
  if (task.status === next && tasks.some(t => t.id === task.id && t.projectId === task.projectId && t.status === next)) return null;
  const limit = rules.wip[next as keyof RulesSettings['wip']];
  if (limit === null || limit === undefined) return null;
  const count = tasks.filter(t => t.projectId === task.projectId && t.id !== task.id && t.status === next).length;
  return count >= limit ? `Grænsen for arbejde i denne kolonne er nået (${count}/${limit}). Afslut eller flyt en eksisterende opgave først.` : null;
}

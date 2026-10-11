import type { Task } from '../../lib/types';

export function taskProgress(task: Task): number {
  if (task.subtasks.length > 0) {
    const done = task.subtasks.filter((s) => s.done).length;
    return Math.round((done / task.subtasks.length) * 100);
  }
  return task.status === 'done' ? 100 : 0;
}

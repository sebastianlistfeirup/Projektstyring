// Projekt-puls: simpel health-score pr. projekt (0-100) med forklaringer
import type { Project, Sprint, Task, User } from './types';
import { isOverdue } from './utils';

export interface HealthFactor {
  label: string;
  impact: number; // negativ point-effekt
}

export interface ProjectHealth {
  projectId: string;
  name: string;
  color: string;
  score: number;
  openCount: number;
  overdueCount: number;
  doneRatio: number;
  factors: HealthFactor[];
}

export function computeHealth(tasks: Task[], projects: Project[], users: User[], sprints: Sprint[]): ProjectHealth[] {
  const today = new Date().toISOString().slice(0, 10);
  return projects
    .filter((p) => !p.archived)
    .map((p) => {
      const pt = tasks.filter((t) => t.projectId === p.id);
      const open = pt.filter((t) => t.status !== 'done' && t.status !== 'canceled');
      const overdue = open.filter(isOverdue);
      const doneCount = pt.filter((t) => t.status === 'done').length;
      const doneRatio = pt.length ? doneCount / pt.length : 0;
      const unassignedUrgent = open.filter((t) => t.priority === 'urgent' && !t.assigneeId).length;
      const activeSprint = sprints.find((sp) => sp.projectId === p.id && sp.status === 'active');
      const teamCapacity = users
        .filter((u) => !u.vacationUntil || u.vacationUntil < today)
        .reduce((sum, u) => sum + (u.capacity ?? 8), 0);
      const sprintLoad = activeSprint
        ? open.filter((t) => t.sprintId === activeSprint.id).reduce((sum, t) => sum + (t.estimate ?? 1), 0)
        : 0;

      const factors: HealthFactor[] = [];
      if (overdue.length > 0) factors.push({ label: `${overdue.length} overskredne frister`, impact: Math.min(30, overdue.length * 8) });
      if (unassignedUrgent > 0) factors.push({ label: `${unassignedUrgent} kritiske opgaver uden ejer`, impact: unassignedUrgent * 10 });
      if (pt.length >= 5 && doneRatio < 0.3) factors.push({ label: 'Lav fremdrift (under 30% færdig)', impact: 12 });
      if (activeSprint && sprintLoad > teamCapacity) {
        factors.push({ label: `Aktivt sprint overbelastet (${sprintLoad} pts / ${teamCapacity} kapacitet)`, impact: 12 });
      }
      if (open.length > 0 && open.every((t) => !t.assigneeId)) {
        factors.push({ label: 'Ingen åbne opgaver har en ansvarlig', impact: 10 });
      }

      const score = Math.max(5, Math.round(100 - factors.reduce((sum, f) => sum + f.impact, 0)));
      return {
        projectId: p.id,
        name: p.name,
        color: p.color,
        score,
        openCount: open.length,
        overdueCount: overdue.length,
        doneRatio: Math.round(doneRatio * 100),
        factors,
      };
    })
    .sort((a, b) => a.score - b.score);
}

export function healthTone(score: number): 'rose' | 'amber' | 'emerald' {
  if (score < 55) return 'rose';
  if (score < 80) return 'amber';
  return 'emerald';
}

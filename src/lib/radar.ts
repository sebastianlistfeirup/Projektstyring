// Frist-radar: forudsig om åbne opgaver når deres frist,
// baseret på teamets faktiske gennemførselshastighed.
import type { Task } from './types';

export interface DeadlineRisk {
  taskId: string;
  title: string;
  dueDate: string;
  remainingPoints: number; // points der skal nås (inkl. denne opgave)
  pointsPerDay: number;
  daysLeft: number;
  neededDays: number;
  atRisk: boolean;
}

export function deadlineRisks(tasks: Task[], windowDays = 30): DeadlineRisk[] {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const windowStart = new Date(today.getTime() - windowDays * 86400000).toISOString();

  // Gennemført hastighed: points afsluttet inden for vinduet pr. dag (min 0.5)
  const completed = tasks.filter((t) => t.status === 'done' && t.updatedAt >= windowStart);
  const completedPoints = completed.reduce((sum, t) => sum + (t.estimate ?? 1), 0);
  const pointsPerDay = Math.max(0.5, completedPoints / windowDays);

  const open = tasks
    .filter((t) => t.status !== 'done' && t.status !== 'canceled' && t.dueDate && t.dueDate >= todayStr)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));

  let remaining = 0;
  const risks: DeadlineRisk[] = open.map((t) => {
    remaining += t.estimate ?? 1;
    const daysLeft = Math.max(0, Math.round((new Date(`${t.dueDate}T12:00:00`).getTime() - today.getTime()) / 86400000));
    const neededDays = remaining / pointsPerDay;
    return {
      taskId: t.id,
      title: t.title,
      dueDate: t.dueDate!,
      remainingPoints: remaining,
      pointsPerDay: Math.round(pointsPerDay * 10) / 10,
      daysLeft,
      neededDays: Math.round(neededDays * 10) / 10,
      atRisk: neededDays > daysLeft,
    };
  });
  return risks.filter((r) => r.atRisk);
}

// Estimat-assistent: gennemsnit af points for afsluttede opgaver med lignende titel
export function estimateSuggestion(tasks: Task[], title: string): number | null {
  const words = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  if (words.length === 0) return null;
  const similar = tasks.filter((t) => {
    if (t.status !== 'done' || t.estimate == null) return false;
    const tl = t.title.toLowerCase();
    return words.some((w) => tl.includes(w));
  });
  if (similar.length === 0) return null;
  const avg = similar.reduce((sum, t) => sum + (t.estimate ?? 0), 0) / similar.length;
  return Math.max(1, Math.round(avg));
}

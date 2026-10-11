import { format, formatDistanceToNow, isBefore, parseISO } from 'date-fns';
import { da } from 'date-fns/locale';
import type { Project, Task } from './types';

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value;
}

export function formatDate(iso: string | Date | null | undefined, pattern = 'd. MMM yyyy'): string {
  if (!iso) return '—';
  return format(toDate(iso), pattern, { locale: da });
}

export function formatDateShort(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  return format(toDate(iso), 'd. MMM', { locale: da });
}

export function timeAgo(iso: string | Date): string {
  return formatDistanceToNow(toDate(iso), { addSuffix: true, locale: da });
}

export function isOverdue(task: Task): boolean {
  if (!task.dueDate) return false;
  if (task.status === 'done' || task.status === 'canceled') return false;
  return isBefore(parseISO(task.dueDate), new Date());
}

export function taskRef(task: Task, projects: Project[]): string {
  const key = projects.find((p) => p.id === task.projectId)?.key ?? 'OPG';
  return `${key}-${task.number}`;
}

export function todayISO(): string {
  return new Date().toISOString();
}

export function daysBetween(a: string, b: string): number {
  const ms = parseISO(b).getTime() - parseISO(a).getTime();
  return Math.round(ms / 86400000);
}

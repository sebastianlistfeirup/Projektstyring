import type { Priority, SprintStatus, TaskStatus } from './types';

export const STATUS_ORDER: TaskStatus[] = ['backlog', 'todo', 'inprogress', 'inreview', 'done', 'canceled'];

export const STATUS_META: Record<TaskStatus, { label: string; short: string; badge: string; dot: string }> = {
  backlog: {
    label: 'Backlog',
    short: 'Backlog',
    badge: 'bg-zinc-500/10 text-zinc-600 dark:bg-zinc-400/10 dark:text-zinc-400',
    dot: 'bg-zinc-400',
  },
  todo: {
    label: 'Planlagt',
    short: 'Planlagt',
    badge: 'bg-sky-500/10 text-sky-600 dark:bg-sky-400/10 dark:text-sky-400',
    dot: 'bg-sky-400',
  },
  inprogress: {
    label: 'I gang',
    short: 'I gang',
    badge: 'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-400',
    dot: 'bg-indigo-400',
  },
  inreview: {
    label: 'Til gennemgang',
    short: 'Gennemgang',
    badge: 'bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400',
    dot: 'bg-amber-400',
  },
  done: {
    label: 'Færdig',
    short: 'Færdig',
    badge: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400',
    dot: 'bg-emerald-400',
  },
  canceled: {
    label: 'Annulleret',
    short: 'Annull.',
    badge: 'bg-rose-500/10 text-rose-600 dark:bg-rose-400/10 dark:text-rose-400',
    dot: 'bg-rose-400',
  },
};

export const PRIORITY_META: Record<Priority, { label: string; badge: string; rank: number }> = {
  urgent: { label: 'Kritisk', badge: 'bg-rose-500 text-white', rank: 0 },
  high: { label: 'Høj', badge: 'bg-orange-500/15 text-orange-600 dark:text-orange-400', rank: 1 },
  medium: { label: 'Mellem', badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', rank: 2 },
  low: { label: 'Lav', badge: 'bg-sky-500/15 text-sky-600 dark:text-sky-400', rank: 3 },
  none: { label: 'Ingen', badge: 'bg-zinc-500/10 text-zinc-500', rank: 4 },
};

export const SPRINT_META: Record<SprintStatus, { label: string; badge: string }> = {
  planned: { label: 'Planlagt', badge: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
  active: { label: 'Aktiv', badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  completed: { label: 'Afsluttet', badge: 'bg-zinc-500/10 text-zinc-500' },
};

export const LABEL_COLOR_STYLES: Record<string, string> = {
  pink: 'bg-pink-500/15 text-pink-600 dark:text-pink-400',
  indigo: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  cyan: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  red: 'bg-red-500/15 text-red-600 dark:text-red-400',
  slate: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
};

export const AVATAR_COLORS: Record<string, string> = {
  indigo: 'bg-indigo-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  sky: 'bg-sky-500',
  violet: 'bg-violet-500',
  teal: 'bg-teal-500',
  orange: 'bg-orange-500',
};

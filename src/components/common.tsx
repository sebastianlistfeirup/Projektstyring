import type { ReactNode } from 'react';
import { Flag, Users } from 'lucide-react';
import type { Priority, TaskStatus, User } from '../lib/types';
import { AVATAR_COLORS, LABEL_COLOR_STYLES, PRIORITY_META, STATUS_META } from '../lib/constants';
import { useLang, t } from '../lib/i18n';
import { cn } from '../lib/utils';

const AVATAR_SIZES = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
} as const;

export function Avatar({
  user,
  size = 'md',
  className,
}: {
  user: User | null | undefined;
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
}) {
  // Abonnér på sprog, så tooltip re-render'er ved skift
  useLang();
  if (!user) {
    return (
      <div
        className={cn(
          'grid place-items-center rounded-full bg-zinc-300 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400',
          AVATAR_SIZES[size],
          className,
        )}
        title={t('common.notAssigned')}
      >
        <Users className="h-[60%] w-[60%]" />
      </div>
    );
  }
  return (
    <div
      title={`${user.name} · ${user.role}`}
      className={cn(
        'grid shrink-0 select-none place-items-center rounded-full font-semibold text-white shadow-sm',
        AVATAR_COLORS[user.color] ?? 'bg-zinc-500',
        AVATAR_SIZES[size],
        className,
      )}
    >
      {user.initials}
    </div>
  );
}

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        meta.badge,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}

const PRIORITY_FLAG: Record<Priority, string> = {
  urgent: 'text-rose-500',
  high: 'text-orange-500',
  medium: 'text-amber-500',
  low: 'text-sky-500',
  none: 'text-zinc-400',
};

export function PriorityBadge({ priority, showLabel = true }: { priority: Priority; showLabel?: boolean }) {
  const meta = PRIORITY_META[priority];
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
      <Flag className={cn('h-3.5 w-3.5', PRIORITY_FLAG[priority])} fill="currentColor" />
      {showLabel && meta.label}
    </span>
  );
}

export function LabelChip({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        LABEL_COLOR_STYLES[color] ?? LABEL_COLOR_STYLES.slate,
        className,
      )}
    >
      {name}
    </span>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10', className)}>
      <div
        className={cn(
          'h-full rounded-full transition-all duration-300',
          value >= 100 ? 'bg-emerald-500' : 'bg-indigo-500',
        )}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function ViewHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 animate-fade-in">
      <div className="min-w-0">
        <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-gradient-to-b from-zinc-100 to-transparent px-6 py-16 text-center animate-fade-in dark:border-white/10 dark:from-white/[0.04] dark:to-transparent">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-indigo-500/10 text-indigo-500 ring-1 ring-indigo-500/20 dark:text-indigo-400">
        {icon}
      </div>
      <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{title}</p>
      {description && <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">{description}</p>}
      {action}
    </div>
  );
}

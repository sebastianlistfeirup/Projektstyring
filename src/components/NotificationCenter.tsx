import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useLang, t } from '../lib/i18n';
import { cn, timeAgo } from '../lib/utils';

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const notifications = useStore((s) => s.notifications);
  const currentUserId = useStore((s) => s.currentUserId);
  const markNotificationRead = useStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useStore((s) => s.markAllNotificationsRead);
  const selectTask = useStore((s) => s.selectTask);

  // Abonnér på sprog, så tekster re-render'er ved skift
  useLang();

  const mine = useMemo(
    () => notifications.filter((n) => n.userId === currentUserId),
    [notifications, currentUserId],
  );
  const unread = mine.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openNotification = (id: string, taskId: string | null) => {
    markNotificationRead(id);
    if (taskId) selectTask(taskId);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t('notify.title')}
        aria-label={t('notify.title')}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="glass-panel absolute right-0 top-full z-50 mt-2 w-80 rounded-xl shadow-panel animate-scale-in">
          <div className="flex items-center justify-between gap-2 border-b border-zinc-200/80 px-4 py-2.5 dark:border-white/[0.06]">
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{t('notify.title')}</p>
            {unread > 0 && (
              <button onClick={markAllNotificationsRead} className="btn-ghost shrink-0 text-xs">
                {t('notify.markAll')}
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {mine.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">{t('notify.empty')}</p>
            ) : (
              mine.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openNotification(n.id, n.taskId)}
                  className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-zinc-100/70 dark:hover:bg-white/[0.04]"
                >
                  <span
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      n.read ? 'bg-zinc-300 dark:bg-zinc-600' : 'bg-indigo-400',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-sm',
                        n.read
                          ? 'text-zinc-500 dark:text-zinc-400'
                          : 'font-medium text-zinc-800 dark:text-zinc-100',
                      )}
                    >
                      {n.text}
                    </span>
                    <span className="mt-0.5 block text-xs text-zinc-400 dark:text-zinc-500">
                      {timeAgo(n.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

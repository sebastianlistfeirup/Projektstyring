import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Moon, Plus, Search, Sun, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { VIEWS } from '../lib/nav';
import { useI18n, useLang, t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { Avatar } from './common';
import NotificationCenter from './NotificationCenter';

function openPalette() {
  window.dispatchEvent(new CustomEvent('orbit:open-palette'));
}

export default function AppShell() {
  const projects = useStore((s) => s.projects);
  const tasks = useStore((s) => s.tasks);
  const users = useStore((s) => s.users);
  const currentUserId = useStore((s) => s.currentUserId);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const addProject = useStore((s) => s.addProject);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const toggleLang = useI18n((s) => s.toggleLang);

  // Abonnér på sprog, så alle tekster re-render'er ved skift
  const lang = useLang();

  const location = useLocation();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const me = users.find((u) => u.id === currentUserId);
  const currentView = VIEWS.find((v) => location.pathname.startsWith(v.to));
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const activeCount = (projectId: string) =>
    tasks.filter((t) => t.projectId === projectId && t.status !== 'done' && t.status !== 'canceled').length;

  const submitProject = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const project = addProject(trimmed);
    setActiveProject(project.id);
    setName('');
    setAdding(false);
  };

  return (
    <div className="relative z-10 flex h-screen overflow-hidden">
      {/* Ambient lys bag indholdet */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-44 left-1/3 h-96 w-[36rem] rounded-full bg-indigo-500/[0.06] blur-3xl dark:bg-indigo-500/[0.11]" />
        <div className="absolute -bottom-24 right-0 h-80 w-[30rem] rounded-full bg-violet-500/[0.05] blur-3xl dark:bg-violet-500/[0.08]" />
        <div className="absolute -left-32 top-1/2 h-72 w-72 rounded-full bg-sky-500/[0.04] blur-3xl dark:bg-sky-500/[0.06]" />
      </div>
      {/* Ikon-rail */}
      <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-zinc-200/80 bg-white py-3 dark:border-white/[0.06] dark:bg-[#131417]">
        <div
          className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-glow"
          title="Orbit"
        >
          O
        </div>
        {VIEWS.map((view) => (
          <NavLink
            key={view.to}
            to={view.to}
            title={t(view.labelKey)}
            aria-label={t(view.labelKey)}
            className={({ isActive }) =>
              cn(
                'grid h-10 w-10 place-items-center rounded-xl transition-all duration-150',
                isActive
                  ? 'bg-indigo-500/15 text-indigo-500 dark:bg-indigo-400/15 dark:text-indigo-300'
                  : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100',
              )
            }
          >
            <view.icon className="h-5 w-5" />
          </NavLink>
        ))}
        <div className="mt-auto flex flex-col items-center gap-2">
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? t('shell.light') : t('shell.dark')}
            className="grid h-10 w-10 place-items-center rounded-xl text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100"
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          <Avatar user={me} size="md" className="h-9 w-9 text-[11px]" />
        </div>
      </nav>

      {/* Workspace-panel */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200/80 bg-zinc-50/60 dark:border-white/[0.06] dark:bg-[#1a1b1f]/60">
        <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-zinc-700 to-zinc-900 text-xs font-bold text-white dark:from-zinc-200 dark:to-zinc-400 dark:text-zinc-900">
            N
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">Nordlys ApS</p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('shell.workspace')}</p>
          </div>
        </div>

        <div className="px-3 pb-1 pt-2">
          <button
            onClick={openPalette}
            className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-500 transition-colors hover:border-zinc-300 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-400 dark:hover:border-white/20"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">{t('shell.search')}</span>
            <kbd className="rounded border border-zinc-200 bg-zinc-100 px-1.5 text-[10px] font-medium text-zinc-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400">
              Ctrl K
            </kbd>
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between px-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {t('shell.projects')}
          </p>
          <button
            onClick={() => setAdding((v) => !v)}
            title={t('shell.newProject')}
            className="grid h-6 w-6 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/[0.08] dark:hover:text-zinc-100"
          >
            {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </button>
        </div>

        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          <button
            onClick={() => setActiveProject(null)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
              activeProjectId === null
                ? 'bg-zinc-200/70 font-medium text-zinc-900 dark:bg-white/[0.08] dark:text-white'
                : 'text-zinc-600 hover:bg-zinc-200/50 dark:text-zinc-300 dark:hover:bg-white/[0.05]',
            )}
          >
            <span className="grid h-2.5 w-2.5 place-items-center rounded-full bg-gradient-to-r from-indigo-400 to-violet-500" />
            <span className="flex-1 truncate text-left">{t('shell.allProjects')}</span>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
              {tasks.filter((t) => t.status !== 'done' && t.status !== 'canceled').length}
            </span>
          </button>

          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveProject(p.id)}
              className={cn(
                'group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
                activeProjectId === p.id
                  ? 'bg-zinc-200/70 font-medium text-zinc-900 dark:bg-white/[0.08] dark:text-white'
                  : 'text-zinc-600 hover:bg-zinc-200/50 dark:text-zinc-300 dark:hover:bg-white/[0.05]',
              )}
            >
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', `bg-${p.color}-500`)} />
              <span className="flex-1 truncate text-left">{p.name}</span>
              <span className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{activeCount(p.id)}</span>
            </button>
          ))}

          {adding && (
            <div className="animate-fade-in px-1 pt-1">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitProject();
                  if (e.key === 'Escape') setAdding(false);
                }}
                onBlur={() => !name.trim() && setAdding(false)}
                placeholder={t('shell.projectName')}
                className="input py-1.5 text-sm"
              />
            </div>
          )}
        </div>

        <div className="border-t border-zinc-200/80 p-3 text-[11px] text-zinc-400 dark:border-white/[0.06] dark:text-zinc-500">
          {t('shell.footer')}
        </div>
      </aside>

      {/* Hovedindhold */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200/80 bg-white/70 px-5 backdrop-blur dark:border-white/[0.06] dark:bg-[#17181c]/80">
          <h1 className="truncate text-[15px] font-semibold">
            {currentView ? t(currentView.labelKey) : 'Orbit'}
          </h1>
          {activeProject && (
            <>
              <span className="text-zinc-300 dark:text-zinc-600">/</span>
              <span className={cn('flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300')}>
                <span className={cn('h-2 w-2 rounded-sm', `bg-${activeProject.color}-500`)} />
                <span className="truncate">{activeProject.name}</span>
              </span>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <NotificationCenter />
            <button
              onClick={toggleLang}
              title="Skift sprog / Switch language"
              className="btn-ghost px-2 text-xs font-semibold tracking-wide"
            >
              {lang === 'da' ? 'EN' : 'DA'}
            </button>
            <button onClick={openPalette} className="btn-primary">
              <Plus className="h-4 w-4" />
              {t('shell.newTask')}
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

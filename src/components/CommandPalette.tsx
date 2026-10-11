import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, FilePlus2, Moon, RefreshCcw, Search } from 'lucide-react';
import { useStore } from '../store/useStore';
import { VIEWS } from '../lib/nav';
import { cn, taskRef } from '../lib/utils';
import { StatusBadge } from './common';

interface Row {
  id: string;
  group: 'handling' | 'navigation' | 'opgave';
  label: string;
  hint?: string;
  run: () => void;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const selectTask = useStore((s) => s.selectTask);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const addTask = useStore((s) => s.addTask);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const resetWorkspace = useStore((s) => s.resetWorkspace);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('orbit:open-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('orbit:open-palette', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const list: Row[] = [];

    if (q) {
      const targetProject = projects.find((p) => p.id === (activeProjectId ?? projects[0]?.id));
      list.push({
        id: 'create',
        group: 'handling',
        label: `Opret opgave "${query.trim()}"${targetProject ? ` i ${targetProject.name}` : ''}`,
        hint: 'Enter',
        run: () => {
          const projectId = activeProjectId ?? projects[0]?.id;
          if (!projectId) return;
          const task = addTask({ title: query.trim(), projectId });
          setActiveProject(projectId);
          selectTask(task.id);
        },
      });
      const matches = tasks
        .filter((t) => t.title.toLowerCase().includes(q))
        .slice(0, 8)
        .map<Row>((t) => ({
          id: t.id,
          group: 'opgave',
          label: t.title,
          hint: taskRef(t, projects),
          run: () => {
            setActiveProject(t.projectId);
            selectTask(t.id);
          },
        }));
      list.push(...matches);
    }

    VIEWS.filter((v) => !q || v.label.toLowerCase().includes(q) || v.keywords.some((k) => k.includes(q))).forEach((v) =>
      list.push({
        id: `nav-${v.to}`,
        group: 'navigation',
        label: `Gå til ${v.label}`,
        run: () => navigate(v.to),
      }),
    );

    list.push(
      {
        id: 'theme',
        group: 'handling',
        label: 'Skift lyst / mørkt tema',
        run: toggleTheme,
      },
      {
        id: 'reset',
        group: 'handling',
        label: 'Nulstil demo-data',
        hint: 'gendanner eksempeldata',
        run: () => resetWorkspace(),
      },
    );
    return list;
  }, [query, tasks, projects, activeProjectId, addTask, selectTask, setActiveProject, navigate, toggleTheme, resetWorkspace]);

  useEffect(() => setIndex(0), [rows.length]);

  const runRow = useCallback(
    (row: Row) => {
      row.run();
      setOpen(false);
    },
    [setOpen],
  );

  if (!open) return null;

  const groups: Row['group'][] = ['handling', 'navigation', 'opgave'];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/40 pt-[14vh] backdrop-blur-sm animate-fade-in"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-panel animate-scale-in dark:border-white/10 dark:bg-[#1e1f24]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-zinc-200 px-4 dark:border-white/[0.06]">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, rows.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && rows[index]) {
                runRow(rows[index]);
              }
            }}
            placeholder="Søg efter opgaver, eller opret en ny …"
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-zinc-400"
          />
          <kbd className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400">
            Esc
          </kbd>
        </div>

        <div className="max-h-[46vh] overflow-y-auto p-2">
          {rows.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-zinc-500">Ingen resultater for "{query}"</p>
          )}
          {groups.map((g) => {
            const groupRows = rows.filter((r) => r.group === g);
            if (groupRows.length === 0) return null;
            return (
              <div key={g}>
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  {g === 'handling' ? 'Handlinger' : g === 'navigation' ? 'Navigation' : 'Opgaver'}
                </p>
                {groupRows.map((row) => {
                  const idx = rows.indexOf(row);
                  const task = row.group === 'opgave' ? tasks.find((t) => t.id === row.id) : null;
                  return (
                    <button
                      key={row.id}
                      onMouseEnter={() => setIndex(idx)}
                      onClick={() => runRow(row)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                        idx === index ? 'bg-indigo-500/10 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-200' : 'text-zinc-700 dark:text-zinc-200',
                      )}
                    >
                      {row.group === 'handling' &&
                        (row.id === 'create' ? (
                          <FilePlus2 className="h-4 w-4 shrink-0 text-indigo-500" />
                        ) : row.id === 'theme' ? (
                          <Moon className="h-4 w-4 shrink-0 text-zinc-400" />
                        ) : (
                          <RefreshCcw className="h-4 w-4 shrink-0 text-zinc-400" />
                        ))}
                      {task && <StatusBadge status={task.status} className="shrink-0" />}
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                      {task && <span className="text-[11px] text-zinc-400">{row.hint}</span>}
                      {row.id === 'create' && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-zinc-400" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

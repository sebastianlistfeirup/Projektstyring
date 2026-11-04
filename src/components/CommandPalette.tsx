import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CornerDownLeft, FilePlus2, Folder, MessageSquare, Search, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useSwarm } from '../lib/swarm';
import { VIEWS } from '../lib/nav';
import { useI18n, useLang, t } from '../lib/i18n';
import { cn, taskRef } from '../lib/utils';
import { StatusBadge } from './common';
import { wrapDialogFocus } from '../lib/dialogFocus';

type Group = 'handling' | 'projekt' | 'samtale' | 'leverance' | 'opgave' | 'navigation';
interface Row { id: string; group: Group; label: string; hint?: string; run: () => void }
const groups: Group[] = ['handling', 'projekt', 'samtale', 'leverance', 'opgave', 'navigation'];
const groupNames: Record<Group, string> = { handling: 'Handlinger', projekt: 'Projekter', samtale: 'Samtaler', leverance: 'Leverancer i seneste kørsel', opgave: 'Opgaver', navigation: 'Visninger' };
const matches = (query: string, ...values: (string | undefined)[]) => !query || values.some(value => value?.toLocaleLowerCase().includes(query));

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const tasks = useStore(s => s.tasks);
  const projects = useStore(s => s.projects);
  const chats = useStore(s => s.aiChats);
  const activeProjectId = useStore(s => s.activeProjectId);
  const selectTask = useStore(s => s.selectTask);
  const setActiveProject = useStore(s => s.setActiveProject);
  const addTask = useStore(s => s.addTask);
  const addChat = useStore(s => s.addAiChat);
  const toggleTheme = useStore(s => s.toggleTheme);
  const resetWorkspace = useStore(s => s.resetWorkspace);
  const toggleLang = useI18n(s => s.toggleLang);
  const run = useSwarm(s => s.run);
  const lang = useLang();

  const show = useCallback(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery(''); setIndex(0); setOpen(true);
  }, []);
  const close = useCallback((restore = true) => {
    setOpen(false);
    if (restore) requestAnimationFrame(() => returnFocus.current?.isConnected && returnFocus.current.focus());
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (dialogRef.current?.open) close(); else show();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('orbit:open-palette', show);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('orbit:open-palette', show); };
  }, [show, close]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) { dialog.showModal(); inputRef.current?.focus(); }
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  const rows = useMemo(() => {
    const queryText = query.trim(), q = queryText.toLocaleLowerCase(lang === 'da' ? 'da-DK' : 'en-US');
    const list: Row[] = [];
    const action = (id: string, label: string, keywords: string, execute: () => void, hint?: string) => {
      if (matches(q, label, keywords)) list.push({ id, group: 'handling', label, hint, run: execute });
    };
    const openWorkspace = (section?: string) => {
      const current = new URLSearchParams(location.pathname === '/chat' ? location.search : '');
      if (section) current.set('workspace', section);
      navigate(`/chat${current.size ? `?${current}` : ''}`);
    };
    const openRun = (section = 'result') => {
      if (!run?.projectId) { openWorkspace(section); return; }
      setActiveProject(run.projectId);
      const chat = chats.find(chat => chat.projectId === run.projectId) ?? addChat({ projectId: run.projectId, title: projects.find(project => project.id === run.projectId)?.name ?? 'Arbejdsresultat' });
      navigate(`/chat?chat=${encodeURIComponent(chat.id)}&workspace=${section}`);
    };
    action('workspace', 'Åbn samtale og arbejdsrum', 'orbit chat live', () => openWorkspace());
    action('connections', 'Åbn AI-forbindelser', 'konto login tjenester integration codex claude meshy elevenlabs', () => openWorkspace('connections'));
    if (run) action('result', 'Se seneste kørsel og muligheder for genoptagelse', 'resultat resume genoptag fortsæt status fejl', openRun, 'Åbner status; starter ikke arbejde');
    if (run?.status === 'running') action('live', 'Følg det igangværende arbejde', 'agent live arbejde', () => openWorkspace('live'));
    action('theme', t('palette.theme'), 'theme farve mørk lys', toggleTheme);
    action('lang', t('palette.language'), 'language dansk english', toggleLang);

    for (const project of projects.filter(project => !project.archived && matches(q, project.name)).slice(0, 8)) {
      list.push({ id: `project:${project.id}`, group: 'projekt', label: project.name, hint: project.id === activeProjectId ? 'Aktuelt projekt' : 'Åbn projekt', run: () => {
        setActiveProject(project.id);
        const chat = chats.filter(chat => chat.projectId === project.id).toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? addChat({ projectId: project.id, title: project.name });
        navigate(`/chat?chat=${encodeURIComponent(chat.id)}`);
      } });
    }
    for (const chat of chats.filter(chat => matches(q, chat.title)).toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8)) {
      list.push({ id: `chat:${chat.id}`, group: 'samtale', label: chat.title, hint: projects.find(project => project.id === chat.projectId)?.name ?? 'Uden projekt', run: () => { setActiveProject(chat.projectId); navigate(`/chat?chat=${encodeURIComponent(chat.id)}`); } });
    }
    const artifacts = [...(run?.jobs ?? []).flatMap(job => job.artifacts ?? []), ...(run?.results ?? []).flatMap(result => result.artifacts ?? [])];
    const seenArtifacts = new Set<string>();
    for (const artifact of artifacts) {
      if (!q || !matches(q, artifact.name) || seenArtifacts.has(artifact.name)) continue;
      seenArtifacts.add(artifact.name);
      list.push({ id: `artifact:${artifact.name}`, group: 'leverance', label: artifact.name, hint: 'Åbn kørslens mediegennemgang', run: () => openRun('visual') });
      if (seenArtifacts.size >= 8) break;
    }
    if (q) {
      for (const task of tasks.filter(task => matches(q, task.title, taskRef(task, projects))).slice(0, 8)) list.push({ id: task.id, group: 'opgave', label: task.title, hint: taskRef(task, projects), run: () => { setActiveProject(task.projectId); selectTask(task.id); } });
      const target = projects.find(project => project.id === activeProjectId) ?? projects.find(project => !project.archived);
      if (target) list.push({ id: 'create', group: 'opgave', label: `${t('palette.createTask')} “${queryText}”`, hint: target.name, run: () => { const task = addTask({ title: queryText, projectId: target.id }); setActiveProject(target.id); selectTask(task.id); } });
      if (matches(q, t('palette.reset'), 'nulstil workspace')) list.push({ id: 'reset', group: 'handling', label: t('palette.reset'), hint: t('palette.resetHint'), run: () => { if (window.confirm('Nulstil arbejdsområdet? Dine lokale projekter og samtaler bliver erstattet.')) resetWorkspace(); } });
    }
    for (const view of VIEWS.filter(view => matches(q, view.label, t(view.labelKey), ...view.keywords))) list.push({ id: `nav:${view.to}`, group: 'navigation', label: `${t('palette.goto')} ${t(view.labelKey)}`, run: () => navigate(view.to) });
    return groups.flatMap(group => list.filter(row => row.group === group));
  }, [query, tasks, projects, chats, activeProjectId, addTask, addChat, selectTask, setActiveProject, navigate, location.pathname, location.search, toggleTheme, resetWorkspace, toggleLang, run, lang]);
  const selected = Math.min(index, Math.max(rows.length - 1, 0));
  useEffect(() => { if (open) document.getElementById(`orbit-command-${selected}`)?.scrollIntoView({ block: 'nearest' }); }, [selected, open, query]);
  const runRow = (row: Row) => { close(false); row.run(); };

  return <dialog ref={dialogRef} onKeyDown={wrapDialogFocus} aria-labelledby="orbit-command-title" className="orbit-command-dialog" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="orbit-command-surface">
      <h2 id="orbit-command-title" className="sr-only">Søg og handlinger</h2>
      <div className="orbit-command-input"><Search size={18} aria-hidden="true" /><input ref={inputRef} role="combobox" aria-label="Søg i Orbit" aria-autocomplete="list" aria-expanded={open} aria-controls="orbit-command-results" aria-activedescendant={rows[selected] ? `orbit-command-${selected}` : undefined} value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }} placeholder="Søg projekter, samtaler, opgaver og handlinger…" onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex(current => Math.max(0, Math.min(current + (event.key === 'ArrowDown' ? 1 : -1), rows.length - 1))); }
        if (event.key === 'Enter' && rows[selected]) { event.preventDefault(); runRow(rows[selected]); }
      }} /><button type="button" aria-label="Luk søgning" className="btn-ghost" onClick={() => close()}><X size={16} /></button></div>
      <div id="orbit-command-results" role="listbox" aria-label="Søgeresultater" className="orbit-command-results">
        {rows.length === 0 && <p className="orbit-command-empty">Ingen resultater for “{query}”. Prøv et projekt, en samtale eller en handling.</p>}
        {groups.map(group => {
          const groupRows = rows.filter(row => row.group === group);
          if (!groupRows.length) return null;
          return <div role="group" aria-label={groupNames[group]} key={group}>
            <p className="orbit-command-group" aria-hidden="true">{groupNames[group]}</p>
            {groupRows.map(row => {
              const position = rows.indexOf(row);
              const task = row.group === 'opgave' && row.id !== 'create' ? tasks.find(task => task.id === row.id) : null;
              return <div id={`orbit-command-${position}`} role="option" aria-selected={position === selected} key={row.id} onMouseEnter={() => setIndex(position)} onClick={() => runRow(row)} className={cn('orbit-command-row', position === selected && 'is-selected')}>
                {row.group === 'projekt' ? <Folder size={16} /> : row.group === 'samtale' ? <MessageSquare size={16} /> : row.id === 'create' ? <FilePlus2 size={16} /> : task ? <StatusBadge status={task.status} className="shrink-0" /> : <ArrowRight size={15} />}
                <div><span>{row.label}</span>{row.hint && <small>{row.hint}</small>}</div>{position === selected && <CornerDownLeft size={14} className="orbit-command-enter" />}
              </div>;
            })}
          </div>;
        })}
      </div>
      <footer className="orbit-command-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> vælg</span><span><kbd>Enter</kbd> åbn</span><span><kbd>Esc</kbd> luk</span></footer>
    </div>
  </dialog>;
}

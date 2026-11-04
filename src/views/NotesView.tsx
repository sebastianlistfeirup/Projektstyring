import { useMemo, useState } from 'react';
import { FileText, Gavel, NotebookPen, Plus, Users } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useLang, t } from '../lib/i18n';
import { cn, formatDateShort } from '../lib/utils';
import type { NoteEntry, NoteKind } from '../lib/types';
import { EmptyState, ViewHeader } from '../components/common';
import NoteEditor from '../components/NoteEditor';

const KIND_META: Record<NoteKind, { labelKey: string; icon: typeof FileText; chip: string; iconClass: string }> = {
  note: {
    labelKey: 'notes.kindNote',
    icon: FileText,
    chip: 'bg-sky-500/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300',
    iconClass: 'text-sky-500 dark:text-sky-400',
  },
  meeting: {
    labelKey: 'notes.kindMeeting',
    icon: Users,
    chip: 'bg-violet-500/10 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300',
    iconClass: 'text-violet-500 dark:text-violet-400',
  },
  decision: {
    labelKey: 'notes.kindDecision',
    icon: Gavel,
    chip: 'bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
    iconClass: 'text-amber-500 dark:text-amber-400',
  },
};


export default function NotesView() {
  useLang();
  const notes = useStore((s) => s.notes);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const addNote = useStore((s) => s.addNote);
  const deleteNote = useStore((s) => s.deleteNote);

  const [selection, setSelection] = useState<Record<string, string | null>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('orbit-note-selection') ?? '{}');
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? Object.fromEntries(Object.entries(saved).filter(([, value]) => value === null || typeof value === 'string')) as Record<string, string | null> : {};
    } catch { return {}; }
  });
  const selId = selection[activeProjectId ?? 'all'] ?? null;
  const setSelId = (id: string | null) => {
    const next = { ...selection, [activeProjectId ?? 'all']: id };
    setSelection(next);
    try { localStorage.setItem('orbit-note-selection', JSON.stringify(next)); } catch { /* Draft persistence has its own visible warning. */ }
  };

  const visible = useMemo(
    () =>
      notes
        .filter((n) => (activeProjectId ? n.projectId === activeProjectId : true))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [notes, activeProjectId],
  );

  const selected = visible.find((n) => n.id === selId) ?? null;

  const groups = useMemo(() => {
    if (activeProjectId) {
      const project = projects.find((p) => p.id === activeProjectId);
      return [{ projectId: activeProjectId, name: project?.name ?? '—', notes: visible }];
    }
    return projects
      .map((p) => ({ projectId: p.id, name: p.name, notes: visible.filter((n) => n.projectId === p.id) }))
      .filter((g) => g.notes.length > 0);
  }, [activeProjectId, projects, visible]);

  const targetProjectId = activeProjectId ?? projects[0]?.id ?? null;

  const onNew = () => {
    if (!targetProjectId) return;
    addNote(targetProjectId, 'note', t('notes.untitled'), '');
    const created = useStore.getState().notes.find((n) => n.projectId === targetProjectId);
    if (created) setSelId(created.id);
  };

  const onDelete = (note: NoteEntry) => {
    if (!window.confirm(t('notes.confirmDelete').replace('{title}', note.title))) return;
    deleteNote(note.id);
    try { localStorage.removeItem(`orbit-note-draft:${note.projectId}:${note.id}`); } catch { /* Intentional deletion; no other drafts are affected. */ }
    if (selId === note.id) setSelId(null);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col p-4 lg:p-6">
        <ViewHeader
          title={t('notes.title')}
          subtitle={t('notes.subtitle')}
          actions={
            <button onClick={onNew} disabled={!targetProjectId} className="btn-primary text-sm">
              <Plus className="h-4 w-4" />
              {t('notes.new')}
            </button>
          }
        />

        {!activeProjectId && visible.length > 0 && (
          <p className="mb-3 text-xs text-zinc-400 dark:text-zinc-500">{t('notes.allProjectsHint')}</p>
        )}

        {visible.length === 0 ? (
          <EmptyState
            icon={<NotebookPen className="h-6 w-6" />}
            title={t('notes.emptyList')}
            description={t('notes.emptyDesc')}
            action={
              <button onClick={onNew} disabled={!targetProjectId} className="btn-primary text-sm">
                <Plus className="h-4 w-4" />
                {t('notes.new')}
              </button>
            }
          />
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[280px_1fr]">
            {/* Liste */}
            <div className="space-y-4">
              {groups.map((group) => (
                <section key={group.projectId}>
                  {!activeProjectId && (
                    <h3 className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                      <span className={cn('h-2 w-2 rounded-sm', `bg-${projects.find((p) => p.id === group.projectId)?.color ?? 'zinc'}-500`)} />
                      {group.name}
                    </h3>
                  )}
                  <ul className="space-y-1.5">
                    {group.notes.map((note) => {
                      const meta = KIND_META[note.kind];
                      const Icon = meta.icon;
                      const author = users.find((u) => u.id === note.authorId);
                      return (
                        <li key={note.id}>
                          <button
                            onClick={() => setSelId(note.id)}
                            className={cn(
                              'w-full rounded-xl border px-3 py-2.5 text-left transition-all',
                              selId === note.id
                                ? 'border-indigo-500/40 bg-indigo-500/[0.06] shadow-sm dark:border-indigo-400/30'
                                : 'border-zinc-200/80 bg-white/60 hover:border-zinc-300 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:border-white/[0.12]',
                            )}
                          >
                            <span className="flex items-center gap-2">
                              <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.iconClass)} />
                              <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{note.title}</span>
                            </span>
                            {note.body.trim() && (
                              <span className="mt-1 block line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                                {note.body}
                              </span>
                            )}
                            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                              <span>{formatDateShort(note.updatedAt)}</span>
                              {note.kind === 'decision' && (
                                <span className="rounded-full bg-amber-500/10 px-1.5 py-px font-medium text-amber-700 dark:text-amber-300">
                                  {t('notes.decisionMeta')
                                    .replace('{date}', formatDateShort(note.updatedAt))
                                    .replace('{name}', author?.name ?? '—')}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>

            {/* Editor */}
            {selected ? (
              <NoteEditor key={selected.id} note={selected} onDelete={onDelete} />
            ) : (
              <EmptyState
                icon={<NotebookPen className="h-6 w-6" />}
                title={t('notes.emptyTitle')}
                description={t('notes.emptyDesc')}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

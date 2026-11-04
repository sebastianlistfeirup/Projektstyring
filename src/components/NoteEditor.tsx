import { useId, useState } from 'react';
import { FileText, Gavel, Trash2, Users } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { NoteEntry } from '../lib/types';
import { t } from '../lib/i18n';
import { formatDateShort } from '../lib/utils';

type Content = Pick<NoteEntry, 'title' | 'body' | 'kind'>;
type Draft = Content & { version: 1; base: Content; baseUpdatedAt: string };
const content = (note: Content): Content => ({ title: note.title, body: note.body, kind: note.kind });
const same = (a: Content, b: Content) => a.title === b.title && a.body === b.body && a.kind === b.kind;
const fromNote = (note: NoteEntry): Draft => ({ version: 1, ...content(note), base: content(note), baseUpdatedAt: note.updatedAt });
const keyFor = (note: NoteEntry) => `orbit-note-draft:${note.projectId}:${note.id}`;
const validContent = (value: unknown): value is Content => Boolean(value && typeof value === 'object' && typeof (value as Content).title === 'string' && typeof (value as Content).body === 'string' && ['note', 'meeting', 'decision'].includes((value as Content).kind));

function readDraft(note: NoteEntry): { draft: Draft; issue: string } {
  try {
    const raw = localStorage.getItem(keyFor(note));
    if (!raw) return { draft: fromNote(note), issue: '' };
    const saved = JSON.parse(raw);
    const candidate = saved as Record<string, unknown>;
    if (!candidate || candidate.version !== 1 || !validContent(candidate.base) || typeof candidate.baseUpdatedAt !== 'string' || !validContent(candidate)) throw new Error('Invalid draft');
    return { draft: saved as Draft, issue: '' };
  } catch { return { draft: fromNote(note), issue: 'Den lokale kladde kunne ikke læses. Den gemte note vises; den lokale kopi er ikke slettet.' }; }
}

export default function NoteEditor({ note, onDelete }: { note: NoteEntry; onDelete: (note: NoteEntry) => void }) {
  const fieldId = useId();
  const [initial] = useState(() => readDraft(note));
  const [storedDraft, setDraft] = useState(initial.draft);
  // External saves refresh pristine editors; local edits retain their own base.
  const draft = same(storedDraft, storedDraft.base) && !same(note, storedDraft.base) ? fromNote(note) : storedDraft;
  const [issue, setIssue] = useState(initial.issue);
  const [saved, setSaved] = useState(false);
  const updateNote = useStore(s => s.updateNote);
  const users = useStore(s => s.users);
  const dirty = !same(draft, draft.base);
  const conflict = dirty && !same(note, draft.base);

  const change = (patch: Partial<Content>) => {
    const next = { ...draft, ...patch };
    setDraft(next); setSaved(false);
    try { localStorage.setItem(keyFor(note), JSON.stringify(next)); setIssue(''); }
    catch { setIssue('Kladdeændringen findes kun i denne visning. Lokal lagring er utilgængelig; gem eller kopiér teksten før du forlader siden.'); }
  };
  const clearLocal = () => {
    try { localStorage.removeItem(keyFor(note)); setIssue(''); }
    catch { setIssue('Den tidligere lokale kladde kunne ikke fjernes. Kontrollér den ved næste åbning.'); }
  };
  const save = () => {
    updateNote(note.id, content(draft));
    const updated = useStore.getState().notes.find(item => item.id === note.id);
    if (!updated) { setIssue('Noten findes ikke længere. Kopiér din kladde, før du forlader siden.'); return; }
    setDraft(fromNote(updated)); clearLocal(); setSaved(true);
  };
  const discard = () => { setDraft(fromNote(note)); clearLocal(); setSaved(false); };
  const kinds = [{ kind: 'note', Icon: FileText, label: 'notes.kindNote' }, { kind: 'meeting', Icon: Users, label: 'notes.kindMeeting' }, { kind: 'decision', Icon: Gavel, label: 'notes.kindDecision' }] as const;

  return <section className="glass-panel rounded-xl p-4 animate-fade-in" aria-label="Noteredigering">
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Notetype">
      {kinds.map(({ kind, Icon, label }) => <button key={kind} type="button" aria-pressed={draft.kind === kind} onClick={() => change({ kind })} className={`btn-outline text-xs ${draft.kind === kind ? 'border-indigo-500/40 bg-indigo-500/10' : ''}`}><Icon size={13} />{t(label)}</button>)}
      <button type="button" onClick={() => onDelete(note)} className="btn-ghost ml-auto px-2 py-1.5 text-xs text-rose-600 dark:text-rose-400"><Trash2 size={13} />{t('notes.deleteTitle')}</button>
    </div>
    <div className="mt-4"><label htmlFor={`${fieldId}-title`} className="text-xs text-zinc-500 dark:text-zinc-400">Notens titel</label><input id={`${fieldId}-title`} value={draft.title} onChange={event => change({ title: event.target.value })} placeholder={t('notes.titlePlaceholder')} className="input mt-1 font-semibold" /></div>
    <div className="mt-3"><label htmlFor={`${fieldId}-body`} className="text-xs text-zinc-500 dark:text-zinc-400">Notens indhold</label><textarea id={`${fieldId}-body`} value={draft.body} onChange={event => change({ body: event.target.value })} rows={14} placeholder={t('notes.bodyPlaceholder')} className="input mt-1 resize-y leading-relaxed" /></div>
    {conflict && <div role="alert" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs"><strong>Den gemte note er ændret, mens du skrev.</strong><p className="mt-1">Din kladde er bevaret. “Gem min version” erstatter den gemte tekst; “Kassér kladde” åbner den senest gemte version.</p><details className="mt-2"><summary className="cursor-pointer">Se senest gemte tekst</summary><p className="mt-2 font-semibold">{note.title}</p><p className="whitespace-pre-wrap mt-1">{note.body}</p></details></div>}
    {issue && <p role="alert" className="mt-3 text-xs text-amber-700 dark:text-amber-300">{issue}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" onClick={save} disabled={!dirty || !draft.title.trim()} className="btn-primary text-xs">{conflict ? 'Gem min version' : t('notes.save')}</button>
      {dirty && <button type="button" onClick={discard} className="btn-ghost text-xs">Kassér kladde</button>}
      <span role="status" className="text-xs text-zinc-500 dark:text-zinc-400">{saved ? t('notes.saved') : dirty && !issue ? 'Kladde gemt lokalt · ikke delt endnu' : ''}</span>
      <span className="ml-auto text-[11px] text-zinc-400 dark:text-zinc-500">{formatDateShort(note.createdAt)} · {users.find(user => user.id === note.authorId)?.name ?? '—'}</span>
    </div>
  </section>;
}

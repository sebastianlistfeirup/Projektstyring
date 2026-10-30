import { createHash } from 'node:crypto';

const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const document = (kind, id, title, text, extra = {}) => ({ kind, id, title, sha256: hash(text), characters: text.length, ...extra });

/** A run carries a reproducible snapshot, never a pointer to a mutable draft. */
export function captureProjectContext(project, task, state, fallbackBible = '') {
  const published = state.bibleVersions?.[project.id]?.at(-1);
  const bible = String(published?.text ?? state.bibles?.[project.id] ?? fallbackBible);
  const decisions = (state.notes ?? []).filter(note => note.projectId === project.id && note.kind === 'decision')
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id)));
  const documents = [document('bible', published?.id ?? `bible:${project.id}`, 'Projektbibel', bible, {
    state: published ? 'published' : bible ? 'draft' : 'missing', version: published?.version ?? null, updatedAt: published?.createdAt ?? null,
  })];
  if (task) documents.push(document('task', task.id, task.title, `${task.title}\n${task.description ?? ''}`, { updatedAt: task.updatedAt ?? null }));
  for (const note of decisions) documents.push(document('decision', note.id, String(note.title ?? 'Beslutning'), `${note.title ?? ''}\n${note.body ?? ''}`, { updatedAt: note.updatedAt ?? null }));
  const manifest = {
    version: 1, capturedAt: new Date().toISOString(), projectId: project.id, projectName: project.name ?? project.id,
    releaseGoal: project.releaseGoal ?? '', scopeTaskIds: project.scopeTaskIds ? [...project.scopeTaskIds] : null,
    documents,
  };
  const context = decisions.length ? [bible,
    'REGISTREREDE PROJEKTBESLUTNINGER\nDisse noter er registreret som beslutninger i projektet. Ved modstrid med den gældende bibel skal konflikten synliggøres; du må ikke selv ændre spillets retning.',
    ...decisions.map(note => `Beslutning ${note.id}: ${note.title ?? ''}\nSenest ændret: ${note.updatedAt ?? 'ukendt'}\n${note.body ?? ''}`),
  ].join('\n\n') : bible;
  return { bible: context, contextManifest: manifest };
}

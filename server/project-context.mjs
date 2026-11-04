import { createHash } from 'node:crypto';

const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const document = (kind, id, title, text, extra = {}) => ({ kind, id, title, sha256: hash(text), characters: text.length, ...extra });

// Content identity deliberately excludes timestamps: task status and sync
// metadata change during normal execution without changing the instruction.
export function projectContextFingerprint(manifest) {
  if (!manifest || !Array.isArray(manifest.documents)) return null;
  return hash(JSON.stringify({
    projectId: manifest.projectId ?? null,
    releaseGoal: manifest.releaseGoal ?? '',
    scopeTaskIds: manifest.scopeTaskIds ? [...manifest.scopeTaskIds].sort() : null,
    repositoryPath: manifest.repositoryPath ?? null,
    repositoryBaseRef: manifest.repositoryBaseRef ?? null,
    verificationChecks: manifest.verificationChecks ?? [],
    documents: manifest.documents.map(doc => ({ kind: doc.kind, id: doc.id, title: doc.title, sha256: doc.sha256, state: doc.state ?? null, version: doc.version ?? null }))
      .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)),
  }));
}

export function compareProjectContext(saved, current) {
  const expectedFingerprint = projectContextFingerprint(saved), currentFingerprint = projectContextFingerprint(current);
  if (!expectedFingerprint || !currentFingerprint) return { status: 'unavailable', changes: ['Projektgrundlaget kunne ikke kontrolleres.'], expectedFingerprint, currentFingerprint };
  const changes = [];
  const now = new Map(current.documents.map(doc => [`${doc.kind}:${doc.id}`, doc]));
  for (const doc of saved.documents) {
    const key = `${doc.kind}:${doc.id}`, next = now.get(key);
    if (!next) changes.push(`${doc.title ?? doc.id} er fjernet eller erstattet.`);
    else if (doc.sha256 !== next.sha256 || (doc.state ?? null) !== (next.state ?? null) || (doc.version ?? null) !== (next.version ?? null)) changes.push(`${doc.title ?? doc.id} er ændret.`);
    now.delete(key);
  }
  for (const doc of now.values()) changes.push(`${doc.title ?? doc.id} er tilføjet.`);
  if (expectedFingerprint !== currentFingerprint && !changes.length) changes.push('Projektets mål, scope, dokumentnavne eller repository-grundlag er ændret.');
  return { status: expectedFingerprint === currentFingerprint ? 'current' : 'changed', changes, expectedFingerprint, currentFingerprint };
}

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
    repositoryPath: project.repositoryPath ?? null, repositoryBaseRef: project.repositoryBaseRef ?? null,
    verificationChecks: (project.verificationChecks ?? []).map(check => ({ name: check.name, command: check.command, args: [...(check.args ?? [])], timeoutMs: check.timeoutMs ?? null })),
    documents,
  };
  manifest.fingerprint = projectContextFingerprint(manifest);
  const context = decisions.length ? [bible,
    'REGISTREREDE PROJEKTBESLUTNINGER\nDisse noter er registreret som beslutninger i projektet. Ved modstrid med den gældende bibel skal konflikten synliggøres; du må ikke selv ændre spillets retning.',
    ...decisions.map(note => `Beslutning ${note.id}: ${note.title ?? ''}\nSenest ændret: ${note.updatedAt ?? 'ukendt'}\n${note.body ?? ''}`),
  ].join('\n\n') : bible;
  return { bible: context, contextManifest: manifest };
}

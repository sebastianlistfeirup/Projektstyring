export type MediaFeedback = { version: 1; runId: string; artifactId: string; sha256: string; note: string; updatedAt: string };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = (runId: string, artifactId: string) => `orbit:media-feedback:v1:${encodeURIComponent(runId)}:${encodeURIComponent(artifactId)}`;

export function readMediaFeedback(storage: StorageLike, runId: string, artifactId: string, sha256: string): MediaFeedback | null {
  try {
    const record = JSON.parse(storage.getItem(key(runId, artifactId)) ?? 'null');
    return record?.version === 1 && record.runId === runId && record.artifactId === artifactId && record.sha256 === sha256 && typeof record.note === 'string' && record.note.length <= 2000 && typeof record.updatedAt === 'string' ? record : null;
  } catch { return null; }
}

export function saveMediaFeedback(storage: StorageLike, runId: string, artifactId: string, sha256: string, note: string): MediaFeedback | null {
  if (!artifactId || !/^[a-f0-9]{64}$/i.test(sha256)) throw new Error('Feedback kræver en arkiveret version.');
  const value = note.trim();
  if (value.length > 2000) throw new Error('Feedback må højst være 2.000 tegn.');
  if (!value) { storage.removeItem(key(runId, artifactId)); return null; }
  const record: MediaFeedback = { version: 1, runId, artifactId, sha256, note: value, updatedAt: new Date().toISOString() };
  storage.setItem(key(runId, artifactId), JSON.stringify(record));
  return record;
}

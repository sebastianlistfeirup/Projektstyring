import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Keep transactions short and close every connection before returning. DELETE
// journaling means the existing stopped-workspace backup copies a complete DB,
// with no live WAL or open Windows file handle left outside the snapshot.
export function durableStorePath(dirs) {
  if (!dirs?.runs) throw new Error('Det holdbare joblager mangler sin mappe.');
  return join(dirs.runs, 'orbit-state.sqlite');
}

function connect(path) {
  mkdirSync(dirname(path), { recursive: true });
  const created = !existsSync(path);
  const db = new DatabaseSync(path);
  try {
    if (created) chmodSync(path, 0o600);
    db.exec('PRAGMA busy_timeout=5000;');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new Error('Joblageret kræver en nyere Orbit-version.');
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
    // Reads must not execute schema writes. Queue reconciliation reads a run
    // through a second connection while its own queue transaction holds a
    // writer lock; unnecessary CREATE/PRAGMA writes would deadlock until timeout.
    if (version === 0) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const lockedVersion = db.prepare('PRAGMA user_version').get().user_version;
        if (lockedVersion > 1) throw new Error('Joblageret kræver en nyere Orbit-version.');
        if (lockedVersion === 0) db.exec(`CREATE TABLE IF NOT EXISTS documents (
          key TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL
        ); PRAGMA user_version=1;`);
        db.exec('COMMIT');
      } catch (error) { try { db.exec('ROLLBACK'); } catch { /* BEGIN may fail. */ } throw error; }
    }
    return db;
  } catch (error) { db.close(); throw error; }
}

function document(row) {
  return row ? { revision: row.revision, value: JSON.parse(row.body), updatedAt: row.updated_at } : null;
}

export function readDurableDocument(path, key) {
  if (!existsSync(path)) return null;
  const db = connect(path);
  try { return document(db.prepare('SELECT revision, body, updated_at FROM documents WHERE key=?').get(key)); }
  finally { db.close(); }
}

export function listDurableDocuments(path, prefix) {
  if (!existsSync(path)) return [];
  const db = connect(path);
  try {
    return db.prepare('SELECT key, revision, body, updated_at FROM documents WHERE substr(key,1,?)=?').all(prefix.length, prefix)
      .map(row => ({ key: row.key, ...document(row) }));
  } finally { db.close(); }
}

export function visitDurableDocuments(path, prefix, visit) {
  if (!existsSync(path)) return;
  const db = connect(path);
  try {
    for (const row of db.prepare('SELECT key, revision, body, updated_at FROM documents WHERE substr(key,1,?)=?').iterate(prefix.length, prefix)) {
      const outcome = visit({ key: row.key, ...document(row) });
      if (outcome?.then) throw new Error('Lagergennemgang skal være synkron.');
    }
  } finally { db.close(); }
}

// The callback reads current persisted state while holding the write lock.
// Undefined value means no mutation; thrown errors roll the transaction back.
// No external work or async callback belongs inside this transaction.
export function transactDurableDocument(path, key, change) {
  const db = connect(path);
  try {
    db.exec('BEGIN IMMEDIATE');
    const before = document(db.prepare('SELECT revision, body, updated_at FROM documents WHERE key=?').get(key));
    const outcome = change(before);
    if (outcome?.then) throw new Error('En lagertransaktion må ikke afvente eksternt arbejde.');
    let saved = before;
    if (outcome?.value !== undefined) {
      const body = JSON.stringify(outcome.value), revision = (before?.revision ?? 0) + 1, updatedAt = Date.now();
      if (body === undefined) throw new Error('Joblageret kan kun gemme JSON.');
      db.prepare('INSERT INTO documents(key,revision,body,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET revision=excluded.revision, body=excluded.body, updated_at=excluded.updated_at')
        .run(key, revision, body, updatedAt);
      saved = { revision, value: JSON.parse(body), updatedAt };
    }
    db.exec('COMMIT');
    return { document: saved, result: outcome?.result };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* BEGIN itself may have failed. */ }
    throw error;
  } finally { db.close(); }
}

export function saveDurableRun(dirs, run, summary) {
  const db = connect(durableStorePath(dirs));
  try {
    db.exec('BEGIN IMMEDIATE');
    const write = db.prepare('INSERT INTO documents(key,revision,body,updated_at) VALUES(?,1,?,?) ON CONFLICT(key) DO UPDATE SET revision=documents.revision+1, body=excluded.body, updated_at=excluded.updated_at');
    const at = Date.now();
    write.run(`run:${run.runId}`, JSON.stringify(run), at);
    write.run(`summary:${run.runId}`, JSON.stringify(summary), at);
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch { /* BEGIN may fail. */ } throw error; }
  finally { db.close(); }
}

const operationKey = key => {
  if (typeof key !== 'string' || !key || key.length > 500) throw new Error('Mediebestillingen mangler en stabil identitet.');
  return `submission:${key}`;
};

function validateSubmission(value) {
  if (!value || !['submitting', 'processing', 'completed'].includes(value.state)
    || typeof value.serviceId !== 'string' || !value.serviceId || !/^[a-f0-9]{64}$/i.test(value.requestHash ?? '')
    || (value.remoteId !== undefined && (typeof value.remoteId !== 'string' || !value.remoteId))
    || (value.state === 'processing' && !value.remoteId)
    || (value.state === 'completed' && (!Array.isArray(value.artifacts) || !value.artifacts.length))) throw new Error('Mediebestillingens gemte tilstand er ugyldig. Kontrollér joblageret.');
  operationKey(value.key);
  return value;
}

// A workspace rollback must never roll back knowledge of an external effect.
// Capture before directory replacement, merge inside the restore transaction's
// commitSnapshot callback. A conflict throws so that its directories roll back.
export function captureExternalSubmissionLedger(dirs) {
  return listDurableDocuments(durableStorePath(dirs), 'submission:').map(record => {
    const value = validateSubmission(record.value);
    if (record.key !== operationKey(value.key)) throw new Error('Mediebestillingens lageridentitet matcher ikke.');
    return value;
  });
}

export function mergeExternalSubmissionLedger(dirs, ledger) {
  if (!Array.isArray(ledger)) throw new Error('Mediebestillingernes gendannelsesgrundlag er ugyldigt.');
  if (!ledger.length) return;
  const db = connect(durableStorePath(dirs));
  try {
    db.exec('BEGIN IMMEDIATE');
    const read = db.prepare('SELECT body FROM documents WHERE key=?');
    const write = db.prepare('INSERT INTO documents(key,revision,body,updated_at) VALUES(?,1,?,?) ON CONFLICT(key) DO UPDATE SET revision=documents.revision+1, body=excluded.body, updated_at=excluded.updated_at');
    const rank = { submitting: 1, processing: 2, completed: 3 };
    for (const item of ledger) {
      const live = validateSubmission(item), key = operationKey(live.key), row = read.get(key);
      const restored = row ? validateSubmission(JSON.parse(row.body)) : null;
      if (restored && (restored.key !== live.key || restored.serviceId !== live.serviceId || restored.requestHash !== live.requestHash
        || (restored.remoteId && live.remoteId && restored.remoteId !== live.remoteId))) throw new Error('Backup og nuværende lager har modstridende mediebestillinger. Gendannelsen er afbrudt for at bevare kvitteringerne.');
      // An equally advanced restored record belongs to the restored files. In
      // particular, a newer full backup can restore a previously missing asset.
      if (restored && rank[restored.state] >= rank[live.state]) continue;
      const value = { ...live, retainedAcrossRestore: true };
      if (value.state === 'completed') value.requiresArtifactRecovery = true;
      else delete value.artifacts; // A preview from after the backup may be gone.
      write.run(key, JSON.stringify(value), Date.now());
    }
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch { /* BEGIN may fail. */ } throw error; }
  finally { db.close(); }
}

export function readExternalSubmission(dirs, key) {
  return readDurableDocument(durableStorePath(dirs), operationKey(key))?.value ?? null;
}

export function claimExternalSubmission(dirs, { key, serviceId, requestHash }) {
  if (typeof serviceId !== 'string' || !serviceId || !/^[a-f0-9]{64}$/i.test(requestHash ?? '')) throw new Error('Mediebestillingen mangler tjeneste eller indholdsidentitet.');
  return transactDurableDocument(durableStorePath(dirs), operationKey(key), current => {
    const previous = current?.value;
    if (previous) {
      validateSubmission(previous);
      if (previous.key !== key) throw new Error('Mediebestillingens lageridentitet matcher ikke.');
      if (previous.serviceId !== serviceId || previous.requestHash !== requestHash) throw new Error('Mediebestillingens grundlag er ændret. Opret en ny opgave i stedet for at genbruge en tidligere bestilling.');
      if (previous.requiresArtifactRecovery) throw new Error('Mediebestillingen blev allerede afsluttet efter den gendannede backup. Gendan leverancen fra en nyere backup eller hent det eksisterende resultat hos leverandøren. Orbit genbestiller ikke automatisk.');
      if (previous.state === 'submitting' && !previous.remoteId) throw new Error('En tidligere mediebestilling kan være modtaget af leverandøren, men kvitteringen mangler. Kontrollér leverandørens historik. Orbit genbestiller ikke automatisk.');
      return { result: { created: false, submission: previous } };
    }
    const submission = { key, serviceId, requestHash, state: 'submitting', submittedAt: Date.now() };
    return { value: submission, result: { created: true, submission } };
  }).result;
}

export function updateExternalSubmission(dirs, key, patch) {
  if (!patch || !['processing', 'completed'].includes(patch.state)) throw new Error('Ugyldig mediekvittering.');
  return transactDurableDocument(durableStorePath(dirs), operationKey(key), current => {
    if (!current) throw new Error('Mediebestillingen er ikke reserveret i joblageret.');
    const previous = validateSubmission(current.value);
    if (previous.key !== key) throw new Error('Mediebestillingens lageridentitet matcher ikke.');
    if (previous.state === 'completed' && patch.state !== 'completed') throw new Error('En afsluttet mediebestilling kan ikke genåbnes.');
    if (patch.remoteId !== undefined && (typeof patch.remoteId !== 'string' || !patch.remoteId || patch.remoteId.length > 500)) throw new Error('Ugyldig leverandørkvittering.');
    if (previous.remoteId && patch.remoteId && previous.remoteId !== patch.remoteId) throw new Error('Leverandørkvitteringen tilhører en anden bestilling.');
    const value = { ...previous, state: patch.state, updatedAt: Date.now(),
      ...(patch.remoteId ? { remoteId: patch.remoteId } : {}),
      ...(patch.artifacts ? { artifacts: patch.artifacts } : {}) };
    if (value.state === 'processing' && !value.remoteId) throw new Error('En igangværende mediebestilling kræver leverandørens id.');
    if (value.state === 'completed' && (!Array.isArray(value.artifacts) || !value.artifacts.length)) throw new Error('En afsluttet mediebestilling kræver en leverance.');
    return { value, result: value };
  }).result;
}

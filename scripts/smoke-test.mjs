// Orbit Companion – automatiseret smoke-test
// Køres med: npm run test:smoke
// Tester alle endpoints på den kørende Companion-server (standard: http://127.0.0.1:4310).
// Afslutter med "ALLE TESTS BESTÅET" (exit 0) eller "X FEJL" (exit 1).
import { existsSync, rmSync } from 'node:fs';

const BASE = (process.env.ORBIT_COMPANION_URL ?? 'http://127.0.0.1:4310').replace(/\/$/, '');
const OPEN_EXPORT = process.env.ORBIT_SMOKE_OPEN_EXPORT === '1';

const resultater = []; // { status: 'pass' | 'fail' | 'skip' }
const testFiler = new Set(); // præcist de filstier serveren returnerede og skal ryddes op

function linje(status, nummer, navn, detalje = '') {
  resultater.push({ status });
  const symbol = status === 'pass' ? '✓' : status === 'skip' ? '–' : '✗';
  const tekst = detalje ? ` – ${detalje}` : '';
  console.log(`${symbol} ${String(nummer).padStart(2)}. ${navn}${tekst}`);
}

function forvent(betingelse, besked) {
  if (!betingelse) throw new Error(besked);
}

async function hent(sti) {
  const res = await fetch(`${BASE}${sti}`, { signal: AbortSignal.timeout(15000) });
  return res.json();
}

async function send(sti, body) {
  const res = await fetch(`${BASE}${sti}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

async function kør(nummer, navn, fn) {
  try {
    const resultat = await fn();
    if (resultat && typeof resultat === 'object' && resultat.skip) {
      linje('skip', nummer, navn, resultat.skip);
    } else {
      linje('pass', nummer, navn, typeof resultat === 'string' ? resultat : '');
    }
  } catch (err) {
    linje('fail', nummer, navn, err.message);
  }
}

// To fiktive opgaver. Bemærk: serverens CSV-generator tilgår t.subtasks og t.comments
// som arrays – begge felter skal derfor altid være til stede.
const opgaver = [
  {
    id: 'smoke-export-1', number: 1, title: 'Smoke-test opgave 1', status: 'todo', priority: 'high',
    projectId: null, assigneeName: 'Smoke Tester', sprintName: 'Sprint 1', startDate: '2026-10-12',
    dueDate: '2026-10-19', estimate: 3, subtasks: [{ id: 'st1', title: 'Delopgave', done: true }], comments: [],
  },
  {
    id: 'smoke-export-2', number: 2, title: 'Smoke-test opgave 2; med "semikolon"', status: 'done', priority: 'low',
    projectId: null, assigneeName: '', sprintName: '', startDate: '', dueDate: '', estimate: '',
    subtasks: [], comments: [{ id: 'c1', text: 'kommentar' }],
  },
];

const syncOpgave = {
  id: 'smoke-sync-1', number: 1, title: 'Smoke-sync opgave', status: 'todo', priority: 'medium', dueDate: '',
};

// ---- Forbindelsestjek: giv en klar besked i stedet for 14 fejllinjer ----
try {
  const ping = await hent('/api/ping');
  forvent(ping.ok === true, 'serveren svarede ikke ok på /api/ping');
} catch (err) {
  console.error(`Kunne ikke nå Orbit Companion på ${BASE} – er serveren startet? (${err.message})`);
  console.error('1 FEJL');
  process.exit(1);
}

console.log(`Smoke-test mod ${BASE}\n`);

await kør(1, 'GET /api/ping', async () => {
  const d = await hent('/api/ping');
  forvent(d.ok === true, `forventede ok:true, fik ${JSON.stringify(d)}`);
  forvent(d.name === 'Orbit Companion', `forventede name 'Orbit Companion', fik '${d.name}'`);
  return d.name;
});

await kør(2, 'GET /api/status', async () => {
  const d = await hent('/api/status');
  forvent(d.ok === true, `forventede ok:true, fik ${JSON.stringify(d)}`);
  forvent(typeof d.exportDir === 'string' && d.exportDir.length > 0, 'exportDir er ikke defineret');
  return `exportDir: ${d.exportDir}`;
});

await kør(3, 'POST /api/config (rydder webhook)', async () => {
  const d = await send('/api/config', { teamsWebhook: '' });
  forvent(d.ok === true, `forventede ok:true, fik ${JSON.stringify(d)}`);
});

await kør(4, 'POST /api/notify', async () => {
  const d = await send('/api/notify', { title: 'Smoke-test', message: 'Test-besked fra smoke-testen – kan ignoreres.' });
  forvent(d.ok === true, `forventede ok:true, fik ${JSON.stringify(d)}`);
});

await kør(5, 'POST /api/teams uden webhook (forventer graceful afvisning)', async () => {
  const d = await send('/api/teams', { title: 'T', text: 'x' });
  forvent(d.ok === false, `forventede ok:false, fik ${JSON.stringify(d)}`);
  forvent(typeof d.reason === 'string' && d.reason.length > 0, 'der mangles en reason i svaret');
  return d.reason;
});

await kør(6, 'POST /api/export csv + json med 2 fiktive opgaver', async () => {
  const csv = await send('/api/export', { tasks: opgaver, projects: [], format: 'csv' });
  forvent(csv.ok === true && typeof csv.path === 'string', `csv-svar uden ok/path: ${JSON.stringify(csv)}`);
  forvent(existsSync(csv.path), `csv-filen findes ikke på disk: ${csv.path}`);
  testFiler.add(csv.path);
  const json = await send('/api/export', { tasks: opgaver, projects: [], format: 'json' });
  forvent(json.ok === true && typeof json.path === 'string', `json-svar uden ok/path: ${JSON.stringify(json)}`);
  forvent(existsSync(json.path), `json-filen findes ikke på disk: ${json.path}`);
  testFiler.add(json.path);
  return `${csv.path} + ${json.path}`;
});

await kør(7, 'POST /api/report (markdown)', async () => {
  const d = await send('/api/report', { markdown: '# T' });
  forvent(d.ok === true && typeof d.path === 'string', `forventede ok:true + path, fik ${JSON.stringify(d)}`);
  forvent(existsSync(d.path), `rapport-filen findes ikke på disk: ${d.path}`);
  testFiler.add(d.path);
  return d.path;
});

await kør(8, 'POST /api/sync/push + GET /api/sync/state', async () => {
  const push = await send('/api/sync/push', {
    clientId: 'smoke-test',
    user: { name: 'Smoke-test' },
    snapshot: {
      tasks: [syncOpgave], projects: [], sprints: [], users: [], labels: [], activity: [],
      updatedAt: new Date().toISOString(),
    },
  });
  forvent(push.ok === true, `forventede ok:true, fik ${JSON.stringify(push)}`);
  const state = await hent('/api/sync/state');
  forvent(state.ok === true, `forventede ok:true, fik ${JSON.stringify(state)}`);
  const fundet = (state.snapshot?.tasks ?? []).find((t) => t.id === syncOpgave.id);
  forvent(fundet && fundet.title === syncOpgave.title, 'den synkroniserede opgave kom ikke tilbage i /api/sync/state');
  return `opgave '${fundet.title}' modtaget`;
});

await kør(9, 'GET /api/presence', async () => {
  const d = await hent('/api/presence');
  forvent(d.ok === true, `forventede ok:true, fik ${JSON.stringify(d)}`);
  forvent(Array.isArray(d.online), 'online er ikke et array');
  return `${d.online.length} online`;
});

await kør(10, 'POST /api/reminders/run-now', async () => {
  const d = await send('/api/reminders/run-now');
  if (d.ok === true) {
    forvent(typeof d.title === 'string' && d.title.length > 0, 'ok:true men title mangler');
    forvent(Array.isArray(d.lines), 'ok:true men lines er ikke et array');
    return d.title;
  }
  forvent(typeof d.reason === 'string' && d.reason.length > 0, `forventede graceful reason, fik ${JSON.stringify(d)}`);
  return `graceful: ${d.reason}`;
});

await kør(11, 'POST /api/reports/run-now', async () => {
  const d = await send('/api/reports/run-now');
  forvent(d.ok === true, `forventede ok:true, fik ${JSON.stringify(d)}`);
  forvent(typeof d.path === 'string', 'path mangler i svaret');
  forvent(existsSync(d.path), `uge-rapport findes ikke på disk: ${d.path}`);
  testFiler.add(d.path);
  return d.path;
});

await kør(12, 'POST /api/ai/complete uden API-nøgle (forventer graceful afvisning)', async () => {
  const d = await send('/api/ai/complete', { messages: [{ role: 'user', content: 'hej' }] });
  forvent(d.ok === false, `forventede ok:false, fik ${JSON.stringify(d)}`);
  forvent(typeof d.reason === 'string' && d.reason.length > 0, 'der mangles en reason i svaret');
  return d.reason;
});

await kør(13, 'Graph: POST /api/graph/status + GET /api/graph/messages uden login', async () => {
  const status = await send('/api/graph/status');
  forvent(status.ok === true, `forventede ok:true, fik ${JSON.stringify(status)}`);
  const beskeder = await hent('/api/graph/messages');
  forvent(beskeder.ok === false, `forventede ok:false, fik ${JSON.stringify(beskeder)}`);
  forvent(typeof beskeder.reason === 'string' && beskeder.reason.length > 0, 'der mangles en reason i svaret');
  return beskeder.reason;
});

await kør(14, 'POST /api/open-export', async () => {
  if (!OPEN_EXPORT) return { skip: 'sprunget over (sæt ORBIT_SMOKE_OPEN_EXPORT=1 for at åbne Stifinder)' };
  const d = await send('/api/open-export');
  forvent(d.ok === true, `forventede ok:true, fik ${JSON.stringify(d)}`);
  return `Stifinder åbnet: ${d.path}`;
});

// ---- Oprydning: slet præcis de filer testen selv oprettede ----
console.log('');
const slettet = [];
for (const sti of testFiler) {
  if (existsSync(sti)) {
    rmSync(sti);
    slettet.push(sti);
  }
}
for (const sti of slettet) console.log(`Slettet test-fil: ${sti}`);
if (slettet.length === 0 && testFiler.size > 0) console.log('Ingen test-filer at slette.');

// ---- Samlet resultat ----
const fejl = resultater.filter((r) => r.status === 'fail').length;
const sprungetOver = resultater.filter((r) => r.status === 'skip').length;
console.log('');
if (fejl === 0) {
  console.log(`ALLE TESTS BESTÅET${sprungetOver > 0 ? ` (${sprungetOver} sprunget over)` : ''}`);
  process.exit(0);
} else {
  console.log(`${fejl} FEJL`);
  process.exit(1);
}

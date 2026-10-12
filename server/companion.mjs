// Orbit Companion – lokal server der giver Orbit-appen adgang til Windows,
// filsystemet, Teams-webhooks, Microsoft Graph, AI-assistent og tværgående
// synkronisering mellem brugere.
// Køres med: node server/companion.mjs   (port 4310)
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PORT = 4310;
const APP_DIR = join(homedir(), '.orbit');
const CONFIG_PATH = join(APP_DIR, 'companion.json');
const MSAL_CACHE_PATH = join(APP_DIR, 'msal-cache.json');
const EXPORT_DIR = join(homedir(), 'Documents', 'Orbit');
const GRAPH_SCOPES = ['User.Read', 'Tasks.Read', 'Calendars.Read', 'Mail.Read', 'Mail.Send', 'offline_access'];

mkdirSync(APP_DIR, { recursive: true });
mkdirSync(EXPORT_DIR, { recursive: true });
const BACKUP_DIR = join(EXPORT_DIR, 'backup');
mkdirSync(BACKUP_DIR, { recursive: true });

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''").slice(0, 200)}'`;
}

// Windows-toast via BurntToast (hvis modulet findes – ellers stille ignoreret)
function windowsNotify(title, message) {
  const script = `try { Import-Module BurntToast -ErrorAction Stop; New-BurntToastNotification -Text ${psQuote(title)}, ${psQuote(message)} } catch { }`;
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 9000 }, () => {});
}

function openExportFolder() {
  execFile('explorer', [EXPORT_DIR], () => {});
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

async function sendTeamsMessage(title, text, subtitle) {
  const url = loadConfig().teamsWebhook;
  if (!url) return { ok: false, reason: 'Ingen Teams-webhook konfigureret' };
  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: '6366f1',
    summary: title,
    sections: [{ activityTitle: title, activitySubtitle: subtitle ?? 'Orbit Companion', text }],
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(tasks, projects) {
  const header = ['Reference', 'Titel', 'Status', 'Prioritet', 'Projekt', 'Ansvarlig', 'Sprint', 'Start', 'Frist', 'Points', 'Delopgaver', 'Færdige delopgaver', 'Kommentarer'];
  const lines = tasks.map((t) => {
    const project = projects.find((p) => p.id === t.projectId);
    const doneSub = t.subtasks.filter((st) => st.done).length;
    return [
      project ? `${project.key}-${t.number}` : t.number,
      t.title, t.status, t.priority, project?.name ?? '',
      t.assigneeName ?? '', t.sprintName ?? '', t.startDate ?? '', t.dueDate ?? '',
      t.estimate ?? '', t.subtasks.length, doneSub, t.comments.length,
    ].map(csvEscape).join(';');
  });
  return '﻿' + header.join(';') + '\n' + lines.join('\n');
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function weekKey(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - start) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${week}`;
}

// ---------------- Synkronisering & presence ----------------
let lastSnapshot = null; // { snapshot, from, updatedAt }
const presence = new Map(); // clientId -> { name, since }

// ---------------- Påmindelser & uge-rapport ----------------
function reminderConfig() {
  return { enabled: false, time: '08:00', ...(loadConfig().reminders ?? {}) };
}

function reportConfig() {
  return { enabled: false, day: 1, time: '08:00', ...(loadConfig().reports ?? {}) }; // day: 1 = mandag
}

function backupConfig() {
  return { enabled: true, time: '09:00', ...(loadConfig().backup ?? {}) };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function computeDigest(snapshot) {
  const tasks = snapshot.tasks ?? [];
  const today = todayStr();
  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'canceled');
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const dueToday = open.filter((t) => t.dueDate === today);
  const dueWeek = open.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const projects = snapshot.projects ?? [];
  const sprints = (snapshot.sprints ?? []).filter((sp) => sp.status === 'active');
  const ending = sprints.filter((sp) => {
    const daysLeft = Math.ceil((new Date(sp.endDate) - new Date(today)) / 86400000);
    return daysLeft >= 0 && daysLeft <= 2;
  });
  const lines = [
    overdue.length > 0 ? `${overdue.length} opgave(r) overskredet` : 'Ingen overskredne frister',
    dueToday.length > 0 ? `${dueToday.length} opgave(r) har frist i dag` : null,
    dueWeek.length > 0 ? `${dueWeek.length} frister de næste 7 dage` : null,
    ...ending.map((sp) => {
      const p = projects.find((pr) => pr.id === sp.projectId);
      return `${sp.name} (${p?.name ?? ''}) slutter ${sp.endDate}`;
    }),
  ].filter(Boolean);
  return { title: 'Orbit – dagens overblik', lines, overdue, dueToday, dueWeek, openCount: open.length };
}

async function runReminders() {
  if (!lastSnapshot) {
    return { ok: false, reason: 'Ingen data endnu – åbn appen mindst én gang, så synkroniseringen kan sende data til serveren.' };
  }
  const digest = computeDigest(lastSnapshot.snapshot);
  windowsNotify(digest.title, digest.lines.slice(0, 3).join(' · ') || 'Alt er opdateret.');
  const teams = await sendTeamsMessage(digest.title, digest.lines.join('\n\n'));
  return { ok: true, ...digest, teams };
}

function buildReportMarkdown(snapshot) {
  const tasks = snapshot.tasks ?? [];
  const projects = snapshot.projects ?? [];
  const today = todayStr();
  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'canceled');
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const dueSoon = open.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= weekAhead);
  const lines = [
    `# Orbit uge-rapport – uge ${weekKey().split('-W')[1]}`,
    '',
    `Genereret ${today} · ${open.length} åbne opgaver · ${projects.length} projekter`,
    '',
    '## Status pr. projekt',
    '',
    ...projects.map((p) => {
      const pt = tasks.filter((t) => t.projectId === p.id);
      const openCount = pt.filter((t) => t.status !== 'done' && t.status !== 'canceled').length;
      const doneCount = pt.filter((t) => t.status === 'done').length;
      return `- **${p.name}**: ${openCount} åbne / ${doneCount} færdige`;
    }),
    '',
    '## Overskredne frister',
    '',
    ...(overdue.length
      ? overdue.map((t) => {
          const p = projects.find((pr) => pr.id === t.projectId);
          return `- ${p ? p.key : ''}-${t.number} – ${t.title} (frist ${t.dueDate})`;
        })
      : ['- Ingen. Alle frister er overholdt.']),
    '',
    '## Frister de næste 7 dage',
    '',
    ...(dueSoon.length
      ? dueSoon.map((t) => {
          const p = projects.find((pr) => pr.id === t.projectId);
          return `- ${p ? p.key : ''}-${t.number} – ${t.title} (frist ${t.dueDate})`;
        })
      : ['- Ingen frister den kommende uge.']),
  ];
  return lines.join('\n');
}

async function runWeeklyReport() {
  if (!lastSnapshot) {
    return { ok: false, reason: 'Ingen data endnu – åbn appen mindst én gang først.' };
  }
  const markdown = buildReportMarkdown(lastSnapshot.snapshot);
  const filePath = join(EXPORT_DIR, `orbit-uge-rapport-${stamp()}.md`);
  writeFileSync(filePath, markdown, 'utf8');
  const teams = await sendTeamsMessage('Orbit uge-rapport', markdown.split('\n').slice(0, 18).join('\n'));
  let mail = { skipped: !graphAccount };
  if (graphAccount) {
    mail = await graphSendMail('Orbit uge-rapport', markdown);
  }
  return { ok: true, path: filePath, teams, mail };
}

// Schedulere: tjek hvert 30. sekund
let lastReminderDate = null;
let lastReportWeek = null;
let lastBackupDate = null;
setInterval(() => {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const rc = reminderConfig();
  if (rc.enabled && hhmm === rc.time && lastReminderDate !== todayStr()) {
    lastReminderDate = todayStr();
    void runReminders();
  }
  const wc = reportConfig();
  if (wc.enabled && now.getDay() === wc.day && hhmm === wc.time && lastReportWeek !== weekKey()) {
    lastReportWeek = weekKey();
    void runWeeklyReport();
  }
  const bc = backupConfig();
  if (bc.enabled && hhmm === bc.time && lastBackupDate !== todayStr() && lastSnapshot) {
    lastBackupDate = todayStr();
    try {
      const p = join(BACKUP_DIR, `orbit-backup-${stamp()}.json`);
      writeFileSync(p, JSON.stringify(lastSnapshot.snapshot, null, 2), 'utf8');
      console.log(`Backup gemt: ${p}`);
    } catch { /* ignorer */ }
  }
}, 30000);

// ---------------- AI-assistent (OpenAI-kompatibel) ----------------
async function aiComplete(messages) {
  const cfg = loadConfig().ai ?? {};
  if (!cfg.apiKey) {
    return { ok: false, reason: 'AI-assistenten er ikke konfigureret – se Integrationer-fanen.' };
  }
  const baseUrl = (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', messages, temperature: 0.4 }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, reason: `AI-model svarede ${res.status}: ${body.slice(0, 160)}` };
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { ok: false, reason: 'Tomt svar fra AI-modellen.' };
    return { ok: true, content };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

// ---------------- Microsoft Graph ----------------
let pca = null;
let graphAccount = null;
let graphLoginInProgress = null;
let lastDevice = null;

function graphClientId() {
  return loadConfig().graphClientId || null;
}

async function ensurePca() {
  const clientId = graphClientId();
  if (!clientId) return null;
  const { PublicClientApplication } = await import('@azure/msal-node');
  pca = new PublicClientApplication({
    auth: { clientId, authority: 'https://login.microsoftonline.com/common' },
    cache: {
      cachePlugin: {
        readFromStorage: async () => (existsSync(MSAL_CACHE_PATH) ? readFileSync(MSAL_CACHE_PATH, 'utf8') : ''),
        writeToStorage: async (data) => writeFileSync(MSAL_CACHE_PATH, data),
      },
    },
  });
  return pca;
}

async function graphAcquireSilent() {
  if (!pca) return null;
  const accounts = await pca.getTokenCache().getAllAccounts();
  if (accounts.length === 0) return null;
  try {
    const result = await pca.acquireTokenSilent({ account: accounts[0], scopes: GRAPH_SCOPES });
    graphAccount = result.account;
    return result.accessToken;
  } catch {
    return null;
  }
}

async function graphFetch(path, accessToken) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Graph ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function graphSendMail(subject, textBody) {
  try {
    const token = await graphAcquireSilent();
    if (!token || !graphAccount) return { ok: false, reason: 'Ikke tilsluttet Microsoft 365' };
    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'Text', content: textBody },
          toRecipients: [{ emailAddress: { address: graphAccount.username } }],
        },
      }),
    });
    return { ok: res.ok || res.status === 202, status: res.status };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

// ---------------- HTTP + WS ----------------
const app = express();
app.use(express.json({ limit: '12mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcastPresence() {
  broadcast({ type: 'presence', online: [...presence.values()] });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'hello') {
        presence.set(String(msg.clientId ?? Math.random()), { name: String(msg.user?.name ?? 'Ukendt'), since: new Date().toISOString() });
        broadcastPresence();
      }
    } catch { /* ignorer */ }
  });
  ws.send(JSON.stringify({ type: 'hello', name: 'Orbit Companion' }));
});

wss.on('close', () => {});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, name: 'Orbit Companion', version: '1.1.0', time: new Date().toISOString() });
});

app.get('/api/status', (_req, res) => {
  const cfg = loadConfig();
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    clients: wss.clients.size,
    online: [...presence.values()],
    teamsConfigured: Boolean(cfg.teamsWebhook),
    graphConfigured: Boolean(cfg.graphClientId),
    graphConnected: Boolean(graphAccount),
    graphAccount: graphAccount?.username ?? null,
    aiConfigured: Boolean(cfg.ai?.apiKey),
    reminders: reminderConfig(),
    reports: reportConfig(),
    syncSnapshotAt: lastSnapshot?.updatedAt ?? null,
    exportDir: EXPORT_DIR,
  });
});

app.post('/api/config', (req, res) => {
  const cfg = loadConfig();
  const { teamsWebhook, graphClientId, reminders, reports, ai } = req.body ?? {};
  if (teamsWebhook !== undefined) cfg.teamsWebhook = teamsWebhook || undefined;
  if (graphClientId !== undefined) cfg.graphClientId = graphClientId || undefined;
  if (reminders !== undefined) cfg.reminders = { ...(cfg.reminders ?? {}), ...reminders };
  if (reports !== undefined) cfg.reports = { ...(cfg.reports ?? {}), ...reports };
  if (ai !== undefined) cfg.ai = { ...(cfg.ai ?? {}), ...ai };
  saveConfig(cfg);
  res.json({ ok: true });
});

// ---- Synkronisering ----
app.post('/api/sync/push', (req, res) => {
  const { clientId, user, snapshot } = req.body ?? {};
  if (!snapshot || !Array.isArray(snapshot.tasks)) {
    return res.status(400).json({ ok: false, reason: 'Mangler snapshot' });
  }
  lastSnapshot = {
    snapshot,
    from: { clientId: String(clientId ?? 'ukendt'), name: String(user?.name ?? 'Ukendt') },
    updatedAt: new Date().toISOString(),
  };
  broadcast({ type: 'sync', from: clientId, updatedAt: lastSnapshot.updatedAt });
  res.json({ ok: true, updatedAt: lastSnapshot.updatedAt });
});

app.get('/api/sync/state', (_req, res) => {
  if (!lastSnapshot) return res.json({ ok: false, reason: 'Ingen synkroniseret data endnu' });
  res.json({ ok: true, snapshot: lastSnapshot.snapshot, from: lastSnapshot.from, updatedAt: lastSnapshot.updatedAt });
});

app.get('/api/presence', (_req, res) => {
  res.json({ ok: true, online: [...presence.values()] });
});

// ---- Påmindelser & rapporter ----
app.post('/api/reminders/run-now', async (_req, res) => {
  res.json(await runReminders());
});

app.post('/api/reports/run-now', async (_req, res) => {
  res.json(await runWeeklyReport());
});

// ---- AI ----
app.post('/api/ai/complete', async (req, res) => {
  const { messages } = req.body ?? {};
  if (!Array.isArray(messages)) return res.status(400).json({ ok: false, reason: 'Mangler beskeder' });
  res.json(await aiComplete(messages));
});

app.post('/api/notify', (req, res) => {
  const { title, message } = req.body ?? {};
  if (!title) return res.status(400).json({ ok: false, reason: 'Mangler titel' });
  windowsNotify(String(title), String(message ?? ''));
  res.json({ ok: true });
});

app.post('/api/teams', async (req, res) => {
  const { title, text, subtitle } = req.body ?? {};
  if (!title || !text) return res.status(400).json({ ok: false, reason: 'Mangler titel eller tekst' });
  res.json(await sendTeamsMessage(String(title), String(text), subtitle ? String(subtitle) : undefined));
});

app.post('/api/open-export', (_req, res) => {
  openExportFolder();
  res.json({ ok: true, path: EXPORT_DIR });
});

app.post('/api/export', (req, res) => {
  const { tasks, projects, format } = req.body ?? {};
  if (!Array.isArray(tasks)) return res.status(400).json({ ok: false, reason: 'Mangler opgaver' });
  try {
    let filePath;
    if (format === 'json') {
      filePath = join(EXPORT_DIR, `orbit-eksport-${stamp()}.json`);
      writeFileSync(filePath, JSON.stringify({ exportedAt: new Date().toISOString(), projects: projects ?? [], tasks }, null, 2), 'utf8');
    } else {
      filePath = join(EXPORT_DIR, `orbit-eksport-${stamp()}.csv`);
      writeFileSync(filePath, toCsv(tasks, projects ?? []), 'utf8');
    }
    res.json({ ok: true, path: filePath, count: tasks.length });
  } catch (err) {
    res.status(500).json({ ok: false, reason: String(err) });
  }
});

app.post('/api/report', (req, res) => {
  const { markdown, title } = req.body ?? {};
  if (!markdown) return res.status(400).json({ ok: false, reason: 'Mangler indhold' });
  const safeTitle = String(title || 'uge-rapport').replace(/[^\wæøåÆØÅ -]/g, '').slice(0, 60) || 'uge-rapport';
  try {
    const filePath = join(EXPORT_DIR, `orbit-${safeTitle}-${stamp()}.md`);
    writeFileSync(filePath, String(markdown), 'utf8');
    res.json({ ok: true, path: filePath });
  } catch (err) {
    res.status(500).json({ ok: false, reason: String(err) });
  }
});

// ---- Graph: login / status / logout ----
app.post('/api/graph/login', async (_req, res) => {
  if (!graphClientId()) return res.json({ ok: false, reason: 'Mangler Microsoft-klient-id (indtast det i appen under Outlook & Microsoft 365)' });
  if (graphLoginInProgress) return res.json({ ok: true, pending: true });
  const instance = await ensurePca();
  if (!instance) return res.json({ ok: false, reason: 'Kunne ikke initialisere MSAL' });
  const existing = await graphAcquireSilent();
  if (existing) return res.json({ ok: true, connected: true, account: graphAccount?.username });

  graphLoginInProgress = (async () => {
    try {
      const result = await instance.acquireTokenByDeviceCode({
        scopes: GRAPH_SCOPES,
        deviceCodeCallback: (response) => {
          lastDevice = {
            userCode: response.userCode,
            verificationUri: response.verificationUri,
            expiresIn: response.expiresIn,
          };
          broadcast({ type: 'graph-device', ...lastDevice });
        },
      });
      graphAccount = result.account;
      broadcast({ type: 'graph-connected', account: result.account?.username });
    } finally {
      graphLoginInProgress = null;
    }
  })();
  res.json({ ok: true, pending: true });
});

app.post('/api/graph/status', async (_req, res) => {
  const token = await graphAcquireSilent();
  res.json({ ok: true, configured: Boolean(graphClientId()), connected: Boolean(token), account: graphAccount?.username ?? null });
});

app.get('/api/graph/device', (_req, res) => {
  res.json({ ok: true, device: graphLoginInProgress ? lastDevice : null });
});

app.post('/api/graph/logout', async (_req, res) => {
  graphAccount = null;
  try { rmSync(MSAL_CACHE_PATH, { force: true }); } catch { /* ignorer */ }
  res.json({ ok: true });
});

// ---- Graph: data ----
app.get('/api/graph/todos', async (_req, res) => {
  try {
    const token = await graphAcquireSilent();
    if (!token) return res.json({ ok: false, reason: 'Ikke tilsluttet Microsoft 365' });
    const listsData = await graphFetch('/me/todo/lists?$select=id,displayName&$top=50', token);
    const items = [];
    for (const list of listsData.value ?? []) {
      const data = await graphFetch(
        `/me/todo/lists/${list.id}/tasks?$top=25&$filter=status ne 'completed'&$select=id,title,importance,dueDateTime,createdDateTime&$orderby=createdDateTime desc`,
        token,
      );
      for (const task of data.value ?? []) {
        items.push({
          id: task.id,
          list: list.displayName,
          title: task.title,
          importance: task.importance ?? 'normal',
          dueDate: task.dueDateTime?.dateTime ? task.dueDateTime.dateTime.slice(0, 10) : null,
        });
        if (items.length >= 60) break;
      }
      if (items.length >= 60) break;
    }
    res.json({ ok: true, items });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

app.get('/api/graph/events', async (_req, res) => {
  try {
    const token = await graphAcquireSilent();
    if (!token) return res.json({ ok: false, reason: 'Ikke tilsluttet Microsoft 365' });
    const start = new Date().toISOString();
    const end = new Date(Date.now() + 7 * 86400000).toISOString();
    const data = await graphFetch(
      `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$select=subject,start,end,location,isOnlineMeeting,onlineMeetingUrl&$orderby=start/dateTime&$top=25`,
      token,
    );
    res.json({
      ok: true,
      items: (data.value ?? []).map((ev) => ({
        id: ev.id,
        subject: ev.subject,
        start: ev.start?.dateTime,
        end: ev.end?.dateTime,
        location: ev.location?.displayName ?? '',
        isOnlineMeeting: Boolean(ev.isOnlineMeeting),
        onlineMeetingUrl: ev.onlineMeetingUrl ?? null,
      })),
    });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

app.get('/api/graph/messages', async (_req, res) => {
  try {
    const token = await graphAcquireSilent();
    if (!token) return res.json({ ok: false, reason: 'Ikke tilsluttet Microsoft 365' });
    const data = await graphFetch(
      "/me/mailFolders/inbox/messages?$select=id,subject,from,receivedDateTime,bodyPreview,webLink&$top=15&$orderby=receivedDateTime desc",
      token,
    );
    res.json({
      ok: true,
      items: (data.value ?? []).map((m) => ({
        id: m.id,
        subject: m.subject ?? '(uden emne)',
        from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Ukendt afsender',
        received: m.receivedDateTime ?? null,
        snippet: m.bodyPreview ?? '',
        webLink: m.webLink ?? null,
      })),
    });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

app.get('/api/graph/planner', async (_req, res) => {
  try {
    const token = await graphAcquireSilent();
    if (!token) return res.json({ ok: false, reason: 'Ikke tilsluttet Microsoft 365' });
    const data = await graphFetch('/me/planner/tasks?$select=id,title,dueDateTime,percentComplete&$top=50', token);
    res.json({
      ok: true,
      items: (data.value ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDateTime?.dateTime ? t.dueDateTime.dateTime.slice(0, 10) : null,
        percentComplete: t.percentComplete ?? 0,
      })),
    });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

app.post('/api/graph/send-report', async (req, res) => {
  const { subject, markdown } = req.body ?? {};
  if (!subject || !markdown) return res.status(400).json({ ok: false, reason: 'Mangler emne eller indhold' });
  res.json(await graphSendMail(String(subject), String(markdown)));
});

// ---- Backup ----
app.post('/api/backup/now', (_req, res) => {
  if (!lastSnapshot) return res.json({ ok: false, reason: 'Ingen data endnu – åbn appen mindst én gang først.' });
  try {
    const filePath = join(BACKUP_DIR, `orbit-backup-${stamp()}.json`);
    writeFileSync(filePath, JSON.stringify(lastSnapshot.snapshot, null, 2), 'utf8');
    res.json({ ok: true, path: filePath, count: lastSnapshot.snapshot.tasks?.length ?? 0 });
  } catch (err) {
    res.status(500).json({ ok: false, reason: String(err) });
  }
});

app.get('/api/backup/list', (_req, res) => {
  try {
    const files = readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((name) => {
        const st = statSync(join(BACKUP_DIR, name));
        return { name, size: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime))
      .slice(0, 30);
    res.json({ ok: true, files });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

app.post('/api/backup/restore', (req, res) => {
  const { name } = req.body ?? {};
  if (!name || !/^[\w.-]+\.json$/.test(String(name))) {
    return res.status(400).json({ ok: false, reason: 'Ugyldigt backup-navn' });
  }
  try {
    const data = JSON.parse(readFileSync(join(BACKUP_DIR, String(name)), 'utf8'));
    res.json({ ok: true, snapshot: data });
  } catch (err) {
    res.status(404).json({ ok: false, reason: String(err) });
  }
});

// ---- Kunde-statusside (offentlig, token-beskyttet) ----
const STATUS_LABELS = { backlog: 'Backlog', todo: 'Planlagt', inprogress: 'I gang', inreview: 'Til gennemgang', done: 'Færdig', canceled: 'Annulleret' };

app.get('/public/status/:token', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!lastSnapshot) {
    return res.status(503).send('<!doctype html><html lang="da"><body style="font-family:sans-serif;padding:2rem">Ingen synkroniseret data endnu – projektet vises, så snart ejeren åbner Orbit.</body></html>');
  }
  const snap = lastSnapshot.snapshot;
  const project = (snap.projects ?? []).find((p) => p.publicToken === req.params.token);
  if (!project) {
    return res.status(404).send('<!doctype html><html lang="da"><body style="font-family:sans-serif;padding:2rem">Ukendt eller inaktivt delingslink.</body></html>');
  }
  const tasks = (snap.tasks ?? []).filter((t) => t.projectId === project.id);
  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'canceled');
  const done = tasks.filter((t) => t.status === 'done');
  const pct = tasks.length ? Math.round((done.length / tasks.length) * 100) : 0;
  const today = todayStr();
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today).slice(0, 5);
  const upcoming = open.filter((t) => t.dueDate && t.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
  const recentDone = [...done].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  const row = (t) => `<li><strong>${esc(project.key)}-${t.number}</strong> ${esc(t.title)} <span class="due">${t.dueDate ? `· frist ${esc(t.dueDate)}` : ''}</span></li>`;
  const counts = Object.entries(STATUS_LABELS)
    .map(([key, label]) => {
      const n = tasks.filter((t) => t.status === key).length;
      return n > 0 ? `<span class="chip">${label}: ${n}</span>` : '';
    })
    .filter(Boolean)
    .join(' ');
  const html = `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Status – ${esc(project.name)}</title>
<style>
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#17181c;color:#e4e4e7;margin:0;padding:2.5rem 1.5rem;display:flex;justify-content:center}
  main{max-width:640px;width:100%}
  h1{font-size:1.6rem;margin:0 0 .25rem}
  p.sub{color:#a1a1aa;margin:0 0 1.5rem}
  .card{background:#1e1f24;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:1.25rem 1.5rem;margin-bottom:1rem}
  .bar{height:10px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;margin:.5rem 0 .25rem}
  .bar>div{height:100%;background:linear-gradient(90deg,#6366f1,#818cf8);border-radius:99px}
  .pct{font-size:1.8rem;font-weight:700}
  h2{font-size:.95rem;text-transform:uppercase;letter-spacing:.05em;color:#a1a1aa;margin:0 0 .75rem}
  ul{list-style:none;margin:0;padding:0}
  li{padding:.45rem 0;border-top:1px solid rgba(255,255,255,.06);font-size:.95rem}
  .due{color:#a1a1aa;font-size:.85rem}
  .chip{display:inline-block;background:rgba(99,102,241,.12);color:#a5b4fc;border-radius:99px;padding:.2rem .7rem;margin:.15rem .15rem 0 0;font-size:.8rem}
  .foot{color:#71717a;font-size:.75rem;margin-top:1.5rem;text-align:center}
  .empty{color:#71717a;font-style:italic}
</style></head><body><main>
<h1>${esc(project.name)}</h1>
<p class="sub">${esc(project.description ?? '')}</p>
<div class="card">
  <h2>Fremdrift</h2>
  <div class="pct">${pct}%</div>
  <div class="bar"><div style="width:${pct}%"></div></div>
  <div>${tasks.length} opgaver · ${open.length} åbne · ${done.length} færdige</div>
  <div style="margin-top:.75rem">${counts}</div>
</div>
<div class="card"><h2>Overskredne frister</h2><ul>${overdue.length ? overdue.map(row).join('') : '<li class="empty">Ingen – alle frister overholdt.</li>'}</ul></div>
<div class="card"><h2>Kommende frister</h2><ul>${upcoming.length ? upcoming.map(row).join('') : '<li class="empty">Ingen planlagte frister.</li>'}</ul></div>
<div class="card"><h2>Senest færdiggjort</h2><ul>${recentDone.length ? recentDone.map(row).join('') : '<li class="empty">Endnu ingen afsluttede opgaver.</li>'}</ul></div>
<p class="foot">Opdateres automatisk fra Orbit · ${esc(new Date().toISOString().slice(0, 10))}</p>
</main></body></html>`;
  res.send(html);
});

server.listen(PORT, () => {
  console.log(`Orbit Companion kører på http://127.0.0.1:${PORT}`);
  console.log(`Eksport-mappe: ${EXPORT_DIR}`);
});

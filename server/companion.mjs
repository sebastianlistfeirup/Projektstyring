// Orbit Companion – lokal server der giver Orbit-appen adgang til Windows,
// filsystemet, Teams-webhooks, Microsoft Graph, AI-assistent og tværgående
// synkronisering mellem brugere.
// Køres med: node server/companion.mjs   (port 4310)
import express from 'express';
import { localAiAccess } from './local-access.mjs';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, networkInterfaces } from 'node:os';
import { createWorkspaceBackup, restoreWorkspaceBackup } from './workspace-backup.mjs';
import { writeAtomicJson } from './atomic-json.mjs';
import { acceptSnapshot, normalizeSnapshot } from './workspace-state.mjs';
import { listRepositoryIssues, repositoryIdentity } from './git-issues.mjs';
import { applyRunToWorkspace } from './task-execution.mjs';
import { runChat, serviceAvailability } from './ai-services.mjs';
import { activeRuns, swarmState, pickOrchestrator } from './ai-runtime.mjs';
import { registerAiRoutes } from './ai-engine.mjs';
import { aiProcessSnapshot } from './ai-processes.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = Number(process.env.ORBIT_PORT ?? 4310);
const APP_DIR = process.env.ORBIT_APP_DIR ?? join(homedir(), '.orbit');
const CONFIG_PATH = join(APP_DIR, 'companion.json');
const MSAL_CACHE_PATH = join(APP_DIR, 'msal-cache.json');
const EXPORT_DIR = process.env.ORBIT_EXPORT_DIR ?? join(homedir(), 'Documents', 'Orbit');
const GRAPH_SCOPES = ['User.Read', 'Tasks.Read', 'Calendars.Read', 'Mail.Read', 'Mail.Send', 'offline_access'];

mkdirSync(APP_DIR, { recursive: true });
mkdirSync(EXPORT_DIR, { recursive: true });
const BACKUP_DIR = join(EXPORT_DIR, 'backup');
mkdirSync(BACKUP_DIR, { recursive: true });
const ATTACH_DIR = join(EXPORT_DIR, 'attachments');
mkdirSync(ATTACH_DIR, { recursive: true });

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  writeAtomicJson(CONFIG_PATH, cfg);
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
  if (payload.kind === 'ai' && ['run_start', 'plan', 'run_finished'].includes(payload.type)) {
    const run = activeRuns.get(payload.runId)?.run;
    const snapshot = run ? applyRunToWorkspace(lastSnapshot?.snapshot, run, payload.type) : null;
    if (snapshot) {
      lastSnapshot = { ...lastSnapshot, snapshot, updatedAt: new Date().toISOString() };
      broadcast({ type: 'sync', from: 'orbit-runtime', updatedAt: lastSnapshot.updatedAt });
    }
  }
  if (payload.type === 'sync' && lastSnapshot) {
    lastSnapshot.snapshot = normalizeSnapshot(lastSnapshot.snapshot);
    writeAtomicJson(SNAPSHOT_PATH, lastSnapshot);
  }
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
const SNAPSHOT_PATH = join(APP_DIR, 'workspace.json');
let lastSnapshot = null; // { snapshot, from, updatedAt }
try {
  if (existsSync(SNAPSHOT_PATH)) {
    const saved = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    if (!Array.isArray(saved.snapshot?.tasks)) throw new Error('Ugyldigt workspace-format');
    lastSnapshot = saved;
  }
} catch (error) { console.error(`Workspace kunne ikke indlæses: ${error.message}. Filen er bevaret.`); }
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
const firedReminders = new Set();
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
    try {
      const p = join(BACKUP_DIR, `orbit-backup-${stamp()}.json`);
      writeAtomicJson(p, createWorkspaceBackup(lastSnapshot.snapshot, APP_DIR, ATTACH_DIR));
      lastBackupDate = todayStr();
      console.log(`Backup gemt: ${p}`);
    } catch (error) {
      console.error(`Automatisk backup fejlede: ${error.message}`);
      broadcast({ type: 'toast', level: 'error', text: `Backup kunne ikke gemmes: ${error.message}` });
    }
  }
  // Tids-påmindelser på opgaver
  if (lastSnapshot) {
    const soon = new Date(now.getTime() + 30 * 1000).toISOString();
    for (const t of lastSnapshot.snapshot.tasks ?? []) {
      if (t.reminderAt && t.reminderAt <= soon && !firedReminders.has(`${t.id}:${t.reminderAt}`)) {
        firedReminders.add(`${t.id}:${t.reminderAt}`);
        windowsNotify('Orbit – påmindelse', t.title);
      }
    }
    if (firedReminders.size > 500) firedReminders.clear();
  }
}, 30000);

// ---------------- AI-assistent (OpenAI-kompatibel) ----------------
async function aiComplete(messages) {
  const cfg = loadConfig();
  try {
    const serviceId = await pickOrchestrator(cfg, await serviceAvailability(cfg));
    if (!serviceId) return { ok: false, reason: 'Ingen abonnementsbekræftet AI-tjeneste er klar. Tilslut en tjeneste i Orbit.' };
    const content = await runChat({ serviceId, cfg, dirs: { cwd: APP_DIR }, readOnly: true,
      messages: messages.map(m => ({ role: m.role, text: String(m.content ?? m.text ?? '') })), signal: AbortSignal.timeout(60000) });
    return { ok: true, content };
  } catch (err) { return { ok: false, reason: String(err) }; }
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
app.use(express.json({ limit: '48mb' }));
app.use((req, res, next) => {
  if (app.locals.aiStopping && req.method !== 'GET' && req.path !== '/api/ai/prepare-shutdown') return res.status(503).json({ ok: false, reason: 'Companion er ved at lukke.' });
  next();
});
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api/ai', localAiAccess);
app.use('/api/backup', localAiAccess);
app.use('/api/config', localAiAccess);

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
      } else if (msg.type === 'cursor') {
        // Videreformidl markørpositioner til alle ANDRE klienter (tilstedeværelsesmarkører)
        const data = JSON.stringify({ type: 'cursor', clientId: String(msg.clientId ?? ''), name: String(msg.user?.name ?? ''), x: Number(msg.x), y: Number(msg.y), view: String(msg.view ?? '') });
        for (const client of wss.clients) {
          if (client !== ws && client.readyState === 1) client.send(data);
        }
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
  const { teamsWebhook, graphClientId, reminders, reports, ai, brand } = req.body ?? {};
  if (teamsWebhook !== undefined) cfg.teamsWebhook = teamsWebhook || undefined;
  if (graphClientId !== undefined) cfg.graphClientId = graphClientId || undefined;
  if (reminders !== undefined) cfg.reminders = { ...(cfg.reminders ?? {}), ...reminders };
  if (reports !== undefined) cfg.reports = { ...(cfg.reports ?? {}), ...reports };
  if (ai !== undefined) cfg.ai = { ...(cfg.ai ?? {}), ...ai };
  if (brand !== undefined) cfg.brand = { ...(cfg.brand ?? {}), ...brand };
  saveConfig(cfg);
  res.json({ ok: true });
});

// ---- Synkronisering ----
function fireWebhooks(event, payload) {
  const urls = loadConfig().webhooks ?? [];
  for (const url of urls) {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, ...payload, source: 'orbit', time: new Date().toISOString() }),
    }).catch(() => {});
  }
}

app.post('/api/sync/push', (req, res) => {
  const { clientId, user, snapshot } = req.body ?? {};
  if (!snapshot || !Array.isArray(snapshot.tasks)) {
    return res.status(400).json({ ok: false, reason: 'Mangler snapshot' });
  }
  const prev = lastSnapshot?.snapshot;
  if (prev) {
    const prevStatus = new Map((prev.tasks ?? []).map((t) => [t.id, t.status]));
    for (const t of snapshot.tasks) {
      if (t.status === 'done' && prevStatus.get(t.id) && prevStatus.get(t.id) !== 'done') {
        fireWebhooks('task.completed', { task: { id: t.id, title: t.title, number: t.number, projectId: t.projectId } });
      }
    }
  }
  const accepted = acceptSnapshot(prev, snapshot);
  lastSnapshot = {
    snapshot: accepted.snapshot,
    from: { clientId: String(clientId ?? 'ukendt'), name: String(user?.name ?? 'Ukendt') },
    updatedAt: new Date().toISOString(),
  };
  broadcast({ type: 'sync', from: clientId, updatedAt: lastSnapshot.updatedAt });
  res.json({ ok: true, updatedAt: lastSnapshot.updatedAt, merged: accepted.merged });
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
        eTag: t['@odata.etag'] ?? '',
        title: t.title,
        dueDate: t.dueDateTime?.dateTime ? t.dueDateTime.dateTime.slice(0, 10) : null,
        percentComplete: t.percentComplete ?? 0,
      })),
    });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

app.post('/api/graph/todos/complete', async (req, res) => {
  try {
    const token = await graphAcquireSilent();
    if (!token) return res.json({ ok: false, reason: 'Ikke tilsluttet Microsoft 365' });
    const { listId, taskId } = req.body ?? {};
    if (!listId || !taskId) return res.status(400).json({ ok: false, reason: 'Mangler listId eller taskId' });
    const r = await fetch(`https://graph.microsoft.com/v1.0/me/todo/lists/${listId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
    res.json({ ok: r.ok, status: r.status });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

app.post('/api/graph/events/create', async (req, res) => {
  try {
    const token = await graphAcquireSilent();
    if (!token) return res.json({ ok: false, reason: 'Ikke tilsluttet Microsoft 365' });
    const { title, date, attendeeEmail } = req.body ?? {};
    if (!title || !date) return res.status(400).json({ ok: false, reason: 'Mangler titel eller dato' });
    const body = {
      subject: String(title),
      isAllDay: true,
      start: { dateTime: `${date}T00:00:00`, timeZone: 'Europe/Copenhagen' },
      end: { dateTime: `${date}T00:00:00`, timeZone: 'Europe/Copenhagen' },
      isReminderOn: true,
      reminderMinutesBeforeStart: 720,
    };
    if (attendeeEmail) body.attendees = [{ emailAddress: { address: String(attendeeEmail) }, type: 'required' }];
    const r = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    res.json({ ok: r.ok, status: r.status });
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
    writeAtomicJson(filePath, createWorkspaceBackup(lastSnapshot.snapshot, APP_DIR, ATTACH_DIR));
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
  if (activeRuns.size || aiProcessSnapshot().length || app.locals.orphanProcesses?.().length) return res.status(409).json({ ok: false, reason: 'Stop aktive AI-kørsler og samtaler før gendannelse.' });
  if (!name || !/^[\w.-]+\.json$/.test(String(name))) {
    return res.status(400).json({ ok: false, reason: 'Ugyldigt backup-navn' });
  }
  try {
    const data = JSON.parse(readFileSync(join(BACKUP_DIR, String(name)), 'utf8'));
    if (app.locals.orbitQueue && !app.locals.orbitQueue.storageError) app.locals.orbitQueue.pause('Gendannelse af backup er i gang.');
    if (lastSnapshot) writeAtomicJson(join(BACKUP_DIR, `before-restore-${Date.now()}.json`), createWorkspaceBackup(lastSnapshot.snapshot, APP_DIR, ATTACH_DIR));
    const snapshot = restoreWorkspaceBackup(data, APP_DIR, ATTACH_DIR);
    lastSnapshot = { snapshot, from: 'backup', updatedAt: new Date().toISOString() };
    writeAtomicJson(SNAPSHOT_PATH, lastSnapshot);
    swarmState.last = null;
    app.locals.orbitQueue?.reloadAfterRestore();
    res.json({ ok: true, snapshot });
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

// ---------------- Vedhæftninger ----------------
function sanitizeFileName(name) {
  return String(name).replace(/[^\wæøåÆØÅ .()-]/g, '_').slice(0, 120);
}

app.post('/api/attachments/:taskId', (req, res) => {
  const { name, dataBase64 } = req.body ?? {};
  if (!name || !dataBase64) return res.status(400).json({ ok: false, reason: 'Mangler navn eller indhold' });
  try {
    const buf = Buffer.from(String(dataBase64), 'base64');
    if (buf.length > 48 * 1024 * 1024) return res.status(400).json({ ok: false, reason: 'Filen er for stor (maks 48 MB)' });
    const safe = sanitizeFileName(name);
    writeFileSync(join(ATTACH_DIR, `${req.params.taskId}__${safe}`), buf);
    res.json({ ok: true, name: safe, size: buf.length });
  } catch (err) {
    res.status(500).json({ ok: false, reason: String(err) });
  }
});

app.get('/api/attachments/:taskId', (_req, res) => {
  try {
    const prefix = `${_req.params.taskId}__`;
    const files = readdirSync(ATTACH_DIR)
      .filter((f) => f.startsWith(prefix))
      .map((f) => {
        const st = statSync(join(ATTACH_DIR, f));
        return { name: f.slice(prefix.length), size: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json({ ok: true, files });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

app.get('/api/attachments/:taskId/file/:name', (req, res) => {
  const file = join(ATTACH_DIR, `${req.params.taskId}__${sanitizeFileName(req.params.name)}`);
  if (!existsSync(file)) return res.status(404).json({ ok: false, reason: 'Filen findes ikke' });
  res.download(file);
});

app.post('/api/attachments/:taskId/open', (req, res) => {
  const file = join(ATTACH_DIR, `${req.params.taskId}__${sanitizeFileName(req.body?.name ?? '')}`);
  if (!existsSync(file)) return res.status(404).json({ ok: false, reason: 'Filen findes ikke' });
  execFile('explorer', [file], () => {});
  res.json({ ok: true });
});

app.delete('/api/attachments/:taskId/:name', (req, res) => {
  const file = join(ATTACH_DIR, `${req.params.taskId}__${sanitizeFileName(req.params.name)}`);
  try { rmSync(file, { force: true }); } catch { /* ignorer */ }
  res.json({ ok: true });
});

// ---------------- Webhooks (udad) ----------------
app.get('/api/webhooks', (_req, res) => {
  res.json({ ok: true, urls: loadConfig().webhooks ?? [] });
});

app.post('/api/webhooks', (req, res) => {
  const url = String(req.body?.url ?? '').trim();
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ ok: false, reason: 'Webhook-URL skal starte med http(s)://' });
  const cfg = loadConfig();
  cfg.webhooks = [...new Set([...(cfg.webhooks ?? []), url])];
  saveConfig(cfg);
  res.json({ ok: true, urls: cfg.webhooks });
});

app.delete('/api/webhooks', (req, res) => {
  const url = String(req.body?.url ?? '').trim();
  const cfg = loadConfig();
  cfg.webhooks = (cfg.webhooks ?? []).filter((u) => u !== url);
  saveConfig(cfg);
  res.json({ ok: true, urls: cfg.webhooks });
});

// ---------------- Åbent API (v1) ----------------
function apiToken() {
  return loadConfig().apiToken ?? null;
}

app.post('/api/v1/token', (_req, res) => {
  const cfg = loadConfig();
  if (!cfg.apiToken) {
    cfg.apiToken = Buffer.from(String(Date.now()) + String(Math.random())).toString('base64url').slice(0, 24);
    saveConfig(cfg);
  }
  res.json({ ok: true, token: cfg.apiToken });
});

function apiAuth(req) {
  const t = apiToken();
  return Boolean(t) && req.get('x-orbit-api-token') === t;
}

function apiSnapshot(res) {
  if (!lastSnapshot) return res.status(503).json({ ok: false, reason: 'Ingen data endnu – åbn appen først' });
  return lastSnapshot.snapshot;
}

app.get('/api/v1/tasks', (req, res) => {
  if (!apiAuth(req)) return res.status(401).json({ ok: false, reason: 'Ugyldigt API-token (header: X-Orbit-Api-Token)' });
  const snap = apiSnapshot(res);
  if (!snap.tasks) return;
  res.json({ ok: true, tasks: snap.tasks, updatedAt: lastSnapshot.updatedAt });
});

app.get('/api/v1/projects', (req, res) => {
  if (!apiAuth(req)) return res.status(401).json({ ok: false, reason: 'Ugyldigt API-token' });
  const snap = apiSnapshot(res);
  if (!snap.projects) return;
  res.json({ ok: true, projects: snap.projects });
});

app.get('/api/v1/sprints', (req, res) => {
  if (!apiAuth(req)) return res.status(401).json({ ok: false, reason: 'Ugyldigt API-token' });
  const snap = apiSnapshot(res);
  if (!snap.sprints) return;
  res.json({ ok: true, sprints: snap.sprints });
});

// ---------------- Asynkron standup ----------------
app.post('/api/standup', async (req, res) => {
  const { name, text } = req.body ?? {};
  if (!text) return res.status(400).json({ ok: false, reason: 'Mangler tekst' });
  const teams = await sendTeamsMessage(`Standup – ${String(name ?? 'Ukendt')}`, String(text));
  res.json({ ok: true, teams });
});

// ---------------- Azure DevOps ----------------
function adopsCfg() {
  return loadConfig().adops ?? {};
}

app.post('/api/adops/config', (req, res) => {
  const { org, project, pat } = req.body ?? {};
  const cfg = loadConfig();
  cfg.adops = { org: org ?? '', project: project ?? '', pat: pat ?? '' };
  saveConfig(cfg);
  res.json({ ok: true });
});

app.get('/api/adops/workitems', async (req, res) => {
  const { org, project, pat } = adopsCfg();
  if (!org || !project || !pat) return res.json({ ok: false, reason: 'Azure DevOps er ikke konfigureret (org, projekt og PAT under Integrationer)' });
  try {
    const auth = `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
    const wiql = await fetch(`https://dev.azure.com/${org}/${project}/_apis/wit/wiql?api-version=7.1-preview.2`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.State] <> 'Closed' AND [System.State] <> 'Done' ORDER BY [System.ChangedDate] DESC` }),
    });
    if (!wiql.ok) return res.json({ ok: false, reason: `DevOps svarede ${wiql.status} – tjek org/projekt/PAT` });
    const wiqlData = await wiql.json();
    const ids = (wiqlData.workItems ?? []).slice(0, 50).map((w) => w.id);
    if (ids.length === 0) return res.json({ ok: true, items: [] });
    const batch = await fetch(`https://dev.azure.com/${org}/_apis/wit/workitemsbatch?api-version=7.1`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, fields: ['System.Title', 'System.State', 'System.WorkItemType'] }),
    });
    if (!batch.ok) return res.json({ ok: false, reason: `DevOps batch svarede ${batch.status}` });
    const batchData = await batch.json();
    res.json({
      ok: true,
      items: (batchData.value ?? []).map((w) => ({
        id: w.id,
        title: w.fields?.['System.Title'] ?? `#${w.id}`,
        state: w.fields?.['System.State'] ?? '',
        type: w.fields?.['System.WorkItemType'] ?? '',
      })),
    });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

app.post('/api/adops/complete', async (req, res) => {
  const { id } = req.body ?? {};
  const { org, pat } = adopsCfg();
  if (!org || !pat || !id) return res.status(400).json({ ok: false, reason: 'Mangler id eller konfiguration' });
  try {
    const auth = `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
    const r = await fetch(`https://dev.azure.com/${org}/_apis/wit/workitems/${id}?api-version=7.0`, {
      method: 'PATCH',
      headers: { Authorization: auth, 'Content-Type': 'application/json-patch+json' },
      body: JSON.stringify([{ op: 'replace', path: '/fields/System.State', value: 'Done' }]),
    });
    res.json({ ok: r.ok || r.status === 200, status: r.status });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

// ---------------- Kundegodkendelse (offentlig side, skriver tilbage i snapshot) ----
function findTaskByApprovalToken(token) {
  const snap = lastSnapshot?.snapshot;
  if (!snap) return null;
  const task = (snap.tasks ?? []).find((t) => t.approval?.token === token);
  return task ? { snap, task } : null;
}

app.get('/public/approve/:token', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const found = findTaskByApprovalToken(req.params.token);
  if (!found) {
    return res.status(404).send('<!doctype html><html lang="da"><body style="font-family:sans-serif;padding:2rem">Ukendt eller inaktivt godkendelseslink.</body></html>');
  }
  const t = found.task;
  const done = t.approval.status !== 'pending';
  const html = `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Godkendelse – ${esc(t.title)}</title>
<style>
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#17181c;color:#e4e4e7;margin:0;padding:2.5rem 1.5rem;display:flex;justify-content:center}
  main{max-width:520px;width:100%}
  h1{font-size:1.4rem;margin:0 0 .25rem}
  .card{background:#1e1f24;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:1.5rem;margin-bottom:1rem}
  .lbl{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:#a1a1aa}
  p{color:#d4d4d8;white-space:pre-wrap}
  textarea{width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#17181c;color:#e4e4e7;padding:.75rem;font-family:inherit;min-height:80px}
  .row{display:flex;gap:.75rem;margin-top:1rem}
  button{flex:1;border:0;border-radius:10px;padding:.85rem;font-size:1rem;font-weight:600;cursor:pointer}
  .ok{background:#10b981;color:#fff}
  .no{background:#f59e0b;color:#111}
  .state{text-align:center;padding:1rem;border-radius:10px;font-weight:600}
  .state.approved{background:rgba(16,185,129,.15);color:#34d399}
  .state.changes{background:rgba(245,158,11,.15);color:#fbbf24}
</style></head><body><main>
<div class="card"><span class="lbl">Anmodning om godkendelse</span><h1>${esc(t.title)}</h1></div>
<div class="card"><span class="lbl">Beskrivelse</span><p>${esc(t.description || 'Ingen beskrivelse.')}</p></div>
${done
  ? `<div class="state ${t.approval.status}">${t.approval.status === 'approved' ? 'Godkendt' : 'Ændringer ønsket'}${t.approval.by ? ` af ${esc(t.approval.by)}` : ''}${t.approval.at ? ` · ${esc(t.approval.at.slice(0, 10))}` : ''}${t.approval.comment ? `<p style="margin-top:.5rem;font-weight:400">${esc(t.approval.comment)}</p>` : ''}</div>`
  : `<div class="card">
  <span class="lbl">Dit navn</span>
  <input id="by" style="width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#17181c;color:#e4e4e7;padding:.75rem;margin-top:.4rem" placeholder="Fx Peter Jensen">
  <div style="margin-top:.75rem"><span class="lbl">Kommentar (valgfri)</span></div>
  <textarea id="comment" placeholder="Fx 'Godkendt med smårettelser'"></textarea>
  <div class="row">
    <button class="ok" onclick="submit('approved')">Godkend</button>
    <button class="no" onclick="submit('changes')">Ændringer</button>
  </div>
  <p id="err" style="color:#fb7185;font-size:.85rem"></p>
</div>`}
<script>
async function submit(action) {
  const by = document.getElementById('by').value.trim();
  if (!by) { document.getElementById('err').textContent = 'Skriv dit navn først.'; return; }
  const comment = document.getElementById('comment').value.trim();
  const r = await fetch(location.pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, by, comment }) });
  if (r.ok) location.reload(); else document.getElementById('err').textContent = 'Noget gik galt – prøv igen.';
}
</script>
</main></body></html>`;
  res.send(html);
});

app.post('/public/approve/:token', (req, res) => {
  const found = findTaskByApprovalToken(req.params.token);
  if (!found) return res.status(404).json({ ok: false, reason: 'Ukendt token' });
  const { action, by, comment } = req.body ?? {};
  if (!['approved', 'changes'].includes(action)) return res.status(400).json({ ok: false, reason: 'Ugyldig handling' });
  const task = found.task;
  task.approval = { ...task.approval, status: action, by: String(by ?? ''), at: new Date().toISOString(), comment: String(comment ?? '') };
  task.updatedAt = new Date().toISOString(); // sikrer at klienterne trækker versionen ned ved næste merge
  broadcast({ type: 'sync', from: 'approval' });
  windowsNotify('Orbit – godkendelse', `“${task.title}”: ${action === 'approved' ? 'Godkendt' : 'Ændringer ønsket'}`);
  res.json({ ok: true });
});

// ---------------- GitHub / GitLab ----------------
function gitCfg(projectId) {
  const cfg = loadConfig();
  return (projectId ? cfg.gitProjects?.[String(projectId)] : undefined) ?? cfg.git ?? {};
}

app.post('/api/git/config', (req, res) => {
  try {
    const { projectId, token } = req.body ?? {};
    const identity = repositoryIdentity(req.body ?? {}), cfg = loadConfig();
    const previous = gitCfg(projectId);
    const value = { ...identity, token: typeof token === 'string' && token.trim() ? token.trim() : previous.provider === identity.provider ? previous.token : undefined };
    if (projectId) cfg.gitProjects = { ...cfg.gitProjects, [String(projectId)]: value };
    else cfg.git = value;
    saveConfig(cfg); res.json({ ok: true });
  } catch (error) { res.status(400).json({ ok: false, reason: error.message }); }
});

app.get('/api/git/issues', async (req, res) => {
  try { res.json({ ok: true, ...await listRepositoryIssues(gitCfg(req.query.projectId)) }); }
  catch (error) { res.json({ ok: false, reason: error.message }); }
});

app.post('/api/git/close', async (req, res) => {
  const { id, projectId } = req.body ?? {};
  const config = gitCfg(projectId);
  let identity;
  try { identity = repositoryIdentity(req.body?.owner ? req.body : config); } catch (error) { return res.status(400).json({ ok: false, reason: error.message }); }
  const { provider, owner, repo } = identity;
  const token = config.provider === provider ? config.token : null;
  if (!token || !Number.isInteger(id) || id < 1) return res.status(400).json({ ok: false, reason: 'Mangler gyldigt issue-nummer eller konfiguration' });
  try {
    if (provider === 'gitlab') {
      const r = await fetch(`https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/issues/${id}`, {
        method: 'PUT',
        headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state_event: 'close' }),
      });
      return res.json({ ok: r.ok, status: r.status });
    }
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed' }),
    });
    res.json({ ok: r.ok, status: r.status });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

// ---------------- Intake-formularer (offentlig indsendelse -> opgaver) ----------------
function findProjectByIntakeToken(token) {
  const snap = lastSnapshot?.snapshot;
  if (!snap) return null;
  const project = (snap.projects ?? []).find((p) => p.intakeToken === token);
  return project ? { snap, project } : null;
}

app.get('/public/intake/:token', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const found = findProjectByIntakeToken(req.params.token);
  if (!found) {
    return res.status(404).send('<!doctype html><html lang="da"><body style="font-family:sans-serif;padding:2rem">Ukendt eller inaktiv formular.</body></html>');
  }
  const html = `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Indsend opgave – ${esc(found.project.name)}</title>
<style>
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#17181c;color:#e4e4e7;margin:0;padding:2.5rem 1.5rem;display:flex;justify-content:center}
  main{max-width:480px;width:100%}
  .card{background:#1e1f24;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:1.5rem;margin-bottom:1rem}
  h1{font-size:1.4rem;margin:.25rem 0 0}
  .lbl{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:#a1a1aa}
  input,textarea{width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#17181c;color:#e4e4e7;padding:.75rem;font-family:inherit;margin-top:.4rem}
  button{width:100%;border:0;border-radius:10px;padding:.85rem;font-size:1rem;font-weight:600;cursor:pointer;background:#6366f1;color:#fff;margin-top:1rem}
  .ok{display:none;text-align:center;padding:1rem;border-radius:10px;background:rgba(16,185,129,.15);color:#34d399;font-weight:600}
</style></head><body><main>
<div class="card"><span class="lbl">Opgaveformular</span><h1>${esc(found.project.name)}</h1></div>
<div class="card" id="form">
  <span class="lbl">Kort titel</span>
  <input id="title" placeholder="Fx 'Skift tekst på forsiden'">
  <div style="margin-top:.75rem"><span class="lbl">Beskrivelse (valgfri)</span></div>
  <textarea id="body" rows="4" placeholder="Beskriv kort, hvad der skal ske…"></textarea>
  <button onclick="submit()">Send opgave</button>
  <p id="err" style="color:#fb7185;font-size:.85rem"></p>
</div>
<div class="card ok" id="done">Tak! Din opgave er modtaget.</div>
<script>
async function submit() {
  const title = document.getElementById('title').value.trim();
  if (!title) { document.getElementById('err').textContent = 'Skriv en titel først.'; return; }
  const r = await fetch(location.pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body: document.getElementById('body').value.trim() }) });
  if (r.ok) { document.getElementById('form').style.display = 'none'; document.getElementById('done').style.display = 'block'; }
  else document.getElementById('err').textContent = 'Noget gik galt – prøv igen.';
}
</script>
</main></body></html>`;
  res.send(html);
});

app.post('/public/intake/:token', (req, res) => {
  const found = findProjectByIntakeToken(req.params.token);
  if (!found) return res.status(404).json({ ok: false, reason: 'Ukendt token' });
  const { title, body } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ ok: false, reason: 'Mangler titel' });
  const snap = found.snap;
  const maxNumber = (snap.tasks ?? []).filter((t) => t.projectId === found.project.id).reduce((m, t) => Math.max(m, t.number ?? 0), 0);
  snap.tasks = [
    ...(snap.tasks ?? []),
    {
      id: `t-ext-${Date.now()}`,
      number: maxNumber + 1,
      projectId: found.project.id,
      sprintId: null,
      title: String(title).slice(0, 200),
      description: body ? `Indsendt via formular:\n${String(body).slice(0, 1000)}` : 'Indsendt via formular',
      status: 'todo',
      priority: 'medium',
      assigneeId: null,
      reporterId: 'external',
      labelIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startDate: null,
      dueDate: null,
      estimate: null,
      subtasks: [],
      comments: [],
      order: 0,
    },
  ];
  broadcast({ type: 'sync', from: 'intake' });
  windowsNotify('Orbit – ny opgave', `“${String(title).slice(0, 60)}” indsendt til ${found.project.name}`);
  res.json({ ok: true });
});

// ---------------- Hvid-label kundeportal ----------------
app.get('/public/portal/:token', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const found = findProjectByIntakeToken(req.params.token) ?? (() => {
    const snap = lastSnapshot?.snapshot;
    const project = snap?.projects?.find((p) => p.publicToken === req.params.token);
    return project ? { snap, project } : null;
  })();
  if (!found) return res.status(404).send('<!doctype html><html lang="da"><body style="font-family:sans-serif;padding:2rem">Ukendt portal.</body></html>');
  const { snap, project } = found;
  const brand = loadConfig().brand?.name || 'Orbit';
  const tasks = (snap.tasks ?? []).filter((t) => t.projectId === project.id);
  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'canceled');
  const done = tasks.filter((t) => t.status === 'done');
  const pending = open.filter((t) => t.approval?.status === 'pending');
  const row = (t) => `<li><strong>${esc(project.key)}-${t.number}</strong> ${esc(t.title)} <span class="due">${t.dueDate ? `· frist ${esc(t.dueDate)}` : ''}${t.approval?.status === 'pending' ? ' · afventer godkendelse' : ''}</span></li>`;
  const html = `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(brand)} – ${esc(project.name)}</title>
<style>
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#fafafa;color:#18181b;margin:0;padding:2.5rem 1.5rem;display:flex;justify-content:center}
  main{max-width:640px;width:100%}
  .brand{font-size:.85rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6366f1}
  h1{font-size:1.7rem;margin:.25rem 0 1.5rem}
  .card{background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:1.25rem 1.5rem;margin-bottom:1rem;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  h2{font-size:.9rem;text-transform:uppercase;letter-spacing:.05em;color:#71717a;margin:0 0 .75rem}
  ul{list-style:none;margin:0;padding:0}
  li{padding:.5rem 0;border-top:1px solid #f0f0f2;font-size:.95rem}
  .due{color:#a1a1aa;font-size:.85rem}
  .empty{color:#a1a1aa;font-style:italic}
  .foot{color:#a1a1aa;font-size:.75rem;margin-top:1.5rem;text-align:center}
</style></head><body><main>
<div class="brand">${esc(brand)}</div>
<h1>${esc(project.name)}</h1>
<div class="card"><h2>Igangværende</h2><ul>${open.length ? open.map(row).join('') : '<li class="empty">Ingen åbne opgaver.</li>'}</ul></div>
<div class="card"><h2>Afventer jeres godkendelse (${pending.length})</h2><ul>${pending.length ? pending.map(row).join('') : '<li class="empty">Intet afventer.</li>'}</ul></div>
<div class="card"><h2>Senest afsluttet</h2><ul>${done.length ? done.slice(-5).reverse().map(row).join('') : '<li class="empty">Endnu ingen.</li>'}</ul></div>
<p class="foot">Leveret af ${esc(brand)} · opdateres automatisk</p>
</main></body></html>`;
  res.send(html);
});

// ================= Eksterne integrationer =================
function extCfg(key) {
  return loadConfig()[key] ?? {};
}

function audit(action, detail) {
  try {
    appendFileSync(join(APP_DIR, 'audit.log'), `${new Date().toISOString()} ${action} ${detail}\n`);
  } catch { /* ignorer */ }
}

function injectExternalTask(title, description, source) {
  if (!lastSnapshot) return null;
  const snap = lastSnapshot.snapshot;
  const project = (snap.projects ?? [])[0];
  if (!project) return null;
  const maxNumber = (snap.tasks ?? []).filter((t) => t.projectId === project.id).reduce((m, t) => Math.max(m, t.number ?? 0), 0);
  const task = {
    id: `t-ext-${Date.now()}-${Math.round(Math.random() * 999)}`,
    number: maxNumber + 1,
    projectId: project.id,
    sprintId: null,
    title: String(title).slice(0, 200),
    description: String(description ?? '').slice(0, 1500),
    status: 'todo',
    priority: 'medium',
    assigneeId: null,
    reporterId: source,
    labelIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startDate: null,
    dueDate: null,
    estimate: null,
    subtasks: [],
    comments: [],
    order: 0,
  };
  snap.tasks = [...(snap.tasks ?? []), task];
  lastSnapshot.updatedAt = new Date().toISOString();
  broadcast({ type: 'sync', from: source });
  return task;
}

// ---- Telegram-bot (polling) ----
let telegramTimer = null;
let telegramOffset = 0;

async function tgSend(token, chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 400) }),
    });
  } catch { /* ignorer */ }
}

function startTelegram() {
  if (telegramTimer) return;
  const token = extCfg('telegram').token;
  if (!token) return;
  telegramTimer = setInterval(async () => {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${telegramOffset}&timeout=5`);
      const d = await r.json();
      for (const u of d.result ?? []) {
        telegramOffset = u.update_id + 1;
        const text = u.message?.text?.trim();
        const chatId = u.message?.chat?.id;
        if (!text || chatId == null) continue;
        if (text.startsWith('/start')) {
          await tgSend(token, chatId, 'Hej! Skriv en besked, så opretter jeg en opgave i Orbit. ✅');
          continue;
        }
        const task = injectExternalTask(text, 'Oprettet fra Telegram', 'telegram');
        if (task) {
          audit('telegram-task', task.title);
          await tgSend(token, chatId, `Opgave oprettet: ${task.title}`);
        } else {
          await tgSend(token, chatId, 'Orbit er ikke startet endnu – åbn appen først.');
        }
      }
    } catch { /* ignorer */ }
  }, 10000);
}

app.post('/api/telegram/config', (req, res) => {
  const token = String(req.body?.token ?? '').trim();
  const cfg = loadConfig();
  cfg.telegram = { token };
  saveConfig(cfg);
  if (telegramTimer) { clearInterval(telegramTimer); telegramTimer = null; }
  startTelegram();
  audit('telegram-config', token ? 'token gemt' : 'token fjernet');
  res.json({ ok: true, running: Boolean(token) });
});

app.get('/api/telegram/status', (_req, res) => {
  res.json({ ok: true, configured: Boolean(extCfg('telegram').token), running: Boolean(telegramTimer) });
});

// ---- Slack-kommando ----
app.post('/api/slack/command', (req, res) => {
  const body = req.body ?? {};
  if (body.type === 'url_verification') return res.json({ challenge: body.challenge });
  const cfg = extCfg('slack');
  if (!cfg.commandToken || body.token !== cfg.commandToken) {
    return res.status(401).json({ ok: false, reason: 'Ugyldig Slack-token' });
  }
  const text = String(body.text ?? '').trim();
  if (!text) return res.json({ response_type: 'ephemeral', text: 'Skriv: /orbit <opgavetitel>' });
  const task = injectExternalTask(text, `Fra Slack (af ${body.user_name ?? 'ukendt'})`, 'slack');
  audit('slack-task', text);
  res.json({ response_type: 'in_channel', text: `Opgave oprettet i Orbit: ${task ? task.title : '(åbn appen først)'}` });
});

app.post('/api/slack/config', (req, res) => {
  const cfg = loadConfig();
  cfg.slack = { commandToken: String(req.body?.commandToken ?? '') };
  saveConfig(cfg);
  audit('slack-config', 'gemt');
  res.json({ ok: true });
});

// ---- Jira (to-vejs via PAT) ----
function jiraAuth() {
  const { email, token } = extCfg('jira');
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

app.post('/api/jira/config', (req, res) => {
  const { domain, email, token, project } = req.body ?? {};
  const cfg = loadConfig();
  cfg.jira = { domain: domain ?? '', email: email ?? '', token: token ?? '', project: project ?? '' };
  saveConfig(cfg);
  audit('jira-config', 'gemt');
  res.json({ ok: true });
});

app.get('/api/jira/issues', async (_req, res) => {
  const { domain, project } = extCfg('jira');
  if (!domain || !project || !extCfg('jira').token) return res.json({ ok: false, reason: 'Jira er ikke konfigureret (domæne, projekt-nøgle og API-token under Integrationer)' });
  try {
    const r = await fetch(`https://${domain}/rest/api/3/search?jql=${encodeURIComponent(`project = ${project} AND statusCategory != Done ORDER BY updated DESC`)}&maxResults=50&fields=summary,status`, {
      headers: { Authorization: jiraAuth(), Accept: 'application/json' },
    });
    if (!r.ok) return res.json({ ok: false, reason: `Jira svarede ${r.status} – tjek domæne/projekt/token` });
    const d = await r.json();
    res.json({
      ok: true,
      items: (d.issues ?? []).map((i) => ({ id: i.key, title: i.fields?.summary ?? i.key, state: i.fields?.status?.name ?? '' })),
    });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

app.post('/api/jira/complete', async (req, res) => {
  const { id } = req.body ?? {};
  const { domain } = extCfg('jira');
  if (!domain || !id) return res.status(400).json({ ok: false, reason: 'Mangler issue-nøgle eller konfiguration' });
  try {
    const auth = { Authorization: jiraAuth(), Accept: 'application/json' };
    const tr = await fetch(`https://${domain}/rest/api/3/issue/${id}/transitions`, { headers: auth });
    const td = await tr.json();
    const doneTransition = (td.transitions ?? []).find((t) => /done|closed|resolved|complete/i.test(t.name)) ?? (td.transitions ?? [])[0];
    if (!doneTransition) return res.json({ ok: false, reason: 'Ingen afslutnings-transition fundet' });
    const r = await fetch(`https://${domain}/rest/api/3/issue/${id}/transitions`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition: { id: doneTransition.id } }),
    });
    res.json({ ok: r.ok || r.status === 204, status: r.status });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

// ---- Trello (import + write-back) ----
app.post('/api/trello/config', (req, res) => {
  const { key, token, boardId } = req.body ?? {};
  const cfg = loadConfig();
  cfg.trello = { key: key ?? '', token: token ?? '', boardId: boardId ?? '' };
  saveConfig(cfg);
  audit('trello-config', 'gemt');
  res.json({ ok: true });
});

app.get('/api/trello/cards', async (_req, res) => {
  const { key, token, boardId } = extCfg('trello');
  if (!key || !token || !boardId) return res.json({ ok: false, reason: 'Trello er ikke konfigureret (API-nøgle, token og board-id under Integrationer)' });
  try {
    const r = await fetch(`https://api.trello.com/1/boards/${boardId}/cards?filter=open&fields=name,desc,due&key=${key}&token=${token}`);
    if (!r.ok) return res.json({ ok: false, reason: `Trello svarede ${r.status}` });
    const d = await r.json();
    res.json({ ok: true, items: (Array.isArray(d) ? d : []).slice(0, 80).map((c) => ({ id: c.id, title: c.name, due: c.due ? c.due.slice(0, 10) : null, description: c.desc ?? '' })) });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

app.post('/api/trello/complete', async (req, res) => {
  const { key, token } = extCfg('trello');
  const { id } = req.body ?? {};
  if (!key || !token || !id) return res.status(400).json({ ok: false, reason: 'Mangler kort-id eller konfiguration' });
  try {
    const r = await fetch(`https://api.trello.com/1/cards/${id}?closed=true&key=${key}&token=${token}`, { method: 'PUT' });
    res.json({ ok: r.ok, status: r.status });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

// ---- Microsoft Planner (write-back) ----
app.post('/api/graph/planner/complete', async (req, res) => {
  try {
    const token = await graphAcquireSilent();
    if (!token) return res.json({ ok: false, reason: 'Ikke tilsluttet Microsoft 365' });
    const { id, etag } = req.body ?? {};
    if (!id || !etag) return res.status(400).json({ ok: false, reason: 'Mangler planner-id/etag – importer opgaven igen' });
    const r = await fetch(`https://graph.microsoft.com/v1.0/planner/tasks/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': etag },
      body: JSON.stringify({ percentCompleted: 100, completedDateTime: new Date().toISOString() }),
    });
    res.json({ ok: r.ok, status: r.status });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

// ---- Windows-toast med knapper (Action Center) ----
app.post('/api/notify-action', (req, res) => {
  const { title, message, taskId } = req.body ?? {};
  if (!title) return res.status(400).json({ ok: false, reason: 'Mangler titel' });
  const base = `http://localhost:4310/public/toast-action/${encodeURIComponent(String(taskId ?? ''))}`;
  const script = [
    'try {',
    'Import-Module BurntToast -ErrorAction Stop',
    `$btn1 = New-BurntToastButton -Text 'Færdig' -Arguments '${base}?action=done'`,
    `$btn2 = New-BurntToastButton -Text 'Åbn' -Arguments 'http://localhost:5173/#/tavle'`,
    `New-BurntToastNotification -Text '${String(title).replace(/'/g, "''").slice(0, 90)}', '${String(message ?? '').replace(/'/g, "''").slice(0, 120)}' -Button $btn1, $btn2`,
    '} catch {',
    `try { New-BurntToastNotification -Text '${String(title).replace(/'/g, "''").slice(0, 90)}' } catch { }`,
    '}',
  ].join('; ');
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 9000 }, () => {});
  res.json({ ok: true });
});

app.get('/public/toast-action/:taskId', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const snap = lastSnapshot?.snapshot;
  const task = snap?.tasks?.find((t) => t.id === req.params.taskId);
  if (!task) return res.status(404).send('<!doctype html><html lang="da"><body style="font-family:sans-serif;padding:2rem">Opgaven findes ikke (åbn Orbit først).</body></html>');
  if (req.query.action === 'done' && task.status !== 'done') {
    task.status = 'done';
    task.updatedAt = new Date().toISOString();
    broadcast({ type: 'sync', from: 'toast-action' });
    audit('toast-done', task.title);
  }
  res.send(`<!doctype html><html lang="da"><head><meta charset="utf-8"><title>Orbit</title><style>body{font-family:'Segoe UI',sans-serif;background:#17181c;color:#e4e4e7;display:grid;place-items:center;height:100vh;margin:0}div{text-align:center}</style></head><body><div><h2>${req.query.action === 'done' ? '✅ Afsluttet' : 'Orbit'}</h2><p>${task.title.replace(/</g, '&lt;')}</p><p>Opdateret i Orbit.</p></div></body></html>`);
});

// ---- iCal-import (Google/Apple-kalender via offentlig feed) ----
app.post('/api/ical/parse', async (req, res) => {
  const url = String(req.body?.url ?? '').trim();
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ ok: false, reason: 'URL skal starte med http(s)://' });
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return res.json({ ok: false, reason: `Feed svarede ${r.status}` });
    const text = await r.text();
    const events = [];
    const blocks = text.split('BEGIN:VEVENT').slice(1);
    for (const b of blocks) {
      const summary = /SUMMARY:(.{1,200})/.exec(b)?.[1]?.replace(/\\,/g, ',').trim();
      const dtStart = /DTSTART(?:;[^:]*)?:(\d{8})/.exec(b)?.[1];
      const desc = /DESCRIPTION:((?:.|\n )+)/.exec(b)?.[1]?.replace(/\n /g, '').slice(0, 300);
      if (!summary || !dtStart) continue;
      const date = `${dtStart.slice(0, 4)}-${dtStart.slice(4, 6)}-${dtStart.slice(6, 8)}`;
      events.push({ title: summary, date, description: desc ?? '' });
      if (events.length >= 60) break;
    }
    res.json({ ok: true, items: events });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

// ---- e-conomic (fakturakladde) ----
app.post('/api/economic/config', (req, res) => {
  const { agreementGrantToken, customerNumber } = req.body ?? {};
  const cfg = loadConfig();
  cfg.economic = { agreementGrantToken: agreementGrantToken ?? '', customerNumber: customerNumber ?? 0 };
  saveConfig(cfg);
  audit('economic-config', 'gemt');
  res.json({ ok: true });
});

app.post('/api/economic/draft', async (req, res) => {
  const { agreementGrantToken, customerNumber } = extCfg('economic');
  const { lines } = req.body ?? {};
  if (!agreementGrantToken || !customerNumber) return res.json({ ok: false, reason: 'e-conomic er ikke konfigureret (AgreementGrantToken og kundenummer under Integrationer)' });
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ ok: false, reason: 'Mangler linjer' });
  try {
    const r = await fetch('https://restapi.e-conomic.com/invoices/drafts', {
      method: 'POST',
      headers: {
        'X-AgreementGrantToken': agreementGrantToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currency: 'DKK',
        date: new Date().toISOString().slice(0, 10),
        customer: { customerNumber: Number(customerNumber) },
        lines: lines.map((l) => ({
          description: String(l.description ?? '').slice(0, 250),
          quantity: Number(l.quantity ?? 1),
          unit: { unitNumber: 1 },
          unitNetPrice: Number(l.unitPrice ?? 0),
        })),
      }),
    });
    if (!r.ok) return res.json({ ok: false, reason: `e-conomic svarede ${r.status}: ${(await r.text()).slice(0, 160)}` });
    const d = await r.json();
    audit('economic-draft', `kladde ${d.draftInvoiceNumber ?? ''}`);
    res.json({ ok: true, draftNumber: d.draftInvoiceNumber });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

// ---- AI-motor (abonnement-first orkestrering) ----
registerAiRoutes(app, { loadConfig, saveConfig, broadcast, APP_DIR, EXPORT_DIR, getSnapshot: () => lastSnapshot?.snapshot,
  updateSnapshot: transform => {
    const next = { ...lastSnapshot, snapshot: normalizeSnapshot(transform(lastSnapshot?.snapshot)), updatedAt: new Date().toISOString(), from: { clientId: 'orbit-runtime', name: 'Orbit' } };
    writeAtomicJson(SNAPSHOT_PATH, next);
    lastSnapshot = next;
    broadcast({ type: 'sync', from: 'orbit-runtime', updatedAt: next.updatedAt });
  },
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { app.locals.prepareAiShutdown(); } catch (error) { console.error('Kunne ikke gemme køens pause:', error.message); }
  server.close();
  for (const client of wss.clients) client.close(1001, 'Companion stopper');
  const deadline = Date.now() + 20000;
  while ((activeRuns.size || aiProcessSnapshot().length) && Date.now() < deadline) await delay(100);
  const remaining = activeRuns.size || aiProcessSnapshot().length || app.locals.orphanProcesses?.().length;
  if (remaining) console.error('Companion stoppes med uafsluttet arbejde. Kontrollér gendannede kørsler ved næste start.');
  process.exit(remaining ? 1 : 0);
}
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });

server.listen(PORT, '0.0.0.0', () => {
  startTelegram();
  console.log(`Orbit Companion kører på http://127.0.0.1:${server.address().port}`);
  // LAN-adresser, så app'en også kan nås fra telefonen på samme Wi-Fi.
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  Telefon (samme Wi-Fi): http://${a.address}:${PORT}`);
      }
    }
  }
  console.log(`Eksport-mappe: ${EXPORT_DIR}`);
});

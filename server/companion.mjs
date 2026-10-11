// Orbit Companion – lokal server der giver Orbit-appen adgang til Windows,
// filsystemet, Teams-webhooks og Microsoft Graph.
// Køres med: node server/companion.mjs   (port 4310)
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const PORT = 4310;
const APP_DIR = join(homedir(), '.orbit');
const CONFIG_PATH = join(APP_DIR, 'companion.json');
const MSAL_CACHE_PATH = join(APP_DIR, 'msal-cache.json');
const EXPORT_DIR = join(homedir(), 'Documents', 'Orbit');
const GRAPH_SCOPES = ['User.Read', 'Tasks.Read', 'Calendars.Read', 'offline_access'];

mkdirSync(APP_DIR, { recursive: true });
mkdirSync(EXPORT_DIR, { recursive: true });

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

// ---------------- HTTP + WS ----------------
const app = express();
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ type: 'hello', name: 'Orbit Companion' }));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, name: 'Orbit Companion', version: '1.0.0', time: new Date().toISOString() });
});

app.get('/api/status', (_req, res) => {
  const cfg = loadConfig();
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    clients: wss.clients.size,
    teamsConfigured: Boolean(cfg.teamsWebhook),
    graphConfigured: Boolean(cfg.graphClientId),
    graphConnected: Boolean(graphAccount),
    graphAccount: graphAccount?.username ?? null,
    exportDir: EXPORT_DIR,
  });
});

app.post('/api/config', (req, res) => {
  const cfg = loadConfig();
  const { teamsWebhook, graphClientId } = req.body ?? {};
  if (teamsWebhook !== undefined) cfg.teamsWebhook = teamsWebhook || undefined;
  if (graphClientId !== undefined) cfg.graphClientId = graphClientId || undefined;
  saveConfig(cfg);
  res.json({ ok: true, teamsConfigured: Boolean(cfg.teamsWebhook), graphConfigured: Boolean(cfg.graphClientId) });
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

server.listen(PORT, () => {
  console.log(`Orbit Companion kører på http://127.0.0.1:${PORT}`);
  console.log(`Eksport-mappe: ${EXPORT_DIR}`);
});

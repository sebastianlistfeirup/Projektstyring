// Orbit Sync Server – selvhostet sync-server til Orbit teams.
// Kør lokalt:   node server/sync-server.mjs
// På en server: ORBIT_SYNC_TOKEN=hemmeligt node server/sync-server.mjs
//                (sæt evt. PORT; læg bag reverse proxy med TLS for internet-brug)
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4320;
const TOKEN = process.env.ORBIT_SYNC_TOKEN || null;

let lastSnapshot = null; // { snapshot, from, updatedAt }
const presence = new Map();

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Orbit-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function authorized(req) {
  return !TOKEN || req.get('x-orbit-token') === TOKEN;
}

app.get('/api/ping', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, reason: 'Ugyldig token' });
  res.json({ ok: true, name: 'Orbit Sync Server', version: '1.0.0', time: new Date().toISOString(), auth: Boolean(TOKEN) });
});

app.post('/api/sync/push', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, reason: 'Ugyldig token' });
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

app.get('/api/sync/state', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, reason: 'Ugyldig token' });
  if (!lastSnapshot) return res.json({ ok: false, reason: 'Ingen synkroniseret data endnu' });
  res.json({ ok: true, snapshot: lastSnapshot.snapshot, from: lastSnapshot.from, updatedAt: lastSnapshot.updatedAt });
});

app.get('/api/presence', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, reason: 'Ugyldig token' });
  res.json({ ok: true, online: [...presence.values()] });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

function broadcastPresence() {
  broadcast({ type: 'presence', online: [...presence.values()] });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.authed = !TOKEN;
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'hello') {
        if (TOKEN && msg.token !== TOKEN) {
          ws.send(JSON.stringify({ type: 'error', reason: 'Ugyldig token' }));
          ws.close();
          return;
        }
        ws.authed = true;
        presence.set(String(msg.clientId ?? Math.random()), { name: String(msg.user?.name ?? 'Ukendt'), since: new Date().toISOString() });
        broadcastPresence();
      } else if (ws.authed && msg.type === 'sync') {
        broadcast({ type: 'sync', from: msg.clientId });
      }
    } catch { /* ignorer */ }
  });
  ws.send(JSON.stringify({ type: 'hello', name: 'Orbit Sync Server', authRequired: Boolean(TOKEN) }));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`Orbit Sync Server kører på port ${PORT}`);
  console.log(TOKEN ? 'Token-auth: aktiv' : 'Token-auth: deaktiveret (sæt ORBIT_SYNC_TOKEN i produktion)');
  console.log('I appen: Integrationer → Synkronisering → peg på denne servers adresse og indsæt token.');
});

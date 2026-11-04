import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { isLocalAddress, isTrustedLocalOrigin } from './local-access.mjs';

export function trustedDesktopRequest(req) {
  const host = String(req.headers.host ?? '').split(':')[0];
  return isLocalAddress(req.socket.remoteAddress) && (host === '127.0.0.1' || host === 'localhost') && isTrustedLocalOrigin(req.headers.origin);
}

// Packaged desktop serves one immutable release. Development keeps its existing
// server/origin behaviour; no desktop control endpoint exists without a token.
export function desktopReleaseInfo(env = process.env) {
  if (!env.ORBIT_FRONTEND_DIR) return null;
  const frontend = realpathSync(env.ORBIT_FRONTEND_DIR);
  const manifest = JSON.parse(readFileSync(join(frontend, '..', 'release.json'), 'utf8'));
  if (manifest.format !== 1 || !/^[a-zA-Z0-9._-]{1,100}$/.test(manifest.releaseId) || typeof manifest.version !== 'string') throw new Error('Orbit release-manifest er ugyldigt.');
  return { releaseId: manifest.releaseId, version: manifest.version, frontend, runtimeId: env.ORBIT_RUNTIME_ID ?? null };
}

export function registerDesktopRuntime(app, { shutdown, isBusy, prepareShutdown, env = process.env }) {
  const release = desktopReleaseInfo(env);
  if (!release) return null;
  const secret = env.ORBIT_DESKTOP_TOKEN;
  if (!secret || secret.length < 32 || !release.runtimeId) throw new Error('Den pakkede Orbit-runtime mangler sin lokale kontrolidentitet.');
  app.use((req, res, next) => {
    if (!trustedDesktopRequest(req)) return res.status(403).json({ ok: false, reason: 'Den pakkede Orbit-app accepterer kun lokale forespørgsler fra Orbit.' });
    next();
  });
  app.post('/api/desktop/shutdown', (req, res) => {
    const supplied = String(req.headers['x-orbit-desktop-token'] ?? '');
    const validToken = Buffer.byteLength(supplied) === Buffer.byteLength(secret) && timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
    if (!validToken) return res.status(403).json({ ok: false, reason: 'Kun den lokale Orbit-starter kan lukke denne runtime.' });
    // Updates never implicitly stop a coding agent or approve a waiting action.
    if (isBusy()) return res.status(409).json({ ok: false, reason: 'Afslut den aktive kørsel eller beslutning i Orbit før opdatering.' });
    try { prepareShutdown(); }
    catch (error) { return res.status(503).json({ ok: false, reason: error.message }); }
    if (isBusy()) return res.status(409).json({ ok: false, reason: 'Arbejdet ændrede sig under lukning. Kontrollér Orbit.' });
    res.json({ ok: true, runtimeId: release.runtimeId });
    setImmediate(() => { void shutdown(); });
  });
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/ws') return next();
    // Root HTML and SW must revalidate; hashed Vite assets can be retained.
    res.setHeader('Cache-Control', req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    next();
  }, express.static(release.frontend, { index: 'index.html', cacheControl: false, dotfiles: 'deny' }));
  return release;
}

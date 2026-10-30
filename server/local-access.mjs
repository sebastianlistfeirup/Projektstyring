export function isLocalAddress(address) {
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

export function isTrustedLocalOrigin(origin) {
  if (!origin) return true; // Native CLI/desktop requests do not always send Origin.
  try {
    const url = new URL(origin);
    return ['http:', 'https:', 'tauri:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]', 'tauri.localhost'].includes(url.hostname);
  } catch { return false; }
}

// AI endpoints can execute repository commands. Keep them on the local trust
// boundary; a website opened elsewhere must not drive the local companion.
export function localAiAccess(req, res, next) {
  if (!isLocalAddress(req.socket.remoteAddress) || !isTrustedLocalOrigin(req.headers.origin)) {
    return res.status(403).json({ ok: false, reason: 'Denne handling kræver lokal adgang fra Orbit på denne maskine.' });
  }
  next();
}

// Klient til Orbit Companions AI-motor (server/ai-engine.mjs).
import type { AiAttachment, AiMessage } from './types';

const BASE = 'http://127.0.0.1:4310';

export interface AiServiceInfo {
  id: string;
  name: string;
  kind: 'cli' | 'local' | 'sub-api' | 'paid-api' | 'manual';
  color: string;
  strengths: string[];
  available: boolean;
  reason: string | null;
  enabled: boolean;
  hasKey: boolean;
  keyMask: string | null;
  model: string | null;
  cmd: string | null;
  subscriptionCovered: boolean;
}

export interface AiServicesResponse {
  ok: boolean;
  services: Record<string, AiServiceInfo>;
  prefs: { allowPaidApis: boolean; orchestrator: string };
}

export async function fetchAiServices(): Promise<AiServicesResponse | null> {
  try {
    const r = await fetch(`${BASE}/api/ai/services`, { signal: AbortSignal.timeout(2500) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function saveAiPrefs(prefs: Partial<{ allowPaidApis: boolean; orchestrator: string }>): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/ai/prefs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prefs) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function saveService(id: string, patch: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/ai/services/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function uploadAiFile(file: File): Promise<AiAttachment | null> {
  const buf = await file.arrayBuffer();
  if (buf.byteLength > 25 * 1024 * 1024) return null;
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  try {
    const r = await fetch(`${BASE}/api/ai/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, mime: file.type || 'application/octet-stream', dataBase64: btoa(binary) }),
    });
    const j = await r.json();
    return j.ok ? j.file : null;
  } catch {
    return null;
  }
}

// SSE-hjælper: læser 'data: {json}'-linjer og kalder onEvent, indtil 'done'/'error' eller afbrydelse.
async function readSse(url: string, body: unknown, onEvent: (e: Record<string, unknown>) => void, signal: AbortSignal): Promise<void> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`Companion svarede ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        onEvent(evt);
        if (evt.type === 'done' || evt.type === 'error') return;
      } catch {
        /* ufuldstændig JSON */
      }
    }
  }
}

/** Stream en chat-besked fra en tjeneste. */
export async function streamChat(
  service: string,
  messages: Pick<AiMessage, 'role' | 'text' | 'attachments'>[],
  handlers: { onDelta: (delta: string, full: string) => void; onDone: (full: string) => void; onError: (msg: string) => void },
  signal: AbortSignal,
): Promise<void> {
  let full = '';
  try {
    await readSse(
      `${BASE}/api/ai/chat`,
      { service, messages: messages.map((m) => ({ role: m.role, text: m.text, attachments: m.attachments })) },
      (evt) => {
        if (evt.type === 'delta') {
          full += String(evt.delta ?? '');
          handlers.onDelta(String(evt.delta ?? ''), full);
        } else if (evt.type === 'done') {
          handlers.onDone(full);
        } else if (evt.type === 'error') {
          handlers.onError(String(evt.error ?? 'Ukendt fejl'));
        }
      },
      signal,
    );
  } catch (e) {
    if (!signal.aborted) handlers.onError(e instanceof Error ? e.message : String(e));
  }
}

export interface OrchestrateHandlers {
  onEvent: (evt: Record<string, unknown>) => void;
  onError: (msg: string) => void;
}

/** Start en orkestreret kørsel (plan + eksekvering). */
export async function streamOrchestrate(
  input: { goal: string; bible?: string; jobs?: unknown[] },
  handlers: OrchestrateHandlers,
  signal: AbortSignal,
): Promise<void> {
  try {
    await readSse(`${BASE}/api/ai/orchestrate`, input, (evt) => {
      if (evt.type === 'error') handlers.onError(String(evt.error ?? 'Ukendt fejl'));
      else handlers.onEvent(evt);
    }, signal);
  } catch (e) {
    if (!signal.aborted) handlers.onError(e instanceof Error ? e.message : String(e));
  }
}

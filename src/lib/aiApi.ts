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
  models?: string[] | null;
  cmd: string | null;
  subscriptionCovered: boolean;
}

export interface AiServicesResponse {
  ok: boolean;
  services: Record<string, AiServiceInfo>;
  prefs: { allowPaidApis: boolean; orchestrator: string; autoJudge?: boolean; selfHeal?: boolean };
}

export async function fetchAiServices(): Promise<AiServicesResponse | null> {
  try {
    const r = await fetch(`${BASE}/api/ai/services`, { signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export interface SavePrefsResult {
  ok: boolean;
  prefs?: AiServicesResponse['prefs'];
  reason?: string;
}

export async function saveAiPrefs(prefs: Partial<{ allowPaidApis: boolean; orchestrator: string; autoJudge: boolean; selfHeal: boolean }>): Promise<SavePrefsResult> {
  try {
    const r = await fetch(`${BASE}/api/ai/prefs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prefs) });
    const text = await r.text();
    let data: { ok?: boolean; prefs?: AiServicesResponse['prefs']; reason?: string } = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* HTML/fejlside håndteres nedenfor */ }
    return {
      ok: r.ok && data.ok === true && Boolean(data.prefs),
      prefs: data.prefs,
      reason: data.reason ?? (!r.ok ? `Companion svarede ${r.status}` : !data.prefs ? 'Companion bekræftede ikke indstillingen. Genstart companion-serveren.' : undefined),
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Kunne ikke kontakte companion-serveren.' };
  }
}

export interface SaveServiceResult {
  ok: boolean;
  hasKey?: boolean;
  reason?: string;
}

export async function saveService(id: string, patch: Record<string, unknown>): Promise<SaveServiceResult> {
  try {
    const r = await fetch(`${BASE}/api/ai/services/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const text = await r.text();
    let data: { ok?: boolean; hasKey?: boolean; reason?: string } = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* HTML/fejlside håndteres nedenfor */ }
    const needsConfirmation = typeof patch.apiKey === 'string' && patch.apiKey.length > 0;
    const confirmed = !needsConfirmation || data.hasKey === true;
    return {
      ok: r.ok && data.ok === true && confirmed,
      hasKey: data.hasKey,
      reason: data.reason ?? (!r.ok ? `Companion svarede ${r.status}` : !confirmed ? 'Companion bekræftede ikke, at nøglen blev gemt. Genstart companion-serveren.' : undefined),
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Kunne ikke kontakte companion-serveren.' };
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

export type OrchestrateMode = 'standard' | 'roles' | 'debate' | 'vote' | 'race';

export interface OrchestrateHandlers {
  onEvent: (evt: Record<string, unknown>) => void;
  onError: (msg: string) => void;
}

/** Start en orkestreret kørsel (plan + eksekvering). */
export async function streamOrchestrate(
  input: { goal: string; bible?: string; jobs?: unknown[]; mode?: OrchestrateMode; pauseAfterPlan?: boolean },
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

/**
 * Start en kørsel uden at lytte på hændelserne selv — sværmen opdateres via WebSocket.
 * Strømmen konsumeres dog til ende, så serveren ikke afbryder kørslen ved 'close'.
 */
export async function fireOrchestrate(input: {
  goal: string;
  bible?: string;
  jobs?: unknown[];
  mode?: OrchestrateMode;
  pauseAfterPlan?: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    const r = await fetch(`${BASE}/api/ai/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!r.ok || !r.body) return { ok: false, reason: `Companion svarede ${r.status}` };
    const reader = r.body.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export interface Trigger {
  id: string;
  name: string;
  kind: 'cron' | 'webhook';
  cron?: string;
  token?: string;
  goal: string;
  bible?: string;
  mode?: OrchestrateMode;
  enabled: boolean;
  webhookUrl?: string | null;
}

export async function fetchTriggers(): Promise<Trigger[]> {
  try {
    const r = await fetch(`${BASE}/api/ai/triggers`);
    const j = await r.json();
    return j?.ok ? (j.triggers ?? []) : [];
  } catch {
    return [];
  }
}

export async function saveTrigger(body: Partial<Trigger>): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/ai/triggers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function deleteTrigger(id: string): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/ai/triggers/${id}`, { method: 'DELETE' });
    return r.ok;
  } catch {
    return false;
  }
}

export interface PipelineTemplate {
  id: string;
  name: string;
  description?: string;
  builtin?: boolean;
  jobs: { id: string; title: string; serviceId: string | null; phase: string; dependsOn: number[]; description: string; team?: boolean }[];
}

export async function fetchTemplates(): Promise<PipelineTemplate[]> {
  try {
    const r = await fetch(`${BASE}/api/ai/templates`);
    const j = await r.json();
    return j?.ok ? (j.templates ?? []) : [];
  } catch {
    return [];
  }
}

export async function saveTemplate(body: { name: string; description?: string; jobs: unknown[] }): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/ai/templates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function deleteTemplate(id: string): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/ai/templates/${id}`, { method: 'DELETE' });
    return r.ok;
  } catch {
    return false;
  }
}

export async function suggestTemplate(goal: string, bible?: string): Promise<{ ok: boolean; jobs?: PipelineTemplate['jobs']; reason?: string }> {
  try {
    const r = await fetch(`${BASE}/api/ai/templates/suggest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal, bible }) });
    const j = await r.json();
    return j?.ok ? { ok: true, jobs: j.jobs } : { ok: false, reason: j?.reason };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export interface CostSummary {
  totalRuns: number;
  totalJobs: number;
  estKr: number;
  byService: { id: string; name: string; kind: string; jobs: number; subscriptionCovered: boolean; estKr: number }[];
}

export async function fetchCosts(): Promise<CostSummary | null> {
  try {
    const r = await fetch(`${BASE}/api/ai/costs`);
    const j = await r.json();
    return j?.ok ? j : null;
  } catch {
    return null;
  }
}

export async function sendRunMessage(runId: string, text: string): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/ai/runs/${runId}/message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function skipRunJob(runId: string, jobId: string): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/ai/runs/${runId}/skip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId }) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function cancelRun(runId: string): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/ai/runs/${runId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return r.ok;
  } catch {
    return false;
  }
}

export async function approvePlan(runId: string, jobs: unknown[]): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/ai/runs/${runId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobs }) });
    return r.ok;
  } catch {
    return false;
  }
}

/* ---------- nye funktioner (30-ideer-pakken) ---------- */

/** Genoptag en afsluttet kørsel: kun ikke-leverede jobs køres igen. */
export async function resumeRun(runId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const r = await fetch(`${BASE}/api/ai/runs/${runId}/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true } : { ok: false, reason: j?.reason ?? `Companion svarede ${r.status}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Download-URL for samlet leverance-eksport (markdown). */
export function runExportUrl(runId: string): string {
  return `${BASE}/api/ai/runs/${runId}/export`;
}

export interface AiPrompt {
  id: string;
  name: string;
  project: string;
  text: string;
  createdAt: string;
}

export async function fetchPrompts(project?: string): Promise<AiPrompt[]> {
  try {
    const r = await fetch(`${BASE}/api/ai/prompts${project ? `?project=${encodeURIComponent(project)}` : ''}`);
    const j = await r.json();
    return j?.ok ? (j.prompts ?? []) : [];
  } catch {
    return [];
  }
}

export async function savePrompt(body: { name: string; project?: string; text: string }): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/ai/prompts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function deletePrompt(id: string): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/ai/prompts/${id}`, { method: 'DELETE' });
    return r.ok;
  } catch {
    return false;
  }
}

/** AI-opdeling af en opgave i underopgaver. */
export async function splitTask(title: string, description: string): Promise<{ ok: boolean; subtasks?: { title: string; estimate: number | null }[]; reason?: string }> {
  try {
    const r = await fetch(`${BASE}/api/ai/tasks/split`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, description }) });
    const j = await r.json();
    return j?.ok ? { ok: true, subtasks: j.subtasks } : { ok: false, reason: j?.reason };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Smart estimering i story points. */
export async function estimateTask(input: { title: string; description: string; similar: { title: string; estimate: number }[] }): Promise<{ ok: boolean; estimate?: number; reason?: string }> {
  try {
    const r = await fetch(`${BASE}/api/ai/tasks/estimate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const j = await r.json();
    return j?.ok ? { ok: true, estimate: j.estimate } : { ok: false, reason: j?.reason };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Rå noter → liste af opgaver. */
export async function parseTasksFromText(text: string): Promise<{ ok: boolean; tasks?: { title: string; description: string; priority: string | null; dueDate: string | null }[]; reason?: string }> {
  try {
    const r = await fetch(`${BASE}/api/ai/tasks/parse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const j = await r.json();
    return j?.ok ? { ok: true, tasks: j.tasks } : { ok: false, reason: j?.reason };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Årshjul-planlægning: rækkefølge + foreslåede frister. */
export async function planTasks(tasks: { ref: string; title: string; dueDate: string | null }[]): Promise<{ ok: boolean; order?: string[]; plan?: { ref: string; suggestedDue: string | null; note: string }[]; reason?: string }> {
  try {
    const r = await fetch(`${BASE}/api/ai/tasks/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks }) });
    const j = await r.json();
    return j?.ok ? { ok: true, order: j.order, plan: j.plan } : { ok: false, reason: j?.reason };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Uge-prioritering med begrundelser. */
export async function prioritizeTasks(tasks: { ref: string; title: string; dueDate: string | null; priority: string; status: string }[]): Promise<{ ok: boolean; ranked?: { ref: string; reason: string; suggestedPriority: string | null }[]; reason?: string }> {
  try {
    const r = await fetch(`${BASE}/api/ai/tasks/prioritize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks }) });
    const j = await r.json();
    return j?.ok ? { ok: true, ranked: j.ranked } : { ok: false, reason: j?.reason };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export interface AiAnalysis {
  runs: number;
  errors: number;
  avgJobMs: number;
  errorTitles: { title: string; count: number }[];
  services: { id: string | null; name: string; jobs: number; errors: number; avgMs: number; errorRate: number }[];
  insights: string[];
}

export async function fetchAnalysis(): Promise<AiAnalysis | null> {
  try {
    const r = await fetch(`${BASE}/api/ai/analysis`);
    const j = await r.json();
    return j?.ok ? j : null;
  } catch {
    return null;
  }
}

export interface RunHistoryItem {
  file: string;
  runId: string;
  goal: string;
  finishedAt?: string;
  results?: { jobId: string; title: string; text?: string; artifacts?: unknown[]; score?: number | null }[];
  jobs?: { id: string; title: string; serviceId: string | null; phase: string; dependsOn: number[]; description: string; team?: boolean; startedAt?: number | null; finishedAt?: number | null; status?: string }[];
  orchestratorId?: string | null;
  mode?: string;
  events?: { at: number; type: string }[];
}

export async function fetchRunHistory(limit = 20): Promise<RunHistoryItem[]> {
  try {
    const r = await fetch(`${BASE}/api/ai/runs`);
    const j = await r.json();
    return j?.ok ? (j.runs ?? []).slice(0, limit) : [];
  } catch {
    return [];
  }
}

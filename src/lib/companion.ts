// Klient-API til Orbit Companion (lokal server på 127.0.0.1:4310)
// Token bruges også mod selvhostede sync-servere (server/sync-server.mjs).
const BASE = 'http://127.0.0.1:4310';

export function getSyncToken(): string {
  return localStorage.getItem('orbit-sync-token') ?? '';
}

export function setSyncToken(token: string) {
  if (token.trim()) localStorage.setItem('orbit-sync-token', token.trim());
  else localStorage.removeItem('orbit-sync-token');
}

function authHeaders(): Record<string, string> {
  const token = getSyncToken();
  return token ? { 'X-Orbit-Token': token } : {};
}

export interface CompanionStatus {
  ok: boolean;
  uptime?: number;
  clients?: number;
  teamsConfigured?: boolean;
  graphConfigured?: boolean;
  graphConnected?: boolean;
  graphAccount?: string | null;
  aiConfigured?: boolean;
  syncSnapshotAt?: string | null;
  reminders?: { enabled: boolean; time: string };
  reports?: { enabled: boolean; day: number; time: string };
  online?: { name: string; since: string }[];
  exportDir?: string;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

export async function companionStatus(): Promise<CompanionStatus | null> {
  try {
    const res = await fetch(`${BASE}/api/status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return (await res.json()) as CompanionStatus;
  } catch {
    return null;
  }
}

export async function companionNotify(title: string, message: string): Promise<boolean> {
  try {
    await post('/api/notify', { title, message });
    return true;
  } catch {
    return false;
  }
}

export async function companionTeams(
  title: string,
  text: string,
  subtitle?: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    return await post('/api/teams', { title, text, subtitle });
  } catch {
    return { ok: false, reason: 'Companion-serveren svarer ikke' };
  }
}

export async function companionSaveConfig(cfg: {
  teamsWebhook?: string;
  graphClientId?: string;
  reminders?: { enabled?: boolean; time?: string };
  reports?: { enabled?: boolean; day?: number; time?: string };
  ai?: { baseUrl?: string; apiKey?: string; model?: string };
}): Promise<{ ok: boolean }> {
  return post('/api/config', cfg);
}

export async function companionOpenExport(): Promise<{ ok: boolean; path?: string }> {
  try {
    return await post('/api/open-export');
  } catch {
    return { ok: false };
  }
}

export async function companionExport(
  tasks: unknown[],
  projects: unknown[],
  format: 'csv' | 'json',
): Promise<{ ok: boolean; path?: string; count?: number; reason?: string }> {
  try {
    return await post('/api/export', { tasks, projects, format });
  } catch {
    return { ok: false, reason: 'Companion-serveren svarer ikke' };
  }
}

export async function companionReport(
  markdown: string,
  title: string,
): Promise<{ ok: boolean; path?: string; reason?: string }> {
  try {
    return await post('/api/report', { markdown, title });
  } catch {
    return { ok: false, reason: 'Companion-serveren svarer ikke' };
  }
}

export interface GraphDevice {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
}

export interface GraphStatus {
  ok: boolean;
  configured?: boolean;
  connected?: boolean;
  pending?: boolean;
  account?: string | null;
  reason?: string;
}

export async function graphStatus(): Promise<GraphStatus> {
  try {
    return await post('/api/graph/status');
  } catch {
    return { ok: false, reason: 'Companion-serveren svarer ikke' };
  }
}

export async function graphLogin(): Promise<GraphStatus> {
  try {
    return await post('/api/graph/login');
  } catch {
    return { ok: false, reason: 'Companion-serveren svarer ikke' };
  }
}

export async function graphDevice(): Promise<{ ok: boolean; device: GraphDevice | null }> {
  try {
    const res = await fetch(`${BASE}/api/graph/device`, { signal: AbortSignal.timeout(2000) });
    return (await res.json()) as { ok: boolean; device: GraphDevice | null };
  } catch {
    return { ok: false, device: null };
  }
}

export async function graphLogout(): Promise<{ ok: boolean }> {
  try {
    return await post('/api/graph/logout');
  } catch {
    return { ok: false };
  }
}

export interface GraphTodo {
  id: string;
  list: string;
  title: string;
  importance: string;
  dueDate: string | null;
}

export interface GraphEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  location: string;
  isOnlineMeeting: boolean;
  onlineMeetingUrl: string | null;
}

export async function graphTodos(): Promise<{ ok: boolean; items?: GraphTodo[]; reason?: string }> {
  try {
    const res = await fetch(`${BASE}/api/graph/todos`, { signal: AbortSignal.timeout(15000) });
    return (await res.json()) as { ok: boolean; items?: GraphTodo[]; reason?: string };
  } catch {
    return { ok: false, reason: 'Companion-serveren svarer ikke' };
  }
}

export async function graphEvents(): Promise<{ ok: boolean; items?: GraphEvent[]; reason?: string }> {
  try {
    const res = await fetch(`${BASE}/api/graph/events`, { signal: AbortSignal.timeout(15000) });
    return (await res.json()) as { ok: boolean; items?: GraphEvent[]; reason?: string };
  } catch {
    return { ok: false, reason: 'Companion-serveren svarer ikke' };
  }
}

// ---------------- Synkronisering ----------------
export interface SyncSnapshotPayload {
  tasks: unknown[];
  projects: unknown[];
  sprints: unknown[];
  users: unknown[];
  labels: unknown[];
  activity: unknown[];
  updatedAt: string;
}

export interface PresenceEntry {
  name: string;
  since: string;
}

export async function syncPush(
  clientId: string,
  user: { id: string; name: string },
  snapshot: SyncSnapshotPayload,
): Promise<{ ok: boolean; updatedAt?: string }> {
  try {
    return await post('/api/sync/push', { clientId, user, snapshot });
  } catch {
    return { ok: false };
  }
}

export async function syncPull(): Promise<{ ok: boolean; snapshot?: SyncSnapshotPayload; updatedAt?: string } | null> {
  try {
    const res = await fetch(`${BASE}/api/sync/state`, { headers: authHeaders(), signal: AbortSignal.timeout(4000) });
    return (await res.json()) as { ok: boolean; snapshot?: SyncSnapshotPayload; updatedAt?: string };
  } catch {
    return null;
  }
}

export async function getPresence(): Promise<PresenceEntry[]> {
  try {
    const res = await fetch(`${BASE}/api/presence`, { signal: AbortSignal.timeout(2000) });
    const data = (await res.json()) as { ok: boolean; online?: PresenceEntry[] };
    return data.online ?? [];
  } catch {
    return [];
  }
}

// ---------------- Påmindelser & rapporter ----------------
export interface ReminderResult {
  ok: boolean;
  title?: string;
  lines?: string[];
  openCount?: number;
  reason?: string;
}

export async function runRemindersNow(): Promise<ReminderResult> {
  try {
    return await post('/api/reminders/run-now');
  } catch {
    return { ok: false, reason: 'Companion-serveren svarer ikke' };
  }
}

export async function runReportNow(): Promise<{ ok: boolean; path?: string; reason?: string }> {
  try {
    return await post('/api/reports/run-now');
  } catch {
    return { ok: false, reason: 'Companion-serveren svarer ikke' };
  }
}

// ---------------- AI-assistent ----------------
export async function aiComplete(
  messages: { role: 'system' | 'user'; content: string }[],
): Promise<{ ok: boolean; content?: string; reason?: string }> {
  try {
    return await post('/api/ai/complete', { messages });
  } catch {
    return { ok: false, reason: 'Companion-serveren svarer ikke' };
  }
}

// ---------------- Graph: mails & Planner ----------------
export interface GraphMessage {
  id: string;
  subject: string;
  from: string;
  received: string;
  snippet: string;
  webLink: string | null;
}

export async function graphMessages(): Promise<{ ok: boolean; items?: GraphMessage[]; reason?: string }> {
  try {
    const res = await fetch(`${BASE}/api/graph/messages`, { signal: AbortSignal.timeout(15000) });
    return (await res.json()) as { ok: boolean; items?: GraphMessage[]; reason?: string };
  } catch {
    return { ok: false, reason: 'Companion-serveren svarer ikke' };
  }
}

export interface GraphPlannerTask {
  id: string;
  title: string;
  dueDate: string | null;
  percentComplete: number;
}

export async function graphPlannerTasks(): Promise<{ ok: boolean; items?: GraphPlannerTask[]; reason?: string }> {
  try {
    const res = await fetch(`${BASE}/api/graph/planner`, { signal: AbortSignal.timeout(15000) });
    return (await res.json()) as { ok: boolean; items?: GraphPlannerTask[]; reason?: string };
  } catch {
    return { ok: false, reason: 'Companion-serveren svarer ikke' };
  }
}

// ---------------- Backup ----------------
export interface BackupFile {
  name: string;
  size: number;
  mtime: string;
}

export async function createBackup(): Promise<{ ok: boolean; path?: string; count?: number; reason?: string }> {
  try {
    return await post('/api/backup/now');
  } catch {
    return { ok: false, reason: 'Companion-serveren svarer ikke' };
  }
}

export async function listBackups(): Promise<{ ok: boolean; files?: BackupFile[]; reason?: string }> {
  try {
    const res = await fetch(`${BASE}/api/backup/list`, { headers: authHeaders(), signal: AbortSignal.timeout(4000) });
    return (await res.json()) as { ok: boolean; files?: BackupFile[]; reason?: string };
  } catch {
    return { ok: false };
  }
}

export async function restoreBackup(
  name: string,
): Promise<{ ok: boolean; snapshot?: SyncSnapshotPayload; reason?: string }> {
  try {
    return await post('/api/backup/restore', { name });
  } catch {
    return { ok: false, reason: 'Companion-serveren svarer ikke' };
  }
}

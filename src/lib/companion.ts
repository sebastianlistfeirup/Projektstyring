// Klient-API til Orbit Companion (lokal server på 127.0.0.1:4310)
const BASE = 'http://127.0.0.1:4310';

export interface CompanionStatus {
  ok: boolean;
  uptime?: number;
  clients?: number;
  teamsConfigured?: boolean;
  graphConfigured?: boolean;
  graphConnected?: boolean;
  graphAccount?: string | null;
  exportDir?: string;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

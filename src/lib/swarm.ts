import { create } from 'zustand';
import { fetchAiServices, type AiServiceInfo } from './aiApi';
import { companionBase, companionWsUrl } from './companion';

/* ---------- typer ---------- */

export interface SwarmSubagent {
  subId: string;
  name: string;
  status: 'running' | 'done';
  startedAt: number;
  finishedAt: number | null;
  text: string;
}

export interface SwarmJob {
  id: string;
  title: string;
  serviceId: string | null;
  phase: string;
  dependsOn: number[];
  description: string;
  status: 'queued' | 'running' | 'done' | 'error';
  liveText: string;
  notes: string[];
  deltaCount: number;
  lastDeltaAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  text: string;
  artifacts: { kind: string; name: string; mime: string; url?: string }[];
  error: string | null;
  subagents?: SwarmSubagent[];
}

export interface SwarmRun {
  runId: string;
  goal: string;
  startedAt: number;
  orchestratorId: string | null;
  mode: string | null;
  status: 'running' | 'done' | 'error';
  jobs: SwarmJob[];
  notes: string[];
  finishedAt: number | null;
}

interface SwarmStore {
  connected: boolean;
  run: SwarmRun | null;
  services: Record<string, AiServiceInfo> | null;
  setConnected: (v: boolean) => void;
  setRun: (r: SwarmRun | null) => void;
  apply: (evt: Record<string, unknown>) => void;
  refreshServices: () => Promise<void>;
}

/* ---------- tilstand ---------- */

export const useSwarm = create<SwarmStore>()((set, get) => ({
  connected: false,
  run: null,
  services: null,
  setConnected: (v) => set({ connected: v }),
  setRun: (r) => set({ run: r }),
  refreshServices: async () => {
    const s = await fetchAiServices();
    set({ services: s?.services ?? null });
  },
  apply: (evt) => {
    const cur = get().run;
    switch (evt.type) {
      case 'run_start':
        set({
          run: {
            runId: String(evt.runId ?? ''),
            goal: String(evt.goal ?? ''),
            startedAt: Date.parse(String(evt.startedAt ?? '')) || Date.now(),
            orchestratorId: null,
            mode: null,
            status: 'running',
            jobs: [],
            notes: [],
            finishedAt: null,
          },
        });
        break;
      case 'orchestrator':
        if (cur) set({ run: { ...cur, orchestratorId: (evt.serviceId as string) ?? null, mode: String(evt.mode ?? '') } });
        break;
      case 'plan': {
        if (!cur) break;
        const jobs = (evt.jobs as SwarmJob[] | undefined) ?? [];
        set({
          run: {
            ...cur,
            jobs: jobs.map((j) => ({
              ...j,
              status: 'queued' as const,
              liveText: '',
              notes: [],
              deltaCount: 0,
              lastDeltaAt: null,
              startedAt: null,
              finishedAt: null,
              text: '',
              artifacts: [],
              error: null,
              subagents: [],
            })),
          },
        });
        break;
      }
      case 'job_start': {
        if (!cur) break;
        const job = evt.job as { id: string } | undefined;
        set({
          run: {
            ...cur,
            jobs: cur.jobs.map((j) => (j.id === job?.id ? { ...j, status: 'running' as const, startedAt: Date.now() } : j)),
          },
        });
        break;
      }
      case 'job_delta': {
        if (!cur) break;
        const id = String(evt.jobId ?? '');
        set({
          run: {
            ...cur,
            jobs: cur.jobs.map((j) =>
              j.id === id
                ? {
                    ...j,
                    deltaCount: j.deltaCount + 1,
                    liveText: (j.liveText + String(evt.delta ?? '')).slice(-400),
                    lastDeltaAt: Date.now(),
                  }
                : j,
            ),
          },
        });
        break;
      }
      case 'subagent_start': {
        if (!cur) break;
        const sid = String(evt.subId ?? '');
        set({
          run: {
            ...cur,
            jobs: cur.jobs.map((j) =>
              j.id === String(evt.jobId ?? '')
                ? {
                    ...j,
                    subagents: [
                      ...(j.subagents ?? []).filter((s) => s.subId !== sid),
                      { subId: sid, name: String(evt.name ?? 'Underagent'), status: 'running' as const, startedAt: Date.now(), finishedAt: null, text: '' },
                    ],
                  }
                : j,
            ),
          },
        });
        break;
      }
      case 'subagent_done': {
        if (!cur) break;
        const sid = String(evt.subId ?? '');
        set({
          run: {
            ...cur,
            jobs: cur.jobs.map((j) =>
              j.id === String(evt.jobId ?? '')
                ? {
                    ...j,
                    subagents: (j.subagents ?? []).map((s) =>
                      s.subId === sid
                        ? { ...s, status: 'done' as const, text: String(evt.text ?? '').slice(0, 400), finishedAt: Date.now() }
                        : s,
                    ),
                  }
                : j,
            ),
          },
        });
        break;
      }
      case 'job_status':
      case 'job_note': {
        if (!cur) break;
        const id = evt.jobId ? String(evt.jobId) : null;
        const note = String(evt.status ?? evt.note ?? '');
        if (!id) {
          set({ run: { ...cur, notes: [...cur.notes.slice(-4), note] } });
        } else {
          set({
            run: {
              ...cur,
              jobs: cur.jobs.map((j) => (j.id === id ? { ...j, notes: [...j.notes.slice(-3), note] } : j)),
            },
          });
        }
        break;
      }
      case 'job_done': {
        if (!cur) break;
        const r = evt.result as { jobId: string; text: string; artifacts?: SwarmJob['artifacts'] } | undefined;
        if (!r) break;
        set({
          run: {
            ...cur,
            jobs: cur.jobs.map((j) =>
              j.id === r.jobId
                ? { ...j, status: 'done' as const, text: String(r.text ?? '').slice(0, 2000), artifacts: r.artifacts ?? [], finishedAt: Date.now() }
                : j,
            ),
          },
        });
        break;
      }
      case 'job_error': {
        if (!cur) break;
        const id = String(evt.jobId ?? '');
        set({
          run: {
            ...cur,
            jobs: cur.jobs.map((j) =>
              j.id === id ? { ...j, status: 'error' as const, error: String(evt.error ?? ''), finishedAt: Date.now() } : j,
            ),
          },
        });
        break;
      }
      case 'done':
        if (cur) set({ run: { ...cur, status: 'done', finishedAt: Date.now() } });
        break;
      case 'error':
        if (cur && evt.runId) set({ run: { ...cur, status: 'error', finishedAt: Date.now() } });
        break;
      default:
        break;
    }
  },
}));

/* ---------- WebSocket-forbindelse ---------- */

const WS_URL = companionWsUrl();
const API = companionBase();
let ws: WebSocket | null = null;
let retry = 0;
let started = false;

async function syncState() {
  try {
    const r = await fetch(`${API}/api/ai/swarm`);
    const j = await r.json();
    if (j?.ok) useSwarm.getState().setRun(j.run ?? null);
  } catch { /* companion offline */ }
}

export function connectSwarm(): void {
  if (started) return;
  started = true;
  const connect = () => {
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      retry = 0;
      useSwarm.getState().setConnected(true);
      void syncState();
      void useSwarm.getState().refreshServices();
    };
    ws.onmessage = (m) => {
      try {
        const obj = JSON.parse(String(m.data));
        if (obj?.type === 'ai') useSwarm.getState().apply(obj);
      } catch { /* ignorer ikke-JSON */ }
    };
    ws.onclose = () => {
      useSwarm.getState().setConnected(false);
      scheduleReconnect();
    };
    ws.onerror = () => ws?.close();
  };
  const scheduleReconnect = () => {
    const delay = Math.min(15000, 1500 * 2 ** retry++);
    setTimeout(connect, delay);
  };
  connect();
  // Fallback-sync, så visningen også opdaterer uden WS (fx ældre companion).
  setInterval(() => { void syncState(); }, 5000);
}

/* ---------- hjælpere ---------- */

export function serviceColor(services: Record<string, AiServiceInfo> | null, id: string | null): string {
  return (id && services?.[id]?.color) || 'slate';
}

export function serviceName(services: Record<string, AiServiceInfo> | null, id: string | null): string {
  return (id && services?.[id]?.name) || id || '—';
}

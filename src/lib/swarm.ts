import { create } from 'zustand';
import { fetchAiServices, type AiServiceInfo } from './aiApi';

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
  team?: boolean;
}

export interface SwarmRun {
  runId: string;
  goal: string;
  mode?: string;
  startedAt: number;
  orchestratorId: string | null;
  status: 'running' | 'done' | 'error';
  jobs: SwarmJob[];
  notes: string[];
  instructions?: string[];
  finishedAt: number | null;
}

export interface SwarmApproval {
  runId: string;
  jobs: SwarmJob[];
}

interface SwarmStore {
  connected: boolean;
  run: SwarmRun | null;
  services: Record<string, AiServiceInfo> | null;
  approval: SwarmApproval | null;
  setConnected: (v: boolean) => void;
  setRun: (r: SwarmRun | null) => void;
  setApproval: (a: SwarmApproval | null) => void;
  apply: (evt: Record<string, unknown>) => void;
  refreshServices: () => Promise<void>;
}

/* ---------- notifikationer: blip + browser-notifikation ved job-hændelser ---------- */

let audioCtx: AudioContext | null = null;

function notifySound(kind: 'done' | 'error' | 'start'): void {
  if (localStorage.getItem('swarm-sound') === 'off') return;
  try {
    audioCtx = audioCtx ?? new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime;
    const freq = kind === 'error' ? 220 : kind === 'start' ? 520 : 740;
    osc.type = kind === 'error' ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(freq, now);
    if (kind === 'done') osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.12);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'error' ? 0.5 : 0.25));
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.6);
  } catch { /* lyd er ikke kritisk */ }
}

function maybeNotify(kind: 'done' | 'error' | 'start', title: string, body: string): void {
  notifySound(kind);
  // Titel-badge, så man kan se i fanen, at sværmen har brug for opmærksomhed.
  if (kind !== 'start') flashTitle(kind === 'error' ? '⚠ AI-swarm' : '✓ AI-swarm');
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
    try { new Notification(title, { body: body.slice(0, 140) }); } catch { /* */ }
  }
}

let titleTimer: number | null = null;
function flashTitle(prefix: string): void {
  if (titleTimer) window.clearInterval(titleTimer);
  const original = document.title;
  let on = false;
  titleTimer = window.setInterval(() => {
    document.title = on ? original : prefix;
    on = !on;
  }, 1200);
  window.setTimeout(() => {
    if (titleTimer) window.clearInterval(titleTimer);
    titleTimer = null;
    document.title = original;
  }, 8000);
}

export function requestNotifyPermission(): void {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

/* ---------- tilstand ---------- */

export const useSwarm = create<SwarmStore>()((set, get) => ({
  connected: false,
  run: null,
  services: null,
  approval: null,
  setConnected: (v) => set({ connected: v }),
  setRun: (r) => set({ run: r }),
  setApproval: (a) => set({ approval: a }),
  refreshServices: async () => {
    const s = await fetchAiServices();
    set({ services: s?.services ?? null });
  },
  apply: (evt) => {
    const cur = get().run;
    switch (evt.type) {
      case 'run_start':
        requestNotifyPermission();
        maybeNotify('start', 'AI-swarm', String(evt.goal ?? ''));
        set({
          run: {
            runId: String(evt.runId ?? ''),
            goal: String(evt.goal ?? ''),
            mode: String(evt.mode ?? 'standard'),
            startedAt: Date.parse(String(evt.startedAt ?? '')) || Date.now(),
            orchestratorId: null,
            status: 'running',
            jobs: [],
            notes: [],
            instructions: [],
            finishedAt: null,
          },
        });
        break;
      case 'orchestrator':
        if (cur) set({ run: { ...cur, orchestratorId: (evt.serviceId as string) ?? null } });
        break;
      case 'plan': {
        if (!cur) break;
        const jobs = (evt.jobs as SwarmJob[] | undefined) ?? [];
        const mapped = jobs.map((j) => ({
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
        }));
        // Godkendelsespause: planen afventer brugerens godkendelse/redigering.
        if (evt.paused) {
          set({ run: { ...cur, jobs: mapped }, approval: { runId: cur.runId, jobs: mapped } });
        } else {
          set({ run: { ...cur, jobs: mapped }, approval: null });
        }
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
      case 'subagent_delta': {
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
                      s.subId === sid ? { ...s, text: (s.text + String(evt.delta ?? '')).slice(-300) } : s,
                    ),
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
      case 'job_healing': {
        if (!cur) break;
        const id = String(evt.jobId ?? '');
        set({
          run: {
            ...cur,
            jobs: cur.jobs.map((j) =>
              j.id === id
                ? { ...j, status: 'running' as const, notes: [...j.notes.slice(-3), `Selvhealing (${String(evt.attempt ?? 2)}. forsøg)`] }
                : j,
            ),
          },
        });
        break;
      }
      case 'job_skipped': {
        if (!cur) break;
        const id = String(evt.jobId ?? '');
        set({
          run: {
            ...cur,
            jobs: cur.jobs.map((j) =>
              j.id === id ? { ...j, status: 'done' as const, text: '(sprunget over)', finishedAt: Date.now() } : j,
            ),
          },
        });
        break;
      }
      case 'job_done': {
        if (!cur) break;
        const r = evt.result as { jobId: string; title?: string; text: string; artifacts?: SwarmJob['artifacts'] } | undefined;
        if (!r) break;
        maybeNotify('done', 'AI-job færdigt', r.title ?? cur.goal);
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
        const job = cur.jobs.find((j) => j.id === id);
        maybeNotify('error', 'AI-job slog fejl', job?.title ?? String(evt.error ?? ''));
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
        if (cur) {
          maybeNotify('done', 'AI-kørsel færdig', cur.goal);
          set({ run: { ...cur, status: 'done', finishedAt: Date.now() } });
        }
        break;
      case 'error':
        if (cur && evt.runId) {
          maybeNotify('error', 'AI-kørsel slog fejl', String(evt.error ?? cur.goal));
          set({ run: { ...cur, status: 'error', finishedAt: Date.now() } });
        }
        break;
      default:
        break;
    }
  },
}));

/* ---------- WebSocket-forbindelse ---------- */

const WS_URL = 'ws://127.0.0.1:4310/ws';
const API = 'http://127.0.0.1:4310';
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
        // Serveren sender AI-hændelser med kind:'ai' (obj.type er hændelsestypen).
        if (obj?.kind === 'ai' || obj?.type === 'ai') useSwarm.getState().apply(obj);
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

export function toggleSwarmSound(): boolean {
  const cur = localStorage.getItem('swarm-sound') !== 'off';
  localStorage.setItem('swarm-sound', cur ? 'off' : 'on');
  return !cur;
}

export function swarmSoundOn(): boolean {
  return localStorage.getItem('swarm-sound') !== 'off';
}

/* ---------- replay: genbyg en kørsel fra hændelsesloggen (idé 19) ---------- */

export interface SwarmEvent {
  at: number;
  type: string;
  [key: string]: unknown;
}

function applyEventPure(run: SwarmRun, evt: Record<string, unknown>): SwarmRun {
  switch (evt.type) {
    case 'run_start':
      return {
        ...run,
        startedAt: Number(evt.at) || Date.parse(String(evt.startedAt ?? '')) || Date.now(),
        status: 'running',
        jobs: [],
        notes: [],
        finishedAt: null,
      };
    case 'orchestrator':
      return { ...run, orchestratorId: (evt.serviceId as string) ?? null };
    case 'plan':
      return {
        ...run,
        jobs: ((evt.jobs as SwarmJob[] | undefined) ?? []).map((j) => ({
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
      };
    case 'job_start': {
      const job = evt.job as { id: string } | undefined;
      return { ...run, jobs: run.jobs.map((j) => (j.id === job?.id ? { ...j, status: 'running' as const, startedAt: Number(evt.at) } : j)) };
    }
    case 'job_note':
    case 'job_status': {
      const id = evt.jobId ? String(evt.jobId) : null;
      const note = String(evt.status ?? evt.note ?? '');
      if (!id) return { ...run, notes: [...run.notes.slice(-4), note] };
      return { ...run, jobs: run.jobs.map((j) => (j.id === id ? { ...j, notes: [...j.notes.slice(-3), note] } : j)) };
    }
    case 'subagent_start': {
      const sid = String(evt.subId ?? '');
      return {
        ...run,
        jobs: run.jobs.map((j) =>
          j.id === String(evt.jobId ?? '')
            ? {
                ...j,
                subagents: [
                  ...(j.subagents ?? []).filter((x) => x.subId !== sid),
                  { subId: sid, name: String(evt.name ?? 'Underagent'), status: 'running' as const, startedAt: Number(evt.at), finishedAt: null, text: '' },
                ],
              }
            : j,
        ),
      };
    }
    case 'subagent_done': {
      const sid = String(evt.subId ?? '');
      return {
        ...run,
        jobs: run.jobs.map((j) =>
          j.id === String(evt.jobId ?? '')
            ? {
                ...j,
                subagents: (j.subagents ?? []).map((x) =>
                  x.subId === sid ? { ...x, status: 'done' as const, text: String(evt.text ?? '').slice(0, 400), finishedAt: Number(evt.at) } : x,
                ),
              }
            : j,
        ),
      };
    }
    case 'job_skipped':
      return {
        ...run,
        jobs: run.jobs.map((j) => (j.id === String(evt.jobId ?? '') ? { ...j, status: 'done' as const, text: '(sprunget over)', finishedAt: Number(evt.at) } : j)),
      };
    case 'job_done': {
      const r = evt.result as { jobId: string; text: string; artifacts?: SwarmJob['artifacts'] } | undefined;
      if (!r) return run;
      return {
        ...run,
        jobs: run.jobs.map((j) =>
          j.id === r.jobId
            ? { ...j, status: 'done' as const, text: String(r.text ?? '').slice(0, 2000), artifacts: r.artifacts ?? [], finishedAt: Number(evt.at) }
            : j,
        ),
      };
    }
    case 'job_error':
      return {
        ...run,
        jobs: run.jobs.map((j) =>
          j.id === String(evt.jobId ?? '') ? { ...j, status: 'error' as const, error: String(evt.error ?? ''), finishedAt: Number(evt.at) } : j,
        ),
      };
    case 'done':
      return { ...run, status: 'done', finishedAt: Number(evt.at) };
    case 'error':
      return { ...run, status: 'error', finishedAt: Number(evt.at) };
    default:
      return run;
  }
}

/** Genbygger kørselstilstanden fra en hændelseslog op til et tidsstempel (bruges til replay/simulering). */
export function replayEvents(base: SwarmRun, events: SwarmEvent[], upTo: number): SwarmRun {
  let run: SwarmRun = { ...base, jobs: base.jobs.map((j) => ({ ...j, subagents: (j.subagents ?? []).map((x) => ({ ...x })) })) };
  const sorted = [...events].sort((a, b) => a.at - b.at);
  for (const evt of sorted) {
    if (evt.at > upTo) break;
    run = applyEventPure(run, evt);
  }
  if (upTo >= (sorted[sorted.length - 1]?.at ?? Infinity) && run.status === 'running') {
    run = { ...run, status: base.status === 'error' ? 'error' : 'done', finishedAt: sorted[sorted.length - 1]?.at ?? base.finishedAt };
  }
  return run;
}

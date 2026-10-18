import { create } from 'zustand';

export interface SwarmJob {
  jobId: string;
  serviceId: string;
  phase: string;
  role: string;
  title: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  note?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface SwarmRun {
  runId: string;
  projectId: string;
  pipeline: string;
  orchestrator?: string;
  jobs: Record<string, SwarmJob>;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  endedAt?: number;
}

interface SwarmState {
  connected: boolean;
  active: SwarmRun | null;
  last: SwarmRun | null;
  services: Record<string, { id: string; name: string; color: string; kind: string }> | null;
  setConnected: (v: boolean) => void;
  apply: (msg: any) => void;
  setState: (s: { active: SwarmRun | null; last: SwarmRun | null }) => void;
  setServices: (s: SwarmState['services']) => void;
}

function cloneRun(run: SwarmRun | null): SwarmRun | null {
  if (!run) return null;
  return { ...run, jobs: { ...run.jobs } };
}

export const useSwarm = create<SwarmState>((set) => ({
  connected: false,
  active: null,
  last: null,
  services: null,
  setConnected: (v) => set({ connected: v }),
  setState: (s) => set({ active: s.active, last: s.last }),
  setServices: (s) => set({ services: s }),
  apply: (msg) =>
    set((state) => {
      const d = msg?.data ?? msg;
      if (!d || typeof d !== 'object') return state;
      const type = d.type as string;
      const target = (state.active && state.active.runId === d.runId) ? cloneRun(state.active) : null;
      const run = target ?? (d.runId ? {
        runId: d.runId,
        projectId: d.projectId || '',
        pipeline: d.pipeline || '',
        jobs: {},
        status: 'running' as const,
        startedAt: Date.now(),
      } : null);
      if (!run) return state;

      const upsert = (job: Partial<SwarmJob> & { jobId: string }) => {
        run.jobs[job.jobId] = { ...run.jobs[job.jobId], ...job } as SwarmJob;
      };

      switch (type) {
        case 'run_start':
          run.pipeline = d.pipeline || run.pipeline;
          run.projectId = d.projectId || run.projectId;
          run.status = 'running';
          run.startedAt = d.startedAt || Date.now();
          break;
        case 'orchestrator':
          run.orchestrator = d.serviceId;
          break;
        case 'plan':
          for (const j of d.jobs || []) {
            upsert({ jobId: j.jobId, serviceId: j.serviceId, phase: j.phase, role: j.role, title: j.title, status: 'queued', progress: 0 });
          }
          break;
        case 'job_start':
          upsert({ jobId: d.jobId, serviceId: d.serviceId, phase: d.phase, role: d.role, title: d.title, status: 'running', progress: 0, startedAt: Date.now() });
          break;
        case 'job_delta':
          if (run.jobs[d.jobId]) {
            run.jobs[d.jobId].progress = Math.min(99, (run.jobs[d.jobId].progress || 0) + (d.delta || 1));
            if (d.note) run.jobs[d.jobId].note = d.note;
          }
          break;
        case 'job_status':
          if (run.jobs[d.jobId]) {
            run.jobs[d.jobId].status = d.status;
            if (d.note) run.jobs[d.jobId].note = d.note;
            if (d.status === 'done' || d.status === 'error') {
              run.jobs[d.jobId].progress = d.status === 'done' ? 100 : run.jobs[d.jobId].progress;
              run.jobs[d.jobId].endedAt = Date.now();
            }
          }
          break;
        case 'job_note':
          if (run.jobs[d.jobId]) run.jobs[d.jobId].note = d.note;
          break;
        case 'job_done':
          upsert({ jobId: d.jobId, status: 'done', progress: 100, endedAt: Date.now(), note: d.note });
          break;
        case 'job_error':
          upsert({ jobId: d.jobId, status: 'error', note: d.error || d.note, endedAt: Date.now() });
          break;
        case 'done':
          run.status = 'done';
          run.endedAt = Date.now();
          break;
        case 'error':
          run.status = 'error';
          run.endedAt = Date.now();
          break;
        default:
          return state;
      }

      const isActive = run.status === 'running';
      return { active: isActive ? run : null, last: isActive ? state.last : run };
    }),
}));

let ws: WebSocket | null = null;
let retry = 0;
let syncTimer: number | null = null;

function syncState() {
  fetch('http://127.0.0.1:4310/api/ai/swarm')
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => { if (s) useSwarm.getState().setState(s); })
    .catch(() => {});
  fetch('http://127.0.0.1:4310/api/ai/services')
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => { if (s) useSwarm.getState().setServices(s); })
    .catch(() => {});
}

function refreshServices() {
  fetch('http://127.0.0.1:4310/api/ai/services')
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => { if (s) useSwarm.getState().setServices(s); })
    .catch(() => {});
}

export function connectSwarm() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket('ws://127.0.0.1:4310/ws');
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    retry = 0;
    useSwarm.getState().setConnected(true);
    syncState();
    refreshServices();
    if (syncTimer) window.clearInterval(syncTimer);
    syncTimer = window.setInterval(syncState, 5000);
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'ai') useSwarm.getState().apply(msg);
    } catch { /* ignore malformed */ }
  };
  ws.onclose = () => {
    useSwarm.getState().setConnected(false);
    if (syncTimer) { window.clearInterval(syncTimer); syncTimer = null; }
    scheduleReconnect();
  };
  ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
}

function scheduleReconnect() {
  const delay = Math.min(15000, 1500 * 2 ** retry);
  retry += 1;
  window.setTimeout(connectSwarm, delay);
}

export function serviceColor(id: string | undefined): string {
  const services = useSwarm.getState().services;
  return (id && services?.[id]?.color) || 'slate';
}

export function serviceName(id: string | undefined): string {
  const services = useSwarm.getState().services;
  return (id && services?.[id]?.name) || id || '—';
}

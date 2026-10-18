import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Cpu,
  History,
  Radio,
  Zap,
} from 'lucide-react';
import { useLang, t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { connectSwarm, useSwarm, serviceColor, serviceName, type SwarmJob, type SwarmRun } from '../lib/swarm';
import type { AiServiceInfo } from '../lib/aiApi';

const BASE_URL = 'http://127.0.0.1:4310';
const PHASES = ['concept', 'design', 'prototype', 'production', 'testing', 'polish', 'release'];

const SERVICE_HEX: Record<string, string> = {
  emerald: '#34d399',
  amber: '#fbbf24',
  indigo: '#818cf8',
  sky: '#38bdf8',
  slate: '#94a3b8',
  teal: '#2dd4bf',
  rose: '#fb7185',
  violet: '#a78bfa',
  cyan: '#22d3ee',
  orange: '#fb923c',
};

function hex(color: string | null | undefined): string {
  return SERVICE_HEX[color ?? 'slate'] ?? SERVICE_HEX.slate;
}

function fmtDur(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}t ${m % 60}m`;
}

/* ================= canvas-sværmen ================= */

interface NodePos { x: number; y: number; tx: number; ty: number; seed: number; }

function SwarmCanvas({ run, services, active }: {
  run: SwarmRun | null;
  services: Record<string, AiServiceInfo> | null;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Map<string, NodePos>>(new Map());
  const particlesRef = useRef<{ x: number; y: number; tx: number; ty: number; color: string; speed: number }[]>([]);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let frame = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const dark = () => document.documentElement.classList.contains('dark');

    const nodeFor = (id: string, nx: number, ny: number): NodePos => {
      const m = nodesRef.current;
      let n = m.get(id);
      if (!n) {
        n = { x: nx, y: ny, tx: nx, ty: ny, seed: Math.random() * 1000 };
        m.set(id, n);
      }
      n.tx = nx; n.ty = ny;
      return n;
    };

    const draw = () => {
      frame++;
      const r = runRef.current;
      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      const cx = W / 2;
      const cy = H / 2 - 10;
      ctx.clearRect(0, 0, W, H);
      const ink = dark() ? 'rgba(255,255,255,' : 'rgba(15,23,42,';
      const tNow = Date.now();

      // baggrunds-prikgitter
      ctx.fillStyle = `${ink}0.05)`;
      for (let gx = 20; gx < W; gx += 42) {
        for (let gy = 20; gy < H; gy += 42) {
          ctx.fillRect(gx, gy, 1.5, 1.5);
        }
      }

      if (!r || r.jobs.length === 0) {
        // Idle: sovende tjenester der langsomt driver
        const list = services ? Object.values(services).filter((s) => s.available) : [];
        list.slice(0, 10).forEach((s, i) => {
          const ang = (i / Math.max(1, list.length)) * Math.PI * 2 + frame * 0.0018;
          const rad = Math.min(W, H) * 0.26;
          const nx = cx + Math.cos(ang) * rad;
          const ny = cy + Math.sin(ang) * rad * 0.6 + Math.sin(frame * 0.02 + i) * 4;
          const n = nodeFor(`idle-${s.id}`, nx, ny);
          n.x += (n.tx - n.x) * 0.03;
          n.y += (n.ty - n.y) * 0.03;
          const c = hex(s.color);
          const breathe = 0.5 + Math.sin(frame * 0.03 + i * 1.7) * 0.18;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 10, 0, Math.PI * 2);
          ctx.fillStyle = c + '33';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(n.x, n.y, 4, 0, Math.PI * 2);
          ctx.globalAlpha = breathe;
          ctx.fillStyle = c;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = `${ink}0.45)`;
          ctx.fillText(s.name, n.x, n.y + 22);
        });
        raf = requestAnimationFrame(draw);
        return;
      }

      const jobs = r.jobs;
      const running = jobs.filter((j) => j.status === 'running');
      const queued = jobs.filter((j) => j.status === 'queued');
      const done = jobs.filter((j) => j.status === 'done');

      // mål-positioner efter status
      const target = new Map<string, { x: number; y: number }>();
      const R = Math.min(W, H) * 0.3;
      running.forEach((j, i) => {
        const ang = -Math.PI / 2 + (i - (running.length - 1) / 2) * 0.9;
        target.set(j.id, { x: cx + Math.cos(ang) * R * (running.length > 2 ? 1.15 : 0.85), y: cy + Math.sin(ang) * R * 0.72 });
      });
      queued.forEach((j, i) => {
        const spread = Math.min(64, (W - 120) / Math.max(1, queued.length));
        target.set(j.id, { x: cx + (i - (queued.length - 1) / 2) * spread, y: H - 34 });
      });
      done.forEach((j, i) => {
        target.set(j.id, { x: W - 64, y: 30 + i * 26 });
      });
      jobs.filter((j) => j.status === 'error').forEach((j) => {
        target.set(j.id, { x: 64, y: 30 + (target.size % 8) * 26 });
      });
      jobs.forEach((j) => { if (!target.has(j.id)) target.set(j.id, { x: cx, y: cy }); });

      // kanter: kørende → deres afhængigheder (levende striber)
      ctx.lineWidth = 1;
      jobs.forEach((j) => {
        if (j.status !== 'running') return;
        const to = nodeFor(j.id, target.get(j.id)!.x, target.get(j.id)!.y);
        const parents = (j.dependsOn ?? [])
          .map((d) => jobs[d])
          .filter((p): p is SwarmJob => Boolean(p));
        const src = parents.length ? parents : [];
        if (!src.length) {
          // fra orkestrator-kernen
          ctx.beginPath();
          ctx.setLineDash([4, 6]);
          ctx.lineDashOffset = -frame * 0.6;
          ctx.strokeStyle = `${ink}0.25)`;
          ctx.moveTo(cx, cy);
          ctx.quadraticCurveTo((cx + to.x) / 2, Math.min(cy, to.y) - 26, to.x, to.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        src.forEach((p) => {
          const pt = target.get(p.id);
          if (!pt) return;
          ctx.beginPath();
          ctx.setLineDash([4, 6]);
          ctx.lineDashOffset = -frame * 0.8;
          ctx.strokeStyle = hex(serviceColor(services, p.serviceId)) + '88';
          ctx.moveTo(pt.x, pt.y);
          ctx.quadraticCurveTo((pt.x + to.x) / 2, Math.min(pt.y, to.y) - 22, to.x, to.y);
          ctx.stroke();
          ctx.setLineDash([]);
        });
      });

      // partikler: data der strømmer ind i kørende noder
      if (active && frame % 7 === 0 && running.length) {
        const j = running[Math.floor(Math.random() * running.length)];
        const to = target.get(j.id)!;
        const parents = (j.dependsOn ?? []).map((d) => jobs[d]).filter(Boolean);
        const from = parents.length ? target.get(parents[Math.floor(Math.random() * parents.length)].id)! : { x: cx, y: cy };
        particlesRef.current.push({
          x: from.x, y: from.y, tx: to.x, ty: to.y,
          color: hex(serviceColor(services, j.serviceId)),
          speed: 0.015 + Math.random() * 0.02,
        });
      }
      particlesRef.current = particlesRef.current.filter((p) => {
        p.x += (p.tx - p.x) * p.speed;
        p.y += (p.ty - p.y) * p.speed;
        const arrived = Math.hypot(p.tx - p.x, p.ty - p.y) < 6;
        if (!arrived) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 6;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        return !arrived;
      });

      // orkestrator-kerne i midten
      const pulse = active ? 1 + Math.sin(frame * 0.08) * 0.12 : 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 13 * pulse, 0, Math.PI * 2);
      const coreGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
      coreGrad.addColorStop(0, 'rgba(129,140,248,0.85)');
      coreGrad.addColorStop(1, 'rgba(129,140,248,0)');
      ctx.fillStyle = coreGrad;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#818cf8';
      ctx.fill();
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = `${ink}0.5)`;
      ctx.fillText(serviceName(services, r.orchestratorId), cx, cy - 20);

      // noder
      jobs.forEach((j) => {
        const tg = target.get(j.id)!;
        const n = nodeFor(j.id, tg.x, tg.y);
        n.x += (n.tx - n.x) * 0.07;
        n.y += (n.ty - n.y) * 0.07;
        const c = hex(serviceColor(services, j.serviceId));

        if (j.status === 'running') {
          const beat = 1 + Math.sin(frame * 0.1 + n.seed) * 0.1;
          // halo
          const g = ctx.createRadialGradient(n.x, n.y, 2, n.x, n.y, 30 * beat);
          g.addColorStop(0, c + 'aa');
          g.addColorStop(1, c + '00');
          ctx.beginPath();
          ctx.arc(n.x, n.y, 30 * beat, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
          // kerne
          ctx.beginPath();
          ctx.arc(n.x, n.y, 13 * beat, 0, Math.PI * 2);
          ctx.fillStyle = c;
          ctx.shadowColor = c;
          ctx.shadowBlur = 16;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fill();
          // fremskridtsring: forløbet tid vs. gennemsnit
          const avg = avgJobMs(jobs);
          if (avg && j.startedAt) {
            const prog = Math.min(0.999, (tNow - j.startedAt) / avg);
            ctx.beginPath();
            ctx.arc(n.x, n.y, 19, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.75)';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          // omløbssmæk
          for (let k = 0; k < 3; k++) {
            const a = frame * 0.06 + n.seed + (k * Math.PI * 2) / 3;
            ctx.beginPath();
            ctx.arc(n.x + Math.cos(a) * 24, n.y + Math.sin(a) * 24, 2, 0, Math.PI * 2);
            ctx.fillStyle = c + 'cc';
            ctx.fill();
          }
          // aktivitetsstød ved delta
          if (j.lastDeltaAt && tNow - j.lastDeltaAt < 250) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, 34, 0, Math.PI * 2);
            ctx.strokeStyle = c + '55';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
          ctx.font = 'bold 10px sans-serif';
          ctx.fillStyle = `${ink}0.85)`;
          ctx.fillText(serviceName(services, j.serviceId), n.x, n.y + 38);
          ctx.font = '9px sans-serif';
          ctx.fillStyle = `${ink}0.45)`;
          ctx.fillText(j.title.length > 26 ? j.title.slice(0, 25) + '…' : j.title, n.x, n.y + 50);
        } else if (j.status === 'queued') {
          ctx.beginPath();
          ctx.arc(n.x, n.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = c + '2e';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(n.x, n.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = c + '99';
          ctx.fill();
          ctx.font = '8.5px sans-serif';
          ctx.fillStyle = `${ink}0.4)`;
          ctx.fillText(j.title.length > 18 ? j.title.slice(0, 17) + '…' : j.title, n.x, n.y + 16);
        } else if (j.status === 'done') {
          ctx.beginPath();
          ctx.arc(n.x, n.y, 7, 0, Math.PI * 2);
          ctx.fillStyle = '#34d399';
          ctx.globalAlpha = 0.9;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.moveTo(n.x - 3, n.y);
          ctx.lineTo(n.x - 0.5, n.y + 2.8);
          ctx.lineTo(n.x + 3.5, n.y - 2.5);
          ctx.strokeStyle = '#052e16';
          ctx.lineWidth = 1.8;
          ctx.stroke();
        } else if (j.status === 'error') {
          const blink = 0.5 + Math.sin(frame * 0.15) * 0.4;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(251,113,133,${blink})`;
          ctx.fill();
          ctx.font = '9px sans-serif';
          ctx.fillStyle = '#fb7185';
          ctx.fillText('!', n.x, n.y + 3);
        }
      });

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [services, active]);

  return <canvas ref={canvasRef} className="w-full h-full" aria-hidden />;
}

function avgJobMs(jobs: SwarmJob[]): number | null {
  const timed = jobs.filter((j) => j.status === 'done' && j.startedAt && j.finishedAt);
  if (!timed.length) return null;
  return timed.reduce((a, j) => a + (j.finishedAt! - j.startedAt!), 0) / timed.length;
}

/* ================= agent-kort ================= */

function JobCard({ j, services, runActive }: { j: SwarmJob; services: Record<string, AiServiceInfo> | null; runActive: boolean }) {
  const liveRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = liveRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [j.liveText, j.notes]);

  const color = hex(serviceColor(services, j.serviceId));
  const waiting = (j.dependsOn ?? [])
    .map((d) => ({ idx: d }))
    .length;

  return (
    <div
      className={cn(
        'relative rounded-2xl border overflow-hidden transition-all duration-500',
        j.status === 'running' && 'border-white/20 shadow-2xl',
        j.status === 'done' && 'border-emerald-400/20 opacity-90',
        j.status === 'queued' && 'border-white/8 opacity-55',
        j.status === 'error' && 'border-rose-400/40',
      )}
      style={j.status === 'running' ? { boxShadow: `0 0 42px -10px ${color}88` } : undefined}
    >
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div className="p-3 bg-black/15 dark:bg-black/30">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color, boxShadow: j.status === 'running' ? `0 0 10px 2px ${color}aa` : undefined }} />
          <span className="text-[12px] font-semibold flex-1 truncate">{serviceName(services, j.serviceId)}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-white/10 opacity-60">{t(`ai.phase.${j.phase}`) === `ai.phase.${j.phase}` ? j.phase : t(`ai.phase.${j.phase}`)}</span>
          {j.status === 'running' && <Activity size={12} className="text-emerald-400 animate-pulse" />}
          {j.status === 'done' && <CheckCircle2 size={12} className="text-emerald-400" />}
          {j.status === 'error' && <AlertTriangle size={12} className="text-rose-400" />}
          {j.status === 'queued' && <CircleDashed size={12} className="opacity-40" />}
        </div>
        <div className="text-[11px] opacity-70 mt-1 truncate">{j.title}</div>

        {j.status === 'running' && (
          <div className="mt-2 space-y-1.5">
            <div ref={liveRef} className="h-24 overflow-hidden rounded-lg bg-black/40 dark:bg-black/50 p-2 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap break-words text-emerald-100/90">
              {j.liveText.slice(-360) || '…'}
              {runActive && <span className="inline-block w-1.5 h-3 ml-0.5 bg-emerald-300 animate-pulse" />}
              {j.notes.slice(-1).map((n, i) => (
                <div key={i} className="text-sky-300/80 italic mt-1">_{n}_</div>
              ))}
            </div>
            <div className="flex items-center justify-between text-[9.5px] opacity-50">
              <span>{j.deltaCount.toLocaleString('da-DK')} {t('swarm.activity')}</span>
              <span className="flex items-center gap-1"><Clock size={9} /> {fmtDur(Date.now() - (j.startedAt ?? Date.now()))}</span>
            </div>
          </div>
        )}

        {j.status === 'done' && (
          <div className="mt-2 space-y-1.5">
            <p className="text-[10.5px] leading-relaxed opacity-70 line-clamp-4">{j.text.slice(0, 420)}</p>
            {(j.artifacts?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {j.artifacts!.map((a, i) => (
                  <a key={i} href={a.url?.startsWith('/') ? `${BASE_URL}${a.url}` : a.url} target="_blank" rel="noreferrer">
                    {a.kind === 'image' ? (
                      <img src={a.url?.startsWith('/') ? `${BASE_URL}${a.url}` : a.url} alt={a.name} className="h-12 w-12 rounded-lg object-cover border border-white/10" />
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 truncate max-w-[110px]">{a.name}</span>
                    )}
                  </a>
                ))}
              </div>
            )}
            <div className="text-[9.5px] opacity-40 flex items-center gap-1"><Clock size={9} /> {fmtDur(j.startedAt && j.finishedAt ? j.finishedAt - j.startedAt : null)}</div>
          </div>
        )}

        {j.status === 'queued' && (
          <p className="mt-2 text-[10px] opacity-45">
            {waiting > 0 ? t('swarm.waitingOn').replace('{n}', String(waiting)) : t('ai.status.queued')}
          </p>
        )}

        {j.status === 'error' && (
          <p className="mt-2 text-[10.5px] text-rose-300/90 leading-relaxed">{j.error}</p>
        )}
      </div>
    </div>
  );
}

/* ================= hovedvisning ================= */

interface RunSummary { file: string; runId: string; goal: string; finishedAt?: string; results?: { title: string }[]; }

export function AiSwarmView() {
  useLang();
  const connected = useSwarm((s) => s.connected);
  const run = useSwarm((s) => s.run);
  const services = useSwarm((s) => s.services);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [archived, setArchived] = useState<SwarmRun | null>(null);
  const [, tick] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    connectSwarm();
    const id = setInterval(() => tick(), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch('http://127.0.0.1:4310/api/ai/runs').then((r) => r.json()).then((j) => setHistory((j?.runs ?? []).slice(0, 6))).catch(() => undefined);
  }, [run?.status]);

  const shown = archived ?? run;
  const active = !archived && shown?.status === 'running';
  const jobs = shown?.jobs ?? [];
  const doneCount = jobs.filter((j) => j.status === 'done').length;
  const runCount = jobs.filter((j) => j.status === 'running').length;
  const errCount = jobs.filter((j) => j.status === 'error').length;
  const elapsed = shown ? (shown.finishedAt ?? Date.now()) - shown.startedAt : 0;
  const avg = jobs.length ? avgJobMs(jobs) : null;
  const remaining = jobs.length - doneCount - errCount;
  const eta = avg && remaining > 0 ? remaining * avg : null;

  const phaseStats = useMemo(() => PHASES.map((p) => {
    const inPhase = jobs.filter((j) => j.phase === p);
    return { phase: p, total: inPhase.length, done: inPhase.filter((j) => j.status === 'done').length };
  }), [jobs]);

  const openArchived = (r: RunSummary & { jobs?: unknown[]; orchestratorId?: string | null }) => {
    const results = new Map((r as { results?: { jobId: string; text: string; artifacts?: SwarmJob['artifacts'] }[] }).results?.map((x) => [x.jobId, x]) ?? []);
    setArchived({
      runId: r.runId,
      goal: r.goal,
      startedAt: Date.parse(r.finishedAt ?? '') - 60_000,
      orchestratorId: r.orchestratorId ?? null,
      mode: null,
      status: 'done',
      notes: [],
      finishedAt: Date.parse(r.finishedAt ?? '') || null,
      jobs: ((r.jobs ?? []) as SwarmJob[]).map((j) => {
        const res = results.get(j.id);
        return { ...j, status: res ? 'done' : 'queued', liveText: '', notes: [], deltaCount: 0, lastDeltaAt: null, startedAt: null, finishedAt: null, text: res?.text ?? '', artifacts: res?.artifacts ?? [], error: null };
      }),
    });
  };

  return (
    <div className="flex flex-col h-full gap-3 p-4 md:p-6 max-w-[1500px] mx-auto w-full">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Radio size={18} className={active ? 'text-emerald-400 animate-pulse' : 'opacity-50'} />
            {t('swarm.title')}
            {active && (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-400/15 border border-emerald-400/40 text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> {t('swarm.live')}
              </span>
            )}
          </h1>
          <p className="text-[11px] opacity-50">{t('swarm.subtitle')}</p>
        </div>
        <div className="flex-1" />
        {archived && (
          <button onClick={() => setArchived(null)} className="btn-primary rounded-xl px-3 py-1.5 text-[11px] flex items-center gap-1.5">
            <Zap size={12} /> {t('swarm.backToLive')}
          </button>
        )}
        {!connected && (
          <span className="text-[10px] px-2 py-1 rounded-lg bg-amber-400/10 border border-amber-400/30 text-amber-300 flex items-center gap-1.5">
            <AlertTriangle size={11} /> {t('swarm.noCompanionShort')}
          </span>
        )}
      </div>

      {!shown ? (
        <div className="flex-1 rounded-2xl border border-white/10 glass-panel flex flex-col items-center justify-center text-center gap-3 p-8">
          <div className="h-[300px] w-full max-w-2xl"><SwarmCanvas run={null} services={services} active={false} /></div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Cpu size={17} /> {t('swarm.idle')}</h2>
          <p className="text-[12.5px] opacity-55 max-w-md leading-relaxed">{t('swarm.idleHint')}</p>
        </div>
      ) : (
        <>
          {/* statuslinje */}
          <div className="rounded-2xl border border-white/10 glass-panel p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px]">
              <span className="font-medium max-w-[46%] truncate" title={shown.goal}>{shown.goal}</span>
              <span className="flex items-center gap-1.5 opacity-70"><Clock size={12} /> {t('swarm.elapsed')}: <b>{fmtDur(elapsed)}</b></span>
              <span className="flex items-center gap-1.5 opacity-70"><Cpu size={12} /> {t('swarm.orchestrator')}: <b>{serviceName(services, shown.orchestratorId)}</b> <span className="opacity-50">({shown.mode === 'llm' ? 'LLM' : t('chat.ruleBased')})</span></span>
              {eta !== null && remaining > 0 && (
                <span className="flex items-center gap-1.5 text-amber-300"><Zap size={12} /> {t('swarm.eta')}: <b>{fmtDur(eta)}</b> <span className="opacity-50 text-[10px]">({t('swarm.etaHint')})</span></span>
              )}
              <span className="flex-1" />
              <span className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1 text-emerald-400"><Activity size={11} /> {runCount}</span>
                <span className="flex items-center gap-1 opacity-60"><CircleDashed size={11} /> {remaining}</span>
                <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 size={11} /> {doneCount}</span>
                {errCount > 0 && <span className="flex items-center gap-1 text-rose-400"><AlertTriangle size={11} /> {errCount}</span>}
              </span>
            </div>
            <div className="h-2 rounded-full bg-black/25 dark:bg-black/40 overflow-hidden relative">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-emerald-400 transition-all duration-700 relative"
                style={{ width: `${jobs.length ? Math.round((doneCount / jobs.length) * 100) : 0}%` }}
              >
                {active && <div className="absolute inset-0 bg-white/25 animate-pulse" />}
              </div>
            </div>
            <div className="flex justify-between text-[9.5px] opacity-45">
              <span>{t('swarm.progress')}</span>
              <span>{t('swarm.jobsDone').replace('{done}', String(doneCount)).replace('{total}', String(jobs.length))}</span>
            </div>
            {/* faser */}
            <div className="flex gap-1 pt-1">
              {phaseStats.map(({ phase, total, done }) => total === 0 ? null : (
                <div key={phase} className="flex-1 min-w-0" title={`${phase}: ${done}/${total}`}>
                  <div className="h-1.5 rounded-full bg-black/25 dark:bg-black/40 overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all duration-700', done === total ? 'bg-emerald-400' : 'bg-indigo-400')} style={{ width: `${Math.round((done / total) * 100)}%` }} />
                  </div>
                  <div className="text-[8.5px] opacity-45 truncate mt-0.5 text-center">{t(`ai.phase.${phase}`) === `ai.phase.${phase}` ? phase : t(`ai.phase.${phase}`)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* canvas-sværmen */}
          <div className="rounded-2xl border border-white/10 bg-black/10 dark:bg-black/25 overflow-hidden relative h-[380px]">
            <SwarmCanvas run={shown} services={services} active={active} />
            {(shown.notes?.length ?? 0) > 0 && (
              <div className="absolute left-3 bottom-2 right-3 text-[10px] opacity-45 truncate">
                {shown.notes[shown.notes.length - 1]}
              </div>
            )}
          </div>

          {/* agent-kort */}
          {jobs.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {[...jobs]
                .sort((a, b) => (a.status === 'running' ? -1 : b.status === 'running' ? 1 : a.status === 'error' ? -1 : b.status === 'error' ? 1 : 0))
                .map((j) => <JobCard key={j.id} j={j} services={services} runActive={active} />)}
            </div>
          )}
        </>
      )}

      {/* historik */}
      {history.length > 0 && (
        <div className="rounded-2xl border border-white/10 glass-panel p-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider opacity-60 flex items-center gap-1.5 mb-2"><History size={12} /> {t('swarm.history')}</h3>
          <div className="flex flex-wrap gap-1.5">
            {history.map((h) => (
              <button
                key={h.file}
                onClick={() => openArchived(h as RunSummary & { jobs?: unknown[] })}
                className="rounded-xl border border-white/10 bg-black/10 dark:bg-white/5 px-2.5 py-1.5 text-left hover:border-indigo-400/40 transition max-w-[240px]"
              >
                <div className="text-[11px] truncate font-medium">{h.goal || h.runId}</div>
                <div className="text-[9.5px] opacity-45">{h.finishedAt ? new Date(h.finishedAt).toLocaleString('da-DK', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'} · {(h.results?.length ?? 0)} {t('swarm.delivered')}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

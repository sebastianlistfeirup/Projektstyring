import { AI_PHASES, normalizePhase, removePlanJob } from '../../shared/ai-plan.mjs';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Clock,
  Coins,
  Copy,
  Cpu,
  FastForward,
  Flame,
  Gavel,
  LayoutTemplate,
  Pause,
  Play,
  Radio,
  Save,
  Send,
  SkipForward,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  Webhook,
  Zap,
} from 'lucide-react';
import { useLang, t } from '../lib/i18n';
import { cn } from '../lib/utils';
import {
  connectSwarm,
  useSwarm,
  serviceColor,
  serviceName,
  toggleSwarmSound,
  swarmSoundOn,
  replayEvents,
  type SwarmEvent,
  type SwarmJob,
  type SwarmRun,
} from '../lib/swarm';
import {
  approvePlanResult,
  cancelRun,
  deleteTemplate,
  deleteTrigger,
  fetchCosts,
  fetchTemplates,
  fetchTriggers,
  fireOrchestrate,
  saveTemplate,
  saveTrigger,
  sendRunMessage,
  skipRunJob,
  suggestTemplate,
  type CostSummary,
  type PipelineTemplate,
  type Trigger,
} from '../lib/aiApi';
import type { AiServiceInfo } from '../lib/aiApi';
import OrbitWorkMap from '../components/OrbitWorkMap';
import RunQueuePanel from '../components/RunQueuePanel';
import RunHistory from '../components/RunHistory';
import type { RunHistoryItem } from '../lib/aiApi';
import { useStore } from '../store/useStore';
import { presentRun, timestamp } from '../lib/runPresentation';
import { AnalysisPanel, CompareRunsPanel, CopyDeliverableButton, JudgePanel, MiniMap, RunActionsBar } from './AiSwarmExtras';

const BASE_URL = 'http://127.0.0.1:4310';
const PHASES = AI_PHASES;

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
          // underagenter: små satellitter i kredsløb om den kørende node
          const subs = j.subagents ?? [];
          subs.forEach((s, si) => {
            const N = Math.max(1, subs.length);
            const a2 = frame * 0.045 + n.seed + (si * Math.PI * 2) / N;
            ctx.beginPath();
            ctx.moveTo(n.x + Math.cos(a2) * 17, n.y + Math.sin(a2) * 17);
            ctx.lineTo(n.x + Math.cos(a2) * 40, n.y + Math.sin(a2) * 40);
            ctx.strokeStyle = c + (s.status === 'running' ? 'aa' : '44');
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(n.x + Math.cos(a2) * 40, n.y + Math.sin(a2) * 40, s.status === 'running' ? 4.5 : 3.5, 0, Math.PI * 2);
            ctx.fillStyle = s.status === 'running' ? '#fbbf24' : '#34d399';
            if (s.status === 'running') { ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 8; }
            ctx.fill();
            ctx.shadowBlur = 0;
          });
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

/* ================= tidslinje for kørslen ================= */

function RunTimeline({ run, services, active }: { run: SwarmRun; services: Record<string, AiServiceInfo> | null; active: boolean }) {
  const rows = useMemo(() => {
    const js = run.jobs.filter((j) => j.startedAt);
    if (!js.length) return null;
    const t0 = Math.min(...[run.startedAt, ...js.map((j) => j.startedAt!)].filter(t => t > 0));
    const t1 = Math.max(run.finishedAt ?? Date.now(), ...js.map((j) => j.finishedAt ?? Date.now()));
    return { t0, t1: Math.max(t1, t0 + 1000), jobs: js };
  }, [run]);
  if (!rows) return null;
  const span = rows.t1 - rows.t0;
  const pctOf = (t: number) => Math.max(0, Math.min(100, ((t - rows.t0) / span) * 100));
  const fmtClock = (t: number) => new Date(t).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="rounded-2xl border border-white/10 glass-panel p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider opacity-60 flex items-center gap-1.5">
          <Clock size={12} /> {t('swarm.timeline')}
        </h3>
        <span className="text-[9.5px] opacity-40 tabular-nums">{fmtClock(rows.t0)} → {fmtClock(rows.t1)}</span>
      </div>
      <div className="relative">
        {/* nu-cursor */}
        <div className="absolute top-0 bottom-0 w-px bg-emerald-300/70 z-10 pointer-events-none" style={{ left: `${pctOf(Date.now())}%` }} />
        <div className="space-y-1">
          {rows.jobs.map((j) => {
            const color = hex(serviceColor(services, j.serviceId));
            const end = j.finishedAt ?? (active && j.status === 'running' ? Date.now() : j.startedAt!);
            const width = Math.max(0.4, pctOf(end) - pctOf(j.startedAt!));
            return (
              <div key={j.id} className="flex items-center gap-2" title={`${serviceName(services, j.serviceId)} · ${j.title}`}>
                <span className="w-32 shrink-0 truncate text-right text-[10px] opacity-60">{serviceName(services, j.serviceId)}</span>
                <div className="relative h-4 flex-1">
                  {/* hovedbar */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full transition-all duration-700"
                    style={{
                      left: `${pctOf(j.startedAt!)}%`,
                      width: `${width}%`,
                      background: color,
                      opacity: j.status === 'done' ? 0.75 : j.status === 'error' ? 0.9 : 1,
                    }}
                  />
                  {/* underagent-segmenter */}
                  {(j.subagents ?? []).map((s) => {
                    const send = s.finishedAt ?? (active && s.status === 'running' ? Date.now() : s.startedAt);
                    return (
                      <div
                        key={s.subId}
                        className="absolute top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-amber-300"
                        style={{ left: `${pctOf(s.startedAt)}%`, width: `${Math.max(0.4, pctOf(send) - pctOf(s.startedAt))}%`, opacity: s.status === 'running' ? 1 : 0.55 }}
                        title={s.name}
                      />
                    );
                  })}
                </div>
                <span className="w-24 shrink-0 truncate text-[9.5px] opacity-45">{j.title}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ================= agent-kort ================= */

function JobCard({ j, services, runActive, onSkip }: { j: SwarmJob; services: Record<string, AiServiceInfo> | null; runActive: boolean; onSkip?: (jobId: string) => void }) {
  const liveRef = useRef<HTMLDivElement>(null);
  const [teamOpen, setTeamOpen] = useState(true);
  useEffect(() => {
    const el = liveRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [j.liveText, j.notes, j.subagents]);

  const color = hex(serviceColor(services, j.serviceId));
  const waiting = (j.dependsOn ?? [])
    .map((d) => ({ idx: d }))
    .length;
  const svcInfo = j.serviceId ? services?.[j.serviceId] : null;
  const billingLabel = svcInfo?.kind === 'local' ? 'Lokalt forbrug' : svcInfo?.billing?.allowed ? 'Inkluderet · brugerbekræftet' : 'Betalingsform ukendt';

  return (
    <div
      id={`jobcard-${j.id}`}
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
          {j.team && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-violet-400/40 text-violet-300 shrink-0">{t('swarm.team')}</span>
          )}
          {(j.score !== null && j.score !== undefined) && (
            <span
              className={cn(
                'text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 tabular-nums',
                j.score >= 8 ? 'bg-emerald-400/15 text-emerald-300' : j.score >= 6 ? 'bg-amber-400/15 text-amber-300' : 'bg-rose-400/15 text-rose-300',
              )}
              title={j.judgeNote ?? ''}
            >
              {j.score}/10
            </span>
          )}
          <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-white/10 opacity-60">{t(`ai.phase.${j.phase}`) === `ai.phase.${j.phase}` ? j.phase : t(`ai.phase.${j.phase}`)}</span>
          {j.status === 'running' && <Activity size={12} className="text-emerald-400 animate-pulse" />}
          {j.status === 'done' && <CheckCircle2 size={12} className="text-emerald-400" />}
          {j.status === 'error' && <AlertTriangle size={12} className="text-rose-400" />}
          {j.status === 'queued' && <CircleDashed size={12} className="opacity-40" />}
          {runActive && j.status === 'queued' && onSkip && (
            <button
              onClick={() => onSkip(j.id)}
              title={t('swarm.skipJob')}
              className="shrink-0 rounded-md p-1 opacity-50 hover:opacity-100 hover:bg-white/10 transition"
            >
              <SkipForward size={12} />
            </button>
          )}
        </div>
        <div className="text-[11px] opacity-70 mt-1 truncate">{j.title}</div>

        {/* Underagenter (holdmedlemmer / CLI-subagenter) — sammenklappeligt team-træ */}
        {(j.subagents?.length ?? 0) > 0 && (
          <div className="mt-2">
            <button onClick={() => setTeamOpen((o) => !o)} className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider opacity-50 hover:opacity-80 transition">
              {teamOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              {t('swarm.teamTree')} · {j.subagents!.filter((s) => s.status === 'done').length}/{j.subagents!.length}
            </button>
            {teamOpen && (
              <div className="mt-1 space-y-1">
                {j.subagents!.map((s, si) => (
                  <div key={s.subId} className="flex items-start gap-1.5 text-[10px] leading-snug">
                    <span className="flex flex-col items-center shrink-0 mt-0.5">
                      {s.status === 'running' ? (
                        <Activity size={10} className="text-emerald-400 animate-pulse" />
                      ) : (
                        <CheckCircle2 size={10} className="text-emerald-400/70" />
                      )}
                      {si < j.subagents!.length - 1 && <span className="w-px flex-1 mt-0.5 bg-white/10" />}
                    </span>
                    <span className="min-w-0 flex-1 pb-0.5">
                      <span className="block truncate opacity-80">{s.name}</span>
                      {s.text && <span className="block truncate opacity-40">{s.text.slice(-90)}</span>}
                      <span className="block opacity-35">
                        {s.status === 'running'
                          ? `${t('swarm.active')} · ${fmtDur(Date.now() - s.startedAt)}`
                          : fmtDur(s.finishedAt ? s.finishedAt - s.startedAt : null)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
            {/* forbrug: tid, aktivitet og est. pris direkte på kortet */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] opacity-45">
              <span className="flex items-center gap-1"><Clock size={9} /> {fmtDur(j.startedAt && j.finishedAt ? j.finishedAt - j.startedAt : null)}</span>
              <span className="flex items-center gap-1"><Activity size={9} /> {j.deltaCount.toLocaleString('da-DK')}</span>
              <span className="flex items-center gap-1"><Coins size={9} /> {billingLabel}</span>
            </div>
            <CopyDeliverableButton text={j.text} />
            {j.judgeNote && (
              <p className="text-[9.5px] text-amber-300/80 leading-snug flex gap-1"><Gavel size={9} className="mt-0.5 shrink-0" /> {j.judgeNote}</p>
            )}
          </div>
        )}

        {j.status === 'queued' && (
          <p className="mt-2 text-[10px] opacity-45">
            {waiting > 0 ? t('swarm.waitingOn').replace('{n}', String(waiting)) : t('ai.status.queued')}
          </p>
        )}

        {['error', 'blocked', 'cancelled', 'interrupted', 'skipped'].includes(j.status) && (
          <div className="mt-2">
            <p className="text-[10.5px] text-rose-300/90 leading-relaxed">{j.error ?? (j.status === 'skipped' ? 'Sprunget over; afhængige jobs kan ikke fortsætte.' : j.status)}</p>
            <p className="text-[9px] opacity-40 mt-1">{t('swarm.selfHealHint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= besked til orkestratoren + aflys (idé 14) ================= */

function RunControls({ run }: { run: SwarmRun }) {
  const [msg, setMsg] = useState('');
  const [sound, setSound] = useState(swarmSoundOn());
  const send = async () => {
    const text = msg.trim();
    if (!text) return;
    setMsg('');
    await sendRunMessage(run.runId, text);
  };
  return (
    <div className="rounded-2xl border border-indigo-400/25 bg-indigo-500/[0.06] p-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void send()}
          placeholder={t('swarm.messagePlaceholder')}
          className="flex-1 rounded-xl bg-black/20 dark:bg-black/30 border border-white/10 px-3 py-2 text-[12px] outline-none focus:border-indigo-400/50 transition"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSound(toggleSwarmSound())}
            title={t('swarm.soundToggle')}
            className="rounded-xl border border-white/10 p-2 opacity-70 hover:opacity-100 transition"
          >
            {sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          <button onClick={() => void send()} disabled={!msg.trim()} className="btn-primary rounded-xl px-3 py-2 text-[11px] flex items-center gap-1.5 disabled:opacity-40">
            <Send size={12} /> {t('swarm.sendMessage')}
          </button>
          <button
            onClick={() => { if (window.confirm(t('swarm.confirmCancel'))) void cancelRun(run.runId); }}
            className="rounded-xl border border-rose-400/30 text-rose-300 px-3 py-2 text-[11px] flex items-center gap-1.5 hover:bg-rose-400/10 transition"
          >
            <Square size={12} /> {t('swarm.cancelRun')}
          </button>
        </div>
      </div>
      {(run.instructions?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {run.instructions!.map((ins, i) => (
            <span key={i} className="text-[9.5px] px-2 py-0.5 rounded-full bg-indigo-400/15 border border-indigo-400/30 text-indigo-200 truncate max-w-[260px]">{ins}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= godkendelse/redigering af plan (idé 1/2) ================= */

interface PlanDraft { id: string; title: string; serviceId: string | null; phase: string; dependsOn: number[]; description: string; team?: boolean; readOnly?: boolean; context?: string[] }

function ApprovalModal({ services, open, onClose }: { services: Record<string, AiServiceInfo> | null; open: boolean; onClose: () => void }) {
  const approval = useSwarm((s) => s.approval);
  const setApproval = useSwarm((s) => s.setApproval);
  const [draft, setDraft] = useState<PlanDraft[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (open && approval) element?.showModal(); else element?.close();
  }, [open, approval?.runId]);

  useEffect(() => {
    if (approval && !ready) {
      setDraft(approval.jobs.map(j => ({ ...j, phase: normalizePhase(j.phase), dependsOn: [...(j.dependsOn ?? [])] })));
      setReady(true);
    }
    if (!approval) { setReady(false); onClose(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approval]);

  if (!approval) return null;

  const patch = (i: number, p: Partial<PlanDraft>) => setDraft((d) => d.map((x, xi) => (xi === i ? { ...x, ...p } : x)));

  const remove = (index: number) => {
    try { setDraft(removePlanJob(draft, index)); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Jobbet kunne ikke fjernes.'); }
  };
  const approve = async () => {
    if (!draft.length || draft.some(job => !job.title.trim())) { setError('Alle jobs skal have en titel. Tomme jobs fjernes ikke automatisk.'); return; }
    setBusy(true); setError('');
    const result = await approvePlanResult(approval.runId, draft);
    setBusy(false);
    if (result.ok) { setApproval(null); onClose(); }
    else setError(result.reason ?? 'Planen kunne ikke godkendes.');
  };
  const cancel = async () => {
    setBusy(true); setError('');
    const ok = await cancelRun(approval.runId);
    setBusy(false);
    if (ok) { setApproval(null); onClose(); }
    else setError('Stop kunne ikke bekræftes. Kontrollér forbindelsen.');
  };

  const serviceOpts = (current: string | null) => {
    const ids = new Set([...Object.keys(services ?? {}), ...(current ? [current] : [])]);
    return [...ids].map((id) => (
      <option key={id} value={id}>{services?.[id]?.name ?? id}{services?.[id] && !services[id].available ? ' (offline)' : ''}</option>
    ));
  };

  return (
    <dialog ref={dialog} aria-label="Gennemgå jobplan" onCancel={event => { event.preventDefault(); onClose(); }} className="fixed m-auto w-[min(96vw,700px)] max-h-[94dvh] rounded-3xl border border-slate-500/30 bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100 p-0 shadow-2xl backdrop:bg-black/75">
      <div className="glass-panel animate-fade-in relative max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-3xl p-5">
        <h3 className="text-base font-bold flex items-center gap-2">
          <Check size={16} className="text-emerald-400" /> {t('swarm.approvalTitle')}
        </h3>
        <p className="text-xs opacity-65 mt-1 mb-3">{t('swarm.approvalHint')}</p>
        <button className="btn-ghost text-xs mb-3" onClick={onClose}>Se arbejdskortet · planen venter</button>
        <fieldset disabled={busy} className="space-y-2">
          {draft.map((j, i) => (
            <div key={j.id || i} role="group" aria-label={`Planjob ${i + 1}`} className="rounded-2xl border border-white/10 bg-black/15 dark:bg-black/25 p-2.5 space-y-1.5">
              <div className="flex gap-1.5">
                <input aria-label="Jobtitel" value={j.title} onChange={(e) => patch(i, { title: e.target.value })} className="flex-1 rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-[12px] outline-none focus:border-indigo-400/50" placeholder={t('swarm.jobTitle')} />
                <button aria-label={`Fjern job ${i + 1}`} onClick={() => remove(i)} className="rounded-lg p-1.5 opacity-40 hover:opacity-100 hover:text-rose-400 transition" title={t('ai.delete')}>
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <select aria-label="Tjeneste" value={j.serviceId ?? ''} onChange={(e) => patch(i, { serviceId: e.target.value || null })} className="rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-[11px] outline-none">
                  <option value="">—</option>
                  {serviceOpts(j.serviceId)}
                </select>
                <select aria-label="Fase" value={j.phase} onChange={(e) => patch(i, { phase: e.target.value })} className="rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-[11px] outline-none">
                  {PHASES.map((p) => <option key={p} value={p}>{t(`ai.phase.${p}`) === `ai.phase.${p}` ? p : t(`ai.phase.${p}`)}</option>)}
                </select>
                <label className="flex items-center gap-1 text-[10px] opacity-60 px-1">
                  <input type="checkbox" checked={Boolean(j.team)} onChange={(e) => patch(i, { team: e.target.checked })} className="accent-violet-500" />
                  {t('swarm.team')}
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={j.readOnly === true} onChange={e => patch(i, { readOnly: e.target.checked })} />Kun læsning · må ikke ændre repository</label>
              {!!j.context?.length && <p className="text-[11px] opacity-60 break-all">Kontekstfiler: {j.context.join(', ')}</p>}
              {draft.length > 1 && <details className="text-xs"><summary className="cursor-pointer opacity-70">Afhænger af {j.dependsOn.length} jobs</summary><div className="flex flex-col gap-1 mt-2">{draft.map((other, index) => index !== i && <label key={other.id} className="flex items-center gap-2"><input type="checkbox" checked={j.dependsOn.includes(index)} onChange={e => patch(i, { dependsOn: e.target.checked ? [...j.dependsOn, index] : j.dependsOn.filter(value => value !== index) })} />{index + 1}. {other.title || 'Uden titel'}</label>)}</div></details>}
              <textarea aria-label="Jobbeskrivelse" value={j.description} onChange={(e) => patch(i, { description: e.target.value })} rows={2} className="w-full rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-[11px] outline-none focus:border-indigo-400/50 resize-none" placeholder={t('ai.descriptionPlaceholder')} />
            </div>
          ))}
        </fieldset>
        <button
          disabled={busy} onClick={() => setDraft((d) => [...d, { id: `job-${crypto.randomUUID()}`, title: '', serviceId: null, phase: 'production', dependsOn: [], description: '' }])}
          className="mt-2 rounded-xl border border-dashed border-white/15 px-3 py-1.5 text-[11px] opacity-60 hover:opacity-100 transition flex items-center gap-1"
        >
          <PlusIcon /> {t('swarm.addJob')}
        </button>
        {error && <p role="alert" className="mt-3 text-xs text-rose-500">{error}</p>}
        <div className="mt-4 flex items-center gap-2">
          <button disabled={busy} onClick={() => void cancel()} className="rounded-xl border border-rose-400/30 text-rose-300 px-3 py-2 text-[11px] hover:bg-rose-400/10 transition">
            {t('swarm.cancelRun')}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button disabled={busy} onClick={approve} className="btn-primary rounded-xl px-4 py-2 text-[12px] flex items-center gap-1.5">
              <Check size={13} /> {t('swarm.approve')}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function PlusIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>;
}

/* ================= autonome triggere (idé 15) ================= */

function TriggersPanel() {
  const projects = useStore(state => state.projects);
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState('');
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'cron' as 'cron' | 'webhook', cron: '0 8 * * 1', goal: '', mode: 'standard' as Trigger['mode'] });
  const [copied, setCopied] = useState<string | null>(null);

  const reload = () => void fetchTriggers().then(setTriggers);
  useEffect(reload, []);

  const add = async () => {
    if (!form.name.trim() || !form.goal.trim()) return;
    const saved = await saveTrigger({ ...form, projectId: projectId || undefined, cron: form.kind === 'cron' ? form.cron : undefined });
    if (!saved) { setError('Planlægningen kunne ikke gemmes. Kontrollér projekt, cron-felter og forbindelsen.'); return; }
    setError('');
    setForm({ name: '', kind: 'cron', cron: '0 8 * * 1', goal: '', mode: 'standard' });
    reload();
  };

  return (
    <div className="rounded-2xl border border-white/10 glass-panel p-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-left">
        <CalendarClock size={13} className="opacity-60" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider opacity-60 flex-1">{t('swarm.triggers')}</h3>
        <span className="text-[10px] opacity-40">{triggers.length}</span>
      </button>
      {open && (
        <div className="mt-2.5 space-y-2">
          {triggers.length === 0 && <p className="text-[10.5px] opacity-45">{t('swarm.noTriggers')}</p>}
          {triggers.map((tr) => (
            <div key={tr.id} className="rounded-xl border border-white/10 bg-black/10 dark:bg-white/[0.03] p-2.5">
              <div className="flex items-center gap-2">
                {tr.kind === 'cron' ? <CalendarClock size={12} className="text-sky-400 shrink-0" /> : <Webhook size={12} className="text-teal-400 shrink-0" />}
                <span className="text-[11.5px] font-medium flex-1 truncate">{tr.name}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-white/10 opacity-50">{tr.kind === 'cron' ? tr.cron : 'webhook'}</span>
                <button onClick={() => { void deleteTrigger(tr.id).then(reload); }} className="opacity-40 hover:opacity-100 hover:text-rose-400 transition"><Trash2 size={12} /></button>
              </div>
              <p className="text-[10px] opacity-50 truncate mt-0.5">{tr.goal}</p>
              {tr.webhookUrl && (
                <button
                  onClick={() => { void navigator.clipboard?.writeText(`http://127.0.0.1:4310${tr.webhookUrl}`); setCopied(tr.id); setTimeout(() => setCopied(null), 1500); }}
                  className="mt-1 text-[9.5px] flex items-center gap-1 text-teal-300/80 hover:text-teal-200 transition"
                >
                  <Copy size={9} /> {copied === tr.id ? <Check size={9} /> : null} http://127.0.0.1:4310{tr.webhookUrl}
                </button>
              )}
            </div>
          ))}
          <div className="rounded-xl border border-dashed border-white/15 p-2.5 space-y-1.5">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('swarm.triggerName')} className="w-full rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-[11px] outline-none focus:border-indigo-400/50" />
            <div className="flex gap-1.5">
              <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as 'cron' | 'webhook' }))} className="rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-[11px] outline-none">
                <option value="cron">cron</option>
                <option value="webhook">webhook</option>
              </select>
              {form.kind === 'cron' ? (
                <input value={form.cron} onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))} placeholder="0 8 * * 1" className="flex-1 rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-[11px] font-mono outline-none focus:border-indigo-400/50" />
              ) : (
                <span className="flex-1 text-[10px] opacity-45 self-center">{t('swarm.webhookHint')}</span>
              )}
              <select value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as Trigger['mode'] }))} className="rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-[11px] outline-none">
                <option value="standard">{t('swarm.mode.standard')}</option>
                <option value="roles">{t('swarm.mode.roles')}</option>
                <option value="debate">{t('swarm.mode.debate')}</option>
                <option value="vote">{t('swarm.mode.vote')}</option>
                <option value="race">{t('swarm.mode.race')}</option>
              </select>
            </div>
            <label className="block text-[11px] space-y-1"><span>Projekt og gældende grundlag</span><select className="input w-full text-xs" aria-label="Projekt for planlagt kørsel" value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Uden projekt (ingen repositorytilknytning)</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            <p className="text-[10px] opacity-50">Tidspunkter bruger maskinens lokale tidszone. Ventende kørsler gemmes; tider mens Companion er lukket efterkøres ikke.</p>
            {error && <p role="alert" className="text-rose-400 text-xs">{error}</p>}
            <textarea value={form.goal} onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))} rows={2} placeholder={t('swarm.triggerGoal')} className="w-full rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-[11px] outline-none focus:border-indigo-400/50 resize-none" />
            <button onClick={() => void add()} disabled={!form.name.trim() || !form.goal.trim()} className="btn-primary rounded-lg px-3 py-1.5 text-[10.5px] disabled:opacity-40 flex items-center gap-1">
              <PlusIcon /> {t('swarm.addTrigger')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= pipeline-skabeloner + selvforbedrende orkestrator (idé 16 + 20) ================= */

function TemplatesPanel({ services }: { services: Record<string, AiServiceInfo> | null }) {
  const [templates, setTemplates] = useState<PipelineTemplate[]>([]);
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState<PipelineTemplate['jobs'] | null>(null);
  const [suggestName, setSuggestName] = useState('');

  const reload = () => void fetchTemplates().then(setTemplates);
  useEffect(reload, []);

  const run = (tpl: PipelineTemplate) => {
    void fireOrchestrate({ goal: `${tpl.name}: ${tpl.description ?? tpl.jobs.map((j) => j.title).join(' → ')}`, jobs: tpl.jobs });
  };

  const suggest = async () => {
    if (!goal.trim()) return;
    setSuggesting(true);
    const r = await suggestTemplate(goal.trim());
    setSuggesting(false);
    if (r.ok && r.jobs) setSuggested(r.jobs);
  };

  const saveSuggested = async () => {
    if (!suggested || !suggestName.trim()) return;
    await saveTemplate({ name: suggestName.trim(), description: goal.trim().slice(0, 140), jobs: suggested });
    setSuggested(null);
    setSuggestName('');
    setGoal('');
    reload();
  };

  return (
    <div className="rounded-2xl border border-white/10 glass-panel p-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-left">
        <LayoutTemplate size={13} className="opacity-60" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider opacity-60 flex-1">{t('swarm.templates')}</h3>
        <span className="text-[10px] opacity-40">{templates.length}</span>
      </button>
      {open && (
        <div className="mt-2.5 space-y-2">
          {templates.map((tpl) => (
            <div key={tpl.id} className="rounded-xl border border-white/10 bg-black/10 dark:bg-white/[0.03] p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] font-medium flex-1 truncate">{tpl.name}</span>
                {tpl.builtin && <span className="text-[8.5px] px-1.5 py-0.5 rounded-full border border-white/10 opacity-40">built-in</span>}
                {!tpl.builtin && (
                  <button onClick={() => { void deleteTemplate(tpl.id).then(reload); }} className="opacity-40 hover:opacity-100 hover:text-rose-400 transition"><Trash2 size={12} /></button>
                )}
                <button onClick={() => run(tpl)} className="btn-primary rounded-lg px-2.5 py-1 text-[10px] flex items-center gap-1">
                  <Play size={10} /> {t('swarm.runTemplate')}
                </button>
              </div>
              <p className="text-[10px] opacity-50 mt-0.5 line-clamp-2">{tpl.description || tpl.jobs.map((j) => j.title).join(' → ')}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {tpl.jobs.slice(0, 8).map((j, i) => (
                  <span key={i} className="text-[8.5px] px-1.5 py-0.5 rounded-md bg-white/[0.06] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: hex(serviceColor(services, j.serviceId)) }} />
                    {j.title}
                  </span>
                ))}
                {tpl.jobs.length > 8 && <span className="text-[8.5px] opacity-40">+{tpl.jobs.length - 8}</span>}
              </div>
            </div>
          ))}
          {/* Selvforbedrende orkestrator: beskriv en pipeline, lad AI'en designe den */}
          <div className="rounded-xl border border-dashed border-violet-400/30 p-2.5 space-y-1.5">
            <p className="text-[10px] font-semibold text-violet-300 flex items-center gap-1"><Sparkles size={11} /> {t('swarm.suggestTitle')}</p>
            <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder={t('swarm.suggestPlaceholder')} className="w-full rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-[11px] outline-none focus:border-violet-400/50 resize-none" />
            <button onClick={() => void suggest()} disabled={suggesting || !goal.trim()} className="rounded-lg border border-violet-400/40 text-violet-300 px-3 py-1.5 text-[10.5px] hover:bg-violet-400/10 transition disabled:opacity-40 flex items-center gap-1">
              {suggesting ? <Clock size={10} className="animate-spin" /> : <Sparkles size={10} />} {t('swarm.suggestAction')}
            </button>
            {suggested && (
              <div className="rounded-lg bg-black/25 p-2 space-y-1">
                {suggested.map((j, i) => (
                  <div key={i} className="text-[10px] flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: hex(serviceColor(services, j.serviceId)) }} />
                    <span className="truncate opacity-80">{j.title}</span>
                    <span className="opacity-35 shrink-0">{serviceName(services, j.serviceId)}</span>
                  </div>
                ))}
                <div className="flex gap-1.5 pt-1">
                  <input value={suggestName} onChange={(e) => setSuggestName(e.target.value)} placeholder={t('swarm.templateName')} className="flex-1 rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-[10.5px] outline-none focus:border-violet-400/50" />
                  <button onClick={() => void saveSuggested()} disabled={!suggestName.trim()} className="rounded-lg bg-violet-500/20 border border-violet-400/40 text-violet-200 px-2.5 py-1 text-[10px] flex items-center gap-1 disabled:opacity-40">
                    <Save size={10} /> {t('swarm.saveTemplate')}
                  </button>
                  <button onClick={() => run({ id: 'draft', name: suggestName || 'Kladde', jobs: suggested })} className="rounded-lg border border-white/15 px-2.5 py-1 text-[10px] hover:bg-white/5 transition flex items-center gap-1">
                    <Play size={10} /> {t('swarm.runNow')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= omkostningsregnskab (idé 8) ================= */

function CostsPanel() {
  const [costs, setCosts] = useState<CostSummary | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) void fetchCosts().then(setCosts); }, [open]);
  return (
    <div className="rounded-2xl border border-white/10 glass-panel p-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-left">
        <Coins size={13} className="opacity-60" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider opacity-60 flex-1">{t('swarm.costs')}</h3>
      </button>
      {open && (
        <div className="mt-2.5">
          {!costs ? (
            <p className="text-[10.5px] opacity-45">{t('swarm.costsEmpty')}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] mb-2">
                <span className="opacity-60">{t('swarm.costRuns')}: <b>{costs.totalRuns}</b></span>
                <span className="opacity-60">{t('swarm.costJobs')}: <b>{costs.totalJobs}</b></span>
                <span className="text-emerald-400">{t('swarm.costEst')}: <b>{costs.estKr?.toFixed(2) ?? 'Ukendt'} kr</b></span>
              </div>
              <div className="space-y-1">
                {costs.byService.map((u) => (
                  <div key={u.id} className="flex items-center gap-2 text-[10.5px]">
                    <span className="flex-1 truncate">{u.name}</span>
                    <span className="opacity-50 tabular-nums">{u.jobs} {t('swarm.costJobsShort')}</span>
                    <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full border', u.subscriptionCovered ? 'border-emerald-400/30 text-emerald-300' : 'border-amber-400/30 text-amber-300')}>
                      {u.subscriptionCovered ? t('swarm.covered') : `${u.estKr?.toFixed(2) ?? 'Ukendt'} kr`}
                    </span>
                  </div>
                ))}
                {costs.byService.length === 0 && <p className="text-[10px] opacity-40">{t('swarm.costsEmpty')}</p>}
              </div>
              <p className="text-[9px] opacity-35 mt-2">{t('swarm.costsHint')}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
/* ================= hovedvisning ================= */

interface ReplayState {
  base: SwarmRun;
  events: SwarmEvent[];
  t0: number;
  t1: number;
  cursor: number;
  playing: boolean;
  speed: number;
}

const MODE_KEYS: Record<string, string> = {
  roles: 'swarm.mode.roles',
  debate: 'swarm.mode.debate',
  vote: 'swarm.mode.vote',
  race: 'swarm.mode.race',
};

export function AiSwarmView() {
  useLang();
  const connected = useSwarm((s) => s.connected);
  const run = useSwarm((s) => s.run);
  const services = useSwarm((s) => s.services);
  const approval = useSwarm((s) => s.approval);
  const [archived, setArchived] = useState<SwarmRun | null>(null);
  const [hiddenApproval, setHiddenApproval] = useState<string | null>(null);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [archivedEvents, setArchivedEvents] = useState<SwarmEvent[]>([]);
  const [mapMode, setMapMode] = useState<'work' | 'constellation'>('work');
  const historyRequest = useRef(0);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };
  const [, tick] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    connectSwarm();
    const id = setInterval(() => tick(), 1000);
    return () => clearInterval(id);
  }, []);

  // Replay-takt: cursor rykker speed x realtid.
  useEffect(() => {
    if (!replay?.playing) return;
    const id = setInterval(() => {
      setReplay((r) => {
        if (!r) return r;
        const cursor = Math.min(r.t1, r.cursor + 200 * r.speed);
        return { ...r, cursor, playing: cursor < r.t1 };
      });
    }, 200);
    return () => clearInterval(id);
  }, [replay?.playing]);

  const shown = replay ? replayEvents(replay.base, replay.events, replay.cursor) : (archived ?? run);
  const active = !archived && !replay && shown?.status === 'running';
  const jobs = shown?.jobs ?? [];
  const doneCount = jobs.filter((j) => j.status === 'done').length;
  const runCount = jobs.filter((j) => j.status === 'running').length;
  const errCount = jobs.filter((j) => j.status === 'error').length;
  const elapsed = shown?.startedAt ? (shown.finishedAt ?? (replay?.cursor ?? Date.now())) - shown.startedAt : null;
  const avg = jobs.length ? avgJobMs(jobs) : null;
  const remaining = jobs.filter(j => ['queued', 'running'].includes(j.status)).length;
  const eta = active && avg && remaining > 0 ? remaining * avg : null;

  const phaseStats = useMemo(() => PHASES.map((p) => {
    const inPhase = jobs.filter((j) => normalizePhase(j.phase) === p);
    return { phase: p, total: inPhase.length, done: inPhase.filter((j) => j.status === 'done').length };
  }), [jobs]);

  // Varmekort: hvor hårdt hver tjeneste er belastet i kørslen.
  const serviceLoad = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) if (j.serviceId) m.set(j.serviceId, (m.get(j.serviceId) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [jobs]);

  const openArchived = async (r: RunHistoryItem) => {
    const request = ++historyRequest.current;
    try {
      const response = await fetch(`${BASE_URL}/api/ai/runs/${encodeURIComponent(r.runId)}`);
      const data = await response.json();
      if (!response.ok || !data.ok || !data.run) throw new Error('Historikken kunne ikke hentes.');
      if (request !== historyRequest.current) return;
      setReplay(null);
      setArchived(presentRun(data.run));
      setArchivedEvents((data.run.eventsTruncated ? [] : data.run.events ?? []).filter((event: SwarmEvent) => timestamp(event.at)).sort((a: SwarmEvent, b: SwarmEvent) => a.at - b.at));
    } catch { if (request === historyRequest.current) showToast('Historikken kunne ikke hentes. Kontrollér forbindelsen.'); }
  };

  const startReplay = () => {
    if (!archived || archivedEvents.length < 2) return;
    const events = archivedEvents;
    // Evidence from the end must not appear before its event in the replay.
    const base = { ...archived, jobs: [], evidence: undefined, verification: undefined, verificationHistory: [], results: [], projectPlan: undefined, projectPlanError: undefined, heartbeatAt: undefined, finishedAt: null };
    setReplay({ base, events, t0: events[0].at, t1: events.at(-1)!.at, cursor: events[0].at, playing: false, speed: 8 });
  };

  const modeKey = shown?.mode ? MODE_KEYS[shown.mode] : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto [&>*]:shrink-0 gap-3 p-3 md:p-6 max-w-[1500px] mx-auto w-full">
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
            {replay && (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-400/15 border border-violet-400/40 text-violet-300">
                <FastForward size={10} /> {t('swarm.replaying')}
              </span>
            )}
          </h1>
          <p className="text-[11px] opacity-50">{t('swarm.subtitle')}</p>
        </div>
        <div className="flex-1" />
        {(archived || replay) && (
          <button onClick={() => { historyRequest.current++; setArchived(null); setReplay(null); setArchivedEvents([]); }} className="btn-primary rounded-xl px-3 py-1.5 text-[11px] flex items-center gap-1.5">
            <Zap size={12} /> {t('swarm.backToLive')}
          </button>
        )}
        {archived && !replay && archivedEvents.length > 1 && <button className="btn-ghost text-xs" onClick={startReplay}><Play size={13} />Genafspil hændelser</button>}
        {!connected && (
          <span className="text-[10px] px-2 py-1 rounded-lg bg-amber-400/10 border border-amber-400/30 text-amber-300 flex items-center gap-1.5">
            <AlertTriangle size={11} /> {t('swarm.noCompanionShort')}
          </span>
        )}
      </div>

      {shown?.eventsJournal && <div className="text-xs opacity-65 flex flex-wrap gap-2"><a className="underline" href={`${BASE_URL}/api/ai/runs/${encodeURIComponent(shown.runId)}/events`} target="_blank" rel="noreferrer">Hent fuld aktivitetslog · {shown.eventCount ?? '—'} hændelser</a>{shown.eventsTruncated && <span>Loggen kan ikke indlæses komplet til genafspilning. Brug den fulde aktivitetslog.</span>}</div>}
      <RunQueuePanel />

      {/* pulserende banner når en plan afventer godkendelse */}
      {approval && (
        <div className="rounded-2xl border border-amber-400/50 bg-amber-400/10 px-3.5 py-2.5 flex flex-wrap items-center gap-2">
          <AlertTriangle size={14} className="text-amber-300 shrink-0" />
          <span className="text-[12px] font-semibold text-amber-200">{t('swarm.approvalWaiting')}</span>
          <span className="text-xs opacity-65 flex-1">{t('swarm.approvalWaitingHint')}</span>
          <button className="btn-primary text-xs" onClick={() => setHiddenApproval(null)}>Redigér og godkend planen</button>
        </div>
      )}

      {!shown ? (
        <div className="flex-1 rounded-2xl border border-white/10 glass-panel flex flex-col items-center justify-center text-center gap-3 p-8">
          <div className="h-[300px] md:h-[340px] w-full max-w-2xl"><SwarmCanvas run={null} services={services} active={false} /></div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Cpu size={17} /> {t('swarm.idle')}</h2>
          <p className="text-[12.5px] opacity-55 max-w-md leading-relaxed">{t('swarm.idleHint')}</p>
        </div>
      ) : (
        <>
          {/* statuslinje */}
          <div className="rounded-2xl border border-white/10 glass-panel p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px]">
              <span className="font-semibold text-sm w-full break-words" title={shown.goal}>{shown.goal}</span>
              {modeKey && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-violet-400/40 text-violet-300">{t(modeKey)}</span>
              )}
              <span className="flex items-center gap-1.5 opacity-70"><Clock size={12} /> {t('swarm.elapsed')}: <b>{fmtDur(elapsed)}</b></span>
              <span className="flex items-center gap-1.5 opacity-70"><Cpu size={12} /> {t('swarm.orchestrator')}: <b>{serviceName(services, shown.orchestratorId)}</b></span>
              {eta !== null && remaining > 0 && !replay && (
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
            <details><summary className="text-xs opacity-60 cursor-pointer">Flere tal om kørslen</summary>
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
            {/* varmekort: tjeneste-belastning (større/mere lys = flere jobs) */}
            {serviceLoad.length > 1 && (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1" title={t('swarm.heatHint')}>
                <Flame size={11} className="opacity-40 shrink-0" />
                {serviceLoad.map(([id, n]) => {
                  const c = hex(serviceColor(services, id));
                  const max = serviceLoad[0][1];
                  const size = 7 + (n / max) * 11;
                  return (
                    <span key={id} className="flex items-center gap-1">
                      <span className="rounded-full transition-all" style={{ width: size, height: size, background: c, opacity: 0.35 + (n / max) * 0.65 }} />
                      <span className="text-[8.5px] opacity-45">{serviceName(services, id)} ×{n}</span>
                    </span>
                  );
                })}
              </div>
            )}
            </details>
          </div>

          {/* dommer-panel for race/debate/vote */}
          {shown && <JudgePanel run={shown} services={services} />}

          {/* handlingsbjælke for afsluttede/arkiverede kørsler: genoptag, eksport, link til opgave */}
          {!active && shown && !replay && (
            <div className="rounded-2xl border border-white/10 glass-panel px-3 py-2">
              <RunActionsBar run={shown} onToast={showToast} />
            </div>
          )}

          {/* besked til orkestratoren mens der køres */}
          {active && run && <RunControls run={run} />}

          {/* replay-bjælke (idé 19) */}
          {replay && (
            <div className="rounded-2xl border border-violet-400/25 bg-violet-500/[0.06] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setReplay((r) => r ? { ...r, playing: !r.playing } : r)}
                  className="rounded-xl bg-violet-500/20 border border-violet-400/40 text-violet-200 px-3 py-1.5 text-[11px] flex items-center gap-1.5 hover:bg-violet-500/30 transition"
                >
                  {replay.playing ? <Pause size={12} /> : <Play size={12} />} {replay.playing ? t('swarm.pause') : t('swarm.replay')}
                </button>
                <input
                  type="range"
                  min={replay.t0}
                  max={replay.t1}
                  step={1000}
                  value={replay.cursor}
                  onChange={(e) => setReplay((r) => r ? { ...r, cursor: Number(e.target.value), playing: false } : r)}
                  className="flex-1 accent-violet-500"
                />
                <select
                  value={replay.speed}
                  onChange={(e) => setReplay((r) => r ? { ...r, speed: Number(e.target.value) } : r)}
                  className="rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-[10.5px] outline-none"
                >
                  <option value={2}>2×</option>
                  <option value={8}>8×</option>
                  <option value={30}>30×</option>
                  <option value={120}>120×</option>
                </select>
                <span className="text-[10px] opacity-50 tabular-nums whitespace-nowrap">
                  {new Date(replay.cursor).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <button onClick={() => setReplay(null)} className="rounded-lg p-1.5 opacity-50 hover:opacity-100 transition"><Ban size={13} /></button>
              </div>
              <p className="text-[9.5px] opacity-45">{t('swarm.replayHint')}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Visning af arbejdet">
            <button className="btn-ghost text-xs" aria-pressed={mapMode === 'work'} onClick={() => setMapMode('work')}>Arbejdskort</button>
            <button className="btn-ghost text-xs" aria-pressed={mapMode === 'constellation'} onClick={() => setMapMode('constellation')}>Konstellation</button>
          </div>
          {mapMode === 'work' ? <OrbitWorkMap key={shown.runId} run={shown} services={services} connected={connected} historical={Boolean(archived || replay)} now={replay?.cursor ?? Date.now()} /> : <div className="rounded-2xl border border-white/10 bg-black/10 dark:bg-black/25 overflow-hidden relative h-[300px] sm:h-[380px]">
            <SwarmCanvas run={shown} services={services} active={active || Boolean(replay?.playing)} />
            <MiniMap jobs={jobs} />
            {(shown.notes?.length ?? 0) > 0 && <div className="absolute left-3 bottom-2 right-3 text-[10px] opacity-45 truncate">{shown.notes[shown.notes.length - 1]}</div>}
          </div>}

          {/* tidslinje: præcis hvem arbejdede hvornår, inkl. underagenter */}
          <RunTimeline run={shown} services={services} active={active || Boolean(replay?.playing)} />

          {/* agent-kort */}
          {mapMode === 'constellation' && jobs.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {[...jobs]
                .sort((a, b) => (a.status === 'running' ? -1 : b.status === 'running' ? 1 : a.status === 'error' ? -1 : b.status === 'error' ? 1 : 0))
                .map((j) => (
                  <JobCard
                    key={j.id}
                    j={j}
                    services={services}
                    runActive={active}
                    onSkip={active && run ? (jobId) => void skipRunJob(run.runId, jobId) : undefined}
                  />
                ))}
            </div>
          )}
        </>
      )}

      {/* Sjældent brugte driftsfunktioner ligger bag en tydelig indgang. */}
      <details className="rounded-xl border border-current/10 p-3"><summary className="cursor-pointer text-xs opacity-65">Automatisering, skabeloner og analyse</summary>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        <TriggersPanel />
        <TemplatesPanel services={services} />
        <CostsPanel />
        <AnalysisPanel />
        <CompareRunsPanel />
      </div>

      </details>

      <RunHistory refreshKey={`${run?.runId ?? ''}:${run?.status ?? ''}`} onOpen={r => void openArchived(r)} />

      {/* godkendelsesmodal til plan-pause */}
      {approval && <ApprovalModal services={services} open={hiddenApproval !== approval.runId} onClose={() => setHiddenApproval(approval.runId)} />}

      {/* lille toast til handlinger (genoptagelse, link, eksport) */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-zinc-900 dark:bg-zinc-800 border border-white/10 px-4 py-2 text-[12px] text-zinc-100 shadow-2xl animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

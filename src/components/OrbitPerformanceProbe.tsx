import { useEffect, useRef, useState } from 'react';
import { useSwarm } from '../lib/swarm';

type Measurement = {
  runId: string | null; measuredAt: string; userAgent: string; viewport: { width: number; height: number; pixelRatio: number };
  durationMs: number; frames: number; medianFrameMs: number | null; p95FrameMs: number | null; maxFrameMs: number | null;
  framesOver50ms: number; activeServices: string[]; maxVisibleAgents: number; maxAnimations: number;
  textEventsObserved: number; reducedMotion: boolean; interrupted: boolean; runChanged: boolean;
};

export default function OrbitPerformanceProbe() {
  const [measuring, setMeasuring] = useState(false);
  const [result, setResult] = useState<Measurement | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  const measure = () => {
    if (measuring) return;
    setMeasuring(true); setResult(null);
    const started = performance.now(), initialRun = useSwarm.getState().run?.runId;
    const gaps: number[] = [], services = new Set<string>();
    const counts = new Map<string, number>();
    let last: number | null = null, frame = 0, timer = 0, nextSample = 0;
    let maxVisibleAgents = 0, maxAnimations = 0, textEventsObserved = 0, runChanged = false;
    for (const job of useSwarm.getState().run?.jobs ?? []) counts.set(job.id, job.deltaCount);
    const unsubscribe = useSwarm.subscribe(state => {
      if (state.run?.runId !== initialRun) { runChanged = true; return; }
      for (const job of state.run?.jobs ?? []) {
        const previous = counts.get(job.id) ?? 0;
        textEventsObserved += Math.max(0, job.deltaCount - previous); counts.set(job.id, job.deltaCount);
      }
    });
    const cleanup = () => { cancelAnimationFrame(frame); clearTimeout(timer); unsubscribe(); document.removeEventListener('visibilitychange', visibility); cancel.current = null; };
    const finish = (interrupted: boolean) => {
      cleanup(); gaps.sort((a, b) => a - b);
      setResult({ runId: initialRun ?? null, measuredAt: new Date().toISOString(), userAgent: navigator.userAgent,
        viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio }, durationMs: Math.round(performance.now() - started),
        frames: gaps.length, medianFrameMs: gaps.length ? gaps[Math.floor(gaps.length * .5)] : null,
        p95FrameMs: gaps.length ? gaps[Math.floor(gaps.length * .95)] : null, maxFrameMs: gaps.at(-1) ?? null,
        framesOver50ms: gaps.filter(gap => gap > 50).length, activeServices: [...services], maxVisibleAgents, maxAnimations,
        textEventsObserved, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, interrupted, runChanged });
      setMeasuring(false);
    };
    const visibility = () => { if (document.hidden) finish(true); };
    const sample = (now: number) => {
      if (last !== null && gaps.length < 10_000) gaps.push(now - last);
      last = now;
      // Read the DOM at most twice per second. No per-frame React updates.
      if (now >= nextSample) {
        nextSample = now + 500;
        const universe = document.querySelector('.orbit-universe');
        for (const orb of universe?.querySelectorAll('[data-service-orb]:has([data-working=true])') ?? []) services.add(orb.getAttribute('data-service-orb')!);
        maxVisibleAgents = Math.max(maxVisibleAgents, universe?.querySelectorAll('[data-subagent-orb]').length ?? 0);
        maxAnimations = Math.max(maxAnimations, universe?.getAnimations({ subtree: true }).length ?? 0);
      }
      frame = requestAnimationFrame(sample);
    };
    cancel.current = cleanup;
    document.addEventListener('visibilitychange', visibility);
    timer = window.setTimeout(() => finish(document.hidden), 10_000);
    frame = requestAnimationFrame(sample);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'orbit-performance.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <details className="px-4 pb-3 text-xs">
    <summary className="cursor-pointer opacity-65">Mål visningens performance</summary>
    <p className="my-2 opacity-65">Mål i 10 sekunder, mens arbejdet kører. Hold fanen synlig. Målingen starter ingen AI-kald.</p>
    <button className="btn-ghost text-xs" disabled={measuring} onClick={measure}>{measuring ? 'Måler i 10 sekunder…' : 'Start performancemåling'}</button>
    {result && <div role="status" className="mt-2 space-y-2">
      <p>{result.interrupted || result.runChanged ? 'Ufuldstændig måling · fanen blev skjult eller kørslen skiftede.' : 'Måling afsluttet.'} {result.frames} frames · median {result.medianFrameMs?.toFixed(1) ?? 'ukendt'} ms · p95 {result.p95FrameMs?.toFixed(1) ?? 'ukendt'} ms.</p>
      <p className="opacity-65">{result.activeServices.length} aktive tjenester · {result.maxVisibleAgents} synlige underagenter · {result.textEventsObserved} teksthændelser under målingen. {result.textEventsObserved === 0 ? 'Ingen tekststream registreret; dette dokumenterer ikke performance under streaming.' : 'Teksthændelser dokumenterer aktivitet, ikke kvalitet eller en bestemt leverandørkonto.'}</p>
      <button className="btn-ghost text-xs" onClick={download}>Gem måling som JSON</button>
    </div>}
  </details>;
}

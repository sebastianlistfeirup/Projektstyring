import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, CheckCircle2, Circle, GitBranch, PauseCircle, ShieldCheck } from 'lucide-react';
import { useSwarm, connectSwarm } from '../lib/swarm';
import { approvePlan, cancelRun, resumeRun, sendRunMessage } from '../lib/aiApi';
import ProjectPlanReview from './ProjectPlanReview';
import RunContextPanel from './RunContextPanel';
import VerificationHistory from './VerificationHistory';
import JobReview from './JobReview';

const labels: Record<string, string> = { running: 'Arbejder', awaiting_approval: 'Afventer din planbeslutning', done: 'Leveret til gennemgang', error: 'Fejlet', blocked: 'Blokeret', partial: 'Delvist leveret', cancelled: 'Stoppet', interrupted: 'Afbrudt ved genstart', queued: 'I kø', skipped: 'Sprunget over' };

export default function OrbitRunPanel({ projectId }: { projectId?: string | null }) {
  const run = useSwarm(s => s.run);
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { connectSwarm(); }, []);
  if (!run || (run.projectId && run.projectId !== projectId)) return null;
  const active = ['running', 'awaiting_approval'].includes(run.status);
  const done = run.jobs.filter(j => j.status === 'done').length;
  async function act(action: () => Promise<boolean>, success: string) {
    setBusy(true);
    try { setFeedback(await action() ? success : 'Handlingen kunne ikke udføres. Opdatér tilstanden og prøv igen.'); }
    catch { setFeedback('Forbindelsen blev afbrudt. Kontrollér kørslen før et nyt forsøg.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Orbit Live" className="rounded-2xl border border-indigo-400/25 bg-indigo-500/5 p-4 space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <Activity size={16} className="text-indigo-400" /><h2 className="font-semibold text-sm">Orbit Live</h2>
      <span className="text-xs opacity-75">{labels[run.status] ?? run.status}</span>
      <Link to="/swarm" className="ml-auto text-xs text-indigo-400 underline">Åbn arbejdskort</Link>
    </div>
    <p className="text-sm line-clamp-2">{run.goal}</p>
    <div className="flex items-center gap-3 text-xs"><progress aria-label="Leverede jobs" value={done} max={Math.max(1, run.jobs.length)} className="flex-1 h-2 accent-indigo-500" /><span>{done}/{run.jobs.length} leveret</span></div>
    <ol className="grid gap-2 sm:grid-cols-2">
      {run.jobs.map(j => <li key={j.id} className="rounded-xl border border-current/10 p-3 text-xs space-y-1">
        <div className="flex items-center gap-2">{j.status === 'done' ? <CheckCircle2 size={14} className="text-emerald-500" /> : j.status === 'running' ? <Activity size={14} className="text-indigo-400" /> : <Circle size={14} />}<strong>{j.title}</strong></div>
        <p className="opacity-70">{j.serviceId ?? 'Ingen tjeneste'} · {labels[j.status] ?? j.status}</p>
        {j.dependsOn.length > 0 && <p className="opacity-60">Afhænger af: {j.dependsOn.map(d => run.jobs[d]?.title ?? '?').join(', ')}</p>}
        <JobReview job={j} />
        {j.error && <p className="text-rose-500">{j.error}</p>}
        {j.liveText && j.status === 'running' && <p className="line-clamp-2 opacity-60">{j.liveText}</p>}
        {!!j.actions?.length && <details open={j.status === 'running'}><summary className="cursor-pointer opacity-70">Seneste værktøjer og filer · {j.actions.length}</summary><ol className="mt-2 space-y-2 border-l border-indigo-400/30 pl-2">{j.actions.slice(-8).map(a => <li key={a.id}><span className={a.status === 'error' ? 'text-rose-400' : a.status === 'running' ? 'text-indigo-400' : 'opacity-70'}>{a.status === 'running' ? 'I gang' : a.status === 'error' ? 'Fejl' : 'Afsluttet'} · {a.kind}</span><p className="font-mono break-all whitespace-pre-wrap">{a.label}</p>{a.detail && <details><summary className="cursor-pointer opacity-60">Resultat</summary><pre className="max-h-32 overflow-auto whitespace-pre-wrap">{a.detail}</pre></details>}</li>)}</ol></details>}
        {!!j.subagents?.length && <ul className="border-l border-indigo-400/30 pl-2">{j.subagents.map(a => <li key={a.subId}>{a.name} · {labels[a.status] ?? a.status}</li>)}</ul>}
      </li>)}
    </ol>
    <RunContextPanel run={run} />
    <VerificationHistory run={run} />
    {run.evidence && <p className="text-xs break-all flex gap-2"><GitBranch size={14} className="shrink-0" />Commit {run.evidence.commit} · {run.evidence.changedFiles.length} ændrede filer</p>}
    {run.verification && <details className="text-xs"><summary className="cursor-pointer flex items-center gap-2"><ShieldCheck size={14} />Kontroller: {run.verification.status === 'passed' ? 'Bestået' : run.verification.status === 'failed' ? 'Fejlet' : 'Ikke kørt / ikke konfigureret'}</summary><div className="mt-2 space-y-2">{run.verification.checks.map((c, i) => <div key={i}><b>{c.name}: {c.status} (exit {c.exitCode ?? 'ukendt'})</b><pre className="max-h-48 overflow-auto whitespace-pre-wrap bg-black/10 p-2 rounded">{c.output}</pre></div>)}</div></details>}
    {run.status === 'done' && run.projectId && run.projectPlan && <ProjectPlanReview key={run.runId} runId={run.runId} plan={run.projectPlan} />}
    {run.projectPlanError && <p className="text-amber-500 text-xs">{run.projectPlanError} Gennemgå tekstleverancen; ingen opgaver er oprettet.</p>}
    <div className="flex flex-wrap gap-2">
      {run.status === 'awaiting_approval' && <button disabled={busy} className="btn-primary text-xs" onClick={() => act(() => approvePlan(run.runId, run.jobs), 'Planen er godkendt. Hvis kørslen er gendannet, brug Genoptag først.')}>Godkend planen</button>}
      {active && <button disabled={busy} className="btn-ghost text-xs" onClick={() => act(() => cancelRun(run.runId), 'Stop sendt. Afventer igangværende proces.')}><PauseCircle size={14} />Stop</button>}
      {run.status !== 'running' && run.status !== 'done' && <button disabled={busy} className="btn-ghost text-xs" onClick={() => act(async () => (await resumeRun(run.runId)).ok, 'Genoptaget med gemt kontekst. Eksterne handlinger fra et afbrudt job skal kontrolleres før genforsøg.')}>Genoptag</button>}
    </div>
    {active && <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (message.trim()) void act(async () => { const ok = await sendRunMessage(run.runId, message.trim()); if (ok) setMessage(''); return ok; }, 'Modtaget. Beskeden gælder fra næste job; det igangværende job fortsætter med sin oprindelige kontekst.'); }}>
      <input aria-label="Besked til den aktive kørsel" className="input min-w-0 flex-1 text-xs" placeholder="Præcisér arbejdet…" value={message} onChange={e => setMessage(e.target.value)} />
      <button disabled={busy || !message.trim()} className="btn-ghost text-xs">Send</button>
    </form>}
    {feedback && <p role="status" className="text-xs">{feedback}</p>}
  </section>;
}

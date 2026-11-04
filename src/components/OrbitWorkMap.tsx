import { useMemo, useState } from 'react';
import { Activity, ArrowRight, Bot, CheckCircle2, ChevronRight, FileText, GitBranch, ShieldCheck } from 'lucide-react';
import { serviceName, type SwarmRun } from '../lib/swarm';
import type { AiServiceInfo } from '../lib/aiApi';
import { jobStages, runLabels, verificationLabels, waitingReason } from '../lib/runPresentation';
import ChatMarkdown from './ChatMarkdown';
import RunContextPanel from './RunContextPanel';
import VerificationHistory from './VerificationHistory';
import JobReview from './JobReview';
import CodeChanges from './CodeChanges';

const tones: Record<string, string> = {
  running: 'border-indigo-400 bg-indigo-500/10', done: 'border-emerald-500/40 bg-emerald-500/5',
  error: 'border-rose-500/50 bg-rose-500/5', blocked: 'border-amber-500/40 bg-amber-500/5',
};
function age(at: number | null | undefined, now: number) {
  if (!at) return 'ukendt';
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return seconds < 60 ? `${seconds} sek.` : seconds < 3600 ? `${Math.floor(seconds / 60)} min.` : `${Math.floor(seconds / 3600)} t. ${Math.floor(seconds % 3600 / 60)} min.`;
}
function clock(at: number | null | undefined) {
  return at ? new Date(at).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'medium' }) : 'Ikke registreret';
}

export default function OrbitWorkMap({ run, services, connected, historical = false, now = Date.now(), selectedJobId, onSelectJob }: {
  run: SwarmRun; services: Record<string, AiServiceInfo> | null; connected: boolean; historical?: boolean; now?: number; selectedJobId?: string; onSelectJob?: (id: string) => void;
}) {
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const selectedId = selectedJobId ?? localSelectedId;
  const setSelectedId = onSelectJob ?? setLocalSelectedId;
  const [service, setService] = useState('all');
  const stages = useMemo(() => jobStages(run.jobs), [run.jobs]);
  const columns = Array.from(new Set(stages)).sort((a, b) => a - b);
  const serviceIds = Array.from(new Set(run.jobs.map(j => j.serviceId).filter((id): id is string => Boolean(id))));
  const selected = run.jobs.find(j => j.id === selectedId) ?? run.jobs.find(j => j.status === 'running') ?? run.jobs.find(j => ['error', 'blocked'].includes(j.status)) ?? run.jobs[0];
  const selectedIndex = run.jobs.indexOf(selected);
  const related = new Set([selectedIndex, ...(selected?.dependsOn ?? []), ...run.jobs.flatMap((j, i) => j.dependsOn.includes(selectedIndex) ? [i] : [])]);
  const live = !historical && ['running', 'awaiting_approval'].includes(run.status);
  const stale = live && (!run.heartbeatAt || now - run.heartbeatAt > 35_000);
  const subagents = run.jobs.flatMap(j => j.subagents ?? []);
  return <section aria-label="Arbejdskort" className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white/40 dark:bg-slate-950/30 overflow-hidden">
    <div className="p-4 border-b border-zinc-200 dark:border-white/10 flex flex-wrap items-start gap-3">
      <div className="flex-1 min-w-48">
        <h2 className="font-semibold flex items-center gap-2"><GitBranch size={17} /> Fra opgave til dokumenteret resultat</h2>
        <p className="text-xs opacity-65 mt-1">Vælg en opgave for at følge dens værktøjer, afhængigheder og leverance.</p>
      </div>
      <div className="text-xs text-right space-y-1">
        <p className={stale ? 'text-amber-600 dark:text-amber-400' : 'opacity-70'}>{historical ? 'Gemt forløb' : live ? stale ? 'Status kan være forsinket' : 'Kørselsmotoren svarer' : runLabels[run.status]}</p>
        {live && <p className="opacity-50" title="Heartbeat viser, at kørselsmotoren svarer. Det dokumenterer ikke, at modellen gør fremskridt.">Heartbeat: {age(run.heartbeatAt, now)} siden · {connected ? 'Liveforbindelse' : 'Henter status periodisk'}</p>}
        {subagents.length > 0 && <p className="opacity-60">{subagents.filter(s => s.status === 'running').length} aktive / {subagents.length} registrerede underagenter</p>}
      </div>
    </div>
    {serviceIds.length > 1 && <div role="group" aria-label="Fremhæv tjeneste" className="px-4 pt-3 flex flex-wrap gap-2">
      {['all', ...serviceIds].map(id => <button key={id} aria-pressed={service === id} onClick={() => setService(id)} className={`rounded-full border px-3 py-1 text-xs ${service === id ? 'border-indigo-400 bg-indigo-500/15' : 'border-zinc-200 dark:border-white/10 opacity-65'}`}>{id === 'all' ? 'Alle tjenester' : serviceName(services, id)}</button>)}
    </div>}
    {run.jobs.length === 0 ? <p className="p-6 text-sm opacity-65">Planlæggeren undersøger målet. Opgaverne vises, når planen er klar.</p> : <>
      <div className="overflow-x-auto p-4" role="region" aria-label="Opgavernes afhængigheder" tabIndex={0}>
        <div className="flex gap-6 min-w-fit items-start">
          {columns.map(stage => <div key={stage} className="w-60 shrink-0 space-y-3">
            <h3 className="text-[10px] uppercase tracking-widest opacity-50 flex items-center gap-2">Trin {stage + 1}<ArrowRight size={12} /></h3>
            {run.jobs.map((job, index) => stages[index] !== stage ? null : <button key={job.id} aria-pressed={selected?.id === job.id} aria-label={`Opgave ${index + 1}: ${job.title}`} onClick={() => setSelectedId(job.id)} className={`text-left w-full p-3 rounded-xl border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 ${tones[job.status] ?? 'border-zinc-300 dark:border-white/[0.15] bg-black/[0.02]'} ${selected?.id === job.id ? 'ring-2 ring-indigo-400 ring-offset-2 ring-offset-transparent' : ''} ${service !== 'all' && service !== job.serviceId ? 'opacity-40' : ''}`}>
              <div className="flex items-center justify-between gap-2 text-[10px] mb-2"><span className="opacity-65">{String(index + 1).padStart(2, '0')} · {serviceName(services, job.serviceId)}</span><span className="font-medium">{runLabels[job.status]}</span></div>
              <div className="font-semibold text-sm leading-snug">{job.title}</div>
              <p className="text-xs opacity-65 mt-2 line-clamp-2 min-h-8">{waitingReason(job, run)}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[10px] opacity-65">
                {job.dependsOn.length > 0 && <span className={related.has(index) ? 'text-indigo-600 dark:text-indigo-300' : ''}>Efter {job.dependsOn.map(i => String(i + 1).padStart(2, '0')).join(', ')}</span>}
                {!!job.actions?.length && <span>{job.actions.length} seneste hændelser</span>}
                {!!job.subagents?.length && <span>{job.subagents.length} underagenter</span>}
              </div>
            </button>)}
          </div>)}
        </div>
      </div>
      {selected && <div className="border-t border-zinc-200 dark:border-white/10 p-4 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6" role="region" aria-label="Valgt opgave">
        <div className="min-w-0 space-y-3">
          <div><p className="text-[10px] uppercase tracking-widest opacity-50">Opgave {selectedIndex + 1} · {serviceName(services, selected.serviceId)}</p><h3 className="font-semibold text-base mt-1">{selected.title}</h3></div>
          <p className={`text-sm ${selected.error ? 'text-rose-600 dark:text-rose-400' : 'opacity-70'}`}>{waitingReason(selected, run)}</p>
          <dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="opacity-50">Startet</dt><dd>{clock(selected.startedAt)}</dd></div><div><dt className="opacity-50">Afsluttet</dt><dd>{clock(selected.finishedAt)}</dd></div></dl>
          {!!selected.dependsOn.length && <div className="text-xs"><p className="opacity-50 mb-1">Kræver en leverance fra</p>{selected.dependsOn.map(index => run.jobs[index] && <button key={index} onClick={() => setSelectedId(run.jobs[index].id)} className="flex items-center gap-1 text-indigo-600 dark:text-indigo-300 py-1"><ChevronRight size={12} />{run.jobs[index].title} · {runLabels[run.jobs[index].status]}</button>)}</div>}
          {selected.description && <details className="text-xs"><summary className="cursor-pointer opacity-70">Arbejdsbeskrivelse</summary><p className="whitespace-pre-wrap mt-2 opacity-70">{selected.description}</p></details>}
          {!!selected.contextDocuments?.length && <details className="text-xs"><summary className="cursor-pointer opacity-70">Filer indsat som kontekst</summary><ul className="mt-2 space-y-2">{selected.contextDocuments.map((doc, i) => <li key={i}><p className="font-mono break-all">{doc.path}</p><p className="opacity-60">{doc.status === 'included' ? `Hele filen · ${doc.bytes} bytes` : doc.reason}</p></li>)}</ul></details>}
          {!!selected.subagents?.length && <div><h4 className="text-xs font-semibold flex items-center gap-1.5"><Bot size={14} />Underagenter</h4><ul className="mt-2 border-l border-indigo-400/30 pl-3 space-y-2">{selected.subagents.map(agent => <li key={agent.subId} className="text-xs"><p className="font-medium">{agent.name} · {runLabels[agent.status]}</p><p className="opacity-55">{clock(agent.startedAt)}{agent.finishedAt ? ` → ${clock(agent.finishedAt)}` : ''}</p>{agent.text && <p className="mt-1 opacity-70 whitespace-pre-wrap">{agent.text}</p>}</li>)}</ul></div>}
          <JobReview job={selected} services={services} />
          {selected.text && <details className="text-sm"><summary className="cursor-pointer flex items-center gap-2 text-xs font-semibold"><FileText size={14} />Leverance fra opgaven</summary><div className="mt-3 max-h-96 overflow-auto"><ChatMarkdown text={selected.text} />{selected.textTruncated && <a className="text-xs text-indigo-500 underline" href={`http://127.0.0.1:4310/api/ai/runs/${encodeURIComponent(run.runId)}/export`} target="_blank" rel="noreferrer">Uddrag — hent hele leverancen</a>}</div></details>}
          {!!selected.artifacts.length && <ul className="text-xs space-y-1">{selected.artifacts.map((artifact, i) => <li key={i}>{artifact.url && /^(https?:|\/)/.test(artifact.url) ? <a className="underline text-indigo-600 dark:text-indigo-300" href={artifact.url} target="_blank" rel="noreferrer">{artifact.name}</a> : artifact.name}</li>)}</ul>}
        </div>
        <div className="min-w-0">
          <h4 className="text-xs font-semibold flex items-center gap-2"><Activity size={14} />Seneste værktøjshændelser</h4>
          {selected.actions?.length ? <ol className="mt-3 space-y-3 max-h-96 overflow-auto pr-1">{[...selected.actions].reverse().map(action => <li key={action.id} className="border-l-2 border-zinc-300 dark:border-white/[0.15] pl-3 text-xs"><div className="flex justify-between gap-3 opacity-55"><span>{action.kind} · {runLabels[action.status]}</span><time>{clock(action.at)}</time></div><p className="font-mono break-all whitespace-pre-wrap mt-1">{action.label}</p>{action.detail && <details className="mt-1"><summary className="cursor-pointer opacity-60">Resultat</summary><pre className="whitespace-pre-wrap break-all max-h-48 overflow-auto bg-black/5 p-2 mt-1 rounded">{action.detail}</pre></details>}</li>)}</ol> : <p className="text-xs opacity-55 mt-3">Denne opgave har ingen registrerede værktøjshændelser. Tekstaktivitet alene dokumenterer ikke filændringer eller tests.</p>}
          {selected.status === 'running' && selected.lastDeltaAt && <p className="text-[10px] opacity-50 mt-3">Seneste tekst fra tjenesten: {age(selected.lastDeltaAt, now)} siden</p>}
        </div>
      </div>}
    </>}
    {run.repository && Boolean(run.evidence?.commit || run.results?.length) && <div className="px-4 pb-3"><CodeChanges key={`${run.runId}:${run.evidence?.commit ?? ""}`} runId={run.runId} commit={run.evidence?.commit} /></div>}
    {!!run.verificationHistory?.length && <div className="px-4 pb-4"><VerificationHistory run={run} /></div>}
    {run.contextManifest && <div className="px-4 pb-4"><RunContextPanel run={run} /></div>}
    <div className="border-t border-zinc-200 dark:border-white/10 p-4 grid sm:grid-cols-2 gap-4 text-xs">
      <div><h3 className="font-semibold flex gap-2 items-center"><GitBranch size={14} />Kodeleverance</h3>{run.evidence ? <><p className="font-mono break-all mt-2">{run.evidence.commit}</p><p className="opacity-65 mt-1">{run.evidence.changedFiles.length} ændrede filer på kørselsgrenen</p><details className="mt-2"><summary className="cursor-pointer opacity-65">Filer og ændringsoversigt</summary><pre className="whitespace-pre-wrap break-all mt-2">{run.evidence.changedFiles.join('\n')}\n{run.evidence.diffStat}</pre></details></> : <p className="opacity-55 mt-2">Ingen Git-leverance registreret endnu.</p>}</div>
      <div><h3 className="font-semibold flex gap-2 items-center"><ShieldCheck size={14} />Faktiske kontroller</h3>{run.verification?.checks.length ? <ul className="mt-2 space-y-2">{run.verification.checks.map((check, index) => <li key={index}><details><summary className="cursor-pointer flex gap-2 items-center">{check.status === 'passed' && <CheckCircle2 size={12} className="text-emerald-500" />}{check.name}: {verificationLabels[check.status] ?? check.status} · exit {check.exitCode ?? 'ukendt'}</summary><pre className="whitespace-pre-wrap break-all max-h-48 overflow-auto mt-2 p-2 bg-black/5 rounded">{check.output}</pre></details></li>)}</ul> : <p className="opacity-55 mt-2">Ingen udførte kontroller registreret. Leverancen er ikke dokumenteret testet.</p>}</div>
    </div>
  </section>;
}

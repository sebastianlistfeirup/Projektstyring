import { useEffect, useState } from 'react';
import { ListOrdered, Pause, Play, X } from 'lucide-react';
import { controlAiQueue, fetchAiQueue, type AiQueueState } from '../lib/aiApi';
import { runLabels } from '../lib/runPresentation';
import { useStore } from '../store/useStore';

export default function RunQueuePanel() {
  const [queue, setQueue] = useState<AiQueueState | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const projects = useStore(state => state.projects);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => { const next = await fetchAiQueue(); if (!disposed) setQueue(next); };
    void refresh(); const timer = setInterval(() => void refresh(), 3000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  async function act(action: 'pause' | 'resume' | 'cancel', id?: string) {
    setBusy(true); const result = await controlAiQueue(action, id);
    setFeedback(result.ok ? action === 'pause' ? 'Køen er sat på pause. Den aktive kørsel fortsætter.' : action === 'resume' ? 'Køen fortsætter, når motoren er ledig.' : 'Opgaven er fjernet fra køen.' : result.reason ?? 'Handlingen mislykkedes.');
    setQueue(await fetchAiQueue()); setBusy(false);
  }
  if (!queue) return null;
  const pending = queue.entries.filter(entry => ['queued', 'running'].includes(entry.status));
  const recent = queue.entries.filter(entry => !['queued', 'running'].includes(entry.status)).slice(-5).reverse();
  return <section aria-label="AI-arbejdskø" className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-indigo-500/5 p-4 text-xs space-y-3">
    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold flex items-center gap-2"><ListOrdered size={15} />Arbejdskø · {pending.length} opgaver</h2><span className="opacity-60">{queue.paused ? 'På pause' : pending.length ? 'Fortsætter automatisk' : 'Klar til arbejdsordrer'}</span><button disabled={busy || Boolean(queue.storageError)} className="btn-ghost text-xs ml-auto" onClick={() => void act(queue.paused ? 'resume' : 'pause')}>{queue.paused ? <Play size={13} /> : <Pause size={13} />}{queue.paused ? 'Fortsæt køen' : 'Pause efter denne kørsel'}</button></div>
    {queue.reason && <p className="text-amber-600 dark:text-amber-400">{queue.reason}</p>}
    {pending.length ? <ol className="space-y-2">{pending.map((entry, index) => <li key={entry.id} className="flex gap-3 items-start rounded-xl border border-zinc-200 dark:border-white/10 p-3"><span className="opacity-40 tabular-nums">{index + 1}</span><div className="min-w-0 flex-1"><p className="font-medium break-words">{entry.name}</p><p className="opacity-60 mt-1">{projects.find(project => project.id === entry.input.projectId)?.name ?? 'Uden projekttilknytning'} · {runLabels[entry.status] ?? entry.status}</p>{entry.runId && <p className="font-mono opacity-40 mt-1">{entry.runId}</p>}</div>{entry.status === 'queued' && <button disabled={busy} onClick={() => void act('cancel', entry.id)} aria-label={`Fjern ${entry.name} fra køen`} className="btn-ghost p-1"><X size={14} /></button>}</li>)}</ol> : null}
    <details><summary className="cursor-pointer opacity-65">Om køen og seneste opgaver</summary><div className="space-y-3 mt-3">
    <p className="opacity-65">Læg arbejdsordrer i kø fra opgavens detaljevisning. Projektgrundlag, scope og kapacitet kontrolleres igen ved start.</p>
    {!!recent.length && <details><summary className="cursor-pointer opacity-65">Seneste køopgaver</summary><ul className="mt-2 space-y-2">{recent.map(entry => <li key={entry.id}><p>{entry.name} · {entry.status === 'done' ? 'Til gennemgang' : runLabels[entry.status] ?? entry.status}</p>{entry.reason && <p className="opacity-55 mt-1">{entry.reason}</p>}{entry.runId && <a className="underline text-indigo-500" href={`http://127.0.0.1:4310/api/ai/runs/${encodeURIComponent(entry.runId)}/export`} target="_blank" rel="noreferrer">Leverance og kontroller</a>}</li>)}</ul></details>}
    <p className="opacity-50">Én kørsel ad gangen. Fejl pauser køen. Companion skal være åben på en vågen maskine; lukning af browseren stopper ikke arbejdet.</p>
    </div></details>
    {feedback && <p role="status">{feedback}</p>}
  </section>;
}

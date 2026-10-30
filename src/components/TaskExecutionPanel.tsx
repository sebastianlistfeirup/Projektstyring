import { useNavigate } from 'react-router-dom';
import { Bot, ExternalLink } from 'lucide-react';
import type { Task } from '../lib/types';
import { useStore } from '../store/useStore';

const labels: Record<string, string> = { running: 'Arbejder', awaiting_approval: 'Plan afventer godkendelse', done: 'Leveret til gennemgang', error: 'Fejlet', partial: 'Delvist leveret', blocked: 'Blokeret', cancelled: 'Stoppet', interrupted: 'Afbrudt' };
export default function TaskExecutionPanel({ task }: { task: Task }) {
  const navigate = useNavigate();
  const link = useStore(s => s.aiTaskLinks[task.id]);
  const delivery = task.aiDelivery;
  function open() {
    const store = useStore.getState();
    const existing = link ? store.aiChats.find(c => c.projectId === task.projectId && c.messages.some(m => m.runId === link.runId)) : null;
    const chat = existing ?? store.addAiChat({ projectId: task.projectId, title: task.title });
    store.setActiveProject(task.projectId); store.selectTask(null);
    sessionStorage.setItem('orbit-active-chat', chat.id);
    navigate(`/chat?chat=${encodeURIComponent(chat.id)}&task=${encodeURIComponent(task.id)}`);
  }
  return <section className="rounded-xl border border-indigo-400/20 bg-indigo-500/5 p-3.5 text-xs space-y-2" aria-label="AI-leverance">
    <h3 className="font-semibold flex gap-2 items-center"><Bot size={15} />Orbit-arbejdsordre</h3>
    {delivery ? <><p>{labels[delivery.status] ?? delivery.status} · Kontroller: {delivery.verification === 'passed' ? 'bestået' : delivery.verification === 'failed' ? 'fejlet' : 'ikke kørt / ikke valgt'}</p>{delivery.commit && <p className="font-mono break-all opacity-70">{delivery.commit}</p>}{delivery.status === 'done' && task.status === 'inprogress' && <p className="text-amber-500">Leverancen er klar, men opgaven er stadig i gang. Kontrollér grænsen i review-kolonnen.</p>}</> : <p className="opacity-70">Åbn opgaven i Orbit med projektbibel, repository og acceptkriterier.</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary text-xs" onClick={open}>Åbn i Orbit</button>{link && <a className="btn-ghost text-xs" href={`http://127.0.0.1:4310/api/ai/runs/${encodeURIComponent(link.runId)}/export`} target="_blank" rel="noreferrer"><ExternalLink size={13} />Leverance og kontroller</a>}</div>
  </section>;
}

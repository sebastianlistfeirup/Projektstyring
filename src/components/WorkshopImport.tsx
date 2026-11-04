import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { pullAndMerge, pushNow } from '../lib/sync';
import type { AiJob } from '../lib/types';

export default function WorkshopImport({ projectId, jobs }: { projectId: string; jobs: AiJob[] }) {
  const tasks = useStore(state => state.tasks);
  const [selected, setSelected] = useState(() => jobs.filter(job => job.status !== 'done' && !tasks.some(task => task.projectId === projectId && task.aiWorkshopSource?.jobId === job.id)).map(job => job.id));
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  async function importJobs() {
    if (busy || !selected.length) return;
    setBusy(true); setFeedback('');
    try {
      if (!await pushNow()) throw new Error('Projektet kunne ikke gemmes på Companion.');
      const response = await fetch('http://127.0.0.1:4310/api/ai/workshop/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, selectedIds: selected }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.reason ?? 'Overførslen fejlede.');
      await pullAndMerge();
      setFeedback(`${result.createdIds.length} arbejdsordrer oprettet i backlog. ${result.existingIds.length} fandtes allerede.`);
    } catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section aria-label="Overfør AI-jobs" className="mb-5 rounded-2xl border border-indigo-400/25 p-4 space-y-3 text-sm">
    <h2 className="font-semibold">Saml arbejdet på projektets tavle</h2>
    <p>De valgte jobs bliver almindelige arbejdsordrer i backlog med beskrivelser, spørgsmål, tidligere output og afhængigheder. Gennemgå acceptkriterierne og vælg derefter arbejdsordren i Orbit-chatten eller læg den i AI-køen.</p>
    <p className="opacity-60">Overførslen starter ingen AI og ændrer ikke versionens scope. Tidligere output tæller ikke som nye testbeviser. Også tidligere færdige jobs overføres til backlog.</p>
    <div className="space-y-2 max-h-72 overflow-auto">{jobs.map(job => {
      const imported = tasks.find(task => task.projectId === projectId && task.aiWorkshopSource?.jobId === job.id);
      return <label key={job.id} className="flex gap-2 items-start"><input type="checkbox" checked={selected.includes(job.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, job.id] : ids.filter(id => id !== job.id))} /><span>{job.title}{imported && <span className="opacity-55"> · allerede overført</span>}{!!job.dependsOn.length && <span className="block text-xs opacity-60">Afhænger af: {job.dependsOn.map(id => jobs.find(item => item.id === id)?.title ?? id).join(', ')}</span>}</span></label>;
    })}</div>
    <button className="btn-primary text-xs" disabled={busy || !selected.length} onClick={() => void importJobs()}>{busy ? 'Overfører…' : `Overfør ${selected.length} valgte jobs`}</button>
    {feedback && <p role="status">{feedback}</p>}
    <Link className="text-indigo-400 underline" to="/tavle" onClick={() => useStore.getState().setActiveProject(projectId)}>Åbn projektets opgaver</Link>
  </section>;
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { pullAndMerge, pushNow } from '../lib/sync';
import type { ProjectPlan } from '../lib/types';

export default function ProjectPlanReview({ runId, plan }: { runId: string; plan: ProjectPlan }) {
  const [selected, setSelected] = useState(() => plan.tasks.filter(t => t.scope === 'version1').map(t => t.id));
  const [includeInScope, setIncludeInScope] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [imported, setImported] = useState(false);
  async function importTasks() {
    if (busy || !selected.length) return;
    setBusy(true); setFeedback('');
    try {
      if (!await pushNow()) throw new Error('Projektet kunne ikke gemmes på Companion.');
      const response = await fetch(`http://127.0.0.1:4310/api/ai/runs/${encodeURIComponent(runId)}/import-plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selectedIds: selected, includeInScope }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.reason ?? 'Forslaget kunne ikke importeres.');
      await pullAndMerge();
      setFeedback(`${result.createdIds.length} opgaver oprettet i backlog. ${result.existingIds.length} fandtes allerede fra dette forslag.`);
      setImported(true);
    } catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <details className="rounded-xl border border-indigo-400/25 p-3 text-xs" aria-label="Forslag til projektplan">
    <summary className="cursor-pointer font-semibold">Gennemse projektplan · {plan.tasks.length} opgaveforslag</summary>
    <div className="mt-3 space-y-3">
      <p>{plan.summary}</p>
      <p><strong>Foreslået versionsmål:</strong> {plan.releaseGoal}</p>
      <p><strong>Første milepæl:</strong> {plan.firstMilestone}</p>
      {!!plan.unknowns.length && <div><strong>Skal afklares:</strong><ul className="list-disc pl-5">{plan.unknowns.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      <p className="opacity-70">Kontrollerne nedenfor er forslag til arbejdet. De er ikke dokumentation for, at spillet allerede er testet.</p>
      <ul className="space-y-2 max-h-96 overflow-auto">
        {plan.tasks.map(task => <li key={task.id} className="rounded-lg border border-current/10 p-2 space-y-2">
          <label className="flex gap-2 items-start"><input type="checkbox" checked={selected.includes(task.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, task.id] : ids.filter(id => id !== task.id))} /><span><strong>{task.title}</strong> · {task.scope === 'version1' ? 'Version 1' : 'Senere idé'}</span></label>
          <details><summary className="cursor-pointer opacity-70">Afgrænsning, kriterier og grundlag</summary><div className="mt-2 space-y-2">
            <p className="whitespace-pre-wrap">{task.description}</p>
            <div><strong>Acceptkriterier</strong><ul className="list-disc pl-5">{task.acceptanceCriteria.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            <div><strong>Kontroller der skal køres</strong><ul className="list-disc pl-5">{task.verification.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            {!!task.dependsOn.length && <p>Afhænger af: {task.dependsOn.map(id => plan.tasks.find(t => t.id === id)?.title ?? id).join(', ')}</p>}
            {!!task.evidence.length && <div><strong>Grundlag fra gennemgangen</strong><ul className="list-disc pl-5">{task.evidence.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          </div></details>
        </li>)}
      </ul>
      {!!plan.tasks.length && <>
        <label className="flex gap-2 items-start"><input type="checkbox" checked={includeInScope} onChange={e => setIncludeInScope(e.target.checked)} /><span>Optag de valgte Version 1-opgaver i versionens scope. Senere idéer forbliver udenfor.</span></label>
        <button className="btn-primary text-xs" disabled={busy || !selected.length} onClick={() => void importTasks()}>{busy ? 'Opretter…' : `Opret ${selected.length} valgte opgaver`}</button>
        <p className="opacity-60">Uden scope-valget gemmes opgaverne i backlog til din videre planlægning.</p>
      </>}
      {feedback && <p role="status">{feedback}</p>}
      {imported && <Link className="text-indigo-400 underline" to="/tavle">Se opgaverne på tavlen</Link>}
    </div>
  </details>;
}

import { useState } from 'react';
import type { Project } from '../lib/types';
import { useStore } from '../store/useStore';

export default function ProjectScopePanel({ project }: { project: Project }) {
  const tasks = useStore(s => s.tasks).filter(t => t.projectId === project.id && t.status !== 'canceled');
  const update = useStore(s => s.updateProject);
  const [goal, setGoal] = useState(project.releaseGoal ?? '');
  const included = tasks.filter(t => project.scopeTaskIds?.includes(t.id));
  const later = project.scopeTaskIds ? tasks.filter(t => !project.scopeTaskIds?.includes(t.id)) : [];
  const finished = included.filter(t => t.status === 'done').length;
  return <details className="rounded-xl border border-current/10 p-3 text-xs">
    <summary className="cursor-pointer font-medium">Versionens mål {project.scopeTaskIds ? `· ${finished}/${included.length} afsluttet · ${later.length} idéer uden for scope` : '· endnu ikke afgrænset'}</summary>
    <div className="mt-3 space-y-3">
      <label className="block space-y-1"><span>Hvad skal denne version kunne?</span><textarea className="input w-full" rows={2} value={goal} onChange={e => setGoal(e.target.value)} placeholder="En spiller kan starte en kampagne, gennemføre det aftalte spillerforløb og gemme/indlæse uden tab." /></label>
      <button className="btn-primary text-xs" disabled={!goal.trim()} onClick={() => update(project.id, { releaseGoal: goal.trim(), ...(project.scopeTaskIds ? {} : { scopeTaskIds: tasks.filter(t => t.status !== 'done').map(t => t.id), scopeCapturedAt: new Date().toISOString() }) })}>{project.scopeTaskIds ? 'Gem versionsmål' : 'Fastlæg scope fra de åbne opgaver'}</button>
      <p className="opacity-70">Nye opgaver ligger uden for den fastlagte version, indtil du vælger dem til. Orbit må foreslå ændringer, men optager ikke nye idéer automatisk.</p>
      {project.scopeTaskIds && <ul className="space-y-2 max-h-48 overflow-y-auto">{tasks.map(t => <li key={t.id}><label className="flex items-start gap-2"><input type="checkbox" checked={project.scopeTaskIds?.includes(t.id)} onChange={e => update(project.id, { scopeTaskIds: e.target.checked ? [...(project.scopeTaskIds ?? []), t.id] : project.scopeTaskIds?.filter(id => id !== t.id) })} /><span>{t.title} · {t.status === 'done' ? 'Færdig' : project.scopeTaskIds?.includes(t.id) ? 'I versionen' : 'Senere idé'}</span></label></li>)}</ul>}
    </div>
  </details>;
}

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Project } from '../lib/types';
import { useStore } from '../store/useStore';
import CodeChanges from './CodeChanges';

type Check = { name: string; command: string; args: string[] };
const presets: Record<string, Check> = {
  godot: { name: 'Godot import', command: 'godot', args: ['--headless', '--editor', '--import', '--path', '.', '--quit'] },
  test: { name: 'Automatiske tests', command: 'npm', args: ['test'] },
  build: { name: 'Produktionsbuild', command: 'npm', args: ['run', 'build'] },
};

export default function ProjectExecutionSettings({ project }: { project: Project }) {
  const update = useStore(s => s.updateProject);
  const [path, setPath] = useState(project.repositoryPath ?? '');
  const [checks, setChecks] = useState<Check[]>(project.verificationChecks ?? []);
  const [continueWork, setContinueWork] = useState(project.continueVerifiedWork ?? false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  function patch(index: number, fields: Partial<Check>) { setChecks(list => list.map((c, i) => i === index ? { ...c, ...fields } : c)); }
  async function save() {
    setBusy(true);
    try {
      if (checks.length > 10 || checks.some(c => !c.command.trim())) throw new Error('Hver kontrol skal have en kommando.');
      if (continueWork && (!path.trim() || !checks.length)) throw new Error('En sammenhængende AI-arbejdsgren kræver repository og mindst én faktisk kvalitetskontrol.');
      let normalizedPath = path.trim();
      if (normalizedPath) {
        const res = await fetch('http://127.0.0.1:4310/api/ai/repository/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: normalizedPath }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.reason ?? 'Repository kunne ikke åbnes.');
        if (data.repository.dirty) throw new Error('Der er lokale ændringer. Commit eller gem dem før tilknytning.');
        normalizedPath = data.repository.source;
      }
      update(project.id, { repositoryPath: normalizedPath, continueVerifiedWork: continueWork, verificationChecks: checks.map(c => ({ ...c, command: c.command.trim(), name: c.name.trim() || c.command })) });
      setPath(normalizedPath);
      setFeedback('Gemt. Orbit arbejder på en separat Git-gren og viser resultaterne af dine kontroller.');
    } catch (e) { setFeedback(e instanceof Error ? e.message : 'Kunne ikke gemme.'); }
    finally { setBusy(false); }
  }
  return <details className="rounded-xl border border-current/10 p-3 text-xs">
    <summary className="cursor-pointer font-medium">Repository og kvalitetskontroller {project.repositoryPath ? '· tilknyttet' : '· ikke tilknyttet'}</summary>
    <div className="mt-3 space-y-3">
      <label className="block space-y-1"><span>Lokal repository-mappe på maskinen med Companion</span><input className="input w-full" value={path} onChange={e => setPath(e.target.value)} placeholder="C:\Projekter\Realmread" /></label>
      <p className="opacity-70">Orbit opretter en arbejdsgren fra dit seneste commit. Lokale ændringer skal først gemmes. Der merges eller publiceres ikke automatisk.</p>
      <div className="flex items-center justify-between gap-2"><strong>Kvalitetskontroller</strong><select aria-label="Tilføj en kontrol" className="input text-xs" value="" disabled={checks.length >= 10} onChange={e => setChecks(list => [...list, presets[e.target.value] ?? { name: '', command: '', args: [] }])}><option value="">Tilføj fra skabelon…</option><option value="godot">Godot · importér projekt</option><option value="test">Node · kør tests</option><option value="build">Node · byg projekt</option></select></div>
      {!checks.length && <p className="opacity-60">Ingen kontroller valgt. Tilføj projektets test- eller buildkommando, så Orbit kan dokumentere resultatet.</p>}
      {checks.map((check, index) => <fieldset key={index} className="rounded-lg border border-current/10 p-3 space-y-2"><legend className="px-1">Kontrol {index + 1}</legend><div className="flex gap-2"><label className="flex-1">Navn<input className="input w-full mt-1" value={check.name} onChange={e => patch(index, { name: e.target.value })} placeholder="Fx Godot import" /></label><button type="button" className="self-end btn-ghost" aria-label={`Fjern kontrol ${index + 1}`} onClick={() => setChecks(list => list.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div><label className="block">Program<input className="input w-full mt-1 font-mono" value={check.command} onChange={e => patch(index, { command: e.target.value })} placeholder="godot, npm eller en fuld sti" /></label><label className="block">Argumenter · ét pr. linje<textarea className="input w-full mt-1 font-mono" rows={Math.max(2, Math.min(7, check.args.length))} value={check.args.join('\n')} onChange={e => patch(index, { args: e.target.value ? e.target.value.split('\n') : [] })} spellCheck={false} /></label></fieldset>)}
      <button type="button" className="btn-ghost text-xs" disabled={checks.length >= 10} onClick={() => setChecks(list => [...list, { name: '', command: '', args: [] }])}><Plus size={13} />Egen kontrol</button>
      <p className="opacity-60">Kontroller køres i rækkefølge i arbejdsgrenen. Første fejl stopper kontrollen. Afhængigheder skal være installeret i arbejdsområdet, før en test kan bestå.</p>
      <label className="flex gap-2 items-start"><input type="checkbox" checked={continueWork} onChange={event => setContinueWork(event.target.checked)} /><span>Fortsæt på projektets verificerede AI-arbejdsgren</span></label>
      <p className="opacity-60">Når dette er valgt, bygger næste arbejdsordre videre på den seneste leverance med beståede kontroller. Afhængigheder kan fortsætte fra verificerede opgaver til gennemgang på denne gren. Opgaverne bliver fortsat først færdige, når du godkender dem. Din oprindelige mappe ændres ikke; en divergerende kildegren stopper forløbet.</p>
      {project.aiWorkspace?.source === project.repositoryPath && project.aiWorkspace && <div className="rounded-lg border border-emerald-400/20 p-3 space-y-1"><p className="font-medium">Verificeret AI-arbejdsgren · {project.aiWorkspace.includedTaskIds.length} arbejdsordrer</p><p className="font-mono break-all">{project.aiWorkspace.branch} · {project.aiWorkspace.commit.slice(0, 12)}</p><p className="opacity-60">Senest verificeret {new Date(project.aiWorkspace.updatedAt).toLocaleString('da-DK')}. Gennemgangen viser hele AI-grenen i forhold til kildens commit ved seneste kørselsstart.</p><CodeChanges key={project.aiWorkspace.runId} runId={project.aiWorkspace.runId} commit={project.aiWorkspace.commit} wholeBranch /></div>}
      <button type="button" disabled={busy} onClick={save} className="btn-primary text-xs">{busy ? 'Kontrollerer…' : 'Kontrollér og gem'}</button>
      {feedback && <p role="status">{feedback}</p>}
    </div>
  </details>;
}

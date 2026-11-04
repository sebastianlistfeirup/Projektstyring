import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Project } from '../lib/types';
import { useStore } from '../store/useStore';
import { pushNow } from '../lib/sync';
import CodeChanges from './CodeChanges';

type Check = { name: string; command: string; args: string[] };
type RepositoryState = { source: string; branch: string; baseCommit: string; dirty: boolean; checkedAt: string; changedFiles: string[]; changedFileCount: number; recentCommits: { commit: string; subject: string }[]; otherBranches: { branch: string; commit: string; ahead: number; behind: number; subject: string }[]; otherBranchCount: number; suggestedBranch?: string; godotProject: boolean; stable: boolean };
const presets: Record<string, Check> = {
  godot: { name: 'Godot import', command: 'godot', args: ['--headless', '--editor', '--import', '--path', '.', '--quit'] },
  test: { name: 'Automatiske tests', command: 'npm', args: ['test'] },
  build: { name: 'Produktionsbuild', command: 'npm', args: ['run', 'build'] },
};

export default function ProjectExecutionSettings({ project, initiallyOpen = false }: { project: Project; initiallyOpen?: boolean }) {
  const update = useStore(s => s.updateProject);
  const [path, setPath] = useState(project.repositoryPath ?? '');
  const [baseRef, setBaseRef] = useState(project.repositoryBaseRef ?? '');
  const [baseRefTouched, setBaseRefTouched] = useState(false);
  const [checks, setChecks] = useState<Check[]>(project.verificationChecks ?? []);
  const [continueWork, setContinueWork] = useState(project.continueVerifiedWork ?? false);
  const [feedback, setFeedback] = useState('');
  const [open, setOpen] = useState(initiallyOpen);
  const [busy, setBusy] = useState(false);
  const [repository, setRepository] = useState<RepositoryState | null>(null);
  async function inspect() {
    setBusy(true); setFeedback(''); setRepository(null);
    try {
      const response = await fetch('http://127.0.0.1:4310/api/ai/repository/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: path.trim(), details: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reason ?? 'Mappen kunne ikke kontrolleres.');
      const inspected = data.repository as RepositoryState;
      setRepository(inspected);
      if (!project.repositoryBaseRef && !baseRefTouched && !baseRef && inspected.otherBranches.some(branch => branch.branch === inspected.suggestedBranch && branch.behind === 0 && branch.ahead > 0)) setBaseRef(inspected.suggestedBranch ?? '');
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Companion svarer ikke.'); }
    finally { setBusy(false); }
  }
  function patch(index: number, fields: Partial<Check>) { setChecks(list => list.map((c, i) => i === index ? { ...c, ...fields } : c)); }
  async function save() {
    setBusy(true);
    try {
      if (checks.length > 10 || checks.some(c => !c.command.trim())) throw new Error('Hver kontrol skal have en kommando.');
      if (continueWork && (!path.trim() || !checks.length)) throw new Error('En sammenhængende AI-arbejdsgren kræver repository og mindst én faktisk kvalitetskontrol.');
      let normalizedPath = path.trim();
      if (normalizedPath) {
        const res = await fetch('http://127.0.0.1:4310/api/ai/repository/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: normalizedPath, details: Boolean(baseRef) }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.reason ?? 'Repository kunne ikke åbnes.');
        if (data.repository.dirty) throw new Error('Der er lokale ændringer. Commit eller gem dem før tilknytning.');
        if (baseRef && !data.repository.otherBranches?.some((branch: RepositoryState['otherBranches'][number]) => branch.branch === baseRef && branch.behind === 0 && branch.ahead > 0)) throw new Error('Den valgte gren er ikke længere en direkte fortsættelse. Kontrollér Git-grundlaget igen.');
        normalizedPath = data.repository.source;
      }
      update(project.id, { repositoryPath: normalizedPath, repositoryBaseRef: baseRef || undefined, continueVerifiedWork: continueWork, verificationChecks: checks.map(c => ({ ...c, command: c.command.trim(), name: c.name.trim() || c.command })) });
      if (!await pushNow()) throw new Error('Ændringen er gemt lokalt, men kunne ikke overføres til Orbit Companion. Kontrollér forbindelsen, før du starter en arbejdsordre.');
      setPath(normalizedPath);
      setFeedback('Gemt. Orbit arbejder på en separat Git-gren og viser resultaterne af dine kontroller.');
      setOpen(false);
    } catch (e) { setFeedback(e instanceof Error ? e.message : 'Kunne ikke gemme.'); }
    finally { setBusy(false); }
  }
  return <><details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="rounded-xl border border-zinc-200 dark:border-white/10 p-3 text-xs">
    <summary className="cursor-pointer font-medium">Repository og kvalitetskontroller {project.repositoryPath ? '· tilknyttet' : '· ikke tilknyttet'}</summary>
    <div className="mt-3 space-y-3">
      <label className="block space-y-1"><span>Lokal repository-mappe på maskinen med Companion</span><input className="input w-full" value={path} onChange={e => { setPath(e.target.value); setRepository(null); setBaseRef(''); setBaseRefTouched(false); }} placeholder="C:\Projekter\Epoch-Isles" /></label>
      <button type="button" className="btn-ghost text-xs" disabled={busy || !path.trim()} onClick={() => void inspect()}>Vis projektets Git-grundlag</button>
      {repository && <section aria-label="Projektets Git-grundlag" className="rounded-lg border border-indigo-400/25 p-3 space-y-2">
        <p className="font-medium">{repository.godotProject ? 'Godot-projekt' : 'Git-projekt'} · {repository.branch || 'Detached HEAD'}</p>
        <p className="font-mono break-all">{repository.source}<br />{repository.baseCommit}</p>
        <p>{repository.changedFileCount ? `${repository.changedFileCount} lokale ændringer. De indgår ikke automatisk i en AI-arbejdsgren.` : 'Ingen lokale ændringer registreret.'}</p>
        {!!repository.changedFiles.length && <details><summary className="cursor-pointer">Vis lokale ændringer</summary><pre className="whitespace-pre-wrap break-all max-h-40 overflow-auto mt-2">{repository.changedFiles.join('\n')}</pre></details>}
        <details><summary className="cursor-pointer">Seneste commits i den valgte gren</summary><ol className="mt-2 space-y-1">{repository.recentCommits.map(commit => <li key={commit.commit}><code>{commit.commit.slice(0, 12)}</code> · {commit.subject}</li>)}</ol></details>
        {!!repository.otherBranchCount && <details open><summary className="cursor-pointer">{repository.otherBranchCount} andre lokale grene har commits, som ikke indgår her</summary><p className="opacity-65 mt-2">Vælg en direkte fortsættelse, hvis næste arbejdsordre skal inkludere dens eksisterende rettelser.</p><ul className="mt-2 space-y-1">{repository.otherBranches.map(branch => <li key={branch.branch} className="font-mono break-all">{branch.branch} · {branch.commit} · {branch.subject} · +{branch.ahead}/−{branch.behind}</li>)}</ul></details>}
        <label className="block space-y-1"><span>Grundlag for næste arbejdsordre</span><select className="input w-full" aria-label="Grundlag for næste arbejdsordre" value={baseRef} onChange={event => { setBaseRef(event.target.value); setBaseRefTouched(true); }}><option value="">Aktuel gren · {repository.branch || 'HEAD'} · {repository.baseCommit.slice(0, 12)}</option>{repository.otherBranches.filter(branch => branch.behind === 0 && branch.ahead > 0).map(branch => <option key={branch.branch} value={branch.branch}>{branch.branch === repository.suggestedBranch ? 'Foreslået · ' : ''}{branch.branch} · +{branch.ahead} commits · {branch.subject}</option>)}</select></label>
        {repository.suggestedBranch && <p className="text-indigo-300">Orbit foreslår {repository.suggestedBranch}, fordi den fortsætter den aktuelle gren i én sammenhængende kæde. Valget gælder først, når du gemmer.</p>}
        {baseRef && <p className="text-amber-300">Næste Orbit-arbejdsgren starter fra {baseRef}. Den oprindelige mappe skifter ikke gren.</p>}
        {!repository.stable && <p role="alert" className="text-amber-500">Git-grundlaget ændrede sig under kontrollen. Kontrollér igen før fortsættelse.</p>}
        <p className="opacity-55">Aflæst {new Date(repository.checkedAt).toLocaleString('da-DK')}. Kontrollen ændrer ingen filer og kører ingen spiltests. Referencer og grafik er ikke vurderet her.</p>
      </section>}
      <p className="opacity-70">Orbit opretter en arbejdsgren fra det valgte Git-grundlag. Lokale ændringer skal først gemmes. Der merges eller publiceres ikke automatisk.</p>
      <div className="flex items-center justify-between gap-2"><strong>Kvalitetskontroller</strong><select aria-label="Tilføj en kontrol" className="input text-xs" value="" disabled={checks.length >= 10} onChange={e => setChecks(list => [...list, presets[e.target.value] ?? { name: '', command: '', args: [] }])}><option value="">Tilføj fra skabelon…</option><option value="godot">Godot · importér projekt</option><option value="test">Node · kør tests</option><option value="build">Node · byg projekt</option></select></div>
      {!checks.length && <p className="opacity-60">Ingen kontroller valgt. Tilføj projektets test- eller buildkommando, så Orbit kan dokumentere resultatet.</p>}
      {checks.map((check, index) => <fieldset key={index} className="rounded-lg border border-zinc-200 dark:border-white/10 p-3 space-y-2"><legend className="px-1">Kontrol {index + 1}</legend><div className="flex gap-2"><label className="flex-1">Navn<input className="input w-full mt-1" value={check.name} onChange={e => patch(index, { name: e.target.value })} placeholder="Fx Godot import" /></label><button type="button" className="self-end btn-ghost" aria-label={`Fjern kontrol ${index + 1}`} onClick={() => setChecks(list => list.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div><label className="block">Program<input className="input w-full mt-1 font-mono" value={check.command} onChange={e => patch(index, { command: e.target.value })} placeholder="godot, npm eller en fuld sti" /></label><label className="block">Argumenter · ét pr. linje<textarea className="input w-full mt-1 font-mono" rows={Math.max(2, Math.min(7, check.args.length))} value={check.args.join('\n')} onChange={e => patch(index, { args: e.target.value ? e.target.value.split('\n') : [] })} spellCheck={false} /></label></fieldset>)}
      <button type="button" className="btn-ghost text-xs" disabled={checks.length >= 10} onClick={() => setChecks(list => [...list, { name: '', command: '', args: [] }])}><Plus size={13} />Egen kontrol</button>
      <p className="opacity-60">Kontroller køres i rækkefølge i arbejdsgrenen. Første fejl stopper kontrollen. Afhængigheder skal være installeret i arbejdsområdet, før en test kan bestå.</p>
      <label className="flex gap-2 items-start"><input type="checkbox" checked={continueWork} onChange={event => setContinueWork(event.target.checked)} /><span>Fortsæt på projektets verificerede AI-arbejdsgren</span></label>
      <p className="opacity-60">Når dette er valgt, bygger næste arbejdsordre videre på den seneste leverance med beståede kontroller. Afhængigheder kan fortsætte fra verificerede opgaver til gennemgang på denne gren. Opgaverne bliver fortsat først færdige, når du godkender dem. Din oprindelige mappe ændres ikke; en divergerende kildegren stopper forløbet.</p>
      {project.aiWorkspace?.source === project.repositoryPath && project.aiWorkspace && <div className="rounded-lg border border-emerald-400/20 p-3 space-y-1"><p className="font-medium">Verificeret AI-arbejdsgren · {project.aiWorkspace.includedTaskIds.length} arbejdsordrer</p><p className="font-mono break-all">{project.aiWorkspace.branch} · {project.aiWorkspace.commit.slice(0, 12)}</p><p className="opacity-60">Senest verificeret {new Date(project.aiWorkspace.updatedAt).toLocaleString('da-DK')}. Gennemgangen viser hele AI-grenen i forhold til kildens commit ved seneste kørselsstart.</p><CodeChanges key={project.aiWorkspace.runId} runId={project.aiWorkspace.runId} commit={project.aiWorkspace.commit} wholeBranch /></div>}
      <button type="button" disabled={busy} onClick={save} className="btn-primary text-xs">{busy ? 'Kontrollerer…' : 'Kontrollér og gem'}</button>
    </div>
  </details>{feedback && <p role="status" className="text-xs opacity-75">{feedback}</p>}</>;
}

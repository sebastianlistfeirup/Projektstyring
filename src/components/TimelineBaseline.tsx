import { useStore } from '../store/useStore';
import { formatDateShort } from '../lib/utils';

const dates = (item: { startDate?: string | null; dueDate?: string | null }) => `${item.startDate ? formatDateShort(item.startDate) : 'Ingen start'} → ${item.dueDate ? formatDateShort(item.dueDate) : 'Ingen frist'}`;

export default function TimelineBaseline() {
  const projectId = useStore(s => s.activeProjectId);
  const tasks = useStore(s => s.tasks);
  const baselines = useStore(s => s.baselines);
  const save = useStore(s => s.saveBaseline);
  const baseline = baselines.find(item => item.projectId === projectId);
  const current = tasks.filter(task => task.projectId === projectId);
  const dated = current.filter(task => task.startDate || task.dueDate);
  const prior = new Map(baseline?.items.map(item => [item.taskId, item]) ?? []);
  const changes = baseline ? current.filter(task => {
    const before = prior.get(task.id);
    return before ? before.startDate !== task.startDate || before.dueDate !== task.dueDate : Boolean(task.startDate || task.dueDate);
  }) : [];
  const removed = baseline?.items.filter(item => !current.some(task => task.id === item.taskId)) ?? [];

  return <section aria-label="Gemt datoplan" className="mb-4 rounded-xl border border-zinc-200 dark:border-white/10 p-3 text-xs">
    <div className="flex flex-wrap gap-3 items-center">
      <div className="flex-1 min-w-48"><h2 className="font-semibold">Sammenlign datoplan</h2><p className="mt-1 opacity-65">{!projectId ? 'Vælg ét projekt for at gemme dets datoer.' : baseline ? `Gemt ${new Date(baseline.savedAt).toLocaleString('da-DK')} · ${changes.length + removed.length} ændringer` : 'Gem de nuværende datoer og se senere forskydninger. Versionsscope ændres ikke.'}</p></div>
      {projectId && <button className="btn-ghost text-xs" disabled={!dated.length} onClick={() => save(projectId)}>{baseline ? 'Erstat den gemte datoplan' : 'Gem datoplan'}</button>}
    </div>
    {baseline && <details className="mt-3"><summary className="cursor-pointer">Se datoændringer</summary>
      {!changes.length && !removed.length ? <p className="mt-2 opacity-65">Ingen datoændringer siden den gemte plan.</p> : <div className="overflow-x-auto mt-2"><table className="w-full text-left"><thead><tr><th className="p-2">Opgave</th><th className="p-2">Gemt plan</th><th className="p-2">Nu</th></tr></thead><tbody>
        {changes.map(task => <tr key={task.id} className="border-t border-zinc-200 dark:border-white/10"><td className="p-2">{task.title}</td><td className="p-2 whitespace-nowrap">{prior.has(task.id) ? dates(prior.get(task.id)!) : 'Ikke i den gemte datoplan'}</td><td className="p-2 whitespace-nowrap">{dates(task)}</td></tr>)}
        {removed.map(item => <tr key={item.taskId} className="border-t border-zinc-200 dark:border-white/10"><td className="p-2">{tasks.find(task => task.id === item.taskId)?.title ?? item.taskId}</td><td className="p-2 whitespace-nowrap">{dates(item)}</td><td className="p-2">Ikke længere i projektet</td></tr>)}
      </tbody></table></div>}
      <p className="mt-2 opacity-55">En ny gemning erstatter sammenligningsgrundlaget. Den flytter ingen opgaver eller datoer.</p>
    </details>}
  </section>;
}

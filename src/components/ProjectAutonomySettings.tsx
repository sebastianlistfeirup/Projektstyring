import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { AutonomyPolicy, Project } from '../lib/types';
import { useStore } from '../store/useStore';
import { pushNow } from '../lib/sync';

const initialPolicy: AutonomyPolicy = { maxProviderCalls: 200, maxExecutionMinutes: null, maxRepairAttempts: 1, maxConsecutiveFailures: 3 };

export default function ProjectAutonomySettings({ project }: { project: Project }) {
  const update = useStore(state => state.updateProject);
  const [policy, setPolicy] = useState<AutonomyPolicy>(() => ({ ...initialPolicy, ...project.autonomyPolicy }));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const patch = (value: Partial<AutonomyPolicy>) => { setPolicy(current => ({ ...current, ...value })); setFeedback(''); };
  async function save() {
    setSaving(true); setFeedback('');
    try {
      const limits: [number, number, number][] = [[policy.maxProviderCalls, 1, 1000], [policy.maxRepairAttempts, 0, 3], [policy.maxConsecutiveFailures, 1, 10]];
      if (policy.maxExecutionMinutes !== null) limits.push([policy.maxExecutionMinutes, 1, 1440]);
      if (limits.some(([value, min, max]) => !Number.isInteger(value) || value < min || value > max)) throw new Error('Brug hele tal inden for de viste grænser.');
      update(project.id, { autonomyPolicy: policy });
      if (!await pushNow()) throw new Error('Rammerne er gemt lokalt, men Companion har ikke bekræftet dem. Kontrollér forbindelsen før næste arbejdsordre.');
      setFeedback('Arbejdsrammerne er gemt på Companion og gælder nye kørsler i projektet.');
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Arbejdsrammerne kunne ikke gemmes.'); }
    finally { setSaving(false); }
  }
  return <details className="rounded-xl border border-zinc-200 dark:border-white/10 p-3 text-xs">
    <summary className="cursor-pointer font-medium"><SlidersHorizontal size={13} className="inline mr-2" />Arbejdsrammer for Orbit</summary>
    <div className="mt-3 space-y-3">
      <p className="opacity-70">Angiv, hvor langt Orbit må fortsætte på en arbejdsordre. Rammerne følger kørslen ved genoptagelse. En igangværende kørsel ændres ikke af nye indstillinger.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1"><span>Maksimalt antal AI-kald · 1–1000</span><input type="number" min={1} max={1000} step={1} className="input w-full" value={policy.maxProviderCalls} onChange={event => patch({ maxProviderCalls: Number(event.target.value) })} /></label>
        <label className="space-y-1"><span>Aktiv køretid i minutter · 1–1440</span><input type="number" min={1} max={1440} step={1} className="input w-full" placeholder="Ingen tidsgrænse valgt" value={policy.maxExecutionMinutes ?? ''} onChange={event => patch({ maxExecutionMinutes: event.target.value === '' ? null : Number(event.target.value) })} /></label>
        <label className="space-y-1"><span>Automatiske rettelsesforsøg · 0–3</span><input type="number" min={0} max={3} step={1} className="input w-full" value={policy.maxRepairAttempts} onChange={event => patch({ maxRepairAttempts: Number(event.target.value) })} /></label>
        <label className="space-y-1"><span>Stop efter fejl i træk · 1–10</span><input type="number" min={1} max={10} step={1} className="input w-full" value={policy.maxConsecutiveFailures} onChange={event => patch({ maxConsecutiveFailures: Number(event.target.value) })} /></label>
      </div>
      <p className="opacity-60">Et AI-kald tæller et forsøg via en tjeneste, også ved genbrug af en gemt leverance. Det er ikke en betalingsgrænse; tjenestens interne værktøjskald tælles ikke særskilt. Native tilladelser, adgang og regler om betaling gælder fortsat. Automatisk fejlretning skal også være aktiveret i AI-indstillingerne.</p>
      <button type="button" className="btn-primary text-xs" disabled={saving} onClick={() => void save()}>{saving ? 'Gemmer…' : 'Gem arbejdsrammer'}</button>
      {feedback && <p role="status">{feedback}</p>}
    </div>
  </details>;
}

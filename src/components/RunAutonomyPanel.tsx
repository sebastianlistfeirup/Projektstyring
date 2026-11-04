import type { SwarmRun } from '../lib/swarm';

export default function RunAutonomyPanel({ run }: { run: SwarmRun }) {
  const state = run.autonomy;
  if (!state) return null;
  return <section id="orbit-run-limits" tabIndex={-1} aria-label="Kørslens arbejdsrammer" className="rounded-xl border border-zinc-200 dark:border-white/10 p-3 text-xs scroll-mt-4">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h2 className="font-semibold">Arbejdsrammer</h2>
      <span>AI-kald: {state.providerCalls} / {state.policy.maxProviderCalls}</span>
      <span>Aktiv køretid: {Math.floor(state.executionMs / 60000)} min{state.policy.maxExecutionMinutes === null ? ' · ingen tidsgrænse valgt' : ` / ${state.policy.maxExecutionMinutes} min`}</span>
      <span>Rettelsesforsøg: {state.repairAttempts ?? 0} / {state.policy.maxRepairAttempts}</span>
    </div>
    {state.blockedReason && <p role="status" className="mt-2 text-amber-700 dark:text-amber-300">{state.blockedReason}</p>}
    {run.contextStatus && run.contextStatus.status !== 'current' && <div className="mt-2 space-y-1 text-amber-700 dark:text-amber-300"><p className="font-medium">Projektgrundlaget kræver en ny gennemgang.</p><ul>{run.contextStatus.changes.map((change, index) => <li key={index}>{change}</li>)}</ul></div>}
    <details className="mt-2 opacity-70"><summary className="cursor-pointer">Hvad tælles med?</summary><p className="mt-2">AI-kald tæller Orbits forsøg på planlægning, udførelse og review, også når en gemt leverance genbruges. Tallet er ikke en opgørelse over betaling eller leverandørens kvote. Tjenestens interne værktøjskald tælles ikke særskilt. Aktiv køretid udelader ventetid på plangodkendelse og native tilladelser. Grænserne og det allerede registrerede forbrug følger kørslen ved genoptagelse.</p></details>
  </section>;
}

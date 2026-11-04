import type { SwarmRun } from '../lib/swarm';
import { verificationLabels } from '../lib/runPresentation';

export default function VerificationHistory({ run }: { run: SwarmRun }) {
  const attempts = run.verificationHistory ?? [];
  if (attempts.length < 2) return null;
  return <details className="rounded-xl border border-zinc-200 dark:border-white/10 p-3 text-xs">
    <summary className="cursor-pointer font-medium">Kontrolhistorik · {attempts.length} gennemløb</summary>
    <ol className="mt-3 space-y-3">{attempts.map(attempt => <li key={attempt.number} className="border-l-2 border-indigo-400/25 pl-3">
      <p className="font-medium">Kontrol {attempt.number}: {verificationLabels[attempt.status] ?? attempt.status}</p>
      <p className="opacity-55 mt-1">{new Date(attempt.at).toLocaleString('da-DK')} · commit <span className="font-mono break-all">{attempt.commit}</span></p>
      {attempt.checks.map((check, index) => <details key={index} className="mt-2"><summary className="cursor-pointer opacity-70">{check.name} · exit {check.exitCode ?? 'ukendt'}</summary><pre className="whitespace-pre-wrap break-all max-h-48 overflow-auto mt-2 bg-black/10 p-2 rounded">{check.output}</pre></details>)}
    </li>)}</ol>
  </details>;
}

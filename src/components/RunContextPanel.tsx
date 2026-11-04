import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import type { SwarmRun } from '../lib/swarm';

export default function RunContextPanel({ run }: { run: SwarmRun }) {
  const [checked, setChecked] = useState<{ runId: string; status?: SwarmRun['contextStatus']; error?: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const manifest = run.contextManifest;
  if (!manifest) return null;
  const latest = checked?.runId === run.runId ? checked : null;
  const status = run.contextStatus && run.contextStatus.status !== 'current' ? run.contextStatus : latest?.status ?? run.contextStatus;
  async function checkCurrent() {
    setChecking(true);
    try {
      const response = await fetch(`http://127.0.0.1:4310/api/ai/runs/${encodeURIComponent(run.runId)}/context`, { signal: AbortSignal.timeout(8000) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.reason ?? 'Projektgrundlaget kunne ikke kontrolleres.');
      setChecked({ runId: run.runId, status: data.contextStatus });
    } catch (error) { setChecked({ runId: run.runId, error: error instanceof Error ? error.message : 'Companion svarer ikke.' }); }
    finally { setChecking(false); }
  }
  const bible = manifest.documents.find(doc => doc.kind === 'bible');
  const decisions = manifest.documents.filter(doc => doc.kind === 'decision');
  return <details className="rounded-xl border border-zinc-200 dark:border-white/10 p-3 text-xs">
    <summary className="cursor-pointer font-medium"><BookOpen size={13} className="inline mr-2" />Anvendt projektgrundlag · {bible?.state === 'published' ? `bibelversion ${bible.version ?? 'ukendt'}` : bible?.state === 'draft' ? 'bibelkladde' : 'ingen bibel'} · {decisions.length} beslutninger</summary>
    <div className="mt-3 space-y-3">
      <p className="opacity-65">Grundlaget blev gemt {new Date(manifest.capturedAt).toLocaleString('da-DK')}. Før fortsættelse sammenligner Orbit dokumenter, mål og repository med det gældende projekt. Ændringer kræver en ny plan.</p>
      <button type="button" className="btn-secondary text-xs" disabled={checking} onClick={() => void checkCurrent()}>{checking ? 'Kontrollerer…' : 'Kontrollér mod gældende projekt'}</button>
      {latest?.error && <p role="status" className="text-amber-700 dark:text-amber-300">{latest.error}</p>}
      {status && <div role="status" className={status.status === 'current' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}><p>{status.status === 'current' ? 'Projektgrundlaget stemte ved seneste kontrol.' : 'Projektgrundlaget kræver gennemgang.'}</p>{status.changes.map((change, index) => <p key={index}>{change}</p>)}</div>}
      {bible?.state !== 'published' && <p className="text-amber-600 dark:text-amber-400">Denne kørsel havde ingen offentliggjort bibelversion. {bible?.state === 'draft' ? 'Den daværende kladde blev anvendt.' : 'Arbejdet bygger på mål, arbejdsordre og øvrige vedhæftninger.'}</p>}
      {manifest.releaseGoal && <p><b>Versionsmål:</b> {manifest.releaseGoal}</p>}
      <ul className="space-y-2">{manifest.documents.map(doc => <li key={`${doc.kind}:${doc.id}`}><p className="font-medium">{doc.title} <span className="font-normal opacity-60">· {doc.kind === 'bible' ? 'Bibel' : doc.kind === 'decision' ? 'Registreret beslutning' : 'Arbejdsordre'} · {doc.characters.toLocaleString('da-DK')} tegn</span></p><details className="mt-1 opacity-60"><summary className="cursor-pointer">Dokumentidentitet</summary><p className="break-all font-mono mt-1">{doc.id}<br />SHA-256: {doc.sha256}</p></details></li>)}</ul>
      <p className="opacity-60">Beslutningsnoter er medsendt i fuld længde. Modstridende krav skal fremhæves af agenten.</p>
    </div>
  </details>;
}

import { BookOpen } from 'lucide-react';
import type { SwarmRun } from '../lib/swarm';

export default function RunContextPanel({ run }: { run: SwarmRun }) {
  const manifest = run.contextManifest;
  if (!manifest) return null;
  const bible = manifest.documents.find(doc => doc.kind === 'bible');
  const decisions = manifest.documents.filter(doc => doc.kind === 'decision');
  return <details className="rounded-xl border border-current/10 p-3 text-xs">
    <summary className="cursor-pointer font-medium"><BookOpen size={13} className="inline mr-2" />Anvendt projektgrundlag · {bible?.state === 'published' ? `bibelversion ${bible.version ?? 'ukendt'}` : bible?.state === 'draft' ? 'bibelkladde' : 'ingen bibel'} · {decisions.length} beslutninger</summary>
    <div className="mt-3 space-y-3">
      <p className="opacity-65">Grundlaget blev gemt {new Date(manifest.capturedAt).toLocaleString('da-DK')} og bevares ved genoptagelse. Senere dokumentændringer følger med i en ny kørsel.</p>
      {bible?.state !== 'published' && <p className="text-amber-600 dark:text-amber-400">Denne kørsel havde ingen offentliggjort bibelversion. {bible?.state === 'draft' ? 'Den daværende kladde blev anvendt.' : 'Arbejdet bygger på mål, arbejdsordre og øvrige vedhæftninger.'}</p>}
      {manifest.releaseGoal && <p><b>Versionsmål:</b> {manifest.releaseGoal}</p>}
      <ul className="space-y-2">{manifest.documents.map(doc => <li key={`${doc.kind}:${doc.id}`}><p className="font-medium">{doc.title} <span className="font-normal opacity-60">· {doc.kind === 'bible' ? 'Bibel' : doc.kind === 'decision' ? 'Registreret beslutning' : 'Arbejdsordre'} · {doc.characters.toLocaleString('da-DK')} tegn</span></p><details className="mt-1 opacity-60"><summary className="cursor-pointer">Dokumentidentitet</summary><p className="break-all font-mono mt-1">{doc.id}<br />SHA-256: {doc.sha256}</p></details></li>)}</ul>
      <p className="opacity-60">Beslutningsnoter er medsendt i fuld længde. Modstridende krav skal fremhæves af agenten.</p>
    </div>
  </details>;
}

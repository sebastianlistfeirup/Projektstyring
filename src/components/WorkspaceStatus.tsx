import { useEffect, useState } from 'react';
import { CircleCheck, CirclePause, LoaderCircle, Radio, WifiOff } from 'lucide-react';
import { useSwarm } from '../lib/swarm';
import { runLabels } from '../lib/runPresentation';
import { runFreshness } from '../lib/runFreshness';

type Props = { projectId?: string | null; otherProjectName?: string; onOpenLive: () => void };

export function WorkspaceStatus({ projectId, otherProjectName, onOpenLive }: Props) {
  const run = useSwarm(s => s.run);
  const connected = useSwarm(s => s.connected);
  const permissions = useSwarm(s => s.permissions);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const otherProject = Boolean(projectId && run?.projectId && run.projectId !== projectId);
  const pending = permissions.filter(permission => !projectId || permission.projectId === projectId || permission.runId === run?.runId && !otherProject).length;
  const job = run?.jobs.find(item => item.status === 'running');
  const stale = runFreshness(run, connected, now) !== 'current';
  let title = 'Klar til næste opgave';
  let detail = 'Beskriv, hvad du vil arbejde videre med.';
  let tone = 'ready';
  let Icon = Radio;
  let action = '';
  if (otherProject) {
    title = `Seneste kørsel: ${otherProjectName ?? 'et andet projekt'}`;
    detail = 'Resultater og beslutninger hører til det projekt. Din samtale her er uændret.';
    tone = 'neutral';
  } else if (stale) {
    title = connected ? 'Afventer en ny status' : 'Forbindelsen til arbejdet er afbrudt';
    detail = 'Den viste status kan være forældet. Orbit forsøger at genoprette forbindelsen; start ikke opgaven igen imens.';
    tone = 'waiting'; Icon = WifiOff; action = 'Se seneste status';
  } else if (pending || run?.status === 'awaiting_approval') {
    title = pending ? `${pending} beslutning${pending === 1 ? '' : 'er'} afventer dig` : run?.recoveredAt ? 'Den gemte plan kan genoptages' : 'Planen afventer dig';
    detail = pending ? 'Gennemgå den konkrete forespørgsel, så arbejdet kan fortsætte.' : 'Gennemgå planen og vælg det næste skridt.';
    tone = 'waiting'; Icon = CirclePause; action = 'Se beslutning';
  } else if (run?.status === 'running') {
    title = job?.title ?? 'Orbit forbereder arbejdet';
    detail = job?.media?.state ? 'Tjenesten producerer medier. Nye forhåndsvisninger vises, når de er tilgængelige.' : job?.actions?.at(-1)?.label ?? 'Arbejdet er i gang. Du kan fortsætte samtalen her.';
    tone = 'working'; Icon = LoaderCircle; action = 'Følg arbejdet';
  } else if (run?.status === 'done') {
    title = run.verification?.status === 'failed' ? 'Leveret med fejlede kontroller' : 'Resultatet er klar til gennemgang';
    detail = 'Se ændringerne og de faktiske kontroller, før du godkender resultatet.';
    tone = run.verification?.status === 'failed' ? 'waiting' : 'delivered'; Icon = CircleCheck; action = 'Gennemse resultat';
  } else if (run) {
    title = runLabels[run.status] ?? 'Status skal gennemgås';
    detail = run.jobs.find(item => item.error)?.error ?? 'Se årsagen og de tilgængelige muligheder, før du fortsætter.';
    tone = 'waiting'; Icon = CirclePause; action = 'Se næste skridt';
  } else if (!connected) {
    title = 'Forbinder til Orbit';
    detail = 'Du kan skrive din kladde, mens forbindelsen kontrolleres.';
    tone = 'neutral'; Icon = WifiOff;
  }
  return <section className="orbit-workspace-progress" data-tone={tone} aria-label="Arbejdsstatus">
    <span className="orbit-workspace-progress-icon"><Icon size={17} aria-hidden="true" className={tone === 'working' ? 'animate-spin-slow' : undefined} /></span>
    <div className="orbit-workspace-progress-copy" aria-live="polite" aria-atomic="true"><strong>{title}</strong><p>{detail}</p></div>
    {action && <button type="button" className="btn-ghost text-xs" onClick={onOpenLive}>{action}</button>}
  </section>;
}

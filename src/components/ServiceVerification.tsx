import { useEffect, useRef, useState } from 'react';
import type { AiServiceInfo } from '../lib/aiApi';

type Report = { runId: string; status: string; checkedAt: string; configurationChanged: boolean; customTemplate: boolean; scope?: string; artifacts?: { name: string; url: string }[] };
type McpCheck = { status: string; configurationChanged: boolean; checkedAt: string; toolNames?: string[]; complete?: boolean; reason?: string };
type Integration = { delivery: string; scope: string | null; repository: string; mcp: { status: string; source?: string; note: string; servers: { name: string; transport: string; enabled: boolean; verification: string; probeSupported?: boolean; lastCheck?: McpCheck | null }[] } };
const base = 'http://127.0.0.1:4310';
const labels: Record<string, string> = { running: 'Prøven kører', passed: 'Prøve leveret', failed: 'Prøven fejlede', interrupted: 'Prøven blev afbrudt' };
export default function ServiceVerification({ service }: { service: AiServiceInfo }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mcpBusy, setMcpBusy] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState('');
  const mcpController = useRef<AbortController | null>(null);
  const serviceId = service.id;
  useEffect(() => () => mcpController.current?.abort(), []);
  const media = Boolean(service.capabilities?.produces);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await fetch(`${base}/api/ai/services/${serviceId}/verification`, { signal: controller.signal });
        if (!response.ok) throw new Error('Kontotesten kræver den opdaterede Companion.');
        const data = await response.json(); setReport(data.report); setIntegration(data.integration ?? null); setLoaded(true); setError('');
        if (data.report?.status === 'running') timer = setTimeout(refresh, 2000);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Kontotestens status kunne ikke hentes.'); }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [serviceId, revision]);
  const start = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${base}/api/ai/services/${service.id}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ execute: true, produceMedia: media }), signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.reason ?? 'Prøven kunne ikke startes.');
      setRevision(value => value + 1);
    } catch (e) { setError(`${e instanceof Error ? e.message : 'Forbindelsen blev afbrudt.'} Se Orbit Live før et nyt forsøg, hvis startstatus er ukendt.`); setRevision(value => value + 1); }
    finally { setBusy(false); }
  };
  const checkMcp = async (serverName: string) => {
    const controller = new AbortController(); mcpController.current = controller;
    setMcpBusy(serverName); setMcpError('');
    try {
      const response = await fetch(`${base}/api/ai/services/${serviceId}/mcp/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ execute: true, serverName }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.reason ?? 'MCP-prøven kunne ikke gennemføres.');
    } catch (error) { setMcpError(controller.signal.aborted ? 'MCP-prøven blev stoppet.' : error instanceof Error ? error.message : 'MCP-forbindelsen blev afbrudt.'); }
    finally { setMcpBusy(null); mcpController.current = null; setRevision(value => value + 1); }
  };
  return <section aria-label={`Forbindelsesbevis for ${service.name}`} className="px-2.5 pb-3 space-y-3 text-[11px]">
    <div className="rounded-xl border border-zinc-200 dark:border-white/10 bg-black/[0.025] dark:bg-white/[0.025] p-3 space-y-2">
      <p className="font-semibold text-xs">Hvad er faktisk afprøvet?</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="opacity-60">Opsætning</dt><dd>{service.available ? 'Klar til en prøve' : 'Kræver handling'}</dd>
        <dt className="opacity-60">Login</dt><dd>{service.kind === 'local' ? 'Lokal tjeneste' : 'Ikke uafhængigt verificeret'}</dd>
        <dt className="opacity-60">Levering</dt><dd>{!loaded ? 'Henter bevis…' : integration?.delivery === 'verified' ? integration.scope === 'one_media_delivery' ? 'Én mediefil leveret' : 'Ét tekstsvar leveret' : integration?.delivery === 'outdated' ? 'Tidligere opsætning afprøvet' : 'Ikke verificeret'}</dd>
        {service.capabilities?.repository && <><dt className="opacity-60">Projektarbejde</dt><dd>Kræver prøve i projektet</dd></>}
        <dt className="opacity-60">Forbrug</dt><dd>{service.billing?.allowed ? service.kind === 'local' ? 'Lokal udførelse' : 'Inkluderet adgang er brugerbekræftet' : 'Adgang er ikke bekræftet'} · resterende kvote ukendt</dd>
      </dl>
    </div>
    <p aria-live="polite">Kontotest: {report ? labels[report.status] ?? report.status : loaded ? 'Ikke afprøvet' : 'Henter status…'}{report && ` · ${new Date(report.checkedAt).toLocaleString('da-DK')}`}</p>
    {report?.configurationChanged && <p className="text-amber-500">Forbindelsen er ændret siden prøven. Resultatet gælder den tidligere opsætning.</p>}
    <p className="opacity-65">Testen sender én rigtig opgave og bruger kvote. {media ? 'Der produceres én mediefil.' : 'Tjenesten skal returnere en kontrolkode.'} Kvoten er ukendt; abonnementsdækning følger din særskilte bekræftelse.</p>
    {report?.customTemplate && <p className="opacity-65">Egen CLI-skabelon: et svar bekræfter skabelonens levering, ikke leverandørens identitet.</p>}
    <button className="btn-ghost text-xs" disabled={!service.available || busy || report?.status === 'running'} onClick={start}>{busy ? 'Starter…' : media ? 'Kør én medietest' : 'Kør én kontotest'}</button>
    {report && <a href="#/swarm" className="ml-2 underline">Se kørsler i Orbit Live</a>}
    {report?.artifacts?.map(artifact => <a key={artifact.url} className="block underline" href={`${base}${artifact.url}`} target="_blank" rel="noreferrer">Åbn {artifact.name}</a>)}
    {service.capabilities?.nativeMcp && integration && <details className="rounded-lg border border-zinc-200 dark:border-white/10 p-2.5">
      <summary className="cursor-pointer font-medium">MCP-forbindelser · {integration.mcp.servers.length} fundet i brugerkonfiguration</summary>
      <p className="opacity-65 mt-2">{integration.mcp.note}</p>
      {integration.mcp.source && <p className="opacity-50 mt-1">Kilde: {integration.mcp.source}</p>}
      {!!integration.mcp.servers.length && <ul className="mt-2 space-y-3">{integration.mcp.servers.map(server => <li key={server.name} className="space-y-2 border-t border-zinc-200 dark:border-white/10 pt-2">
        <div className="flex flex-wrap justify-between gap-1"><span className="font-medium break-all">{server.name}</span><span className="opacity-65">{server.transport === 'stdio' ? 'Lokal proces' : server.transport === 'http' ? 'HTTP' : 'Ukendt transport'} · {!server.enabled ? 'Deaktiveret i konfiguration' : server.lastCheck?.configurationChanged ? 'Tidligere konfiguration afprøvet' : server.lastCheck?.status === 'passed' ? 'Forbindelse og værktøjsliste afprøvet' : server.lastCheck?.status === 'failed' ? 'Prøven fejlede' : server.lastCheck?.status === 'interrupted' ? 'Prøven blev afbrudt' : 'Ikke afprøvet'}</span></div>
        {server.lastCheck && <p className="opacity-60">Seneste prøve: {new Date(server.lastCheck.checkedAt).toLocaleString('da-DK')}{server.lastCheck.status === 'passed' && ` · ${server.lastCheck.toolNames?.length ?? 0} værktøjsnavne${server.lastCheck.complete === false ? ' (delvis liste)' : ''}`}</p>}
        {server.lastCheck?.reason && <p className="text-amber-600 dark:text-amber-300">{server.lastCheck.reason}</p>}
        {!!server.lastCheck?.toolNames?.length && <details><summary className="cursor-pointer underline">Se værktøjsnavne fra prøven</summary><p className="mt-1 break-words opacity-65">{server.lastCheck.toolNames.join(', ')}</p></details>}
        {server.probeSupported ? <button type="button" className="btn-secondary text-xs" disabled={Boolean(mcpBusy)} onClick={() => void checkMcp(server.name)}>{mcpBusy === server.name ? 'Afprøver forbindelse…' : `Afprøv værktøjsliste: ${server.name}`}</button> : <p className="opacity-60">Denne konfiguration skal afprøves i den native tjeneste.</p>}
      </li>)}</ul>}
      <p className="opacity-65 mt-2">Prøven starter den valgte, konfigurerede stdio-server og læser dens værktøjsliste. Den kalder ingen værktøjer og ændrer ikke indstillingerne. Adgang til konkrete data og handlinger er stadig uafprøvet.</p>
      {mcpBusy && <button type="button" className="btn-ghost text-xs" onClick={() => mcpController.current?.abort()}>Stop MCP-prøve</button>}
      {mcpError && <p role="alert" className="text-rose-600 dark:text-rose-300 mt-2">{mcpError}</p>}
    </details>}
    {error && <div role="alert" className="text-rose-500"><p>{error}</p><button type="button" className="underline mt-1" onClick={() => setRevision(value => value + 1)}>Hent status igen</button></div>}
  </section>;
}

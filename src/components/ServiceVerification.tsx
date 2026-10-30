import { useEffect, useState } from 'react';
import type { AiServiceInfo } from '../lib/aiApi';

type Report = { runId: string; status: string; checkedAt: string; configurationChanged: boolean; customTemplate: boolean; artifacts?: { name: string; url: string }[] };
const base = 'http://127.0.0.1:4310';
const labels: Record<string, string> = { running: 'Prøven kører', passed: 'Prøve leveret', failed: 'Prøven fejlede', interrupted: 'Prøven blev afbrudt' };
export default function ServiceVerification({ service }: { service: AiServiceInfo }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const media = Boolean(service.capabilities?.produces);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await fetch(`${base}/api/ai/services/${service.id}/verification`, { signal: controller.signal });
        if (!response.ok) throw new Error('Kontotesten kræver den opdaterede Companion.');
        const data = await response.json(); setReport(data.report);
        if (data.report?.status === 'running') timer = setTimeout(refresh, 2000);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Kontotestens status kunne ikke hentes.'); }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [service, revision]);
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
  return <div className="px-2.5 pb-3 space-y-2 text-[11px]">
    <p>Kontotest: {report ? labels[report.status] ?? report.status : 'Ikke afprøvet'}{report && ` · ${new Date(report.checkedAt).toLocaleString('da-DK')}`}</p>
    {report?.configurationChanged && <p className="text-amber-500">Forbindelsen er ændret siden prøven. Resultatet gælder den tidligere opsætning.</p>}
    <p className="opacity-65">Testen sender én rigtig opgave og bruger kvote. {media ? 'Der produceres én mediefil.' : 'Tjenesten skal returnere en kontrolkode.'} Kvoten er ukendt; abonnementsdækning følger din særskilte bekræftelse.</p>
    {report?.customTemplate && <p className="opacity-65">Egen CLI-skabelon: et svar bekræfter skabelonens levering, ikke leverandørens identitet.</p>}
    <button className="btn-ghost text-xs" disabled={!service.available || busy || report?.status === 'running'} onClick={start}>{busy ? 'Starter…' : media ? 'Kør én medietest' : 'Kør én kontotest'}</button>
    {report && <a href="#/swarm" className="ml-2 underline">Se kørsler i Orbit Live</a>}
    {report?.artifacts?.map(artifact => <a key={artifact.url} className="block underline" href={`${base}${artifact.url}`} target="_blank" rel="noreferrer">Åbn {artifact.name}</a>)}
    {error && <p role="alert" className="text-rose-500">{error}</p>}
  </div>;
}

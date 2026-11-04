import { useEffect, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { RunHistoryItem } from '../lib/aiApi';

const PAGE_SIZE = 12;
const statuses: Record<string, string> = { done: 'Leveret til gennemgang', partial: 'Delvist leveret', error: 'Fejlet', blocked: 'Blokeret', cancelled: 'Stoppet', interrupted: 'Afbrudt', running: 'Arbejder', planning: 'Planlægger', awaiting_approval: 'Afventer din beslutning' };
interface HistoryPage { runs: RunHistoryItem[]; total: number; nextOffset: number | null; unreadable: number }

export default function RunHistory({ refreshKey, onOpen }: { refreshKey: string; onOpen: (run: RunHistoryItem) => void }) {
  const projects = useStore(s => s.projects);
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<HistoryPage>({ runs: [], total: 0, nextOffset: null, unreadable: 0 });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true); setError('');
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), q: query, projectId });
        const response = await fetch(`http://127.0.0.1:4310/api/ai/runs?${params}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error('Historikken kunne ikke hentes. Kontrollér forbindelsen, og prøv igen.');
        if (!controller.signal.aborted) setPage({ runs: data.runs ?? [], total: data.total ?? data.runs?.length ?? 0, nextOffset: data.nextOffset ?? null, unreadable: data.unreadable ?? 0 });
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Historikken kunne ikke hentes.'); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, projectId, offset, revision, refreshKey]);
  const move = (next: number) => { setBusy(true); setOffset(next); };
  return <section aria-label="Kørselshistorik" aria-busy={busy} className="rounded-2xl border border-white/10 glass-panel p-3 space-y-3">
    <div className="flex items-center gap-2"><h3 className="text-xs font-semibold flex items-center gap-1.5 flex-1"><History size={13} />Kørselshistorik</h3><button aria-label="Opdater kørselshistorik" disabled={busy} onClick={() => { setBusy(true); setRevision(r => r + 1); }} className="btn-icon"><RefreshCw size={14} /></button></div>
    <div className="flex flex-wrap gap-2">
      <input type="search" maxLength={200} aria-label="Søg i kørselshistorik" placeholder="Søg efter mål eller kørsels-id…" value={query} onChange={e => { setBusy(true); setQuery(e.target.value); setOffset(0); }} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-transparent px-2.5 py-2 text-xs" />
      <select aria-label="Projekt i kørselshistorik" value={projectId} onChange={e => { setBusy(true); setProjectId(e.target.value); setOffset(0); }} className="max-w-full rounded-lg border border-white/10 bg-transparent px-2 py-2 text-xs"><option value="">Alle projekter</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    </div>
    {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
    {!error && <>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {page.runs.map(run => <button key={run.runId} disabled={busy} onClick={() => onOpen(run)} className="rounded-xl border border-white/10 bg-black/5 px-3 py-2 text-left hover:border-indigo-400/50 disabled:opacity-50 min-w-0">
          <div className="text-xs font-medium truncate">{run.goal || run.runId}{run.goalTruncated ? '…' : ''}</div>
          <div className="text-[11px] opacity-65 mt-1">{statuses[run.status ?? ''] ?? run.status ?? 'Ukendt status'} · {run.results?.length ?? 0} leverancer</div>
          <div className="text-[10px] opacity-50 mt-1">{run.finishedAt || run.startedAt ? new Date(run.finishedAt || run.startedAt!).toLocaleString('da-DK') : 'Tidspunkt ukendt'}{(run.eventCount ?? 0) > 1 ? ' · Aktivitetslog' : ''}</div>
        </button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs" aria-live="polite"><span className="flex-1 opacity-60">{busy ? 'Henter historik…' : page.total ? `Viser ${offset + 1}–${offset + page.runs.length} af ${page.total}` : 'Ingen kørsler matcher dit valg.'}</span><button disabled={busy || offset === 0} onClick={() => move(Math.max(0, offset - PAGE_SIZE))} className="btn-secondary rounded-lg px-2 py-1 disabled:opacity-40">Nyere</button><button disabled={busy || page.nextOffset === null} onClick={() => move(page.nextOffset!)} className="btn-secondary rounded-lg px-2 py-1 disabled:opacity-40">Ældre</button></div>
      {page.unreadable > 0 && <p className="text-xs text-amber-600">{page.unreadable} historikfiler kunne ikke læses og er ikke med i oversigten. Filerne er bevaret.</p>}
    </>}
  </section>;
}

import { useEffect, useRef, useState } from 'react';
import { Download, GitCompareArrows, Loader2, X } from 'lucide-react';

type ChangedFile = { path: string; status: string; added: number | null; removed: number | null; binary: boolean };
type Overview = { baseCommit: string; commit: string; files: ChangedFile[]; totalFiles: number; filesTruncated: boolean };
type FileDiff = { patch: string; truncated: boolean; file: ChangedFile; commit: string };
const labels: Record<string, string> = { A: 'Ny', D: 'Slettet', M: 'Ændret', T: 'Type ændret' };
const BASE = 'http://127.0.0.1:4310';

export default function CodeChanges({ runId, commit, wholeBranch = false }: { runId: string; commit?: string; wholeBranch?: boolean }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null), [selected, setSelected] = useState('');
  const [diff, setDiff] = useState<FileDiff | null>(null), [error, setError] = useState(''), [fileError, setFileError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), request = useRef<AbortController | null>(null);
  const url = `${BASE}/api/ai/runs/${encodeURIComponent(runId)}/changes`;
  const scope = wholeBranch ? 'project' : 'task';
  useEffect(() => { if (open) dialog.current?.showModal(); else { dialog.current?.close(); request.current?.abort(); } }, [open]);
  useEffect(() => () => request.current?.abort(), []);
  async function show() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setOpen(true); setLoading(true); setError(''); setFileError(''); setOverview(null); setDiff(null);
    try {
      const response = await fetch(`${url}?scope=${scope}${commit ? `&commit=${encodeURIComponent(commit)}` : ''}`, { signal: controller.signal }), data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.reason ?? 'Kodeændringerne kunne ikke hentes.');
      if (!controller.signal.aborted) { setOverview(data); setSelected(data.files[0]?.path ?? ''); }
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  useEffect(() => {
    if (!open || !overview || !selected) return;
    const controller = new AbortController();
    void fetch(`${url}?file=${encodeURIComponent(selected)}&commit=${encodeURIComponent(overview.commit)}&scope=${scope}`, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.reason ?? 'Filens ændringer kunne ikke hentes.');
      if (data.commit !== overview.commit) throw new Error('Kørslen har fået et nyt commit. Luk og åbn gennemgangen igen for at se den samlede leverance.');
      if (!controller.signal.aborted) setDiff(data);
    }).catch(err => { if (!controller.signal.aborted) setFileError(err instanceof Error ? err.message : String(err)); });
    return () => controller.abort();
  }, [open, overview, selected, url, scope]);
  const lines = diff?.patch.split('\n') ?? [];
  return <>
    <button type="button" className="btn-ghost text-xs" onClick={() => void show()}><GitCompareArrows size={14} />{wholeBranch ? 'Gennemse hele AI-arbejdsgrenen' : 'Gennemse kodeændringer'}</button>
    <dialog ref={dialog} aria-label="Kodegennemgang" onCancel={() => setOpen(false)} onClose={() => setOpen(false)} className="fixed m-auto w-[min(96vw,1400px)] max-h-[94dvh] rounded-2xl border border-slate-500/40 bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100 p-0 shadow-2xl backdrop:bg-black/75">
      <header className="flex items-start gap-3 border-b border-zinc-200 dark:border-white/10 p-4"><div className="min-w-0 flex-1"><h2 className="font-semibold">Kodegennemgang</h2><p className="text-xs opacity-60 mt-1">{overview ? `${overview.totalFiles} ændrede filer · ${overview.baseCommit.slice(0, 10)} → ${overview.commit.slice(0, 10)}` : 'Henter den gemte kodeleverance…'}</p><p className="text-xs opacity-60 mt-1">Sammenligningen viser gemte commits. Kontroller og eventuelle senere lokale ændringer vurderes særskilt.</p></div><button type="button" aria-label="Luk kodegennemgang" className="btn-ghost p-2" onClick={() => setOpen(false)}><X size={18} /></button></header>
      {loading && <p role="status" className="p-4 text-sm flex gap-2"><Loader2 size={16} className="animate-spin" />Henter ændringer…</p>}
      {error && <div className="p-4 text-sm"><p role="alert">{error}</p><button type="button" className="btn-ghost mt-2" onClick={() => void show()}>Prøv igen</button></div>}
      {overview && <>
        <div className="grid md:grid-cols-[260px_minmax(0,1fr)] max-h-[68dvh] overflow-auto">
          <nav aria-label="Ændrede filer" className="border-b md:border-b-0 md:border-r border-zinc-200 dark:border-white/10 p-2 max-h-40 md:max-h-[68dvh] overflow-auto">
            {overview.files.map(file => <button key={file.path} type="button" aria-pressed={selected === file.path} onClick={() => { if (file.path !== selected) { setSelected(file.path); setDiff(null); setFileError(''); } }} className={`w-full text-left text-xs p-2 rounded-lg mb-1 ${selected === file.path ? 'bg-indigo-500/15 ring-1 ring-inset ring-indigo-400/40' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}><span className="block break-all font-mono">{file.path}</span><span className="opacity-60">{labels[file.status] ?? file.status} · {file.binary ? 'Binær fil' : `+${file.added} −${file.removed}`}</span></button>)}
            {overview.filesTruncated && <p className="text-xs p-2">De første 1.000 filer vises. Hent patchen for hele leverancen.</p>}
            {!overview.files.length && <p className="text-sm p-2">Ingen filændringer mellem de gemte commits.</p>}
          </nav>
          <section aria-label="Filens ændringer" className="min-w-0 p-3 overflow-auto md:max-h-[68dvh]">
            {fileError ? <p role="alert" className="text-sm">{fileError}</p> : selected && !diff ? <p role="status" className="text-sm">Henter fil…</p> : diff?.file.binary ? <p className="text-sm">Binært indhold kan ikke vises som tekst. Filen er med i patchen.</p> : diff && <>
              <pre className="text-[11px] leading-5 font-mono w-max min-w-full" aria-label={`Diff: ${selected}`}>{lines.slice(0, 2000).map((line, index) => <span key={index} className={`block px-2 ${line.startsWith('+') && !line.startsWith('+++') ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' : line.startsWith('-') && !line.startsWith('---') ? 'bg-rose-500/10 text-rose-800 dark:text-rose-200' : line.startsWith('@@') ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-200' : ''}`}>{line || ' '}</span>)}</pre>
              {(diff.truncated || lines.length > 2000) && <p className="text-sm mt-3">Udsnit af en stor ændring. Hent patchen for det fulde indhold.</p>}
            </>}
          </section>
        </div>
        <footer className="p-3 border-t border-zinc-200 dark:border-white/10"><a className="btn-ghost text-xs inline-flex" href={`${url}.patch?commit=${encodeURIComponent(overview.commit)}&scope=${scope}`}><Download size={14} />Hent samlet Git-patch</a></footer>
      </>}
    </dialog>
  </>;
}

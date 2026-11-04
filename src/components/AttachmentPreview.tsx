import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Maximize2, Minimize2, X } from 'lucide-react';
import type { AiAttachment } from '../lib/types';

const BASE = 'http://127.0.0.1:4310';
export default function AttachmentPreview({ attachment, onRemove }: { attachment: AiAttachment; onRemove?: () => void }) {
  const [open, setOpen] = useState(false);
  const [original, setOriginal] = useState(false);
  const [dimensions, setDimensions] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const candidate = attachment.dataUrl ?? (attachment.url?.startsWith('/') ? `${BASE}${attachment.url}` : attachment.url);
  const url = candidate && /^(https?:\/\/|data:image\/)/i.test(candidate) ? candidate : undefined;
  const isImage = attachment.kind === 'image' && Boolean(url);
  useEffect(() => {
    const element = dialog.current;
    if (open) element?.showModal();
    else element?.close();
  }, [open]);
  return <>
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/10 bg-black/5 dark:bg-white/5 px-2 py-1 text-[11px]">
      {isImage ? <button type="button" onClick={() => { setOriginal(false); setOpen(true); }} className="inline-flex items-center gap-2 text-left" aria-label={`Åbn billede: ${attachment.name}`}><img src={url} alt="" className="h-10 w-10 rounded object-cover" /><span className="max-w-[140px] truncate">{attachment.name}</span><Maximize2 size={11} className="opacity-50" /></button> : url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2" aria-label={`Åbn fil: ${attachment.name}`}><FileText size={13} /><span className="max-w-[140px] truncate">{attachment.name}</span></a> : <><FileText size={13} /><span className="max-w-[140px] truncate">{attachment.name}</span></>}
      {onRemove && <button type="button" onClick={onRemove} className="opacity-60 hover:opacity-100 p-1" aria-label={`Fjern ${attachment.name}`}><X size={12} /></button>}
    </span>
    {isImage && <dialog ref={dialog} aria-label={`Billedvisning: ${attachment.name}`} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} className="fixed m-auto w-[min(96vw,1100px)] max-h-[94dvh] rounded-2xl border border-slate-500/40 bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100 p-0 shadow-2xl backdrop:bg-black/75">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 dark:border-white/10 p-3"><div className="min-w-0 flex-1"><h2 className="font-semibold text-sm truncate">{attachment.name}</h2><p className="text-xs opacity-60">{dimensions}{attachment.size ? ` · ${(attachment.size / 1024).toFixed(0)} KB` : ''}</p></div><button type="button" className="btn-ghost text-xs" onClick={() => setOriginal(value => !value)}>{original ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{original ? 'Tilpas billedet' : 'Originalstørrelse'}</button><a href={url} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs"><Download size={14} />Åbn fil</a><button type="button" className="btn-ghost p-2" aria-label="Luk billedvisning" onClick={() => setOpen(false)}><X size={17} /></button></div>
      <div className="max-h-[76dvh] overflow-auto p-3 bg-slate-100 dark:bg-black/30"><img src={url} alt={attachment.name} onLoad={event => setDimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight} px`)} className={original ? 'max-w-none' : 'max-w-full max-h-[70dvh] mx-auto object-contain'} /></div>
    </dialog>}
  </>;
}

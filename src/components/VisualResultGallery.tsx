import { useState } from 'react';
import type { SwarmRun } from '../lib/swarm';
import ModelPreview from './ModelPreview';

const api = 'http://127.0.0.1:4310';
type Artifact = { kind: string; name: string; mime: string; url?: string };
function fileUrl(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return `${api}${url}`;
  if (/^https?:\/\//i.test(url)) return url;
  return null;
}
function mediaType(artifact: Artifact): 'image' | 'audio' | 'video' | 'model' | 'model-download' | 'file' {
  const mime = artifact.mime?.toLowerCase() ?? '';
  if (mime.startsWith('image/') || artifact.kind === 'image') return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (['model/gltf-binary', 'model/gltf+json'].includes(mime) || /\.(glb|gltf)$/i.test(artifact.name)) return 'model';
  if (mime.startsWith('model/') || /\.(obj|fbx)$/i.test(artifact.name)) return 'model-download';
  return 'file';
}
function imageOrder(name: string): number {
  if (/(before|før|foer)/i.test(name)) return 0;
  if (/(after|efter)/i.test(name)) return 2;
  return 1;
}
function sceneName(name: string): string { return name.match(/\bei\d{2}\b/i)?.[0].toLowerCase() ?? ''; }

function ModelArtifact({ url, name }: { url: string; name: string }) {
  const [open, setOpen] = useState(false);
  return <article className="rounded-xl border border-zinc-200 dark:border-white/10 p-3 space-y-3">
    <h3 className="text-xs font-semibold break-all">{name}</h3>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn-primary text-xs" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Luk 3D-visning' : 'Vis 3D-model'}</button>
      <a href={url} target="_blank" rel="noreferrer" download={name} className="text-xs underline text-indigo-500 dark:text-indigo-300">Hent originalfil</a>
    </div>
    {open && <ModelPreview url={url} name={name} />}
  </article>;
}

export default function VisualResultGallery({ run }: { run: SwarmRun }) {
  const seen = new Set<string>();
  const artifacts = [...run.jobs.flatMap(job => [...(job.artifacts ?? []), ...(job.media?.artifacts ?? [])]), ...(run.results ?? []).flatMap(result => result.artifacts ?? [])]
    .map(artifact => ({ ...artifact, url: fileUrl(artifact.url), type: mediaType(artifact) }))
    .filter((artifact): artifact is typeof artifact & { url: string } => {
      if (!artifact.url || seen.has(artifact.url)) return false;
      seen.add(artifact.url); return true;
    });
  const images = artifacts.filter(artifact => artifact.type === 'image').sort((a, b) => sceneName(a.name).localeCompare(sceneName(b.name)) || imageOrder(a.name) - imageOrder(b.name));
  const other = artifacts.filter(artifact => artifact.type !== 'image');
  const production = run.jobs.filter(job => job.media?.state);
  if (!artifacts.length && !production.length) return null;
  return <section id="orbit-run-visual" tabIndex={-1} aria-label="Leverancer og medieproduktion" className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-black/5 dark:bg-white/[0.03] p-4 space-y-4 scroll-mt-4">
    <div><h2 className="text-sm font-semibold">Leverancer til gennemgang</h2><p className="text-xs opacity-65 mt-1">Åbn de faktiske filer og sammenlign billeder med projektets referencer.</p></div>
    {!!production.length && <div className="space-y-2" aria-label="Status for medieproduktion">{production.map(job => <div key={job.id} className="rounded-lg border border-zinc-200 dark:border-white/10 px-3 py-2 text-xs"><span className="font-medium">{job.title}</span><span className="ml-2 opacity-70">{job.status === 'error' || job.status === 'blocked' ? 'Produktionen fejlede eller blev blokeret' : job.status === 'cancelled' || job.status === 'interrupted' ? 'Produktionen blev afbrudt' : job.media?.state === 'submitting' ? 'Bestilling sendes' : job.media?.state === 'processing' ? 'Produceres hos tjenesten' : job.media?.state === 'completed' ? 'Fil modtaget' : job.media?.state}</span>{job.notes.at(-1) && <p className="opacity-60 mt-1">{job.notes.at(-1)}</p>}</div>)}</div>}
    {!!images.length && <div className="grid grid-cols-1 gap-3">{images.map(image => <a key={image.url} href={image.url} target="_blank" rel="noreferrer" className="block rounded-xl overflow-hidden border border-zinc-200 dark:border-white/10 bg-black/10 hover:border-indigo-400/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"><img src={image.url} alt={image.name} loading="lazy" className="w-full max-h-[460px] object-contain bg-black/20" /><span className="block text-xs px-3 py-2 break-all">{image.name} · Åbn i fuld størrelse</span></a>)}</div>}
    {!!other.length && <div className="grid grid-cols-1 gap-3">{other.map(item => item.type === 'model' ? <ModelArtifact key={item.url} url={item.url} name={item.name} /> : <article key={item.url} className="rounded-xl border border-zinc-200 dark:border-white/10 p-3 space-y-2"><h3 className="text-xs font-semibold break-all">{item.name}</h3>{item.type === 'audio' && <audio controls preload="metadata" src={item.url} className="w-full" aria-label={`Afspil ${item.name}`} />}{item.type === 'video' && <video controls preload="metadata" src={item.url} className="w-full rounded-lg bg-black" aria-label={`Afspil ${item.name}`} />}{item.type === 'model-download' && <p className="text-xs opacity-65">Denne modeltype kan hentes og åbnes i et 3D-program. Direkte visning i Orbit understøtter GLB og glTF.</p>}<a href={item.url} target="_blank" rel="noreferrer" download={item.name} className="inline-block text-xs underline text-indigo-500 dark:text-indigo-300">{item.type === 'model-download' ? 'Hent 3D-fil' : 'Åbn eller hent fil'}</a></article>)}</div>}
    {!!images.length && <p className="text-xs text-amber-600 dark:text-amber-300">Visuel godkendelse afventer din vurdering.</p>}
  </section>;
}

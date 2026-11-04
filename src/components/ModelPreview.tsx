import { useEffect, useRef, useState } from 'react';

// The renderer is loaded only after the user opens a real 3D artifact. Keeping
// it bundled locally lets the desktop app preview models without a CDN.
export default function ModelPreview({ url, name }: { url: string; name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const container = host.current;
    import('@google/model-viewer').then(() => {
      if (cancelled || !container) return;
      const viewer = document.createElement('model-viewer');
      viewer.setAttribute('src', url);
      viewer.setAttribute('alt', name);
      viewer.setAttribute('camera-controls', '');
      viewer.setAttribute('interaction-prompt', 'none');
      viewer.setAttribute('shadow-intensity', '1');
      viewer.setAttribute('loading', 'eager');
      viewer.tabIndex = 0;
      viewer.style.width = '100%';
      viewer.style.height = '380px';
      viewer.style.background = 'radial-gradient(circle at center, #363653, #171726)';
      viewer.addEventListener('load', () => { if (!cancelled) setState('ready'); });
      viewer.addEventListener('error', () => { if (!cancelled) setState('error'); });
      container.replaceChildren(viewer);
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; container?.replaceChildren(); };
  }, [url, name, attempt]);

  return <div className="space-y-2">
    <div ref={host} role="group" aria-label={`3D-visning: ${name}`} className="rounded-lg overflow-hidden border border-white/10 min-h-[380px] bg-[#171726]" />
    {state === 'loading' && <p role="status" className="text-xs opacity-65">Indlæser 3D-modellen…</p>}
    {state === 'ready' && <p className="text-xs opacity-65">Træk for at dreje. Rul eller knib for at zoome. Modellen kan også vælges med tastaturet.</p>}
    {state === 'error' && <div role="alert" className="text-xs text-amber-500 space-y-2"><p>Modellen kunne ikke vises her. Du kan stadig hente originalfilen ovenfor.</p><button type="button" className="btn-secondary text-xs" onClick={() => { setState('loading'); setAttempt(value => value + 1); }}>Prøv 3D-visning igen</button></div>}
  </div>;
}

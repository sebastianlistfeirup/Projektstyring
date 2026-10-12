import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { MonitorPlay, X } from 'lucide-react';

const ROTATION = ['/idag', '/dashboard', '/tidslinje', '/team'];
const ROTATE_MS = 20_000;

function setTvMode(on: boolean) {
  window.dispatchEvent(new CustomEvent('orbit:tv', { detail: { on } }));
}

/**
 * TV-tilstand: fuldskærms-overblik der roterer mellem app's sider hvert 20. sekund.
 * Kommunikerer med AppShell via 'orbit:tv'-eventet, som skjuler rail/aside/topbar.
 */
export default function TvMode() {
  const [active, setActive] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const navigate = useNavigate();
  const location = useLocation();
  const activeRef = useRef(false);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const exit = useCallback(() => {
    if (!activeRef.current) return;
    setActive(false);
    setTvMode(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    navigate('/idag');
  }, [navigate]);

  const start = () => {
    setActive(true);
    setTvMode(true);
    void document.documentElement.requestFullscreen().catch(() => {});
    if (!ROTATION.includes(location.pathname)) navigate('/idag');
  };

  // Klokkeslæt i headeren (viser minutter; opdateres løbende)
  useEffect(() => {
    if (!active) return;
    const i = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(i);
  }, [active]);

  // Rotation mellem siderne – kun mens tilstanden er aktiv
  useEffect(() => {
    if (!active) return;
    const i = window.setTimeout(() => {
      const idx = ROTATION.indexOf(location.pathname);
      navigate(ROTATION[(idx + 1) % ROTATION.length] ?? '/idag');
    }, ROTATE_MS);
    return () => window.clearTimeout(i);
  }, [active, location.pathname, navigate]);

  // Esc afslutter; browserens egen fullscreen-exit (Esc i fullscreen) afslutter også
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit();
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement && activeRef.current) exit();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [active, exit]);

  if (!active) {
    return (
      <button onClick={start} title="TV-tilstand" className="btn-ghost px-2">
        <MonitorPlay className="h-4 w-4" />
        <span className="hidden lg:inline">TV</span>
      </button>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[85] flex flex-col">
      <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-3 bg-[#17181c] px-10 py-6 shadow-panel">
        <div className="flex items-baseline gap-4">
          <h2 className="text-3xl font-bold tracking-tight text-white">Orbit – overblik</h2>
          <span className="text-xl tabular-nums text-zinc-400">{format(now, 'HH:mm')}</span>
        </div>
        <button
          onClick={exit}
          className="btn-ghost border border-white/10 text-zinc-200 hover:bg-white/10 dark:hover:bg-white/10"
        >
          <X className="h-4 w-4" />
          Afslut TV-tilstand
        </button>
      </div>
    </div>
  );
}

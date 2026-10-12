import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getClientId, onRemoteCursor, sendCursor } from '../lib/sync';

interface CursorState {
  name: string;
  x: number;
  y: number;
  view: string;
  ts: number;
}

const PALETTE = ['#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#a78bfa'];

function colorFor(clientId: string): string {
  let h = 0;
  for (let i = 0; i < clientId.length; i++) h = (h * 31 + clientId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Lys baggrund -> mørk tekst i navne-chippen
function textOn(color: string): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#18181b' : '#ffffff';
}

const STALE_MS = 8000;

/** Figma-lignende tilstedeværelsesmarkører for kolleger på samme side. */
export default function PresenceCursors() {
  const location = useLocation();
  const [cursors, setCursors] = useState<Map<string, CursorState>>(new Map());

  // Egen markør: send musens position (throttlet i sendCursor)
  useEffect(() => {
    const onMove = (e: MouseEvent) => sendCursor(e.clientX, e.clientY, location.pathname);
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [location.pathname]);

  // Fjernmarkører fra companion-serveren
  useEffect(() => {
    return onRemoteCursor((cursor) => {
      setCursors((prev) => {
        const next = new Map(prev);
        next.set(cursor.clientId, { name: cursor.name, x: cursor.x, y: cursor.y, view: cursor.view, ts: Date.now() });
        return next;
      });
    });
  }, []);

  // Ryd op i markører, der er gået i stå (>8 sekunder uden besked)
  useEffect(() => {
    const interval = window.setInterval(() => {
      const cutoff = Date.now() - STALE_MS;
      setCursors((prev) => {
        let changed = false;
        const next = new Map<string, CursorState>();
        for (const [id, c] of prev) {
          if (c.ts > cutoff) next.set(id, c);
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 4000);
    return () => window.clearInterval(interval);
  }, []);

  const ownId = getClientId();

  return (
    <>
      {[...cursors.entries()]
        .filter(([clientId, c]) => clientId !== ownId && c.view === location.pathname)
        .map(([clientId, c]) => {
          const color = colorFor(clientId);
          return (
            <div
              key={clientId}
              className="pointer-events-none fixed z-[80]"
              style={{ left: c.x, top: c.y, transition: 'left .12s ease-out, top .12s ease-out' }}
            >
              <div className="-ml-px -mt-px flex flex-col items-start">
                <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
                  <path
                    d="M4 2 L4 19 L9.2 14.6 L12.4 20.6 L15 19.2 L11.9 13.4 L18.5 13.4 Z"
                    fill={color}
                    stroke="#ffffff"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                </svg>
                <span
                  className="mt-1 max-w-36 truncate rounded-full px-1.5 py-px text-[10px] font-semibold leading-4"
                  style={{ backgroundColor: color, color: textOn(color) }}
                >
                  {c.name}
                </span>
              </div>
            </div>
          );
        })}
    </>
  );
}

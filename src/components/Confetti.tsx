import { useEffect, useState, type CSSProperties } from 'react';

interface Particle {
  id: number;
  color: string;
  dx: number;
  peak: number;
  rot: number;
  delay: number;
  round: boolean;
}

interface Burst {
  id: number;
  particles: Particle[];
}

const COLORS = ['var(--acc-500, #6366f1)', '#f59e0b', '#10b981', '#ec4899', '#38bdf8'];
const PARTICLE_COUNT = 36;

let burstSeq = 0;
let particleSeq = 0;

export function celebrate(taskId?: string) {
  window.dispatchEvent(new CustomEvent('orbit:celebrate', { detail: { taskId } }));
}

export default function Confetti() {
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    const onCelebrate = (e: Event) => {
      void (e as CustomEvent<{ taskId?: string }>).detail;
      const burstId = ++burstSeq;
      const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
        id: ++particleSeq,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        dx: Math.round((Math.random() - 0.5) * 520),
        peak: -(50 + Math.random() * 230),
        rot: Math.round((Math.random() - 0.5) * 760),
        delay: Math.round(Math.random() * 120) / 1000,
        round: Math.random() < 0.4,
      }));
      setBursts((prev) => [...prev, { id: burstId, particles }]);
      window.setTimeout(() => {
        setBursts((prev) => prev.filter((b) => b.id !== burstId));
      }, 1400);
    };
    window.addEventListener('orbit:celebrate', onCelebrate);
    return () => window.removeEventListener('orbit:celebrate', onCelebrate);
  }, []);

  return (
    <>
      <style>{`
        @keyframes confetti-fall {
          0% {
            transform: translate(-50%, -50%) translate(0, 0) rotate(0deg);
            opacity: 1;
          }
          30% {
            transform: translate(-50%, -50%) translate(calc(var(--dx) * 0.45), var(--peak)) rotate(calc(var(--rot) * 0.4));
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) translate(var(--dx), 58vh) rotate(var(--rot));
            opacity: 0;
          }
        }
      `}</style>
      <div className="pointer-events-none fixed inset-0 z-[96] overflow-hidden" aria-hidden="true">
        {bursts.map((burst) =>
          burst.particles.map((p) => (
            <div
              key={p.id}
              className="absolute left-1/2 top-1/3 h-2 w-2"
              style={
                {
                  backgroundColor: p.color,
                  borderRadius: p.round ? '50%' : '2px',
                  animation: `confetti-fall 1.1s ease-in ${p.delay}s forwards`,
                  '--dx': `${p.dx}px`,
                  '--peak': `${p.peak}px`,
                  '--rot': `${p.rot}deg`,
                } as CSSProperties
              }
            />
          )),
        )}
      </div>
    </>
  );
}

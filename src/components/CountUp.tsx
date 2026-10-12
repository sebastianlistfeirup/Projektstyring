import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Tæller animéret op (eller ned) til `value`.
 * Starter når `value` ændrer sig, og første gang komponenten scroller ind i viewport.
 */
export default function CountUp({
  value,
  durationMs = 700,
  className,
}: {
  value: number;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const displayed = useRef(0);
  const raf = useRef<number | null>(null);
  const inView = useRef(false);
  const spanRef = useRef<HTMLSpanElement>(null);

  const animateTo = (target: number) => {
    if (raf.current) cancelAnimationFrame(raf.current);
    const from = displayed.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const current = from + (target - from) * easeOutCubic(t);
      displayed.current = current;
      setDisplay(current);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  // Start når tallet ændrer sig (kun når synligt)
  useEffect(() => {
    if (!inView.current) return;
    animateTo(value);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  // Første visning: start når elementet er i viewport (ellers med det samme)
  useEffect(() => {
    const el = spanRef.current;
    if (!el || !('IntersectionObserver' in window)) {
      inView.current = true;
      animateTo(value);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !inView.current) {
          inView.current = true;
          animateTo(value);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span ref={spanRef} className={cn('tabular-nums', className)} title={String(value)} aria-label={String(value)}>
      {Math.round(display)}
    </span>
  );
}

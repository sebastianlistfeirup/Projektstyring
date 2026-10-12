import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/** Let overgangs-animation mellem sider: remount'er indholdet ved ruteskift. */
export default function RouteTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <div key={location.pathname} className="h-full animate-view-enter">
      {children}
    </div>
  );
}

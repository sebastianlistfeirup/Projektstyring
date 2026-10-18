import { useEffect, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { useStore } from './store';
import { OversigtView } from './views/OversigtView';
import { ProjekterView } from './views/ProjekterView';
import { OpgaverView } from './views/OpgaverView';
import { TidslinjeView } from './views/TidslinjeView';
import { AarshjulView } from './views/AarshjulView';
import { TeamView } from './views/TeamView';
import { RessourcerView } from './views/RessourcerView';
import { RapporterView } from './views/RapporterView';
import { BudgetView } from './views/BudgetView';
import { RisiciView } from './views/RisiciView';
import { StatusbeskedView } from './views/StatusbeskedView';
import { LogView } from './views/LogView';
import { NoterView } from './views/NoterView';
import { MaalView } from './views/MaalView';
import { ImportView } from './views/ImportView';
import { AiChatView } from './views/AiChatView';
import { AiSwarmView } from './views/AiSwarmView';
import { AiVaerkstedView } from './views/AiVaerkstedView';
import { IntegrationerView } from './views/IntegrationerView';
import { ListevisningView } from './views/ListevisningView';

export default function App() {
  const init = useStore((s) => s.init);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<OversigtView />} />
          <Route path="oversigt" element={<OversigtView />} />
          <Route path="projekter" element={<ProjekterView />} />
          <Route path="opgaver" element={<OpgaverView />} />
          <Route path="tidslinje" element={<TidslinjeView />} />
          <Route path="aarshjul" element={<AarshjulView />} />
          <Route path="team" element={<TeamView />} />
          <Route path="ressourcer" element={<RessourcerView />} />
          <Route path="rapporter" element={<RapporterView />} />
          <Route path="budget" element={<BudgetView />} />
          <Route path="risici" element={<RisiciView />} />
          <Route path="besked" element={<StatusbeskedView />} />
          <Route path="log" element={<LogView />} />
          <Route path="noter" element={<NoterView />} />
          <Route path="maal" element={<MaalView />} />
          <Route path="import" element={<ImportView />} />
          <Route path="chat" element={<AiChatView />} />
          <Route path="swarm" element={<AiSwarmView />} />
          <Route path="vaerksted" element={<AiVaerkstedView />} />
          <Route path="integrationer" element={<IntegrationerView />} />
          <Route path="liste" element={<ListevisningView />} />
        </Route>
      </Routes>
      <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </HashRouter>
  );
}

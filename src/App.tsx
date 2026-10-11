import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import CommandPalette from './components/CommandPalette';
import TaskDrawer from './components/TaskDrawer';
import { useStore } from './store/useStore';
import ActivityView from './views/ActivityView';
import BacklogView from './views/BacklogView';
import BoardView from './views/BoardView';
import DashboardView from './views/DashboardView';
import MyWorkView from './views/MyWorkView';
import TableView from './views/TableView';
import TimelineView from './views/TimelineView';

export default function App() {
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/tavle" replace />} />
          <Route path="/tavle" element={<BoardView />} />
          <Route path="/tabel" element={<TableView />} />
          <Route path="/tidslinje" element={<TimelineView />} />
          <Route path="/backlog" element={<BacklogView />} />
          <Route path="/min" element={<MyWorkView />} />
          <Route path="/dashboard" element={<DashboardView />} />
          <Route path="/aktivitet" element={<ActivityView />} />
          <Route path="*" element={<Navigate to="/tavle" replace />} />
        </Route>
      </Routes>
      <TaskDrawer />
      <CommandPalette />
    </HashRouter>
  );
}

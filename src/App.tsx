import { useEffect, useRef } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import CommandPalette from './components/CommandPalette';
import TaskDrawer from './components/TaskDrawer';
import { useStore } from './store/useStore';
import type { Task } from './lib/types';
import { taskRef } from './lib/utils';
import { companionNotify, companionTeams } from './lib/companion';
import { startSync } from './lib/sync';
import ActivityView from './views/ActivityView';
import BacklogView from './views/BacklogView';
import BoardView from './views/BoardView';
import DashboardView from './views/DashboardView';
import GraphView from './views/GraphView';
import ImportView from './views/ImportView';
import IntegrationsView from './views/IntegrationsView';
import MyWorkView from './views/MyWorkView';
import TableView from './views/TableView';
import TeamView from './views/TeamView';
import TimelineView from './views/TimelineView';

export default function App() {
  const theme = useStore((s) => s.theme);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const previousTasks = useRef<Map<string, Task>>(new Map());
  const notifiedDone = useRef<Set<string>>(new Set());

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Tværgående synkronisering via companion-serveren
  useEffect(() => startSync(), []);

  // Notifikationer + Teams-webhook når en opgave markeres færdig
  useEffect(() => {
    const prev = previousTasks.current;
    for (const task of tasks) {
      const before = prev.get(task.id);
      if (before && before.status !== 'done' && task.status === 'done' && !notifiedDone.current.has(task.id)) {
        notifiedDone.current.add(task.id);
        const text = `${taskRef(task, projects)} · ${task.title}`;
        void companionNotify('Opgave afsluttet', text);
        void companionTeams('Opgave afsluttet i Orbit', text);
      }
      prev.set(task.id, task);
    }
  }, [tasks, projects]);

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
          <Route path="/team" element={<TeamView />} />
          <Route path="/dashboard" element={<DashboardView />} />
          <Route path="/aktivitet" element={<ActivityView />} />
          <Route path="/import" element={<ImportView />} />
          <Route path="/integrationer" element={<IntegrationsView />} />
          <Route path="/outlook" element={<GraphView />} />
          <Route path="*" element={<Navigate to="/tavle" replace />} />
        </Route>
      </Routes>
      <TaskDrawer />
      <CommandPalette />
    </HashRouter>
  );
}

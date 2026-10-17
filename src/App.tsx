import { useEffect, useRef, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import CommandPalette from './components/CommandPalette';
import { ShortcutsOverlay, Tour } from './components/Onboarding';
import Splash from './components/Splash';
import SyncConflictsBanner from './components/SyncConflictsBanner';
import TaskDrawer from './components/TaskDrawer';
import { useStore } from './store/useStore';
import type { Task } from './lib/types';
import { taskRef } from './lib/utils';
import { aiComplete } from './lib/companion';
import { completeAdopsWorkItem, closeGitIssue, completeTodoTask, companionNotify, companionTeams } from './lib/companion';
import { completeJiraIssue, completePlannerTask, completeTrelloCard } from './lib/companion';
import { celebrate } from './components/Confetti';
import { startSync } from './lib/sync';
import ActivityView from './views/ActivityView';
import BacklogView from './views/BacklogView';
import BoardView from './views/BoardView';
import DashboardView from './views/DashboardView';
import TasksView from './views/TasksView';
import YearWheelView from './views/YearWheelView';
import AiWorkshopView from './views/AiWorkshopView';
import { AiChatView } from './views/AiChatView';
import GraphView from './views/GraphView';
import GoalsView from './views/GoalsView';
import ImportView from './views/ImportView';
import IntegrationsView from './views/IntegrationsView';
import MyWorkView from './views/MyWorkView';
import NotesView from './views/NotesView';
import ReportsView from './views/ReportsView';
import RisksView from './views/RisksView';
import TableView from './views/TableView';
import TeamView from './views/TeamView';
import TimelineView from './views/TimelineView';
import TodayView from './views/TodayView';

export default function App() {
  const theme = useStore((s) => s.theme);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const previousTasks = useRef<Map<string, Task>>(new Map());
  const notifiedDone = useRef<Set<string>>(new Set());
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle(
      'dark',
      theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches),
    );
  }, [theme]);

  // Følg Windows-temaet mens "system" er valgt
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', mq.matches);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  // AI-agent: triage nye opgaver + advarsel om stillestående opgaver
  const triagedRef = useRef<Set<string>>(new Set());
  const staleWarnedRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const state = useStore.getState();
    const now = Date.now();

    if (state.agents.triage) {
      for (const task of tasks) {
        if (triagedRef.current.has(task.id)) continue;
        triagedRef.current.add(task.id);
        const isNew = now - new Date(task.createdAt).getTime() < 60_000;
        const untouched = !task.assigneeId && task.priority === 'medium' && !task.labelIds.length;
        if (isNew && untouched) {
          void aiComplete([
            { role: 'system', content: 'Du er en dansk projektassistent. For opgaven foreslå en passende PRIORITET (kritisk/høj/mellem/lav) og om den bør tildeles projektlederen. Svar KUN: prioritet | ja|nej' },
            { role: 'user', content: `Opgave: ${task.title}\nBeskrivelse: ${task.description || '(ingen)'}` },
          ]).then((r) => {
            if (!r.ok || !r.content) return;
            const [prioRaw, assignRaw] = r.content.split('|').map((s) => s.trim().toLowerCase());
            const priorityMap: Record<string, Task['priority']> = { kritisk: 'urgent', høj: 'high', 'ho j': 'high', mellem: 'medium', lav: 'low' };
            const priority = priorityMap[prioRaw] ?? null;
            const assign = assignRaw === 'ja';
            if (!priority && !assign) return;
            state.updateTask(task.id, {
              ...(priority ? { priority } : {}),
              ...(assign ? { assigneeId: state.currentUserId } : {}),
            });
            state.addNotification(state.currentUserId, `AI triagerede: “${task.title}”${priority ? ` → ${priority}` : ''}${assign ? ' + tildelt dig' : ''}`, task.id);
          });
        }
      }
    }

    if (state.agents.stale && state.rules.escalate) {
      const limit = Date.now() - state.agents.staleDays * 86400000;
      for (const task of tasks) {
        if (task.status !== 'inprogress' && task.status !== 'inreview') continue;
        if (new Date(task.updatedAt).getTime() > limit) continue;
        const day = new Date().toISOString().slice(0, 10);
        if (staleWarnedRef.current.get(task.id) === day) continue;
        staleWarnedRef.current.set(task.id, day);
        state.addNotification(
          task.assigneeId ?? state.currentUserId,
          `Stillestående opgave: “${task.title}” har ikke været aktiv i ${state.agents.staleDays} dage`,
          task.id,
        );
      }
    }
  }, [tasks]);

  // "?" åbner genvejsoversigt (når man ikke skriver i et felt)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      setShowShortcuts((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Tværgående synkronisering via companion-serveren
  useEffect(() => startSync(), []);

  // PWA share target: del tekst/links fra mobil direkte ind som opgave
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('shared') !== '1') return;
    const text = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join(' ').trim();
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    if (!text) return;
    const state = useStore.getState();
    const projectId = state.activeProjectId ?? state.projects[0]?.id;
    if (!projectId) return;
    const task = state.addTask({ title: text.slice(0, 120), projectId, description: text });
    state.selectTask(task.id);
  }, []);

  // Automatiseringsregler: afslutning -> Teams/notifikation/eksterne systemer, kritisk -> tildeling
  useEffect(() => {
    const prev = previousTasks.current;
    const state = useStore.getState();
    for (const task of tasks) {
      const before = prev.get(task.id);
      if (!before) {
        prev.set(task.id, task);
        continue;
      }
      if (before.status !== 'done' && task.status === 'done' && !notifiedDone.current.has(task.id)) {
        notifiedDone.current.add(task.id);
        celebrate();
        const text = `${taskRef(task, projects)} · ${task.title}`;
        void companionNotify('Opgave afsluttet', text);
        if (state.automation.doneTeams) void companionTeams('Opgave afsluttet i Orbit', text);
        if (state.automation.doneNotifyAssignee && task.assigneeId && task.assigneeId !== state.currentUserId) {
          state.addNotification(task.assigneeId, `Din opgave “${task.title}” blev afsluttet`, task.id);
        }
        // To-vejs: skriv status tilbage til eksterne systemer
        if (task.extIds?.todoTaskId && task.extIds.todoListId) {
          void completeTodoTask(task.extIds.todoListId, task.extIds.todoTaskId);
        }
        if (task.extIds?.adopsId) {
          void completeAdopsWorkItem(task.extIds.adopsId);
        }
        if (task.extIds?.gitProvider && task.extIds.gitIssue) {
          void closeGitIssue(task.extIds.gitIssue);
        }
        if (task.extIds?.jiraKey) {
          void completeJiraIssue(task.extIds.jiraKey);
        }
        if (task.extIds?.trelloId) {
          void completeTrelloCard(task.extIds.trelloId);
        }
        if (task.extIds?.plannerId && task.extIds.plannerEtag) {
          void completePlannerTask(task.extIds.plannerId, task.extIds.plannerEtag);
        }
      }
      if (
        before.priority !== 'urgent' &&
        task.priority === 'urgent' &&
        state.automation.urgentAssigneeId &&
        !task.assigneeId
      ) {
        state.updateTask(task.id, { assigneeId: state.automation.urgentAssigneeId }, 'sat kritisk prioritet');
        state.addNotification(state.automation.urgentAssigneeId, `Kritisk opgave tildelt dig: “${task.title}”`, task.id);
      }
      prev.set(task.id, task);
    }
  }, [tasks, projects]);

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/idag" replace />} />
          <Route path="/idag" element={<TodayView />} />
          <Route path="/opgaver" element={<TasksView />} />
          <Route path="/aarshjul" element={<YearWheelView />} />
          <Route path="/ai" element={<AiWorkshopView />} />
          <Route path="/chat" element={<AiChatView />} />
          <Route path="/tavle" element={<BoardView />} />
          <Route path="/tabel" element={<TableView />} />
          <Route path="/tidslinje" element={<TimelineView />} />
          <Route path="/backlog" element={<BacklogView />} />
          <Route path="/min" element={<MyWorkView />} />
          <Route path="/team" element={<TeamView />} />
          <Route path="/maal" element={<GoalsView />} />
          <Route path="/dashboard" element={<DashboardView />} />
          <Route path="/aktivitet" element={<ActivityView />} />
          <Route path="/import" element={<ImportView />} />
          <Route path="/noter" element={<NotesView />} />
          <Route path="/risici" element={<RisksView />} />
          <Route path="/rapporter" element={<ReportsView />} />
          <Route path="/integrationer" element={<IntegrationsView />} />
          <Route path="/outlook" element={<GraphView />} />
          <Route path="*" element={<Navigate to="/idag" replace />} />
        </Route>
      </Routes>
      <TaskDrawer />
      <CommandPalette />
      <Splash />
      <Tour />
      <SyncConflictsBanner />
      <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </HashRouter>
  );
}

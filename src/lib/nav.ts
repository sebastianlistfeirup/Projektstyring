import type { LucideIcon } from 'lucide-react';
import { Activity, CalendarRange, Kanban, LayoutDashboard, ListChecks, ListTodo, Table2 } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  keywords: string[];
}

export const VIEWS: NavItem[] = [
  { to: '/tavle', label: 'Tavle', icon: Kanban, keywords: ['board', 'kanban', 'opgaver'] },
  { to: '/tabel', label: 'Tabel', icon: Table2, keywords: ['liste', 'table', 'oversigt'] },
  { to: '/tidslinje', label: 'Tidslinje', icon: CalendarRange, keywords: ['gantt', 'plan', 'kalender'] },
  { to: '/backlog', label: 'Backlog & Sprints', icon: ListChecks, keywords: ['sprint', 'planlægning', 'roadmap'] },
  { to: '/min', label: 'Min arbejdsliste', icon: ListTodo, keywords: ['mine', 'opgaver', 'todo'] },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, keywords: ['rapport', 'diagram', 'status'] },
  { to: '/aktivitet', label: 'Aktivitet', icon: Activity, keywords: ['log', 'historik', 'feed'] },
];

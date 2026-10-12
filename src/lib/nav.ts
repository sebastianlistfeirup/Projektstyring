import type { LucideIcon } from 'lucide-react';
import { Activity, CalendarRange, FolderInput, Kanban, LayoutDashboard, ListChecks, ListTodo, Mail, Plug, Sun, Table2, Users } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  /** Nøgle i i18n-ordbogen ('nav.*'); label er dansk fallback. */
  labelKey: string;
  icon: LucideIcon;
  keywords: string[];
}

export const VIEWS: NavItem[] = [
  { to: '/idag', label: 'I dag', labelKey: 'nav.today', icon: Sun, keywords: ['today', 'nu', 'overblik', 'forslag'] },
  { to: '/tavle', label: 'Tavle', labelKey: 'nav.board', icon: Kanban, keywords: ['board', 'kanban', 'opgaver'] },
  { to: '/tabel', label: 'Tabel', labelKey: 'nav.table', icon: Table2, keywords: ['liste', 'table', 'oversigt'] },
  { to: '/tidslinje', label: 'Tidslinje', labelKey: 'nav.timeline', icon: CalendarRange, keywords: ['gantt', 'plan', 'kalender'] },
  { to: '/backlog', label: 'Backlog & Sprints', labelKey: 'nav.backlog', icon: ListChecks, keywords: ['sprint', 'planlægning', 'roadmap'] },
  { to: '/min', label: 'Min arbejdsliste', labelKey: 'nav.mywork', icon: ListTodo, keywords: ['mine', 'opgaver', 'todo'] },
  { to: '/team', label: 'Team & kapacitet', labelKey: 'nav.team', icon: Users, keywords: ['team', 'kapacitet', 'ressourcer', 'belastning'] },
  { to: '/dashboard', label: 'Dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, keywords: ['rapport', 'diagram', 'status'] },
  { to: '/aktivitet', label: 'Aktivitet', labelKey: 'nav.activity', icon: Activity, keywords: ['log', 'historik', 'feed'] },
  { to: '/import', label: 'Import & skabeloner', labelKey: 'nav.import', icon: FolderInput, keywords: ['skabelon', 'monday', 'trello', 'jira', 'import'] },
  { to: '/integrationer', label: 'Integrationer', labelKey: 'nav.integrations', icon: Plug, keywords: ['companion', 'eksport', 'teams', 'notifikationer'] },
  { to: '/outlook', label: 'Outlook & Microsoft 365', labelKey: 'nav.outlook', icon: Mail, keywords: ['microsoft', 'graph', 'møder', 'to do', 'kalender'] },
];

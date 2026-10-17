import type { LucideIcon } from 'lucide-react';
import { Activity, BarChart3, Bot, CalendarRange, CircleGauge, FolderInput, Kanban, LayoutDashboard, ListChecks, ListTodo, Mail, MessageSquare, NotebookPen, Plug, ShieldAlert, Sun, Table2, Target, Users } from 'lucide-react';

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
  { to: '/opgaver', label: 'Mine opgaver', labelKey: 'nav.mineopgaver', icon: ListChecks, keywords: ['mine', 'opgaver', 'liste', 'tjekliste', 'todo', 'plan'] },
  { to: '/aarshjul', label: 'Årshjul', labelKey: 'nav.aarshjul', icon: CircleGauge, keywords: ['årshjul', 'år', 'overblik', 'sæson', 'planlægning'] },
  { to: '/ai', label: 'AI-værksted', labelKey: 'nav.aiworkshop', icon: Bot, keywords: ['ai', 'agenter', 'orkestrator', 'pipeline', 'spil', 'udvikling', 'codex', 'claude'] },
  { to: '/chat', label: 'AI-chat', labelKey: 'nav.aichat', icon: MessageSquare, keywords: ['chat', 'snak', 'besked', 'prompt', 'billeder', 'filer'] },
  { to: '/tavle', label: 'Tavle', labelKey: 'nav.board', icon: Kanban, keywords: ['board', 'kanban', 'opgaver'] },
  { to: '/tabel', label: 'Tabel', labelKey: 'nav.table', icon: Table2, keywords: ['liste', 'table', 'oversigt'] },
  { to: '/tidslinje', label: 'Tidslinje', labelKey: 'nav.timeline', icon: CalendarRange, keywords: ['gantt', 'plan', 'kalender'] },
  { to: '/backlog', label: 'Backlog & Sprints', labelKey: 'nav.backlog', icon: ListChecks, keywords: ['sprint', 'planlægning', 'roadmap'] },
  { to: '/min', label: 'Min arbejdsliste', labelKey: 'nav.mywork', icon: ListTodo, keywords: ['mine', 'opgaver', 'todo'] },
  { to: '/team', label: 'Team & kapacitet', labelKey: 'nav.team', icon: Users, keywords: ['team', 'kapacitet', 'ressourcer', 'belastning'] },
  { to: '/maal', label: 'Mål', labelKey: 'nav.goals', icon: Target, keywords: ['okr', 'mål', 'key results'] },
  { to: '/noter', label: 'Noter', labelKey: 'nav.notes', icon: NotebookPen, keywords: ['wiki', 'mødenoter', 'beslutninger'] },
  { to: '/risici', label: 'Risici & fejl', labelKey: 'nav.risks', icon: ShieldAlert, keywords: ['risiko', 'issue', 'heatmap', 'matrix'] },
  { to: '/dashboard', label: 'Dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, keywords: ['rapport', 'diagram', 'status'] },
  { to: '/rapporter', label: 'Rapporter', labelKey: 'nav.reports', icon: BarChart3, keywords: ['rapport', 'pdf', 'print', 'widget'] },
  { to: '/aktivitet', label: 'Aktivitet', labelKey: 'nav.activity', icon: Activity, keywords: ['log', 'historik', 'feed'] },
  { to: '/import', label: 'Import & skabeloner', labelKey: 'nav.import', icon: FolderInput, keywords: ['skabelon', 'monday', 'trello', 'jira', 'import'] },
  { to: '/integrationer', label: 'Integrationer', labelKey: 'nav.integrations', icon: Plug, keywords: ['companion', 'eksport', 'teams', 'notifikationer'] },
  { to: '/outlook', label: 'Outlook & Microsoft 365', labelKey: 'nav.outlook', icon: Mail, keywords: ['microsoft', 'graph', 'møder', 'to do', 'kalender'] },
];

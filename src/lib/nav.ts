import {
  Activity, BarChart3, Bot, CalendarRange, CircleGauge, FolderInput, Kanban, LayoutDashboard, ListChecks, ListTodo, Mail, MessageSquare, NotebookPen, Plug, Radar, ShieldAlert, Sun, Table2, Target, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  labelKey: string;
  icon: LucideIcon;
  keywords: string[];
}

export const VIEWS: NavItem[] = [
  { to: '/oversigt', label: 'Oversigt', labelKey: 'nav.oversigt', icon: LayoutDashboard, keywords: ['dashboard', 'oversigt', 'hjem', 'home'] },
  { to: '/projekter', label: 'Projekter', labelKey: 'nav.projekter', icon: Kanban, keywords: ['projekt', 'projekter', 'projects', 'kanban'] },
  { to: '/opgaver', label: 'Mine opgaver', labelKey: 'nav.opgaver', icon: ListTodo, keywords: ['opgave', 'opgaver', 'tasks', 'mine', 'my'] },
  { to: '/tidslinje', label: 'Tidslinje', labelKey: 'nav.tidslinje', icon: CalendarRange, keywords: ['tidslinje', 'timeline', 'gantt'] },
  { to: '/aarshjul', label: 'Årshjul', labelKey: 'nav.aarshjul', icon: Sun, keywords: ['årshjul', 'aarshjul', 'år', 'year'] },
  { to: '/team', label: 'Team', labelKey: 'nav.team', icon: Users, keywords: ['team', 'medarbejdere', 'personer', 'people'] },
  { to: '/ressourcer', label: 'Ressourcer', labelKey: 'nav.ressourcer', icon: CircleGauge, keywords: ['ressourcer', 'kapacitet', 'allokering', 'resources'] },
  { to: '/rapporter', label: 'Rapporter', labelKey: 'nav.rapporter', icon: BarChart3, keywords: ['rapport', 'rapporter', 'reports', 'rapporting'] },
  { to: '/budget', label: 'Budget', labelKey: 'nav.budget', icon: Table2, keywords: ['budget', 'økonomi', 'finans'] },
  { to: '/risici', label: 'Risici', labelKey: 'nav.risici', icon: ShieldAlert, keywords: ['risiko', 'risici', 'risks'] },
  { to: '/besked', label: 'Statusbesked', labelKey: 'nav.besked', icon: Mail, keywords: ['besked', 'mail', 'status', 'beskeddeling'] },
  { to: '/log', label: 'Aktivitetslog', labelKey: 'nav.log', icon: Activity, keywords: ['log', 'aktivitet', 'activity', 'historik'] },
  { to: '/noter', label: 'Noter', labelKey: 'nav.noter', icon: NotebookPen, keywords: ['noter', 'notes', 'note'] },
  { to: '/maal', label: 'Mål', labelKey: 'nav.maal', icon: Target, keywords: ['mål', 'maal', 'goals', 'objectives'] },
  { to: '/import', label: 'Import / eksport', labelKey: 'nav.import', icon: FolderInput, keywords: ['import', 'eksport', 'export', 'backup'] },
  { to: '/chat', label: 'AI-chat', labelKey: 'nav.aichat', icon: MessageSquare, keywords: ['chat', 'ai', 'samtale', 'conversation'] },
  { to: '/swarm', label: 'AI-swarm', labelKey: 'nav.aiswarm', icon: Radar, keywords: ['swarm', 'agenter', 'live', 'visualisering', 'orkestrering', 'radar'] },
  { to: '/vaerksted', label: 'AI-værksted', labelKey: 'nav.vaerksted', icon: Bot, keywords: ['værksted', 'vaerksted', 'værkstæd', 'ai', 'workshop', 'pipeline'] },
  { to: '/integrationer', label: 'Integrationer', labelKey: 'nav.integrationer', icon: Plug, keywords: ['integration', 'integrationer', 'connectors', 'services'] },
  { to: '/liste', label: 'Listevisning', labelKey: 'nav.liste', icon: ListChecks, keywords: ['liste', 'list', 'table', 'tabel'] },
];

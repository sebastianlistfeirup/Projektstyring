import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Lang = 'da' | 'en';

const da = {
  // Navigation
  'nav.today': 'I dag',
  'nav.board': 'Tavle',
  'nav.table': 'Tabel',
  'nav.timeline': 'Tidslinje',
  'nav.backlog': 'Backlog & Sprints',
  'nav.mywork': 'Min arbejdsliste',
  'nav.team': 'Team & kapacitet',
  'nav.dashboard': 'Dashboard',
  'nav.activity': 'Aktivitet',
  'nav.import': 'Import & skabeloner',
  'nav.integrations': 'Integrationer',
  'nav.outlook': 'Outlook & Microsoft 365',
  // App-shell
  'shell.search': 'Søg …',
  'shell.newTask': 'Ny opgave',
  'shell.footer':
    'Data gemmes lokalt i browseren. Windows-notifikationer, Teams og eksport styres fra Integrationer-fanen.',
  'shell.workspace': 'Workspace',
  'shell.projects': 'Projekter',
  'shell.allProjects': 'Alle projekter',
  'shell.dark': 'Skift til mørkt tema',
  'shell.light': 'Skift til lyst tema',
  'shell.newProject': 'Nyt projekt',
  'shell.projectName': 'Projektnavn …',
  // Kommandopalette
  'palette.placeholder': 'Søg efter opgaver, eller opret en ny …',
  'palette.createTask': 'Opret opgave',
  'palette.in': 'i',
  'palette.goto': 'Gå til',
  'palette.actions': 'Handlinger',
  'palette.navigation': 'Navigation',
  'palette.tasks': 'Opgaver',
  'palette.theme': 'Skift tema',
  'palette.reset': 'Nulstil demo-data',
  'palette.resetHint': 'gendanner eksempeldata',
  'palette.language': 'Skift sprog DA/EN',
  'palette.noResults': 'Ingen resultater for',
  // Notifikationscenter
  'notify.title': 'Notifikationer',
  'notify.markAll': 'Markér alle læst',
  'notify.empty': 'Ingen notifikationer endnu',
  // Fælles
  'common.notAssigned': 'Ikke tildelt',
};

export type DictKey = keyof typeof da;

const en: Record<DictKey, string> = {
  'nav.today': 'Today',
  'nav.board': 'Board',
  'nav.table': 'Table',
  'nav.timeline': 'Timeline',
  'nav.backlog': 'Backlog & Sprints',
  'nav.mywork': 'My work',
  'nav.team': 'Team & capacity',
  'nav.dashboard': 'Dashboard',
  'nav.activity': 'Activity',
  'nav.import': 'Import & templates',
  'nav.integrations': 'Integrations',
  'nav.outlook': 'Outlook & Microsoft 365',
  'shell.search': 'Search …',
  'shell.newTask': 'New task',
  'shell.footer':
    'Data is stored locally in your browser. Windows notifications, Teams and export are managed from the Integrations tab.',
  'shell.workspace': 'Workspace',
  'shell.projects': 'Projects',
  'shell.allProjects': 'All projects',
  'shell.dark': 'Switch to dark theme',
  'shell.light': 'Switch to light theme',
  'shell.newProject': 'New project',
  'shell.projectName': 'Project name …',
  'palette.placeholder': 'Search for tasks, or create a new one …',
  'palette.createTask': 'Create task',
  'palette.in': 'in',
  'palette.goto': 'Go to',
  'palette.actions': 'Actions',
  'palette.navigation': 'Navigation',
  'palette.tasks': 'Tasks',
  'palette.theme': 'Toggle theme',
  'palette.reset': 'Reset demo data',
  'palette.resetHint': 'restores sample data',
  'palette.language': 'Switch language DA/EN',
  'palette.noResults': 'No results for',
  'notify.title': 'Notifications',
  'notify.markAll': 'Mark all as read',
  'notify.empty': 'No notifications yet',
  'common.notAssigned': 'Not assigned',
};

const dict: Record<Lang, Record<string, string>> = { da, en };

interface I18nState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
}

export const useI18n = create<I18nState>()(
  persist(
    (set, get) => ({
      lang: 'da',
      setLang: (lang) => set({ lang }),
      toggleLang: () => set({ lang: get().lang === 'da' ? 'en' : 'da' }),
    }),
    { name: 'orbit-lang' },
  ),
);

/** Bruges i komponenter, så de re-render'er når sproget skifter. */
export function useLang(): Lang {
  return useI18n((s) => s.lang);
}

/**
 * Slår op i ordbogen for det aktive sprog.
 * Læser getState() og abonnerer IKKE — brug useLang() i komponenter,
 * så de re-render'er ved sprogændring (t() kalder derefter det nye sprog).
 */
export function t(key: string): string {
  const lang = useI18n.getState().lang;
  return dict[lang][key] ?? dict.da[key] ?? key;
}

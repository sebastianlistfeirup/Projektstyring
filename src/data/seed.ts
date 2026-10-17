import type { ActivityEntry, Label, Priority, Project, Sprint, Subtask, Task, TaskStatus, User } from '../lib/types';

export const seedUsers: User[] = [
  { id: 'u-me', name: 'Freja Lindberg', initials: 'FL', color: 'indigo', role: 'Projektleder', email: 'freja@nordlys.dk', capacity: 6 },
  { id: 'u-oscar', name: 'Oscar Nielsen', initials: 'ON', color: 'sky', role: 'Udvikler', email: 'oscar@nordlys.dk', capacity: 12 },
  { id: 'u-sofie', name: 'Sofie Holm', initials: 'SH', color: 'rose', role: 'Designer', email: 'sofie@nordlys.dk', capacity: 10 },
  { id: 'u-emil', name: 'Emil Christiansen', initials: 'EC', color: 'emerald', role: 'Udvikler', email: 'emil@nordlys.dk', capacity: 12 },
  { id: 'u-clara', name: 'Clara Møller', initials: 'CM', color: 'amber', role: 'QA', email: 'clara@nordlys.dk', capacity: 8 },
  { id: 'u-noah', name: 'Noah Sørensen', initials: 'NS', color: 'violet', role: 'Produktchef', email: 'noah@nordlys.dk', capacity: 4 },
];

export const seedLabels: Label[] = [
  { id: 'l-design', name: 'Design', color: 'pink' },
  { id: 'l-dev', name: 'Udvikling', color: 'indigo' },
  { id: 'l-marketing', name: 'Markedsføring', color: 'emerald' },
  { id: 'l-research', name: 'Research', color: 'cyan' },
  { id: 'l-bug', name: 'Fejl', color: 'red' },
  { id: 'l-docs', name: 'Dokumentation', color: 'slate' },
];

export const seedProjects: Project[] = [
  { id: 'p-app', name: 'App 2.0', key: 'APP', color: 'violet', description: 'Ny mobilapp med offline-first, betaling og moderniseret backend.' },
  { id: 'p-hjb', name: 'Hjemmeside & Brand', key: 'HJB', color: 'sky', description: 'Ny visuel identitet og hjemmeside med fokus på SEO og konvertering.' },
  { id: 'p-iit', name: 'Intern IT-omlægning', key: 'IIT', color: 'amber', description: 'Samling af it-drift: Microsoft 365-oprydning, sikkerhed og enheder.' },
  { id: 'p-game', name: 'Dragenatten (spil)', key: 'SPIL', color: 'pink', description: 'Nordisk mørk fantasy-spil: udforsk, saml sjæle og opdræt din drage.' },
];

export const seedSprints: Sprint[] = [
  { id: 's-app-14', projectId: 'p-app', name: 'Sprint 14', goal: 'Fundament: design, login og onboarding på plads.', status: 'completed', startDate: '2026-09-21', endDate: '2026-10-04' },
  { id: 's-app-15', projectId: 'p-app', name: 'Sprint 15', goal: 'Kernefunktioner: offline, betaling og ydelse.', status: 'active', startDate: '2026-10-05', endDate: '2026-10-18' },
  { id: 's-app-16', projectId: 'p-app', name: 'Sprint 16', goal: 'Polering, tilgængelighed og beta-lancering.', status: 'planned', startDate: '2026-10-19', endDate: '2026-11-01' },
  { id: 's-hjb-1', projectId: 'p-hjb', name: 'Fase 1 – Identitet', goal: 'Visuel identitet og SoMe-kit klar.', status: 'completed', startDate: '2026-09-14', endDate: '2026-09-27' },
  { id: 's-hjb-2', projectId: 'p-hjb', name: 'Fase 2 – Hjemmeside', goal: 'Ny hjemmesidebygning og indhold.', status: 'active', startDate: '2026-09-28', endDate: '2026-10-11' },
  { id: 's-hjb-3', projectId: 'p-hjb', name: 'Fase 3 – Lancering', goal: 'Lancering, presse og kampagner.', status: 'planned', startDate: '2026-10-12', endDate: '2026-10-25' },
  { id: 's-iit-1', projectId: 'p-iit', name: 'Roadmap Q4 – del 1', goal: 'Inventar, MFA og backup på plads.', status: 'active', startDate: '2026-09-29', endDate: '2026-10-26' },
  { id: 's-iit-2', projectId: 'p-iit', name: 'Roadmap Q4 – del 2', goal: 'Enheder, Intune og mødesystem.', status: 'planned', startDate: '2026-10-27', endDate: '2026-11-23' },
];

let orderCounter = 0;
interface TaskSeed {
  id: string; number: number; projectId: string; sprintId?: string | null;
  title: string; status: TaskStatus; priority?: Priority;
  assigneeId?: string | null; reporterId?: string; labelIds?: string[];
  description?: string; startDate?: string | null; dueDate?: string | null;
  estimate?: number | null; createdAt?: string;
  subtasks?: Subtask[]; comments?: { id: string; authorId: string; text: string; createdAt: string }[];
}

function mk(seed: TaskSeed): Task {
  const created = seed.createdAt ?? '2026-10-01T09:00:00.000Z';
  return {
    id: seed.id,
    number: seed.number,
    projectId: seed.projectId,
    sprintId: seed.sprintId ?? null,
    title: seed.title,
    description: seed.description ?? '',
    status: seed.status,
    priority: seed.priority ?? 'medium',
    assigneeId: seed.assigneeId ?? null,
    reporterId: seed.reporterId ?? 'u-me',
    labelIds: seed.labelIds ?? [],
    createdAt: created,
    updatedAt: created,
    startDate: seed.startDate ?? null,
    dueDate: seed.dueDate ?? null,
    estimate: seed.estimate ?? null,
    subtasks: seed.subtasks ?? [],
    comments: seed.comments ?? [],
    order: orderCounter++,
  };
}

export const seedTasks: Task[] = [
  // ---------- APP (App 2.0) ----------
  mk({ id: 't-app-1', number: 1, projectId: 'p-app', sprintId: 's-app-14', title: 'Designsystem: komponentbibliotek til app 2.0', status: 'done', priority: 'high', assigneeId: 'u-sofie', reporterId: 'u-noah', labelIds: ['l-design'], description: 'Opbyg et samlet komponentbibliotek (knapper, formularer, kort) i Figma og kode, så design og udvikling taler sammen.', startDate: '2026-09-21', dueDate: '2026-09-30', estimate: 8, createdAt: '2026-09-21T08:30:00.000Z', subtasks: [ { id: 'st-1', title: 'Farver og typografi fastlægges', done: true }, { id: 'st-2', title: 'Kernemodeller bygges i Figma', done: true }, { id: 'st-3', title: 'Kodekomponenter publiceres', done: true } ], comments: [ { id: 'c-1', authorId: 'u-sofie', text: 'Biblioteket er publiceret og klar til brug i Sprint 15.', createdAt: '2026-10-02T14:10:00.000Z' } ] }),
  mk({ id: 't-app-2', number: 2, projectId: 'p-app', sprintId: 's-app-14', title: 'Onboarding-flow: 3-trins introduktion', status: 'done', priority: 'medium', assigneeId: 'u-oscar', labelIds: ['l-dev'], description: 'Nye brugere skal gennem 3 enkle trin: profil, interesser og notifikationer.', startDate: '2026-09-23', dueDate: '2026-10-02', estimate: 5 }),
  mk({ id: 't-app-3', number: 3, projectId: 'p-app', sprintId: 's-app-14', title: 'Login med MitID og 2FA', status: 'done', priority: 'urgent', assigneeId: 'u-emil', labelIds: ['l-dev'], description: 'Sikker login med MitID og engangskoder. Krav fra samarbejdspartner.', startDate: '2026-09-22', dueDate: '2026-10-03', estimate: 8 }),
  mk({ id: 't-app-4', number: 4, projectId: 'p-app', sprintId: 's-app-15', title: 'Offline-tilstand: sync-kø og konflikthåndtering', status: 'inprogress', priority: 'high', assigneeId: 'u-oscar', labelIds: ['l-dev'], description: 'Appen skal virke uden netværk. Ændringer lægges i kø og synkroniseres, når forbindelsen vender tilbage.', startDate: '2026-10-06', dueDate: '2026-10-16', estimate: 13, subtasks: [ { id: 'st-4', title: 'Lokal lagring (SQLite)', done: true }, { id: 'st-5', title: 'Sync-kø implementeres', done: true }, { id: 'st-6', title: 'Konfliktopløsning ved sammenfletning', done: false } ], comments: [ { id: 'c-2', authorId: 'u-oscar', text: 'Sync-køen kører stabilt i test. Arbejder på konfliktopløsningen resten af ugen.', createdAt: '2026-10-09T11:42:00.000Z' } ] }),
  mk({ id: 't-app-5', number: 5, projectId: 'p-app', sprintId: 's-app-15', title: 'Push-notifikationer (iOS/Android)', status: 'todo', priority: 'medium', assigneeId: 'u-emil', labelIds: ['l-dev'], estimate: 5 }),
  mk({ id: 't-app-6', number: 6, projectId: 'p-app', sprintId: 's-app-15', title: 'Ydelsestest: opstart under 2 sekunder', status: 'inreview', priority: 'high', assigneeId: 'u-clara', labelIds: ['l-bug'], description: 'Mål opstartstid på lav-end Android. Dokumentér før/efter.', startDate: '2026-10-08', dueDate: '2026-10-15', estimate: 3 }),
  mk({ id: 't-app-7', number: 7, projectId: 'p-app', sprintId: 's-app-15', title: 'Betaling: MobilePay-integration', status: 'inprogress', priority: 'urgent', assigneeId: 'u-emil', labelIds: ['l-dev'], description: 'Integrér MobilePay til abonnementer og engangskøb. Afventer godkendelse af merchant-konto.', startDate: '2026-10-07', dueDate: '2026-10-17', estimate: 13 }),
  mk({ id: 't-app-8', number: 8, projectId: 'p-app', sprintId: 's-app-15', title: 'Tilgængelighed (WCAG 2.2 AA)', status: 'todo', priority: 'medium', assigneeId: 'u-sofie', labelIds: ['l-design'], estimate: 8 }),
  mk({ id: 't-app-9', number: 9, projectId: 'p-app', sprintId: 's-app-15', title: 'Crash-rapportering med symboliserede stacks', status: 'inreview', priority: 'medium', assigneeId: 'u-clara', labelIds: ['l-dev'], estimate: 3 }),
  mk({ id: 't-app-10', number: 10, projectId: 'p-app', title: 'Søgning: fuldtekst og filtre', status: 'backlog', priority: 'low', assigneeId: 'u-oscar', labelIds: ['l-research'], description: 'Undersøg FTS5 vs. server-side søgning. Afventer prioritering.' }),
  mk({ id: 't-app-11', number: 11, projectId: 'p-app', title: 'Mørkt tema i app\'en', status: 'backlog', priority: 'low', assigneeId: 'u-sofie', labelIds: ['l-design'] }),
  mk({ id: 't-app-12', number: 12, projectId: 'p-app', title: 'Versionering af API-kontrakter', status: 'backlog', priority: 'medium', assigneeId: 'u-oscar', labelIds: ['l-docs'] }),
  mk({ id: 't-app-13', number: 13, projectId: 'p-app', sprintId: 's-app-16', title: 'Beta-program via TestFlight og Play Console', status: 'todo', priority: 'high', reporterId: 'u-noah', labelIds: ['l-marketing'], description: 'Rekruttér 50 beta-brugere og opsamling af feedback.', dueDate: '2026-10-30', estimate: 5 }),
  mk({ id: 't-app-14', number: 14, projectId: 'p-app', title: 'Overgang til ny backend-gateway', status: 'backlog', priority: 'high', assigneeId: 'u-emil', labelIds: ['l-dev'], description: 'Udskift legacy-gateway; kræver koordinering med driftleverandøren.' }),

  // ---------- HJB (Hjemmeside & Brand) ----------
  mk({ id: 't-hjb-1', number: 1, projectId: 'p-hjb', sprintId: 's-hjb-1', title: 'Ny visuel identitet: logo og farver', status: 'done', priority: 'high', assigneeId: 'u-sofie', reporterId: 'u-noah', labelIds: ['l-design'], description: 'Nyt logo, farvepalette og typografi. Godkendt af ledelsen 24/9.', startDate: '2026-09-14', dueDate: '2026-09-24', estimate: 8 }),
  mk({ id: 't-hjb-2', number: 2, projectId: 'p-hjb', sprintId: 's-hjb-1', title: 'SoMe-kit til lancering', status: 'done', priority: 'medium', assigneeId: 'u-sofie', labelIds: ['l-marketing'], estimate: 3 }),
  mk({ id: 't-hjb-3', number: 3, projectId: 'p-hjb', sprintId: 's-hjb-2', title: 'Hjemmeside: ny forsidesektion', status: 'inprogress', priority: 'high', assigneeId: 'u-sofie', labelIds: ['l-design'], startDate: '2026-09-30', dueDate: '2026-10-12', estimate: 5, subtasks: [ { id: 'st-7', title: 'Wireframe godkendt', done: true }, { id: 'st-8', title: 'Responsivt layout bygges', done: false } ] }),
  mk({ id: 't-hjb-4', number: 4, projectId: 'p-hjb', sprintId: 's-hjb-2', title: 'CMS-opsætning (headless)', status: 'inprogress', priority: 'high', assigneeId: 'u-oscar', labelIds: ['l-dev'], description: 'Vælg og sæt headless CMS op; migrér eksisterende indhold.', startDate: '2026-10-01', dueDate: '2026-10-14', estimate: 8 }),
  mk({ id: 't-hjb-5', number: 5, projectId: 'p-hjb', sprintId: 's-hjb-2', title: 'Tekster til produktsider', status: 'inreview', priority: 'medium', assigneeId: 'u-me', labelIds: ['l-marketing'], dueDate: '2026-10-10', comments: [ { id: 'c-3', authorId: 'u-noah', text: 'Rigtig fin vinkel — jeg har lavet tre mindre sproglige rettelser.', createdAt: '2026-10-09T15:20:00.000Z' } ] }),
  mk({ id: 't-hjb-6', number: 6, projectId: 'p-hjb', sprintId: 's-hjb-2', title: 'SEO-gennemgang og metadata', status: 'todo', priority: 'medium', assigneeId: 'u-clara', labelIds: ['l-marketing'], dueDate: '2026-10-16', estimate: 3 }),
  mk({ id: 't-hjb-7', number: 7, projectId: 'p-hjb', sprintId: 's-hjb-2', title: 'Cookie-samtykke og GDPR-flow', status: 'todo', priority: 'urgent', assigneeId: 'u-emil', labelIds: ['l-dev'], description: 'Skal være på plads inden lancering. Jura har godkendt leverandørlisten.', dueDate: '2026-10-15', estimate: 2 }),
  mk({ id: 't-hjb-8', number: 8, projectId: 'p-hjb', title: 'Case-side med kundeudtalelser', status: 'backlog', priority: 'low', labelIds: ['l-marketing'] }),
  mk({ id: 't-hjb-9', number: 9, projectId: 'p-hjb', title: 'Lanceringsplan og pressemeddelelse', status: 'backlog', priority: 'high', assigneeId: 'u-me', labelIds: ['l-marketing'] }),
  mk({ id: 't-hjb-10', number: 10, projectId: 'p-hjb', sprintId: 's-hjb-3', title: 'Blog: tre artikler klar til lancering', status: 'todo', priority: 'low', assigneeId: 'u-me', labelIds: ['l-docs'], dueDate: '2026-10-24', estimate: 3 }),

  // ---------- IIT (Intern IT-omlægning) ----------
  mk({ id: 't-iit-1', number: 1, projectId: 'p-iit', sprintId: 's-iit-1', title: 'Inventar: hardware- og licensliste', status: 'done', priority: 'high', assigneeId: 'u-clara', labelIds: ['l-docs'], description: 'Fuld oversigt over udstyr og licenser i hele organisationen.', startDate: '2026-09-29', dueDate: '2026-10-06', estimate: 5 }),
  mk({ id: 't-iit-2', number: 2, projectId: 'p-iit', sprintId: 's-iit-1', title: 'Microsoft 365-rydning: grupper og Teams', status: 'inprogress', priority: 'medium', assigneeId: 'u-me', labelIds: ['l-docs'], description: 'Nedlæg uanvendte grupper, arkivér kanaler og strammes ejerskaber op.', startDate: '2026-10-05', dueDate: '2026-10-20', estimate: 5 }),
  mk({ id: 't-iit-3', number: 3, projectId: 'p-iit', sprintId: 's-iit-1', title: 'Onboarding-checkliste til nye medarbejdere', status: 'done', priority: 'medium', assigneeId: 'u-me', labelIds: ['l-docs'], estimate: 2 }),
  mk({ id: 't-iit-4', number: 4, projectId: 'p-iit', sprintId: 's-iit-1', title: 'MFA-udrulning til alle brugere', status: 'inreview', priority: 'urgent', assigneeId: 'u-emil', labelIds: ['l-dev'], description: '96 % er omlagt. Resten er fabriksbrugere uden telefon — aftalt løsning med drift.', startDate: '2026-10-02', dueDate: '2026-10-13', estimate: 5 }),
  mk({ id: 't-iit-5', number: 5, projectId: 'p-iit', sprintId: 's-iit-1', title: 'Backup-strategi og restore-test', status: 'inprogress', priority: 'high', assigneeId: 'u-oscar', labelIds: ['l-dev'], description: 'Kvartalsvis restore-test skal dokumenteres og godkendes.', startDate: '2026-10-08', dueDate: '2026-10-22', estimate: 5 }),
  mk({ id: 't-iit-6', number: 6, projectId: 'p-iit', sprintId: 's-iit-1', title: 'Enhedshåndtering med Intune', status: 'todo', priority: 'medium', assigneeId: 'u-emil', labelIds: ['l-dev'], estimate: 8 }),
  mk({ id: 't-iit-7', number: 7, projectId: 'p-iit', title: 'Udskiftning af mødebookingsystem', status: 'backlog', priority: 'low', labelIds: ['l-research'], description: 'Indhent tilbud fra tre leverandører. Beslutning i november.' }),
  mk({ id: 't-iit-8', number: 8, projectId: 'p-iit', title: 'It-sikkerhedspolitik: opdatering og underskrift', status: 'backlog', priority: 'medium', assigneeId: 'u-clara', labelIds: ['l-docs'] }),
];

export const seedActivity: ActivityEntry[] = [
  { id: 'a-1', timestamp: '2026-10-09T15:20:00.000Z', userId: 'u-noah', taskId: 't-hjb-5', projectId: 'p-hjb', action: 'kommenterede på', detail: 'Tekster til produktsider' },
  { id: 'a-2', timestamp: '2026-10-09T11:42:00.000Z', userId: 'u-oscar', taskId: 't-app-4', projectId: 'p-app', action: 'kommenterede på', detail: 'Offline-tilstand: sync-kø og konflikthåndtering' },
  { id: 'a-3', timestamp: '2026-10-09T09:15:00.000Z', userId: 'u-clara', taskId: 't-app-6', projectId: 'p-app', action: 'flyttede til Gennemgang', detail: 'Ydelsestest: opstart under 2 sekunder' },
  { id: 'a-4', timestamp: '2026-10-08T14:05:00.000Z', userId: 'u-emil', taskId: 't-app-7', projectId: 'p-app', action: 'påbegyndte', detail: 'Betaling: MobilePay-integration' },
  { id: 'a-5', timestamp: '2026-10-08T10:30:00.000Z', userId: 'u-me', taskId: 't-iit-2', projectId: 'p-iit', action: 'påbegyndte', detail: 'Microsoft 365-rydning: grupper og Teams' },
  { id: 'a-6', timestamp: '2026-10-07T16:45:00.000Z', userId: 'u-sofie', taskId: 't-hjb-3', projectId: 'p-hjb', action: 'opdaterede', detail: 'Hjemmeside: ny forsidesektion' },
  { id: 'a-7', timestamp: '2026-10-07T08:20:00.000Z', userId: 'u-me', taskId: 't-hjb-10', projectId: 'p-hjb', action: 'oprettede', detail: 'Blog: tre artikler klar til lancering' },
  { id: 'a-8', timestamp: '2026-10-06T13:10:00.000Z', userId: 'u-noah', taskId: null, projectId: 'p-app', action: 'startede sprinten', detail: 'Sprint 15' },
  { id: 'a-9', timestamp: '2026-10-05T09:00:00.000Z', userId: 'u-me', taskId: 't-iit-4', projectId: 'p-iit', action: 'tildelte opgaven til Emil Christiansen', detail: 'MFA-udrulning til alle brugere' },
  { id: 'a-10', timestamp: '2026-10-02T14:10:00.000Z', userId: 'u-sofie', taskId: 't-app-1', projectId: 'p-app', action: 'afsluttede', detail: 'Designsystem: komponentbibliotek til app 2.0' },
  { id: 'a-11', timestamp: '2026-10-01T11:00:00.000Z', userId: 'u-me', taskId: 't-app-13', projectId: 'p-app', action: 'planlagde i', detail: 'Sprint 16' },
  { id: 'a-12', timestamp: '2026-09-30T10:15:00.000Z', userId: 'u-oscar', taskId: 't-hjb-4', projectId: 'p-hjb', action: 'påbegyndte', detail: 'CMS-opsætning (headless)' },
];

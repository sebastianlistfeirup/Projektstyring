export type TaskStatus = 'backlog' | 'todo' | 'inprogress' | 'inreview' | 'done' | 'canceled';
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type SprintStatus = 'planned' | 'active' | 'completed';
export type Theme = 'dark' | 'light' | 'system';

export interface User {
  id: string;
  name: string;
  initials: string;
  color: string; // tailwind color base, fx "indigo", "amber"
  role: string;
  email: string;
  capacity?: number; // estimeret points pr. uge
  vacationUntil?: string | null; // ISO-dato, fravær til og med
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Comment {
  id: string;
  authorId: string;
  text: string;
  createdAt: string; // ISO
  replyToId?: string | null; // svar på anden kommentar
  reactions?: Record<string, string[]>; // emoji -> userIds
  editedAt?: string;
}

export interface Task {
  id: string;
  number: number; // løbenummer pr. projekt, fx 42 -> "APP-42"
  projectId: string;
  sprintId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assigneeId: string | null;
  reporterId: string;
  labelIds: string[];
  createdAt: string;
  updatedAt: string;
  startDate: string | null; // ISO
  dueDate: string | null; // ISO
  estimate: number | null; // story points
  subtasks: Subtask[];
  comments: Comment[];
  order: number; // rækkefølge i kolonne/liste
  recurrence?: 'daily' | 'weekly' | 'monthly' | null; // opret næste instans når opgaven afsluttes
  blockedBy?: string[]; // id'er på opgaver der blokerer denne
  customFields?: Record<string, string | number>; // fieldDefId -> værdi
  extIds?: {
    todoListId?: string;
    todoTaskId?: string;
    adopsId?: number;
    gitProvider?: 'github' | 'gitlab';
    gitIssue?: number;
    gitOwner?: string;
    gitRepo?: string;
    gitUrl?: string;
    jiraKey?: string;
    trelloId?: string;
    plannerId?: string;
    plannerEtag?: string;
  }; // eksterne systemer
  aiDelivery?: { runId: string; status: string; verification: string; commit?: string; updatedAt: string };
  aiProposal?: { runId: string; itemId: string; scope: 'version1' | 'later' };
  approval?: Approval | null; // kundegodkendelse via offentligt link
  emoji?: string; // lille visuel markør på kortet
  pinnedDay?: string | null; // fastgjort til "Min dag" (ISO-dato, ryddes automatisk)
  reminderAt?: string | null; // påmindelse på klokkeslæt (ISO)
  isMilestone?: boolean; // vises som diamant på tidslinjen
  kudos?: Kudo[]; // high-fives på afsluttede opgaver
  history?: HistoryEntry[]; // versionshistorik (max 30)
}

export type NoteKind = 'note' | 'meeting' | 'decision';

export interface NoteEntry {
  id: string;
  projectId: string;
  kind: NoteKind;
  title: string;
  body: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Risk {
  id: string;
  projectId: string;
  title: string;
  probability: number; // 1-5
  impact: number; // 1-5
  mitigation: string;
  status: 'open' | 'mitigated' | 'closed';
}

export interface IssueEntry {
  id: string;
  projectId: string;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'inprogress' | 'resolved';
  taskId?: string | null;
  createdAt: string;
}

export interface RulesSettings {
  wip: { todo: number | null; inprogress: number | null; inreview: number | null };
  agingDays: number; // eskalér opgaver uden aktivitet efter N dage
  escalate: boolean;
}

export interface AgentsSettings {
  triage: boolean; // foreslå ansvarlig/prioritet på nye opgaver
  stale: boolean; // advar om stillestående opgaver
  staleDays: number;
}

export interface Approval {
  token: string;
  status: 'pending' | 'approved' | 'changes';
  by?: string;
  at?: string;
  comment?: string;
}

export type Accent = 'indigo' | 'violet' | 'emerald' | 'sunset' | 'graphite' | 'ocean';
export type Density = 'comfortable' | 'compact';

export interface Kudo {
  userId: string;
  emoji: string;
  at: string;
}

export interface KeyResult {
  id: string;
  title: string;
  taskIds: string[];
}

export interface Goal {
  id: string;
  title: string;
  note: string;
  keyResults: KeyResult[];
}

export interface BaselineEntry {
  taskId: string;
  startDate: string | null;
  dueDate: string | null;
}

export interface Baseline {
  projectId: string;
  savedAt: string;
  items: BaselineEntry[];
}

export interface HistoryEntry {
  at: string; // ISO
  userId: string;
  field: string; // fx 'status', 'prioritet', 'frist'
  from: string;
  to: string;
}

export interface NovaEntry {
  date: string; // yyyy-mm-dd
  question: string;
  answer: string;
}

export interface StandupEntry {
  id: string;
  userId: string;
  text: string;
  createdAt: string; // ISO
}

export interface TimeEntry {
  id: string;
  taskId: string;
  userId: string;
  startedAt: string; // ISO
  endedAt: string | null; // ISO, null = timer kører
}

export interface AppNotification {
  id: string;
  userId: string; // modtager
  text: string;
  taskId: string | null;
  read: boolean;
  createdAt: string; // ISO
}

export interface TrashItem {
  task: Task;
  deletedAt: string; // ISO
}

export interface CustomFieldDef {
  id: string;
  projectId: string;
  name: string;
  type: 'text' | 'number' | 'select';
  options?: string[]; // kun ved select
}

export interface SavedView {
  id: string;
  name: string;
  filters: {
    query: string;
    status: string; // 'all' eller TaskStatus
    priority: string; // 'all' eller Priority
    groupBy: string; // 'none' | 'status' | 'project' | 'assignee'
  };
  createdAt: string;
}

export interface AutomationSettings {
  doneTeams: boolean; // besked til Teams når opgave afsluttes
  doneNotifyAssignee: boolean; // notifikation til ansvarlig ved afslutning
  urgentAssigneeId: string | null; // tildel denne person når prioritet bliver kritisk
}

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  status: SprintStatus;
  startDate: string;
  endDate: string;
}

export interface Project {
  releaseGoal?: string;
  scopeTaskIds?: string[];
  scopeCapturedAt?: string;
  repositoryPath?: string;
  verificationChecks?: { name: string; command: string; args: string[] }[];
  id: string;
  name: string;
  key: string; // fx "APP"
  color: string;
  description: string;
  publicToken?: string | null; // kunde-statusside ( companion /public/status/<token> )
  archived?: boolean; // arkiverede projekter gemmes væk, men kan gendannes
  budget?: number | null; // budget i DKK (økonomi-modul)
  privateZone?: boolean; // tilhører "Privat"-zonen (personlige projekter)
  intakeToken?: string | null; // offentlig indsendelsesformular
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  userId: string;
  taskId: string | null;
  projectId: string | null;
  action: string; // fx "oprettede opgaven", "flyttede til I gang"
  detail?: string;
}

export interface ImportItem {
  title: string;
  dueDate?: string | null;
  priority?: Priority;
  status?: TaskStatus;
  description?: string;
}

export interface SyncSnapshot {
  tasks: Task[];
  projects: Project[];
  sprints: Sprint[];
  users: User[];
  labels: Label[];
  activity: ActivityEntry[];
  updatedAt: string;
}

/* ---------- AI-værksted ---------- */

export type AiAgentKind = 'subscription' | 'api' | 'local';

export type AiPhase = 'concept' | 'design' | 'prototype' | 'production' | 'testing' | 'polish' | 'release';

export type AiJobStatus = 'queued' | 'inprogress' | 'review' | 'blocked' | 'done';

export interface AiAgent {
  id: string;
  name: string;
  provider: string;
  kind: AiAgentKind;
  color: string; // tailwind-farve, fx "indigo", "emerald"
  strengths: string[];
  canOrchestrate: boolean;
  active: boolean;
}

export interface AiJob {
  id: string;
  projectId: string;
  title: string;
  description: string;
  agentId: string | null; // hvilken AI der udfører
  phase: AiPhase;
  status: AiJobStatus;
  dependsOn: string[]; // id'er på jobs der skal være færdige først
  question: string; // åbent spørgsmål der skal afklares
  answer: string;
  result: string; // output / link / noter fra AI'en
  createdAt: string;
  updatedAt: string;
}

/* ---------- AI-chat (ChatGPT-lignende, drevet af companion) ---------- */

export interface AiAttachment {
  id?: string;
  extractedText?: string | null;
  extractionError?: string | null;
  kind: 'image' | 'file';
  name: string;
  mime: string;
  size?: number;
  url?: string;     // orbit-fil (server)
  path?: string;    // disksti på serveren (CLI'er kan læse den)
  dataUrl?: string; // til inline visning / provider-inline
}

export type AiMessageStatus = 'streaming' | 'done' | 'error';

export interface AiMessage {
  runId?: string;
  runFinishedAt?: number;
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  serviceId?: string; // hvilken tjeneste der svarede
  attachments?: AiAttachment[];
  artifacts?: AiAttachment[]; // producerede resultater (billede/lyd/3D/fil)
  status: AiMessageStatus;
  createdAt: string;
}

export interface AiChat {
  id: string;
  projectId: string | null;
  title: string;
  messages: AiMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPlan {
  version: 1;
  releaseGoal: string;
  summary: string;
  firstMilestone: string;
  unknowns: string[];
  tasks: { id: string; title: string; description: string; priority: string; scope: 'version1' | 'later'; acceptanceCriteria: string[]; verification: string[]; evidence: string[]; dependsOn: string[] }[];
}

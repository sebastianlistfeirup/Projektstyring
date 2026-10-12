import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileUp,
  Globe,
  Info,
  LayoutTemplate,
  UserPlus,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { format, isValid, parseISO } from 'date-fns';
import { useStore } from '../store/useStore';
import { PROJECT_TEMPLATES, type ProjectTemplate } from '../data/templates';
import type { ImportItem, Priority } from '../lib/types';
import { cn, formatDate } from '../lib/utils';
import { StatusBadge } from '../components/common';

const UNKNOWN_FILE = 'Kunne ikke genkende filen – understøtter Trello JSON, Monday CSV og Jira CSV.';

// ---------- Fil-parsere ----------

interface ParsedImport {
  items: ImportItem[];
  source: 'Trello' | 'Monday' | 'Jira';
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, may: 5, jun: 6, jul: 7,
  aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12,
};

function normalizeDate(raw?: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Jira: dd/MMM/yy fx "11/Oct/26"
  const jira = /^(\d{1,2})[/-]([A-Za-z]{3,})[/-](\d{2,4})$/.exec(v);
  if (jira) {
    const day = Number(jira[1]);
    const month = MONTHS[jira[2].toLowerCase()];
    const yearRaw = Number(jira[3]);
    if (!month || day < 1 || day > 31) return null;
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  // dd/mm/yyyy (dansk)
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const yearRaw = Number(dmy[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const parsed = parseISO(v);
  return isValid(parsed) ? format(parsed, 'yyyy-MM-dd') : null;
}

function mapStatus(raw: string | undefined, workingLabels: string[]): 'todo' | 'inprogress' | 'done' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'done' || v === 'completed' || v === 'complete' || v === 'færdig') return 'done';
  if (workingLabels.includes(v)) return 'inprogress';
  return 'todo';
}

function mapPriority(raw: string | undefined): Priority | undefined {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'critical' || v === 'highest' || v === 'urgent') return 'urgent';
  if (v === 'high') return 'high';
  if (v === 'medium') return 'medium';
  if (v === 'low' || v === 'lowest') return 'low';
  return undefined;
}

function parseCSV(text: string): string[][] {
  const cleaned = text.replace(/^\uFEFF/, '');
  const firstLine = cleaned.slice(0, cleaned.indexOf('\n') === -1 ? undefined : cleaned.indexOf('\n'));
  const delimiter = (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inQuotes) {
      if (c === '"') {
        if (cleaned[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && cleaned[i + 1] === '\n') i++;
      row.push(field.replace(/\r$/, ''));
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function colIndex(headers: string[], ...names: string[]): number {
  const norm = headers.map((h) => h.trim().toLowerCase());
  for (const name of names) {
    const i = norm.indexOf(name.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function parseTrello(json: unknown): ImportItem[] | null {
  if (typeof json !== 'object' || json === null) return null;
  const root = json as Record<string, unknown>;
  const collected: Record<string, unknown>[] = [];
  const collect = (cards: unknown) => {
    if (!Array.isArray(cards)) return;
    for (const c of cards) {
      if (typeof c === 'object' && c !== null && 'name' in c) collected.push(c as Record<string, unknown>);
    }
  };
  const collectFromLists = (lists: unknown) => {
    if (!Array.isArray(lists)) return;
    for (const l of lists) collect((l as Record<string, unknown>).cards);
  };
  if (Array.isArray(root.boards)) {
    for (const b of root.boards) {
      const board = b as Record<string, unknown>;
      collect(board.cards);
      collectFromLists(board.lists);
    }
  }
  collect(root.cards);
  collectFromLists(root.lists);
  if (collected.length === 0) return null;
  const items: ImportItem[] = [];
  for (const card of collected) {
    const title = typeof card.name === 'string' ? card.name.trim() : '';
    if (!title) continue;
    const dueRaw = typeof card.due === 'string' ? card.due.slice(0, 10) : null;
    const done = card.dueComplete === true || card['due complete'] === true;
    items.push({
      title,
      dueDate: dueRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null,
      status: done ? 'done' : 'todo',
      description: typeof card.desc === 'string' ? card.desc : '',
    });
  }
  return items.length > 0 ? items : null;
}

function parseCsvRows(rows: string[][]): ParsedImport | null {
  if (rows.length < 2) return null;
  const headers = rows[0];
  const summaryIdx = colIndex(headers, 'Summary');
  if (summaryIdx >= 0) {
    const statusIdx = colIndex(headers, 'Status');
    const dueIdx = colIndex(headers, 'Due Date');
    const descIdx = colIndex(headers, 'Description');
    const prioIdx = colIndex(headers, 'Priority');
    const items: ImportItem[] = [];
    for (const row of rows.slice(1)) {
      const title = (row[summaryIdx] ?? '').trim();
      if (!title) continue;
      items.push({
        title,
        status: mapStatus(row[statusIdx], ['in progress']),
        dueDate: dueIdx >= 0 ? normalizeDate(row[dueIdx]) : null,
        description: descIdx >= 0 ? (row[descIdx] ?? '').trim() : undefined,
        priority: prioIdx >= 0 ? mapPriority(row[prioIdx]) : undefined,
      });
    }
    return items.length > 0 ? { items, source: 'Jira' } : null;
  }
  const titleIdx = colIndex(headers, 'Item', 'Item Name', 'Name');
  if (titleIdx >= 0) {
    const statusIdx = colIndex(headers, 'Status');
    const dateIdx = colIndex(headers, 'Date', 'Due Date');
    const prioIdx = colIndex(headers, 'Priority');
    const items: ImportItem[] = [];
    for (const row of rows.slice(1)) {
      const title = (row[titleIdx] ?? '').trim();
      if (!title) continue;
      items.push({
        title,
        status: mapStatus(row[statusIdx], ['working on it', 'in progress']),
        dueDate: dateIdx >= 0 ? normalizeDate(row[dateIdx]) : null,
        priority: prioIdx >= 0 ? mapPriority(row[prioIdx]) : undefined,
      });
    }
    return items.length > 0 ? { items, source: 'Monday' } : null;
  }
  return null;
}

function parseImportFile(text: string, fileName: string): ParsedImport | string {
  const trimmed = text.trim();
  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[') || fileName.toLowerCase().endsWith('.json');
  if (looksJson) {
    try {
      const items = parseTrello(JSON.parse(trimmed));
      if (items) return { items, source: 'Trello' };
    } catch {
      // Ikke gyldig JSON – falder igennem til fejlbesked
    }
    return UNKNOWN_FILE;
  }
  const parsed = parseCsvRows(parseCSV(text));
  return parsed ?? UNKNOWN_FILE;
}

// ---------- Sektion A: skabelonkort ----------

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  'tpl-web': Globe,
  'tpl-app': Zap,
  'tpl-onboarding': UserPlus,
};

function TemplateCard({ tpl }: { tpl: ProjectTemplate }) {
  const addProjectFromTemplate = useStore((s) => s.addProjectFromTemplate);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; count: number } | null>(null);

  const Icon = TEMPLATE_ICONS[tpl.id] ?? LayoutTemplate;
  const totalPoints = tpl.tasks.reduce((sum, t) => sum + (t.estimate ?? 0), 0);

  const create = () => {
    const project = addProjectFromTemplate(tpl.id, name);
    if (!project) return;
    setActiveProject(project.id);
    setCreated({ name: project.name, count: tpl.tasks.length });
  };

  return (
    <div className="glass-panel card-hover animate-fade-in flex flex-col rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{tpl.name}</h3>
          <p className="pt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{tpl.description}</p>
        </div>
      </div>

      <p className="pt-3 text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {tpl.tasks.length} opgaver · {totalPoints} points i alt
      </p>
      <ul className="pt-1.5">
        {tpl.tasks.slice(0, 5).map((t) => (
          <li key={t.title} className="flex items-start gap-1.5 py-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-600" />
            <span className="truncate">{t.title}</span>
          </li>
        ))}
        {tpl.tasks.length > 5 && (
          <li className="py-0.5 pl-2.5 text-xs text-zinc-400 dark:text-zinc-500">… og {tpl.tasks.length - 5} flere</li>
        )}
      </ul>

      {created ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <p className="flex items-start gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
            Projektet {created.name} er oprettet med {created.count} opgaver
          </p>
          <button onClick={() => navigate('/tavle')} className="btn-primary self-start py-1 text-xs">
            Gå til tavlen
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder={tpl.name}
            className="input py-1.5 text-sm"
          />
          <button onClick={create} className="btn-primary self-stretch justify-center">
            Opret projekt
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Hovedview ----------

export default function ImportView() {
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const importTasks = useStore((s) => s.importTasks);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState<(ParsedImport & { fileName: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number } | null>(null);

  const targetProjectId = selectedProjectId ?? activeProjectId ?? projects[0]?.id ?? null;

  const handleFile = (file: File) => {
    setError(null);
    setParsed(null);
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const result = parseImportFile(text, file.name);
      if (typeof result === 'string') setError(result);
      else setParsed({ ...result, fileName: file.name });
    };
    reader.onerror = () => setError('Filen kunne ikke læses – prøv igen.');
    reader.readAsText(file);
  };

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const runImport = () => {
    if (!parsed || !targetProjectId) return;
    const created = importTasks(parsed.items, targetProjectId);
    setImportResult({ created, skipped: parsed.items.length - created });
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        {/* Sektion A */}
        <section className="animate-fade-in">
          <div className="flex items-center gap-2 pb-3">
            <LayoutTemplate className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Opret projekt fra skabelon</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {PROJECT_TEMPLATES.map((tpl) => (
              <TemplateCard key={tpl.id} tpl={tpl} />
            ))}
          </div>
        </section>

        {/* Sektion B */}
        <section className="animate-fade-in">
          <div className="flex items-center gap-2 pb-3">
            <FileUp className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Importér opgaver fra andre værktøjer</h2>
          </div>

          <div className="flex flex-col gap-4">
            {/* Upload-zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all duration-150',
                dragging
                  ? 'border-indigo-400 bg-indigo-500/5 dark:border-indigo-400 dark:bg-indigo-400/5'
                  : 'border-zinc-300 hover:border-indigo-400 dark:border-white/10 dark:hover:border-indigo-400/60',
              )}
            >
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500 dark:text-indigo-400">
                <FileUp className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Træk en eksportfil hertil</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Understøtter Trello JSON, Monday CSV og Jira CSV</p>
              <label className="btn-outline mt-1 cursor-pointer">
                Vælg fil
                <input ref={fileInputRef} type="file" accept=".json,.csv" className="hidden" onChange={onInputChange} />
              </label>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs font-medium text-rose-700 animate-fade-in dark:text-rose-300">
                <AlertCircle className="mt-px h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Forhåndsvisning */}
            {parsed && (
              <div className="glass-panel animate-slide-up rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Forhåndsvisning</h3>
                    <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {parsed.fileName} · {parsed.source}-format · {parsed.items.length} opgaver fundet
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={targetProjectId ?? ''}
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                      className="input w-auto py-1.5 text-sm"
                      title="Mål-projekt"
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button onClick={runImport} disabled={!targetProjectId} className="btn-primary">
                      Importér {parsed.items.length} opgaver
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto pt-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        <th className="pb-2 pr-4 font-medium">Titel</th>
                        <th className="pb-2 pr-4 font-medium">Frist</th>
                        <th className="pb-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.items.slice(0, 10).map((item, i) => (
                        <tr key={`${item.title}-${i}`} className="border-t border-zinc-100 dark:border-white/[0.06]">
                          <td className="max-w-0 w-1/2 truncate py-2 pr-4 text-zinc-800 dark:text-zinc-200">{item.title}</td>
                          <td className="py-2 pr-4 text-zinc-500 dark:text-zinc-400">
                            {item.dueDate ? formatDate(item.dueDate) : '—'}
                          </td>
                          <td className="py-2">
                            <StatusBadge status={item.status ?? 'todo'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.items.length > 10 && (
                    <p className="pt-2 text-xs text-zinc-400 dark:text-zinc-500">
                      … og {parsed.items.length - 10} flere rækker importeres
                    </p>
                  )}
                </div>

                {importResult && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs font-medium text-emerald-700 animate-fade-in dark:text-emerald-300">
                    <CheckCircle2 className="mt-px h-4 w-4 shrink-0" />
                    {importResult.created} opgaver importeret ({importResult.skipped} sprunget over som dubletter)
                  </div>
                )}
              </div>
            )}

            <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <Info className="h-3.5 w-3.5 shrink-0" />
              Microsoft Planner importeres fra fanen Outlook &amp; Microsoft 365.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

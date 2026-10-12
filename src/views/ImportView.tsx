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
  ListChecks,
  UserPlus,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { CHECKLIST_TEMPLATES, PROJECT_TEMPLATES, type ProjectTemplate } from '../data/templates';
import { parseImportFile, type ParsedImport } from '../lib/importers';
import { useLang, t } from '../lib/i18n';
import { cn, formatDate } from '../lib/utils';
import { StatusBadge, ViewHeader } from '../components/common';

// ---------- Sektion A: skabelonkort ----------

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  'tpl-web': Globe,
  'tpl-app': Zap,
  'tpl-onboarding': UserPlus,
};

function TemplateCard({ tpl }: { tpl: ProjectTemplate }) {
  useLang();
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
        {t('import.tasksPoints').replace('{tasks}', String(tpl.tasks.length)).replace('{points}', String(totalPoints))}
      </p>
      <ul className="pt-1.5">
        {tpl.tasks.slice(0, 5).map((t) => (
          <li key={t.title} className="flex items-start gap-1.5 py-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-600" />
            <span className="truncate">{t.title}</span>
          </li>
        ))}
        {tpl.tasks.length > 5 && (
          <li className="py-0.5 pl-2.5 text-xs text-zinc-400 dark:text-zinc-500">
            {t('import.moreTasks').replace('{n}', String(tpl.tasks.length - 5))}
          </li>
        )}
      </ul>

      {created ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <p className="flex items-start gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
            {t('import.createdOk').replace('{name}', created.name).replace('{count}', String(created.count))}
          </p>
          <button onClick={() => navigate('/tavle')} className="btn-primary self-start py-1 text-xs">
            {t('import.goToBoard')}
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
            {t('import.createProject')}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Hovedview ----------

export default function ImportView() {
  useLang();
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const importTasks = useStore((s) => s.importTasks);
  const addTask = useStore((s) => s.addTask);
  const addSubtask = useStore((s) => s.addSubtask);
  const [createdChecklist, setCreatedChecklist] = useState<string | null>(null);

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
    reader.onerror = () => setError(t('import.readError'));
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 lg:p-6">
        <ViewHeader title={t('import.title')} subtitle={t('import.subtitle')} />

        {/* Sektion A */}
        <section className="animate-fade-in">
          <div className="flex items-center gap-2 pb-3">
            <LayoutTemplate className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{t('import.templatesTitle')}</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {PROJECT_TEMPLATES.map((tpl) => (
              <TemplateCard key={tpl.id} tpl={tpl} />
            ))}
          </div>
        </section>

        {/* Sektion: personlige checklister */}
        <section className="animate-fade-in">
          <div className="flex items-center gap-2 pb-3">
            <ListChecks className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Personlige checklister</h2>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">én opgave med underopgaver – klar på 2 sekunder</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {CHECKLIST_TEMPLATES.map((chk) => (
              <div key={chk.id} className="glass-panel card-hover flex flex-col rounded-xl p-4">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">{chk.emoji}</span>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">{chk.name}</h3>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{chk.description}</p>
                  </div>
                </div>
                <p className="pt-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  {chk.items.length} punkter
                </p>
                <button
                  onClick={() => {
                    const projectId = activeProjectId ?? projects[0]?.id;
                    if (!projectId) return;
                    const task = addTask({ title: chk.name, projectId, emoji: chk.emoji });
                    for (const item of chk.items) addSubtask(task.id, item);
                    setCreatedChecklist(chk.name);
                  }}
                  className="btn-primary mt-3 self-stretch justify-center py-1 text-xs"
                >
                  Tilføj til tavlen
                </button>
              </div>
            ))}
          </div>
          {createdChecklist && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600 animate-fade-in dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Checklisten "{createdChecklist}" ligger nu på tavlen med alle punkter.
            </p>
          )}
        </section>

        {/* Sektion B */}
        <section className="animate-fade-in">
          <div className="flex items-center gap-2 pb-3">
            <FileUp className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{t('import.importTitle')}</h2>
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
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{t('import.dropTitle')}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('import.dropSub')}</p>
              <label className="btn-outline mt-1 cursor-pointer">
                {t('import.chooseFile')}
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
                    <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{t('import.preview')}</h3>
                    <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {t('import.previewSub')
                        .replace('{file}', parsed.fileName)
                        .replace('{source}', parsed.source)
                        .replace('{n}', String(parsed.items.length))}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={targetProjectId ?? ''}
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                      className="input w-auto py-1.5 text-sm"
                      title={t('import.targetProject')}
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button onClick={runImport} disabled={!targetProjectId} className="btn-primary">
                      {t('import.importN').replace('{n}', String(parsed.items.length))}
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto pt-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        <th className="pb-2 pr-4 font-medium">{t('import.colTitle')}</th>
                        <th className="pb-2 pr-4 font-medium">{t('import.colDue')}</th>
                        <th className="pb-2 font-medium">{t('import.colStatus')}</th>
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
                      {t('import.moreRows').replace('{n}', String(parsed.items.length - 10))}
                    </p>
                  )}
                </div>

                {importResult && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs font-medium text-emerald-700 animate-fade-in dark:text-emerald-300">
                    <CheckCircle2 className="mt-px h-4 w-4 shrink-0" />
                    {t('import.resultOk')
                      .replace('{created}', String(importResult.created))
                      .replace('{skipped}', String(importResult.skipped))}
                  </div>
                )}
              </div>
            )}

            <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <Info className="h-3.5 w-3.5 shrink-0" />
              {t('import.plannerHint')}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

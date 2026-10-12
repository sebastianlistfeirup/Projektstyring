import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlarmClock,
  BellRing,
  Copy,
  Download,
  FileText,
  FolderOpen,
  HardDrive,
  Link2,
  MailWarning,
  Play,
  Plug,
  RotateCcw,
  Send,
  Share2,
  Sparkles,
  Trash2,
  Unplug,
  Users,
  Zap,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import {
  aiComplete,
  companionExport,
  companionNotify,
  companionOpenExport,
  companionReport,
  companionSaveConfig,
  companionStatus,
  companionTeams,
  createBackup,
  getSyncToken,
  listBackups,
  restoreBackup,
  runRemindersNow,
  runReportNow,
  setSyncToken,
  type BackupFile,
  type CompanionStatus,
} from '../lib/companion';
import { applySnapshot, getSyncUrl, isSyncEnabled, restartSync, setSyncEnabled, setSyncUrl } from '../lib/sync';
import { cn, formatDate, formatDateShort, isOverdue, taskRef, timeAgo } from '../lib/utils';
import { STATUS_META } from '../lib/constants';

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel animate-fade-in rounded-xl p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300">
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Feedback({ text, tone }: { text: string | null; tone: 'ok' | 'error' }) {
  if (!text) return null;
  return (
    <p className={cn('mt-3 rounded-lg px-3 py-2 text-xs', tone === 'ok' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300')}>
      {text}
    </p>
  );
}

export default function IntegrationsView() {
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const users = useStore((s) => s.users);
  const sprints = useStore((s) => s.sprints);
  const automation = useStore((s) => s.automation);
  const setAutomation = useStore((s) => s.setAutomation);
  const shareProject = useStore((s) => s.shareProject);
  const unshareProject = useStore((s) => s.unshareProject);
  const trash = useStore((s) => s.trash);
  const restoreTask = useStore((s) => s.restoreTask);
  const emptyTrash = useStore((s) => s.emptyTrash);

  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [webhook, setWebhook] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const feedbackTimer = useRef<number | null>(null);

  // Synkronisering, påmindelser, rapporter og AI
  const [syncUrlInput, setSyncUrlInput] = useState(getSyncUrl());
  const [syncOn, setSyncOn] = useState(isSyncEnabled());
  const [remEnabled, setRemEnabled] = useState(false);
  const [remTime, setRemTime] = useState('08:00');
  const [repEnabled, setRepEnabled] = useState(false);
  const [repDay, setRepDay] = useState(1);
  const [repTime, setRepTime] = useState('08:00');
  const [aiBase, setAiBase] = useState('https://api.openai.com/v1');
  const [aiKey, setAiKey] = useState('');
  const [aiModel, setAiModel] = useState('gpt-4o-mini');
  const [aiConfigured, setAiConfigured] = useState(false);
  const [syncTokenInput, setSyncTokenInput] = useState(getSyncToken());
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const prefilled = useRef(false);

  useEffect(() => {
    if (!status || prefilled.current) return;
    prefilled.current = true;
    if (status.reminders) {
      setRemEnabled(status.reminders.enabled);
      setRemTime(status.reminders.time);
    }
    if (status.reports) {
      setRepEnabled(status.reports.enabled);
      setRepDay(status.reports.day);
      setRepTime(status.reports.time);
    }
    setAiConfigured(Boolean(status.aiConfigured));
  }, [status]);

  const say = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    setFeedback({ text, tone });
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 8000);
  }, []);

  const refresh = useCallback(async () => {
    const s = await companionStatus();
    setStatus(s);
    if (s) {
      const b = await listBackups();
      if (b.ok && b.files) setBackups(b.files);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 5000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const connected = Boolean(status);

  const run = async (key: string, fn: () => Promise<string>, tone: 'ok' | 'error' = 'ok') => {
    setBusy(key);
    try {
      say(await fn(), tone);
    } finally {
      setBusy(null);
    }
  };

  const enriched = tasks.map((t) => ({
    ...t,
    assigneeName: users.find((u) => u.id === t.assigneeId)?.name ?? '',
    sprintName: sprints.find((sp) => sp.id === t.sprintId)?.name ?? '',
  }));

  const buildReport = () => {
    const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'canceled');
    const overdue = tasks.filter(isOverdue);
    const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const dueSoon = open.filter((t) => t.dueDate && t.dueDate <= week);
    const weekNo = Math.ceil((((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000) + 1) / 7);
    const lines: string[] = [
      `# Orbit uge-rapport – uge ${weekNo}`,
      '',
      `Genereret ${formatDate(new Date().toISOString())} · ${open.length} åbne opgaver · ${projects.length} projekter`,
      '',
      '## Status pr. projekt',
      '',
      ...projects.map((p) => {
        const pt = tasks.filter((t) => t.projectId === p.id);
        const openCount = pt.filter((t) => t.status !== 'done' && t.status !== 'canceled').length;
        const doneCount = pt.filter((t) => t.status === 'done').length;
        return `- **${p.name}**: ${openCount} åbne / ${doneCount} færdige`;
      }),
      '',
      '## Overskredne frister',
      '',
      ...(overdue.length
        ? overdue.map((t) => `- ${taskRef(t, projects)} – ${t.title} (frist ${formatDateShort(t.dueDate)})`)
        : ['- Ingen. Alle frister er overholdt.']),
      '',
      '## Frister de næste 7 dage',
      '',
      ...(dueSoon.length
        ? dueSoon.map((t) => `- ${taskRef(t, projects)} – ${t.title} (frist ${formatDateShort(t.dueDate)})`)
        : ['- Ingen frister den kommende uge.']),
      '',
      '## Opgavestatus i alt',
      '',
      ...Object.entries(STATUS_META).flatMap(([key, meta]) => {
        const count = tasks.filter((t) => t.status === key).length;
        return count > 0 ? [`- ${meta.label}: ${count}`] : [];
      }),
    ];
    return lines.join('\n');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 p-4 lg:p-6">
        {/* Companion-status */}
        <Section icon={<Plug className="h-5 w-5" />} title="Orbit Companion" subtitle="Lokal server der forbinder appen med Windows, filsystemet og Teams">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-2">
              <span className={cn('relative flex h-2.5 w-2.5', connected && 'animate-pulse')}>
                <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-60', connected ? 'bg-emerald-400' : 'bg-rose-400')} />
                <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', connected ? 'bg-emerald-500' : 'bg-rose-500')} />
              </span>
              <span className={cn('text-sm font-semibold', connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                {connected ? 'Tilsluttet' : 'Frakoblet'}
              </span>
            </span>
            {status && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Køretid {Math.floor((status.uptime ?? 0) / 60)} min · {status.exportDir}
              </span>
            )}
            {!status && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Start den med <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-white/10">npm run companion</code>
              </span>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              disabled={!connected || busy === 'notify'}
              onClick={() =>
                run('notify', async () => {
                  await companionNotify('Orbit', 'Dette er en test-notifikation fra Orbit Companion.');
                  return 'Test-notifikation sendt (kræver PowerShell-modulet BurntToast – ellers stille ignoreret).';
                })
              }
              className="btn-outline"
            >
              <BellRing className="h-4 w-4" />
              Test-notifikation
            </button>
            <button
              disabled={!connected || busy === 'teams'}
              onClick={() =>
                run('teams', async () => {
                  const r = await companionTeams('Orbit', 'Test-besked fra Orbit Companion.', 'Forbindelsen virker');
                  return r.ok ? 'Test-besked sendt til Teams.' : `Kunne ikke sende: ${r.reason ?? 'ukendt fejl'}`;
                }, 'error')
              }
              className="btn-outline"
            >
              <Send className="h-4 w-4" />
              Test til Teams
            </button>
            <button
              disabled={!connected || busy === 'folder'}
              onClick={() => run('folder', async () => {
                await companionOpenExport();
                return 'Eksport-mappen åbnes i Stifinder.';
              })}
              className="btn-outline"
            >
              <FolderOpen className="h-4 w-4" />
              Åbn eksport-mappe
            </button>
          </div>

          {/* Teams-webhook */}
          <div className="mt-5 border-t border-zinc-200/70 pt-4 dark:border-white/[0.06]">
            <label className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              <Link2 className="h-3.5 w-3.5" />
              Teams-webhook (valgfri)
              {status?.teamsConfigured && (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-emerald-600 dark:text-emerald-400">
                  Konfigureret
                </span>
              )}
            </label>
            <div className="flex gap-2">
              <input
                value={webhook}
                onChange={(e) => setWebhook(e.target.value)}
                placeholder="https://…webhook… (fra Teams: kanal ⋯ → Tilføjelser → Indgående webhook)"
                className="input flex-1 py-1.5 text-xs"
              />
              <button
                disabled={!connected}
                onClick={() =>
                  run('save-webhook', async () => {
                    await companionSaveConfig({ teamsWebhook: webhook.trim() });
                    await refresh();
                    return webhook.trim() ? 'Webhook gemt.' : 'Webhook fjernet.';
                  })
                }
                className="btn-primary shrink-0 py-1.5 text-xs"
              >
                Gem
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              Når webhook'en er gemt, sendes der automatisk en besked til kanalen, hver gang en opgave markeres færdig.
            </p>
          </div>
          <Feedback text={feedback?.text ?? null} tone={feedback?.tone ?? 'ok'} />
        </Section>

        {/* Eksport */}
        <Section icon={<Download className="h-5 w-5" />} title="Eksport" subtitle={`Gemmer i Documents/Orbit – ${tasks.length} opgaver eksporteres`}>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={!connected || busy === 'csv'}
              onClick={() =>
                run('csv', async () => {
                  const r = await companionExport(enriched, projects, 'csv');
                  return r.ok && r.path ? `CSV gemt: ${r.path}` : `Fejl: ${r.reason ?? 'ukendt'}`;
                }, 'error')
              }
              className="btn-outline"
            >
              <Download className="h-4 w-4" />
              CSV (Excel)
            </button>
            <button
              disabled={!connected || busy === 'json'}
              onClick={() =>
                run('json', async () => {
                  const r = await companionExport(enriched, projects, 'json');
                  return r.ok && r.path ? `JSON gemt: ${r.path}` : `Fejl: ${r.reason ?? 'ukendt'}`;
                }, 'error')
              }
              className="btn-outline"
            >
              <Download className="h-4 w-4" />
              JSON
            </button>
            <button
              disabled={!connected || busy === 'report'}
              onClick={() =>
                run('report', async () => {
                  const r = await companionReport(buildReport(), 'uge-rapport');
                  return r.ok && r.path ? `Rapport gemt: ${r.path}` : `Fejl: ${r.reason ?? 'ukendt'}`;
                }, 'error')
              }
              className="btn-primary"
            >
              <FileText className="h-4 w-4" />
              Uge-rapport (Markdown)
            </button>
          </div>
          {!connected && (
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <Unplug className="h-4 w-4 shrink-0" />
              Companion-serveren kører ikke – eksport er slået fra, indtil den startes.
            </p>
          )}
          <p className="mt-3 flex items-start gap-2 text-[11px] text-zinc-400 dark:text-zinc-500">
            <MailWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Outlook-integrationen (møder og Microsoft To Do-opgaver) finder du under fanen "Outlook & Microsoft 365".
          </p>
        </Section>

        {/* Automatisering */}
        <Section icon={<Zap className="h-5 w-5" />} title="Automatisering" subtitle="Små regler der sparer dig for gentagelse – slås til/fra med det samme">
          <div className="space-y-3">
            <label className="flex items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={automation.doneTeams}
                onChange={(e) => setAutomation({ doneTeams: e.target.checked })}
                className="h-4 w-4 accent-indigo-500"
              />
              Send besked til Teams, når en opgave afsluttes
            </label>
            <label className="flex items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={automation.doneNotifyAssignee}
                onChange={(e) => setAutomation({ doneNotifyAssignee: e.target.checked })}
                className="h-4 w-4 accent-indigo-500"
              />
              Notificér den ansvarlige, når deres opgave afsluttes
            </label>
            <div className="flex flex-wrap items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-200">
              <Zap className="h-4 w-4 text-amber-500" />
              Tildel automatisk ved kritisk prioritet:
              <select
                value={automation.urgentAssigneeId ?? ''}
                onChange={(e) => setAutomation({ urgentAssigneeId: e.target.value || null })}
                className="input w-auto py-1.5 text-sm"
              >
                <option value="">Ingen</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>

        {/* Synkronisering & team */}
        <Section icon={<Users className="h-5 w-5" />} title="Synkronisering & team" subtitle="Del arbejdsområdet med kolleger på samme netværk">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={syncUrlInput}
              onChange={(e) => setSyncUrlInput(e.target.value)}
              className="input flex-1 py-1.5 font-mono text-xs"
              placeholder="http://127.0.0.1:4310"
            />
            <button
              disabled={!connected}
              onClick={() =>
                run('sync-url', async () => {
                  setSyncUrl(syncUrlInput);
                  setSyncEnabled(true);
                  setSyncOn(true);
                  restartSync();
                  await new Promise((r) => setTimeout(r, 600));
                  await refresh();
                  return 'Synkronisering genstartet.';
                })
              }
              className="btn-outline shrink-0 py-1.5 text-xs"
            >
              Gem & forbind
            </button>
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={syncOn}
                onChange={(e) => {
                  setSyncOn(e.target.checked);
                  setSyncEnabled(e.target.checked);
                  restartSync();
                }}
                className="h-4 w-4 accent-indigo-500"
              />
              Synkronisér automatisk
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={syncTokenInput}
              onChange={(e) => setSyncTokenInput(e.target.value)}
              placeholder="Sync-token (valgfri – kræves af sync-servere med ORBIT_SYNC_TOKEN)"
              className="input flex-1 py-1.5 font-mono text-xs"
            />
            <button
              onClick={() => {
                setSyncToken(syncTokenInput);
                restartSync();
                say('Sync-token gemt – synkronisering genstartet.');
              }}
              className="btn-outline shrink-0 py-1.5 text-xs"
            >
              Gem token
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            Kolleger på samme netværk peger på din adresse (fx http://192.168.1.20:4310). Til sync over internettet kører du
            <code className="mx-1 rounded bg-zinc-100 px-1 py-0.5 font-mono text-[10px] dark:bg-white/10">server/sync-server.mjs</code>
            på en server med <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[10px] dark:bg-white/10">ORBIT_SYNC_TOKEN</code> og peger appen dérhen.
          </p>
          {status?.online && status.online.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {status.online.map((p, i) => (
                <span
                  key={`${p.name}-${i}`}
                  className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {p.name}
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* Morgen-påmindelser */}
        <Section icon={<AlarmClock className="h-5 w-5" />} title="Morgen-påmindelser" subtitle="Dagligt overblik som Windows-notifikation og Teams-besked">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={remEnabled}
                onChange={(e) => setRemEnabled(e.target.checked)}
                className="h-4 w-4 accent-indigo-500"
              />
              Aktivér
            </label>
            <input type="time" value={remTime} onChange={(e) => setRemTime(e.target.value)} className="input w-auto py-1.5 text-sm" />
            <button
              disabled={!connected}
              onClick={() =>
                run('save-reminders', async () => {
                  await companionSaveConfig({ reminders: { enabled: remEnabled, time: remTime } });
                  return 'Påmindelser gemt.';
                })
              }
              className="btn-outline py-1.5 text-xs"
            >
              Gem
            </button>
            <button
              disabled={!connected}
              onClick={() =>
                run('run-reminders', async () => {
                  const r = await runRemindersNow();
                  if (!r.ok) return r.reason ?? 'Kunne ikke køre påmindelser.';
                  return `Sendt: ${(r.lines ?? []).join(' · ')}`;
                }, 'error')
              }
              className="btn-outline py-1.5 text-xs"
            >
              <Play className="h-3.5 w-3.5" />
              Kør nu
            </button>
          </div>
        </Section>

        {/* Automatisk uge-rapport */}
        <Section icon={<FileText className="h-5 w-5" />} title="Automatisk uge-rapport" subtitle="Gemmes på disk og sendes til Teams (og til dig selv på mail, hvis Microsoft 365 er tilsluttet)">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={repEnabled}
                onChange={(e) => setRepEnabled(e.target.checked)}
                className="h-4 w-4 accent-indigo-500"
              />
              Aktivér
            </label>
            <select value={repDay} onChange={(e) => setRepDay(Number(e.target.value))} className="input w-auto py-1.5 text-sm">
              <option value={1}>Mandag</option>
              <option value={2}>Tirsdag</option>
              <option value={3}>Onsdag</option>
              <option value={4}>Torsdag</option>
              <option value={5}>Fredag</option>
            </select>
            <input type="time" value={repTime} onChange={(e) => setRepTime(e.target.value)} className="input w-auto py-1.5 text-sm" />
            <button
              disabled={!connected}
              onClick={() =>
                run('save-reports', async () => {
                  await companionSaveConfig({ reports: { enabled: repEnabled, day: repDay, time: repTime } });
                  return 'Uge-rapport gemt.';
                })
              }
              className="btn-outline py-1.5 text-xs"
            >
              Gem
            </button>
            <button
              disabled={!connected}
              onClick={() =>
                run('run-report', async () => {
                  const r = await runReportNow();
                  return r.ok && r.path ? `Rapport gemt: ${r.path}` : r.reason ?? 'Kunne ikke generere rapport.';
                }, 'error')
              }
              className="btn-outline py-1.5 text-xs"
            >
              <Play className="h-3.5 w-3.5" />
              Kør nu
            </button>
          </div>
        </Section>

        {/* AI-assistent */}
        <Section icon={<Sparkles className="h-5 w-5" />} title="AI-assistent" subtitle="Foreslå underopgaver og opsummér kommentarer – nøglen gemmes kun lokalt på din egen PC">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              value={aiBase}
              onChange={(e) => setAiBase(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="input py-1.5 font-mono text-xs"
            />
            <input
              type="password"
              value={aiKey}
              onChange={(e) => setAiKey(e.target.value)}
              placeholder="API-nøgle"
              className="input py-1.5 font-mono text-xs"
            />
            <input
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              placeholder="Model, fx gpt-4o-mini"
              className="input py-1.5 font-mono text-xs"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              disabled={!connected}
              onClick={() =>
                run('save-ai', async () => {
                  await companionSaveConfig({ ai: { baseUrl: aiBase, apiKey: aiKey, model: aiModel } });
                  setAiConfigured(Boolean(aiKey));
                  return aiKey ? 'AI-assistent konfigureret.' : 'AI-nøgle fjernet.';
                })
              }
              className="btn-outline py-1.5 text-xs"
            >
              Gem
            </button>
            <button
              disabled={!connected || !aiConfigured}
              onClick={() =>
                run('test-ai', async () => {
                  const r = await aiComplete([
                    { role: 'system', content: 'Du er en kortfattet dansk projektassistent.' },
                    { role: 'user', content: 'Sig hej og fortæl på én sætning, at du er klar til at hjælpe med opgaver.' },
                  ]);
                  return r.ok && r.content ? `AI svarer: ${r.content.slice(0, 140)}` : r.reason ?? 'AI-test mislykkedes.';
                }, 'error')
              }
              className="btn-outline py-1.5 text-xs"
            >
              <Play className="h-3.5 w-3.5" />
              Test
            </button>
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              <Sparkles className="h-3.5 w-3.5" />
              {aiConfigured ? 'Konfigureret' : 'Ikke konfigureret – AI-knapperne i opgavedetaljen virker, så snart nøglen er gemt'}
            </span>
          </div>
        </Section>
        {/* Kunde-statusside */}
        <Section icon={<Share2 className="h-5 w-5" />} title="Kunde-statusside" subtitle="Et læselink til kunden med live status – opdateres automatisk">
          {(() => {
            const shared = projects.filter((p) => p.publicToken);
            return (
              <div className="space-y-3">
                {shared.length === 0 && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Vælg et projekt og aktivér deling – kunden får et link uden login med fremdrift, frister og senest afsluttet.
                  </p>
                )}
                {shared.map((p) => {
                  const url = `http://${window.location.hostname}:4310/public/status/${p.publicToken}`;
                  return (
                    <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200/70 px-3 py-2 dark:border-white/[0.07]">
                      <span className={cn('h-2 w-2 rounded-sm', `bg-${p.color}-500`)} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{p.name}</span>
                      <button
                        onClick={() => void navigator.clipboard?.writeText(url).then(() => say('Link kopieret.'))}
                        title="Kopiér link"
                        className="btn-ghost px-2 py-1 text-xs"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Kopiér
                      </button>
                      <button onClick={() => window.open(url, '_blank')} title="Åbn statusside" className="btn-ghost px-2 py-1 text-xs">
                        <FolderOpen className="h-3.5 w-3.5" />
                        Åbn
                      </button>
                      <button
                        onClick={() => {
                          unshareProject(p.id);
                          say(`Deling deaktiveret for ${p.name}.`);
                        }}
                        className="btn-ghost px-2 py-1 text-xs text-rose-600 dark:text-rose-400"
                      >
                        Deaktivér
                      </button>
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    id="share-project"
                    defaultValue=""
                    className="input w-auto py-1.5 text-sm"
                    title="Projekt der skal deles"
                  >
                    <option value="" disabled>
                      Vælg projekt…
                    </option>
                    {projects
                      .filter((p) => !p.publicToken)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => {
                      const sel = document.getElementById('share-project') as HTMLSelectElement | null;
                      if (sel?.value) {
                        shareProject(sel.value);
                        say('Statusside aktiveret – linket vises ovenfor.');
                      }
                    }}
                    className="btn-outline py-1.5 text-xs"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Aktivér deling
                  </button>
                </div>
              </div>
            );
          })()}
        </Section>

        {/* Backup */}
        <Section icon={<HardDrive className="h-5 w-5" />} title="Backup & gendannelse" subtitle="Daglig sikkerhedskopi kl. 09:00 til Documents/Orbit/backup">
          <div className="flex flex-wrap gap-2">
            <button
              disabled={!connected}
              onClick={() =>
                run('backup-now', async () => {
                  const r = await createBackup();
                  if (!r.ok) return r.reason ?? 'Backup mislykkedes.';
                  await refresh();
                  return `Backup oprettet (${r.count ?? 0} opgaver): ${r.path}`;
                }, 'error')
              }
              className="btn-outline"
            >
              <HardDrive className="h-4 w-4" />
              Opret backup nu
            </button>
          </div>
          {backups.length > 0 && (
            <ul className="mt-3 divide-y divide-zinc-200/70 dark:divide-white/[0.05]">
              {backups.slice(0, 5).map((b) => (
                <li key={b.name} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-600 dark:text-zinc-300">{b.name}</span>
                  <span className="shrink-0 text-xs text-zinc-400">{Math.round(b.size / 1024)} KB</span>
                  <span className="shrink-0 text-xs text-zinc-400">{timeAgo(b.mtime)}</span>
                  <button
                    disabled={!connected}
                    onClick={() =>
                      run(`restore-${b.name}`, async () => {
                        const r = await restoreBackup(b.name);
                        if (!r.ok || !r.snapshot) return r.reason ?? 'Kunne ikke læse backup.';
                        applySnapshot(r.snapshot);
                        return `Backup gendannet (${(r.snapshot.tasks ?? []).length} opgaver flettet ind).`;
                      }, 'error')
                    }
                    className="btn-ghost shrink-0 px-2 py-1 text-xs text-indigo-600 dark:text-indigo-300"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Gendan
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Papirkurv */}
        <Section icon={<Trash2 className="h-5 w-5" />} title="Papirkurv" subtitle={`${trash.length} slettede opgaver gemmes i 30 dage`}>
          {trash.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">Papirkurven er tom.</p>
          ) : (
            <>
              <ul className="mb-3 max-h-64 space-y-1 overflow-y-auto">
                {trash.slice(0, 20).map((item) => (
                  <li key={item.task.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-white/[0.04]">
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-200">{item.task.title}</span>
                    <span className="shrink-0 text-xs text-zinc-400">slettet {timeAgo(item.deletedAt)}</span>
                    <button
                      onClick={() => {
                        restoreTask(item.task.id);
                        say(`“${item.task.title}” er gendannet.`);
                      }}
                      className="btn-ghost shrink-0 px-2 py-0.5 text-xs text-indigo-600 dark:text-indigo-300"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Gendan
                    </button>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => {
                  if (window.confirm(`Tøm papirkurven permanent? (${trash.length} opgaver)`)) {
                    emptyTrash();
                    say('Papirkurven er tømt.');
                  }
                }}
                className="btn-ghost text-xs text-rose-600 dark:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Tøm papirkurv
              </button>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

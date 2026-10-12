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
  addWebhook,
  companionExport,
  companionNotify,
  companionOpenExport,
  companionReport,
  companionSaveConfig,
  companionStatus,
  companionTeams,
  createApiToken,
  createBackup,
  fetchAdopsWorkItems,
  fetchGitIssues,
  getSyncToken,
  getWebhooks,
  listBackups,
  postStandup,
  removeWebhook,
  restoreBackup,
  runRemindersNow,
  runReportNow,
  saveAdopsConfig,
  saveGitConfig,
  setSyncToken,
  type AdopsWorkItem,
  type BackupFile,
  type CompanionStatus,
  type GitIssue,
} from '../lib/companion';
import { applySnapshot, getSyncUrl, isSyncEnabled, restartSync, setSyncEnabled, setSyncUrl } from '../lib/sync';
import { cn, formatDate, formatDateShort, isOverdue, taskRef, timeAgo } from '../lib/utils';
import { Avatar } from '../components/common';
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
  const activeProjectId = useStore((s) => s.activeProjectId);
  const automation = useStore((s) => s.automation);
  const setAutomation = useStore((s) => s.setAutomation);
  const shareProject = useStore((s) => s.shareProject);
  const unshareProject = useStore((s) => s.unshareProject);
  const trash = useStore((s) => s.trash);
  const restoreTask = useStore((s) => s.restoreTask);
  const emptyTrash = useStore((s) => s.emptyTrash);
  const standups = useStore((s) => s.standups);
  const addStandup = useStore((s) => s.addStandup);
  const setTaskExtIds = useStore((s) => s.setTaskExtIds);
  const agents = useStore((s) => s.agents);
  const setAgents = useStore((s) => s.setAgents);
  const rules = useStore((s) => s.rules);
  const setRules = useStore((s) => s.setRules);

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
  const [adopsOrg, setAdopsOrg] = useState('');
  const [adopsProject, setAdopsProject] = useState('');
  const [adopsPat, setAdopsPat] = useState('');
  const [adopsItems, setAdopsItems] = useState<AdopsWorkItem[] | null>(null);
  const [adopsSelected, setAdopsSelected] = useState<Set<number>>(new Set());
  const [webhooks, setWebhooks] = useState<string[]>([]);
  const [webhookInput, setWebhookInput] = useState('');
  const [apiTokenValue, setApiTokenValue] = useState('');
  const [standupText, setStandupText] = useState('');
  const [gitProvider, setGitProvider] = useState<'github' | 'gitlab'>('github');
  const [gitToken, setGitToken] = useState('');
  const [gitOwner, setGitOwner] = useState('');
  const [gitRepo, setGitRepo] = useState('');
  const [gitItems, setGitItems] = useState<GitIssue[] | null>(null);
  const [gitSelected, setGitSelected] = useState<Set<number>>(new Set());
  const [agentDraft, setAgentDraft] = useState<{ projectId: string; text: string } | null>(null);
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
      const [b, w] = await Promise.all([listBackups(), getWebhooks()]);
      if (b.ok && b.files) setBackups(b.files);
      if (w.ok && w.urls) setWebhooks(w.urls);
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
        {/* Azure DevOps */}
        <Section icon={<Zap className="h-5 w-5" />} title="Azure DevOps" subtitle="Hent work items og skriv status tilbage – to-vejs">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input value={adopsOrg} onChange={(e) => setAdopsOrg(e.target.value)} placeholder="Organisation (fx dit-org)" className="input py-1.5 font-mono text-xs" />
            <input value={adopsProject} onChange={(e) => setAdopsProject(e.target.value)} placeholder="Projekt (fx App 2.0)" className="input py-1.5 font-mono text-xs" />
            <input type="password" value={adopsPat} onChange={(e) => setAdopsPat(e.target.value)} placeholder="Personal Access Token" className="input py-1.5 font-mono text-xs" />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              disabled={!connected}
              onClick={() =>
                run('adops-save', async () => {
                  await saveAdopsConfig({ org: adopsOrg, project: adopsProject, pat: adopsPat });
                  return 'Azure DevOps-konfiguration gemt.';
                })
              }
              className="btn-outline py-1.5 text-xs"
            >
              Gem konfiguration
            </button>
            <button
              disabled={!connected}
              onClick={() =>
                run('adops-fetch', async () => {
                  const r = await fetchAdopsWorkItems();
                  if (!r.ok || !r.items) return r.reason ?? 'Kunne ikke hente work items.';
                  setAdopsItems(r.items);
                  setAdopsSelected(new Set(r.items.map((i) => i.id)));
                  return `${r.items.length} åbne work items fundet.`;
                }, 'error')
              }
              className="btn-outline py-1.5 text-xs"
            >
              Hent work items
            </button>
          </div>
          {adopsItems && (
            <div className="mt-3">
              {adopsItems.length === 0 ? (
                <p className="text-sm text-zinc-400">Ingen åbne work items.</p>
              ) : (
                <>
                  <ul className="mb-2 max-h-56 space-y-1 overflow-y-auto">
                    {adopsItems.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-white/[0.04]">
                        <input
                          type="checkbox"
                          checked={adopsSelected.has(item.id)}
                          onChange={() =>
                            setAdopsSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            })
                          }
                          className="h-4 w-4 accent-indigo-500"
                        />
                        <span className="w-12 shrink-0 text-xs font-bold tabular-nums text-zinc-500">#{item.id}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{item.title}</span>
                        <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400">
                          {item.type} · {item.state}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <button
                    disabled={adopsSelected.size === 0}
                    onClick={() => {
                      const projectId = activeProjectId ?? projects[0]?.id;
                      if (!projectId || !adopsItems) return;
                      const chosen = adopsItems.filter((i) => adopsSelected.has(i.id));
                      const state = (s: string): 'todo' | 'inprogress' | 'done' =>
                        /done|closed|resolved/i.test(s) ? 'done' : /progress|active|committed/i.test(s) ? 'inprogress' : 'todo';
                      let created = 0;
                      for (const item of chosen) {
                        const t = useStore.getState().addTask({ title: item.title, projectId, status: state(item.state) });
                        setTaskExtIds(t.id, { adopsId: item.id });
                        created += 1;
                      }
                      setAdopsItems(null);
                      say(`${created} work items importeret – afslut dem i Orbit, og status skrives tilbage til DevOps.`);
                    }}
                    className="btn-primary py-1 text-xs"
                  >
                    Importér valgte ({adopsSelected.size}) – med tilbage-skrivning
                  </button>
                </>
              )}
            </div>
          )}
        </Section>

        {/* Webhooks + åbent API */}
        <Section icon={<Link2 className="h-5 w-5" />} title="Webhooks & åbent API" subtitle="Lad andre systemer reagere på Orbit – fx Power Automate">
          <div className="space-y-2">
            {webhooks.map((url) => (
              <div key={url} className="flex items-center gap-2 rounded-lg border border-zinc-200/70 px-3 py-1.5 dark:border-white/[0.07]">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-600 dark:text-zinc-300">{url}</span>
                <button
                  disabled={!connected}
                  onClick={() =>
                    run('webhook-del', async () => {
                      await removeWebhook(url);
                      setWebhooks((prev) => prev.filter((u) => u !== url));
                      return 'Webhook fjernet.';
                    })
                  }
                  className="btn-ghost shrink-0 px-2 py-0.5 text-xs text-rose-600 dark:text-rose-400"
                >
                  Fjern
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                value={webhookInput}
                onChange={(e) => setWebhookInput(e.target.value)}
                placeholder="https://… (fx Power Automate HTTP-endpoint)"
                className="input flex-1 py-1.5 font-mono text-xs"
              />
              <button
                disabled={!connected}
                onClick={() =>
                  run('webhook-add', async () => {
                    const r = await addWebhook(webhookInput);
                    if (!r.ok) return r.reason ?? 'Kunne ikke tilføje webhook.';
                    setWebhookInput('');
                    if (r.urls) setWebhooks(r.urls);
                    return 'Webhook tilføjet – event "task.completed" sendes fremover.';
                  }, 'error')
                }
                className="btn-outline shrink-0 py-1.5 text-xs"
              >
                Tilføj
              </button>
            </div>
          </div>
          <div className="mt-4 border-t border-zinc-200/70 pt-3 dark:border-white/[0.06]">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Åbent API (læs)</p>
            <p className="mb-2 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
              <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[10px] dark:bg-white/10">GET {`http://<din-pc>:4310/api/v1/tasks`}</code> med header{' '}
              <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[10px] dark:bg-white/10">X-Orbit-Api-Token</code> – se docs/api.md for eksempler med Power Automate.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled={!connected}
                onClick={() =>
                  run('api-token', async () => {
                    const r = await createApiToken();
                    if (!r.ok || !r.token) return 'Kunne ikke oprette token.';
                    setApiTokenValue(r.token);
                    return 'API-token oprettet – vises kun denne gang, så gem det.';
                  }, 'error')
                }
                className="btn-outline py-1.5 text-xs"
              >
                Opret API-token
              </button>
              {apiTokenValue && (
                <code className="rounded bg-indigo-500/10 px-2 py-1 font-mono text-xs text-indigo-600 dark:text-indigo-300">{apiTokenValue}</code>
              )}
            </div>
          </div>
        </Section>

        {/* Asynkron standup */}
        <Section icon={<Users className="h-5 w-5" />} title="Asynkron standup" subtitle="Skriv dagens status – postes til Teams og gemmes i arbejdsområdet">
          <textarea
            value={standupText}
            onChange={(e) => setStandupText(e.target.value)}
            rows={2}
            placeholder="Hvad arbejder du på – og er du blokeret? …"
            className="input resize-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              disabled={!connected || !standupText.trim()}
              onClick={() =>
                run('standup', async () => {
                  const me = users.find((u) => u.id === useStore.getState().currentUserId);
                  const r = await postStandup(me?.name ?? 'Ukendt', standupText.trim());
                  if (!r.ok) return r.reason ?? 'Kunne ikke sende.';
                  addStandup(standupText.trim());
                  setStandupText('');
                  return r.teams?.ok === false && r.teams.reason
                    ? `Standup gemt – men Teams: ${r.teams.reason}`
                    : 'Standup sendt til Teams og gemt.';
                }, 'error')
              }
              className="btn-primary py-1.5 text-xs"
            >
              <Send className="h-3.5 w-3.5" />
              Send standup
            </button>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">Kræver Teams-webhook (øverst på siden)</span>
          </div>
          {standups.length > 0 && (
            <ul className="mt-3 space-y-2">
              {standups.slice(0, 4).map((s) => {
                const author = users.find((u) => u.id === s.userId);
                return (
                  <li key={s.id} className="flex items-start gap-2.5 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-white/[0.03]">
                    <Avatar user={author} size="xs" className="mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        <span className="font-semibold text-zinc-700 dark:text-zinc-200">{author?.name ?? 'Ukendt'}</span> · {timeAgo(s.createdAt)}
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">{s.text}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        {/* AI-agenter */}
        <Section icon={<Sparkles className="h-5 w-5" />} title="AI-agenter" subtitle="Lad AI arbejde i baggrunden – fra værktøj til kollega">
          <div className="space-y-3">
            <label className="flex items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-200">
              <input type="checkbox" checked={agents.triage} onChange={(e) => setAgents({ triage: e.target.checked })} className="h-4 w-4 accent-indigo-500" />
              Triage nye opgaver automatisk (foreslår ansvarlig og prioritet)
            </label>
            <div className="flex flex-wrap items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-200">
              <label className="flex items-center gap-2.5">
                <input type="checkbox" checked={agents.stale} onChange={(e) => setAgents({ stale: e.target.checked })} className="h-4 w-4 accent-indigo-500" />
                Advar om stillestående opgaver efter
              </label>
              <input
                type="number"
                min={1}
                value={agents.staleDays}
                onChange={(e) => setAgents({ staleDays: Math.max(1, Number(e.target.value) || 14) })}
                className="input w-20 py-1.5 text-sm"
              />
              <span>dage</span>
            </div>
          </div>
          <div className="mt-4 border-t border-zinc-200/70 pt-3 dark:border-white/[0.06]">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Statusmail-kladde (AI)</p>
            <div className="flex flex-wrap items-center gap-2">
              <select id="agent-project" defaultValue={activeProjectId ?? ''} className="input w-auto py-1.5 text-sm">
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                disabled={busy === 'agent-draft' || !aiConfigured}
                onClick={() =>
                  run('agent-draft', async () => {
                    const sel = document.getElementById('agent-project') as HTMLSelectElement | null;
                    const project = projects.find((p) => p.id === (sel?.value || activeProjectId));
                    if (!project) return 'Vælg et projekt først.';
                    const pt = tasks.filter((t) => t.projectId === project.id);
                    const open = pt.filter((t) => t.status !== 'done' && t.status !== 'canceled');
                    const overdue = open.filter(isOverdue);
                    const r = await aiComplete([
                      { role: 'system', content: 'Du er en dansk projektleder. Skriv en kort, professionel statusmail til en kunde/ledelse om projektet: 1) hvad er status, 2) hvad sker der nu, 3) hvad har vi brug for. Max 6 korte afsnit. Underskriv ikke.' },
                      { role: 'user', content: `Projekt: ${project.name}\nÅbne opgaver: ${open.length} (${overdue.length} overskredne)\nFærdige: ${pt.length - open.length}\nTop-opgaver: ${open.slice(0, 6).map((t) => t.title).join(', ')}` },
                    ]);
                    if (!r.ok || !r.content) return r.reason ?? 'AI-assistenten er ikke konfigureret.';
                    setAgentDraft({ projectId: project.id, text: r.content });
                    return 'Kladde klar – kopiér og send den.';
                  }, 'error')
                }
                className="btn-outline py-1.5 text-xs"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Skriv kladde
              </button>
            </div>
            {agentDraft && (
              <div className="mt-2 rounded-lg bg-zinc-50 p-3 dark:bg-white/[0.03]">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">{agentDraft.text}</p>
                <button
                  onClick={() => void navigator.clipboard?.writeText(agentDraft.text).then(() => say('Statusmail kopieret.'))}
                  className="btn-ghost mt-2 px-2 py-1 text-xs"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Kopiér kladde
                </button>
              </div>
            )}
          </div>
        </Section>

        {/* Regler 2.0 */}
        <Section icon={<AlarmClock className="h-5 w-5" />} title="Regler & SLA" subtitle="Kolonnegrænser, aldring og automatisk eskalering">
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-700 dark:text-zinc-200">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">WIP-grænser</span>
            {(['todo', 'inprogress', 'inreview'] as const).map((key) => (
              <label key={key} className="flex items-center gap-1.5 text-xs">
                {{ todo: 'Planlagt', inprogress: 'I gang', inreview: 'Gennemgang' }[key]}
                <input
                  type="number"
                  min={0}
                  value={rules.wip[key] ?? ''}
                  placeholder="∞"
                  onChange={(e) =>
                    setRules({ wip: { ...rules.wip, [key]: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) } })
                  }
                  className="input w-16 py-1 text-xs"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-zinc-700 dark:text-zinc-200">
            <label className="flex items-center gap-2.5">
              <input type="checkbox" checked={rules.escalate} onChange={(e) => setRules({ escalate: e.target.checked })} className="h-4 w-4 accent-indigo-500" />
              Eskalér opgaver uden aktivitet efter
            </label>
            <input
              type="number"
              min={1}
              value={rules.agingDays}
              onChange={(e) => setRules({ agingDays: Math.max(1, Number(e.target.value) || 7) })}
              className="input w-20 py-1.5 text-sm"
            />
            <span>dage</span>
          </div>
          <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
            Grænser vises på tavlen (rødt ved overskridelse) og opgaver viser aldring. Eskalering kommer som notifikation i appen.
          </p>
        </Section>

        {/* GitHub / GitLab */}
        <Section icon={<Link2 className="h-5 w-5" />} title="GitHub / GitLab" subtitle="Hent issues og skriv status tilbage – to-vejs">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <select value={gitProvider} onChange={(e) => setGitProvider(e.target.value as 'github' | 'gitlab')} className="input py-1.5 text-sm">
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
            </select>
            <input type="password" value={gitToken} onChange={(e) => setGitToken(e.target.value)} placeholder="Token (PAT / glpat-)" className="input py-1.5 font-mono text-xs" />
            <input value={gitOwner} onChange={(e) => setGitOwner(e.target.value)} placeholder="Ejer / gruppe" className="input py-1.5 font-mono text-xs" />
            <input value={gitRepo} onChange={(e) => setGitRepo(e.target.value)} placeholder="Repository" className="input py-1.5 font-mono text-xs" />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              disabled={!connected}
              onClick={() =>
                run('git-save', async () => {
                  await saveGitConfig({ provider: gitProvider, token: gitToken, owner: gitOwner, repo: gitRepo });
                  return 'Git-konfiguration gemt.';
                })
              }
              className="btn-outline py-1.5 text-xs"
            >
              Gem konfiguration
            </button>
            <button
              disabled={!connected}
              onClick={() =>
                run('git-fetch', async () => {
                  const r = await fetchGitIssues();
                  if (!r.ok || !r.items) return r.reason ?? 'Kunne ikke hente issues.';
                  setGitItems(r.items);
                  setGitSelected(new Set(r.items.map((i) => i.id)));
                  return `${r.items.length} åbne issues fundet.`;
                }, 'error')
              }
              className="btn-outline py-1.5 text-xs"
            >
              Hent issues
            </button>
          </div>
          {gitItems && (
            <div className="mt-3">
              {gitItems.length === 0 ? (
                <p className="text-sm text-zinc-400">Ingen åbne issues.</p>
              ) : (
                <>
                  <ul className="mb-2 max-h-56 space-y-1 overflow-y-auto">
                    {gitItems.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-white/[0.04]">
                        <input
                          type="checkbox"
                          checked={gitSelected.has(item.id)}
                          onChange={() =>
                            setGitSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            })
                          }
                          className="h-4 w-4 accent-indigo-500"
                        />
                        <span className="w-12 shrink-0 text-xs font-bold tabular-nums text-zinc-500">#{item.id}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{item.title}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    disabled={gitSelected.size === 0}
                    onClick={() => {
                      const projectId = activeProjectId ?? projects[0]?.id;
                      if (!projectId || !gitItems) return;
                      const chosen = gitItems.filter((i) => gitSelected.has(i.id));
                      for (const item of chosen) {
                        const t = useStore.getState().addTask({ title: item.title, projectId });
                        setTaskExtIds(t.id, { gitProvider, gitIssue: item.id });
                      }
                      setGitItems(null);
                      say(`${chosen.length} issues importeret – afslut dem i Orbit, og de lukkes i ${gitProvider === 'gitlab' ? 'GitLab' : 'GitHub'}.`);
                    }}
                    className="btn-primary py-1 text-xs"
                  >
                    Importér valgte ({gitSelected.size}) – med tilbage-skrivning
                  </button>
                </>
              )}
            </div>
          )}
          <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">Bruger du Jira? Importer sprints via CSV under Import & skabeloner.</p>
        </Section>
      </div>
    </div>
  );
}

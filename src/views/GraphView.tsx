import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  KeyRound,
  ListTodo,
  LogOut,
  Mail,
  MailPlus,
  Video,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import {
  companionSaveConfig,
  graphDevice,
  graphEvents,
  graphLogin,
  graphLogout,
  graphMessages,
  graphPlannerTasks,
  graphStatus,
  graphTodos,
  type GraphEvent,
  type GraphMessage,
  type GraphPlannerTask,
  type GraphTodo,
} from '../lib/companion';
import { cn, formatDate, formatDateShort } from '../lib/utils';
import type { ImportItem } from '../lib/types';

const CLIENT_ID_KEY = 'orbit-graph-clientid';

export default function GraphView() {
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const addTask = useStore((s) => s.addTask);
  const importTasks = useStore((s) => s.importTasks);

  const [configured, setConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [clientId, setClientId] = useState(() => localStorage.getItem(CLIENT_ID_KEY) ?? '');
  const [pending, setPending] = useState(false);
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [todos, setTodos] = useState<GraphTodo[] | null>(null);
  const [events, setEvents] = useState<GraphEvent[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mails, setMails] = useState<GraphMessage[] | null>(null);
  const [importedMails, setImportedMails] = useState<Set<string>>(new Set());
  const [plannerTasks, setPlannerTasks] = useState<GraphPlannerTask[] | null>(null);
  const [selectedPlanner, setSelectedPlanner] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const timers = useRef<number[]>([]);

  const say = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    setMessage({ text, tone });
    timers.current.push(window.setTimeout(() => setMessage(null), 9000));
  }, []);

  useEffect(() => {
    return () => timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  const refresh = useCallback(async () => {
    const s = await graphStatus();
    setConfigured(Boolean(s.configured));
    setConnected(Boolean(s.connected));
    setAccount(s.account ?? null);
    if (s.connected) setPending(false);
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 6000);
    return () => window.clearInterval(t);
  }, [refresh]);

  // Mens login afventer: hent device-info og stop når tilsluttet
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(async () => {
      const [d, s] = await Promise.all([graphDevice(), graphStatus()]);
      if (d.device) setDevice(d.device);
      if (s.connected) {
        setConnected(true);
        setAccount(s.account ?? null);
        setPending(false);
        say(`Tilsluttet som ${s.account}.`);
      }
    }, 2000);
    return () => window.clearInterval(t);
  }, [pending, say]);

  const saveClientId = async () => {
    const trimmed = clientId.trim();
    localStorage.setItem(CLIENT_ID_KEY, trimmed);
    await companionSaveConfig({ graphClientId: trimmed });
    await refresh();
    say(trimmed ? 'Klient-id gemt.' : 'Klient-id fjernet.');
  };

  const connect = async () => {
    if (!clientId.trim()) {
      say('Indtast først dit Microsoft-klient-id (se vejledningen nedenfor).', 'error');
      return;
    }
    setBusy(true);
    try {
      await saveClientId();
      const r = await graphLogin();
      if (r.ok && r.connected) {
        setConnected(true);
        setAccount(r.account ?? null);
        say(`Tilsluttet som ${r.account}.`);
      } else if (r.ok && r.pending) {
        setPending(true);
        const d = await graphDevice();
        if (d.device) setDevice(d.device);
        say('Login startet – følg instruktionen på skærmen.');
      } else {
        say(r.reason ?? 'Login kunne ikke startes.', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const loadTodos = async () => {
    setBusy(true);
    try {
      const r = await graphTodos();
      if (r.ok && r.items) {
        setTodos(r.items);
        setSelected(new Set(r.items.map((i) => i.id)));
        if (r.items.length === 0) say('Ingen åbne opgaver fundet i Microsoft To Do.');
      } else {
        say(r.reason ?? 'Kunne ikke hente opgaver.', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const loadEvents = async () => {
    setBusy(true);
    try {
      const r = await graphEvents();
      if (r.ok && r.items) {
        setEvents(r.items);
      } else {
        say(r.reason ?? 'Kunne ikke hente møder.', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const loadMessages = async () => {
    setBusy(true);
    try {
      const r = await graphMessages();
      if (r.ok && r.items) {
        setMails(r.items);
        if (r.items.length === 0) say('Ingen mails fundet i indbakken.');
      } else {
        say(r.reason ?? 'Kunne ikke hente mails.', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const importMail = (mail: GraphMessage) => {
    const projectId = activeProjectId ?? projects[0]?.id;
    if (!projectId || importedMails.has(mail.id)) return;
    const title = mail.subject.replace(/^(?:(?:re|sv|fw):\s*)+/i, '').trim() || 'Mail uden emne';
    addTask({
      title,
      projectId,
      description: `Oprettet fra mail fra ${mail.from}.\n\n${mail.snippet}${mail.webLink ? `\n\nÅbn mail: ${mail.webLink}` : ''}`,
    });
    setImportedMails((prev) => new Set(prev).add(mail.id));
    say('Opgave oprettet fra mail.');
  };

  const loadPlanner = async () => {
    setBusy(true);
    try {
      const r = await graphPlannerTasks();
      if (r.ok && r.items) {
        setPlannerTasks(r.items);
        setSelectedPlanner(new Set(r.items.map((i) => i.id)));
        if (r.items.length === 0) say('Ingen Planner-opgaver fundet.');
      } else {
        say(r.reason ?? 'Kunne ikke hente Planner-opgaver.', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const togglePlanner = (id: string) => {
    setSelectedPlanner((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const importPlanner = () => {
    const projectId = activeProjectId ?? projects[0]?.id;
    if (!projectId) return;
    const items: ImportItem[] = (plannerTasks ?? [])
      .filter((t) => selectedPlanner.has(t.id))
      .map((t) => ({
        title: t.title,
        dueDate: t.dueDate,
        status: t.percentComplete === 100 ? 'done' : 'todo',
      }));
    if (items.length === 0) return;
    const created = importTasks(items, projectId);
    say(created > 0 ? `${created} opgaver importeret.` : 'Alle valgte opgaver findes allerede i Orbit.', created > 0 ? 'ok' : 'error');
  };

  const importSelected = () => {
    const projectId = activeProjectId ?? projects[0]?.id;
    if (!projectId) return;
    const chosen = (todos ?? []).filter((t) => selected.has(t.id));
    let created = 0;
    for (const item of chosen) {
      if (tasks.some((t) => t.title === item.title)) continue;
      addTask({
        title: item.title,
        projectId,
        status: 'todo',
        priority: item.importance === 'high' ? 'high' : item.importance === 'low' ? 'low' : 'medium',
        dueDate: item.dueDate,
      });
      created += 1;
    }
    say(created > 0 ? `${created} opgaver importeret til tavlen.` : 'Alle valgte opgaver findes allerede i Orbit.', created > 0 ? 'ok' : 'error');
  };

  const disconnect = async () => {
    await graphLogout();
    setConnected(false);
    setAccount(null);
    setTodos(null);
    setEvents(null);
    say('Frakoblet Microsoft 365.');
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 p-4 lg:p-6">
        {/* Forbindelsesstatus */}
        <section className="glass-panel animate-fade-in rounded-xl p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/10 text-sky-500 dark:bg-sky-400/10 dark:text-sky-300">
              <Mail className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Microsoft 365 / Outlook</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {connected
                  ? `Tilsluttet som ${account}`
                  : configured
                    ? 'Klargjort – tilslut med din Microsoft-konto'
                    : 'Kræver et gratis Microsoft-klient-id (2 min at oprette)'}
              </p>
            </div>
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                connected
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
              )}
            >
              {connected ? 'Tilsluttet' : 'Frakoblet'}
            </span>
          </div>

          {/* Klient-id */}
          <div className="mt-4">
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              <KeyRound className="h-3.5 w-3.5" />
              Microsoft-klient-id (Application ID)
            </label>
            <div className="flex gap-2">
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="input flex-1 py-1.5 font-mono text-xs"
              />
              <button onClick={() => void saveClientId()} className="btn-outline shrink-0 py-1.5 text-xs">
                Gem
              </button>
            </div>
            {!configured && (
              <div className="mt-2 rounded-lg bg-zinc-100 px-3 py-2 text-[11px] leading-relaxed text-zinc-600 dark:bg-white/[0.04] dark:text-zinc-400">
                <p className="mb-1 font-semibold text-zinc-700 dark:text-zinc-200">Sådan opretter du et klient-id (gratis, ca. 2 min):</p>
                <ol className="list-decimal space-y-0.5 pl-4">
                  <li>Gå til <span className="font-mono">portal.azure.com</span> → Microsoft Entra ID → App registrations → <em>New registration</em></li>
                  <li>Navn: "Orbit" · Kontotype: <em>Accounts in any organizational directory and personal Microsoft accounts</em></li>
                  <li>Efter oprettelse: <em>Authentication → Allow public client flows → Yes</em> (påkrævet til device code-login)</li>
                  <li>Kopiér <em>Application (client) ID</em> og sæt det ind ovenfor</li>
                </ol>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {!connected ? (
              <button onClick={() => void connect()} disabled={busy || pending} className="btn-primary">
                <CheckCircle2 className="h-4 w-4" />
                {pending ? 'Venter på godkendelse …' : 'Tilslut Microsoft 365'}
              </button>
            ) : (
              <>
                <button onClick={() => void loadTodos()} disabled={busy} className="btn-outline">
                  <ListTodo className="h-4 w-4" />
                  Hent To Do-opgaver
                </button>
                <button onClick={() => void loadEvents()} disabled={busy} className="btn-outline">
                  <CalendarClock className="h-4 w-4" />
                  Kommende møder (7 dage)
                </button>
                <button onClick={() => void disconnect()} className="btn-ghost text-rose-600 dark:text-rose-400">
                  <LogOut className="h-4 w-4" />
                  Frakobl
                </button>
              </>
            )}
          </div>

          {pending && device && (
            <div className="mt-4 animate-slide-up rounded-xl border border-indigo-500/30 bg-indigo-500/[0.06] p-4">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Afslut login hos Microsoft</p>
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-sm text-zinc-600 dark:text-zinc-300">
                <li>
                  Gå til{' '}
                  <a href={device.verificationUri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-indigo-500 hover:underline dark:text-indigo-300">
                    {device.verificationUri}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>
                  Indtast koden{' '}
                  <code className="rounded-lg bg-white px-2.5 py-1 font-mono text-base font-bold tracking-widest text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50">
                    {device.userCode}
                  </code>
                </li>
                <li>Godkend med din Microsoft-konto – Orbit tilsluttes automatisk.</li>
              </ol>
            </div>
          )}
          {message && (
            <p className={cn('mt-3 rounded-lg px-3 py-2 text-xs', message.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300')}>
              {message.text}
            </p>
          )}
        </section>

        {/* E-mail til opgave */}
        <section className="glass-panel animate-fade-in rounded-xl p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300">
              <MailPlus className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">E-mail til opgave</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {connected ? 'Opret opgaver direkte fra din indbakke' : 'Tilslut Microsoft 365 for at hente mails fra din indbakke'}
              </p>
            </div>
            <button onClick={() => void loadMessages()} disabled={busy || !connected} className="btn-outline shrink-0 text-xs">
              Hent seneste mails
            </button>
          </div>
          {message && (
            <p className={cn('mt-3 rounded-lg px-3 py-2 text-xs', message.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300')}>
              {message.text}
            </p>
          )}
          {mails && (
            <ul className="mt-3 divide-y divide-zinc-200/70 dark:divide-white/[0.05]">
              {mails.map((mail) => (
                <li key={mail.id} className={cn('flex items-center gap-3 py-2.5', importedMails.has(mail.id) && 'opacity-50')}>
                  <MailPlus className="h-4 w-4 shrink-0 text-zinc-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{mail.subject}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      fra {mail.from} · {formatDateShort(mail.received.slice(0, 10))}
                    </p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{mail.snippet}</p>
                  </div>
                  {importedMails.has(mail.id) ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      <Check className="h-3.5 w-3.5" />
                      Importeret
                    </span>
                  ) : (
                    <button onClick={() => importMail(mail)} className="btn-outline shrink-0 text-xs">
                      Opret opgave
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Microsoft Planner */}
        <section className="glass-panel animate-fade-in rounded-xl p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-300">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Microsoft Planner</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {connected ? 'Importer opgaver fra dine Planner-planer' : 'Tilslut Microsoft 365 for at importere Planner-opgaver'}
              </p>
            </div>
            <button onClick={() => void loadPlanner()} disabled={busy || !connected} className="btn-outline shrink-0 text-xs">
              Hent Planner-opgaver
            </button>
          </div>
          {message && (
            <p className={cn('mt-3 rounded-lg px-3 py-2 text-xs', message.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300')}>
              {message.text}
            </p>
          )}
          {plannerTasks && (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={importPlanner} disabled={selectedPlanner.size === 0} className="btn-primary py-1 text-xs">
                  Importér valgte ({selectedPlanner.size})
                </button>
              </div>
              {plannerTasks.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-400">Ingen Planner-opgaver fundet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-zinc-200/70 dark:divide-white/[0.05]">
                  {plannerTasks.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedPlanner.has(item.id)}
                        onChange={() => togglePlanner(item.id)}
                        className="h-4 w-4 rounded border-zinc-300 accent-indigo-500"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{item.title}</span>
                      {item.dueDate && (
                        <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{formatDate(item.dueDate)}</span>
                      )}
                      <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400">
                        {item.percentComplete}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {/* To Do-opgaver */}
        {todos && (
          <section className="glass-panel animate-slide-up rounded-xl p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Microsoft To Do · {todos.length} åbne opgaver
              </h3>
              <span className="flex-1" />
              <button onClick={importSelected} disabled={selected.size === 0} className="btn-primary py-1 text-xs">
                Importér valgte ({selected.size}) til tavlen
              </button>
            </div>
            {todos.length === 0 ? (
              <p className="text-sm text-zinc-400">Ingen åbne opgaver i Microsoft To Do.</p>
            ) : (
              <ul className="divide-y divide-zinc-200/70 dark:divide-white/[0.05]">
                {todos.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                      className="h-4 w-4 rounded border-zinc-300 accent-indigo-500"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{item.title}</span>
                    <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400">
                      {item.list}
                    </span>
                    {item.dueDate && (
                      <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{formatDate(item.dueDate)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Møder */}
        {events && (
          <section className="glass-panel animate-slide-up rounded-xl p-5">
            <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Kommende møder · de næste 7 dage
            </h3>
            {events.length === 0 ? (
              <p className="text-sm text-zinc-400">Ingen møder de kommende 7 dage.</p>
            ) : (
              <ul className="space-y-2">
                {events.map((ev) => (
                  <li key={ev.id} className="flex items-center gap-3 rounded-lg border border-zinc-200/70 px-3 py-2 dark:border-white/[0.06]">
                    <div className="grid h-9 w-14 shrink-0 place-items-center rounded-md bg-indigo-500/10 text-[11px] font-bold uppercase text-indigo-600 dark:text-indigo-300">
                      {ev.start ? formatDate(ev.start.slice(0, 10), 'EEE d.') : ''}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{ev.subject}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {ev.start ? ev.start.slice(11, 16) : ''}–{ev.end ? ev.end.slice(11, 16) : ''}
                        {ev.location ? ` · ${ev.location}` : ''}
                      </p>
                    </div>
                    {ev.isOnlineMeeting && ev.onlineMeetingUrl && (
                      <a
                        href={ev.onlineMeetingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-outline shrink-0 px-2 py-1 text-xs"
                      >
                        <Video className="h-3.5 w-3.5" />
                        Deltag
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

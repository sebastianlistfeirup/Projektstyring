import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  Paperclip,
  Play,
  Plus,
  Send,
  Square,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useLang, t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { companionStatus } from '../lib/companion';
import {
  fetchAiServices,
  saveAiPrefs,
  saveService,
  streamChat,
  streamOrchestrate,
  uploadAiFile,
  type AiServiceInfo,
} from '../lib/aiApi';
import type { AiAttachment, AiChat, AiMessage } from '../lib/types';

const BASE_URL = 'http://127.0.0.1:4310';

/* ---------- lille markdown-renderer (fed, kode, lister) ---------- */

function RichText({ text }: { text: string }) {
  const blocks = text.split(/```(\w*)\n?([\s\S]*?)(?:```|$)/g);
  const out: React.ReactNode[] = [];
  // split giver [før, sprog, kode, efter, sprog, kode, ...]
  for (let i = 0; i < blocks.length; i++) {
    if (i % 3 === 1) continue;
    if (i % 3 === 2) {
      out.push(
        <pre key={i} className="my-2 overflow-x-auto rounded-xl bg-black/60 dark:bg-black/40 p-3 text-[12px] text-emerald-200 font-mono whitespace-pre-wrap">
          {blocks[i]}
        </pre>,
      );
      continue;
    }
    const parts = blocks[i].split('\n');
    parts.forEach((line, li) => {
      const idx = i * 1000 + li;
      const formatted = formatInline(line);
      if (/^\s*[-•]\s+/.test(line)) {
        out.push(<div key={idx} className="pl-4 flex gap-2"><span>•</span><span>{formatted}</span></div>);
      } else if (/^\s*\d+\.\s+/.test(line)) {
        out.push(<div key={idx} className="pl-4 flex gap-2"><span>{line.trim().match(/^\d+/)?.[0]}.</span><span>{formatted}</span></div>);
      } else if (line.trim() === '') {
        out.push(<div key={idx} className="h-2" />);
      } else {
        out.push(<div key={idx}>{formatted}</div>);
      }
    });
  }
  return <div className="whitespace-pre-wrap break-words">{out}</div>;
}

function formatInline(line: string): React.ReactNode {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="rounded bg-black/50 dark:bg-white/10 px-1 py-0.5 text-[12px] font-mono">{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}

/* ---------- vedhæftninger / artefakter ---------- */

function AttachmentChip({ a, onRemove }: { a: AiAttachment; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 dark:bg-white/5 px-2 py-1 text-[11px]">
      {a.kind === 'image' && a.dataUrl ? (
        <img src={a.dataUrl} alt={a.name} className="h-8 w-8 rounded object-cover" />
      ) : (
        <FileText size={12} />
      )}
      <span className="max-w-[140px] truncate">{a.name}</span>
      {onRemove && (
        <button onClick={onRemove} className="opacity-50 hover:opacity-100" aria-label="Fjern">
          <X size={11} />
        </button>
      )}
    </span>
  );
}

function ArtifactCard({ a }: { a: AiAttachment }) {
  const url = a.url?.startsWith('/') ? `${BASE_URL}${a.url}` : a.url;
  if (a.kind === 'image' && url) {
    return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={a.name} className="max-h-64 rounded-xl border border-white/10" /></a>;
  }
  if (a.mime === 'audio/mpeg' && url) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/20 dark:bg-white/5 p-2 flex items-center gap-2">
        <span className="text-[11px] max-w-[160px] truncate">{a.name}</span>
        <audio controls src={url} className="h-8" />
      </div>
    );
  }
  if (a.mime === 'model/gltf-binary' && url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-teal-400/30 bg-teal-400/10 px-3 py-2 text-[12px] hover:bg-teal-400/20">
        <Download size={13} /> {a.name} (GLB)
      </a>
    );
  }
  if (url && a.mime === 'video/mp4') {
    return <video controls src={url} className="max-h-64 rounded-xl border border-white/10" />;
  }
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 dark:bg-white/5 px-3 py-2 text-[12px] hover:bg-white/10">
      <Download size={13} /> {a.name}
    </a>
  ) : null;
}

const AVATAR_GRADIENT: Record<string, string> = {
  emerald: 'from-emerald-400 to-emerald-600',
  amber: 'from-amber-400 to-amber-600',
  indigo: 'from-indigo-400 to-indigo-600',
  sky: 'from-sky-400 to-sky-600',
  slate: 'from-slate-400 to-slate-600',
  teal: 'from-teal-400 to-teal-600',
  rose: 'from-rose-400 to-rose-600',
  violet: 'from-violet-400 to-violet-600',
  cyan: 'from-cyan-400 to-cyan-600',
  orange: 'from-orange-400 to-orange-600',
};

/* ---------- besked ---------- */

function MessageBubble({ m, color }: { m: AiMessage; color?: string }) {
  const [copied, setCopied] = useState(false);
  const isUser = m.role === 'user';
  const copy = async () => {
    try { await navigator.clipboard.writeText(m.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
  };
  return (
    <div className={cn('flex gap-2.5', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white shadow',
          isUser ? 'bg-gradient-to-br from-slate-500 to-slate-700' : color ? AVATAR_GRADIENT[color] ?? 'bg-gradient-to-br from-indigo-400 to-violet-600' : 'bg-gradient-to-br from-indigo-400 to-violet-600',
        )}
      >
        {isUser ? 'Du' : 'AI'}
      </div>
      <div className={cn('max-w-[82%] min-w-0', isUser && 'flex flex-col items-end')}>
        {(m.attachments?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5">{(m.attachments ?? []).map((a, i) => <AttachmentChip key={i} a={a} />)}</div>
        )}
        {m.text && (
          <div
            className={cn(
              'rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed',
              isUser
                ? 'bg-indigo-500/90 text-white rounded-tr-sm'
                : 'glass-panel rounded-tl-sm',
            )}
          >
            {isUser ? <span className="whitespace-pre-wrap break-words">{m.text}</span> : <RichText text={m.text} />}
            {m.status === 'streaming' && <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-current animate-pulse rounded-sm" />}
          </div>
        )}
        {(m.artifacts?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2 mt-1.5">{(m.artifacts ?? []).map((a, i) => <ArtifactCard key={i} a={a} />)}</div>
        )}
        {!isUser && m.status === 'done' && m.text && (
          <button onClick={copy} className="mt-1 inline-flex items-center gap-1 text-[10px] opacity-40 hover:opacity-80 transition">
            {copied ? <Check size={10} /> : <Copy size={10} />} {copied ? t('chat.copied') : t('chat.copy')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- tilslutningspanel ---------- */

const KIND_LABEL: Record<string, string> = {
  cli: 'chat.kind.cli',
  local: 'chat.kind.local',
  'sub-api': 'chat.kind.subapi',
  'paid-api': 'chat.kind.paidapi',
  manual: 'chat.kind.manual',
};

function ServiceRow({ s, onChanged }: { s: AiServiceInfo; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [model, setModel] = useState(s.model ?? '');
  const needsKey = s.kind === 'sub-api' || s.kind === 'paid-api';
  return (
    <div className="rounded-xl border border-white/10 bg-black/10 dark:bg-white/5 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-white/5 transition">
        <span className={cn('w-2 h-2 rounded-full shrink-0', s.available ? 'bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,.5)]' : 'bg-slate-500/60')} />
        <span className="text-[12px] font-medium flex-1 truncate">{s.name}</span>
        <span className={cn(
          'text-[9px] px-1.5 py-0.5 rounded-full border',
          s.kind === 'cli' || s.kind === 'local' ? 'border-emerald-400/30 text-emerald-300' :
          s.kind === 'sub-api' ? 'border-sky-400/30 text-sky-300' :
          s.kind === 'paid-api' ? 'border-amber-400/30 text-amber-300' : 'border-slate-400/30 text-slate-400',
        )}>
          {t(KIND_LABEL[s.kind])}
        </span>
      </button>
      {s.reason && <div className="px-2.5 pb-1.5 text-[10px] opacity-50 leading-snug">{s.reason}</div>}
      {open && (needsKey || s.kind === 'cli' || s.kind === 'local') && (
        <div className="px-2.5 pb-2.5 pt-1 space-y-1.5 border-t border-white/5">
          <label className="flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={async (e) => { await saveService(s.id, { enabled: e.target.checked }); onChanged(); }}
              className="accent-indigo-500"
            />
            {t('chat.enabled')}
          </label>
          {needsKey && (
            <>
              <div className="flex gap-1.5">
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={s.keyMask ? `${t('chat.apiKey')} (${s.keyMask})` : t('chat.apiKey')}
                  className="flex-1 min-w-0 rounded-lg bg-black/20 dark:bg-black/30 border border-white/10 px-2 py-1 text-[11px] outline-none focus:border-indigo-400/60"
                />
                <button
                  onClick={async () => { if (key.trim()) { await saveService(s.id, { apiKey: key.trim(), model: model || undefined }); setKey(''); } onChanged(); }}
                  className="rounded-lg bg-indigo-500/80 hover:bg-indigo-500 px-2 py-1 text-[11px] text-white transition"
                >
                  {t('chat.save')}
                </button>
              </div>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={t('chat.model')}
                className="w-full rounded-lg bg-black/20 dark:bg-black/30 border border-white/10 px-2 py-1 text-[11px] outline-none focus:border-indigo-400/60"
              />
            </>
          )}
          {s.kind === 'cli' && (
            <div className="text-[10px] opacity-60">
              {t('chat.cliDetected')}: <code className="font-mono">{s.cmd}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectionPanel({ services, prefs, onChanged }: {
  services: Record<string, AiServiceInfo> | null;
  prefs: { allowPaidApis: boolean; orchestrator: string } | null;
  onChanged: () => void;
}) {
  const list = useMemo(() => (services ? Object.values(services) : []), [services]);
  const cliIds = list.filter((s) => (s.kind === 'cli' || s.kind === 'local') && s.available).map((s) => s.id);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider opacity-60">{t('chat.connections')}</h3>
        <button onClick={onChanged} className="text-[10px] opacity-40 hover:opacity-80" title={t('chat.refresh')}><Loader2 size={11} /></button>
      </div>
      {prefs && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-2 space-y-1.5 mb-1">
          <label className="flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={prefs.allowPaidApis}
              onChange={async (e) => { await saveAiPrefs({ allowPaidApis: e.target.checked }); onChanged(); }}
              className="accent-amber-500"
            />
            <span className="text-amber-300">{t('chat.allowPaid')}</span>
          </label>
          <p className="text-[10px] opacity-50 leading-snug">{t('chat.allowPaidHint')}</p>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="opacity-60 shrink-0">{t('chat.orchestrator')}:</span>
            <select
              value={prefs.orchestrator}
              onChange={async (e) => { await saveAiPrefs({ orchestrator: e.target.value }); onChanged(); }}
              className="flex-1 min-w-0 rounded-lg bg-black/20 dark:bg-black/30 border border-white/10 px-1.5 py-0.5 text-[11px] outline-none"
            >
              {cliIds.map((id) => <option key={id} value={id}>{services?.[id]?.name ?? id}</option>)}
            </select>
          </div>
        </div>
      )}
      {list.map((s) => <ServiceRow key={s.id} s={s} onChanged={onChanged} />)}
    </div>
  );
}

/* ---------- hovedvisning ---------- */

export function AiChatView() {
  useLang();
  const projects = useStore((s) => s.projects);
  const aiChats = useStore((s) => s.aiChats);
  const addAiChat = useStore((s) => s.addAiChat);
  const deleteAiChat = useStore((s) => s.deleteAiChat);
  const addAiMessage = useStore((s) => s.addAiMessage);
  const updateAiMessage = useStore((s) => s.updateAiMessage);
  const bibles = useStore((s) => s.bibles);
  const setBible = useStore((s) => s.setBible);

  const [chatId, setChatId] = useState<string | null>(null);
  const [newProjectId, setNewProjectId] = useState<string>('p-game');
  const [services, setServices] = useState<Record<string, AiServiceInfo> | null>(null);
  const [prefs, setPrefs] = useState<{ allowPaidApis: boolean; orchestrator: string } | null>(null);
  const [companionOk, setCompanionOk] = useState<boolean | null>(null);
  const [service, setService] = useState<string>('auto');
  const [text, setText] = useState('');
  const [pending, setPending] = useState<AiAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [bibleOpen, setBibleOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const chat = aiChats.find((c) => c.id === chatId) ?? null;
  const chatProject = projects.find((p) => p.id === chat?.projectId) ?? null;
  const bible = chat?.projectId ? bibles[chat.projectId] ?? '' : '';

  const refresh = useCallback(async () => {
    const ok = await companionStatus();
    setCompanionOk(Boolean(ok?.ok));
    const svc = await fetchAiServices();
    setServices(svc?.services ?? null);
    setPrefs(svc?.prefs ?? null);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 12000); return () => clearInterval(id); }, [refresh]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat?.messages.length, running]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setUploading(true);
    for (const f of Array.from(files)) {
      const up = await uploadAiFile(f);
      if (up) setPending((p) => [...p, up]);
    }
    setUploading(false);
  }, []);

  const onPaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const files = items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean) as File[];
    if (files.length) { e.preventDefault(); await addFiles(files); }
  }, [addFiles]);

  const send = useCallback(async () => {
    const body = text.trim();
    if ((!body && pending.length === 0) || running || !chat) return;
    setText('');
    const atts = pending.map(({ dataUrl: _d, ...rest }) => rest); // undgå store dataUrls i localStorage
    setPending([]);
    addAiMessage(chat.id, { role: 'user', text: body, attachments: atts, status: 'done' });
    if (aiChats.find((c) => c.id === chat.id)?.title === t('chat.untitled') && body) {
      useStore.setState((s) => ({ aiChats: s.aiChats.map((c) => (c.id === chat.id ? { ...c, title: body.slice(0, 48) } : c)) }));
    }

    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);

    if (service === 'auto') {
      const msg = addAiMessage(chat.id, { role: 'assistant', text: `**${t('chat.planning')}**\n\n`, status: 'streaming' });
      const msgText = () => (useStore.getState().aiChats.find((c) => c.id === chat.id)?.messages ?? []).find((x) => x.id === msg.id)?.text ?? '';
      const jobText: Record<string, string> = {};
      await streamOrchestrate(
        { goal: body, bible: bible || undefined },
        {
          onEvent: (evt) => {
            let out = msgText();
            if (evt.type === 'orchestrator') {
              out += `${t('chat.orchestratorLine')}: ${evt.serviceId ? services?.[String(evt.serviceId)]?.name ?? String(evt.serviceId) : t('chat.ruleBased')} (${evt.mode === 'llm' ? 'LLM' : t('chat.rules')})\n\n`;
            } else if (evt.type === 'plan') {
              const jobs = evt.jobs as { id: string; title: string; serviceId: string | null; phase: string; description: string }[];
              out += `**${t('chat.plannedJobs')}**\n`;
              jobs.forEach((j, i) => { out += `${i + 1}. [${j.phase}] **${j.title}** — ${j.serviceId ? services?.[j.serviceId]?.name ?? j.serviceId : '?'}\n`; });
              out += '\n';
            } else if (evt.type === 'job_start') {
              const j = evt.job as { id: string; title: string };
              out += `▶ **${j.title}** …\n`;
            } else if (evt.type === 'job_delta') {
              const d = String(evt.delta ?? '');
              jobText[String(evt.jobId)] = (jobText[String(evt.jobId)] ?? '') + d;
            } else if (evt.type === 'job_status' || evt.type === 'job_note') {
              out += `   _${String(evt.status ?? evt.note ?? '')}_\n`;
            } else if (evt.type === 'job_done') {
              const r = evt.result as { title: string; text: string; artifacts?: AiAttachment[] };
              out = out.replace(`▶ **${r.title}** …\n`, `✅ **${r.title}**\n\n`);
              out += `${r.text.slice(0, 6000)}\n\n`;
              if (r.artifacts?.length) {
                const cur = (useStore.getState().aiChats.find((c) => c.id === chat.id)?.messages ?? []).find((x) => x.id === msg.id);
                updateAiMessage(chat.id, msg.id, { artifacts: [...(cur?.artifacts ?? []), ...r.artifacts] });
              }
            } else if (evt.type === 'job_error') {
              out += `⚠️ ${t('chat.jobFailed')}: ${String(evt.error ?? '')}\n`;
            } else if (evt.type === 'done') {
              const sum = (evt.summary as { title: string }[] | undefined) ?? [];
              out += `**${t('chat.runFinished')}** — ${sum.length} ${t('chat.jobsDelivered')}\n`;
            }
            updateAiMessage(chat.id, msg.id, { text: out });
          },
          onError: (e) => updateAiMessage(chat.id, msg.id, { text: `${msgText()}\n\n⚠️ ${e}`, status: 'error' }),
        },
        ac.signal,
      );
      updateAiMessage(chat.id, msg.id, { status: 'done' });
    } else {
      const msg = addAiMessage(chat.id, { role: 'assistant', text: '', serviceId: service, status: 'streaming' });
      const history = (useStore.getState().aiChats.find((c) => c.id === chat.id)?.messages ?? [])
        .filter((m) => m.id !== msg.id && m.status === 'done')
        .slice(-12)
        .map((m) => ({ role: m.role, text: m.text, attachments: m.attachments }));
      let acc = '';
      await streamChat(
        service,
        [...history, { role: 'user' as const, text: body, attachments: atts }],
        {
          onDelta: (_d, full) => { acc = full; updateAiMessage(chat.id, msg.id, { text: full }); },
          onDone: () => updateAiMessage(chat.id, msg.id, { status: 'done' }),
          onError: (e) => updateAiMessage(chat.id, msg.id, { text: acc ? `${acc}\n\n⚠️ ${e}` : `⚠️ ${e}`, status: 'error' }),
        },
        ac.signal,
      );
    }
    setRunning(false);
    abortRef.current = null;
    textareaRef.current?.focus();
  }, [text, pending, running, chat, service, services, bible, aiChats, addAiMessage, updateAiMessage]);

  const availableCount = useMemo(() => (services ? Object.values(services).filter((s) => s.available).length : 0), [services]);

  return (
    <div className="flex h-full gap-4 p-4 md:p-6 max-w-[1500px] mx-auto">
      {/* venstre: samtaler + tilslutning */}
      <aside className="w-64 shrink-0 hidden lg:flex flex-col gap-3 overflow-y-auto pr-1">
        <div className="flex items-center gap-1.5">
          <select
            value={newProjectId}
            onChange={(e) => setNewProjectId(e.target.value)}
            className="flex-1 min-w-0 rounded-xl glass-panel px-2 py-1.5 text-[12px] bg-transparent outline-none"
          >
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            onClick={() => { const c = addAiChat({ projectId: newProjectId, title: t('chat.untitled') }); setChatId(c.id); }}
            className="rounded-xl btn-primary px-2.5 py-1.5 text-[12px] flex items-center gap-1"
          >
            <Plus size={13} /> {t('chat.newChat')}
          </button>
        </div>
        <div className="space-y-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider opacity-60 px-1">{t('chat.chats')}</h3>
          {aiChats.length === 0 && <p className="text-[11px] opacity-40 px-1">{t('chat.noChats')}</p>}
          {aiChats.map((c: AiChat) => (
            <div key={c.id} className={cn('group flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer transition', c.id === chatId ? 'bg-indigo-500/20 border border-indigo-400/30' : 'hover:bg-white/5 border border-transparent')}>
              <div className="flex-1 min-w-0" onClick={() => setChatId(c.id)}>
                <div className="text-[12px] truncate">{c.title}</div>
                <div className="text-[10px] opacity-40 truncate">{projects.find((p) => p.id === c.projectId)?.name ?? '—'}</div>
              </div>
              <button onClick={() => { deleteAiChat(c.id); if (chatId === c.id) setChatId(null); }} className="opacity-0 group-hover:opacity-40 hover:opacity-100 transition shrink-0">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex-1" />
        <ConnectionPanel services={services} prefs={prefs} onChanged={refresh} />
      </aside>

      {/* hoved: beskeder + komponist */}
      <main className="flex-1 min-w-0 flex flex-col gap-3">
        {companionOk === false && (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-[13px]">
            <div className="flex items-center gap-2 font-semibold text-amber-300"><WifiOff size={15} /> {t('chat.noCompanion')}</div>
            <p className="mt-1 opacity-70 leading-relaxed">{t('chat.noCompanionHint')}</p>
          </div>
        )}
        {companionOk === true && (
          <div className="flex items-center gap-2 text-[11px] text-emerald-400">
            <Wifi size={12} /> {t('chat.online')} · {availableCount} {t('chat.servicesReady')}
          </div>
        )}

        {!chat ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-xl shadow-indigo-500/30">
              <Send size={26} />
            </div>
            <h2 className="text-xl font-bold">{t('chat.emptyTitle')}</h2>
            <p className="text-[13px] opacity-60 max-w-sm leading-relaxed">{t('chat.emptyHint')}</p>
            <button
              onClick={() => { const c = addAiChat({ projectId: newProjectId, title: t('chat.untitled') }); setChatId(c.id); }}
              className="btn-primary rounded-xl px-4 py-2 text-[13px] flex items-center gap-1.5"
            >
              <Plus size={14} /> {t('chat.newChat')}
            </button>
          </div>
        ) : (
          <>
            {/* bibel-bar */}
            {chat.projectId && (
              <div className="rounded-2xl border border-white/10 bg-black/10 dark:bg-white/5 overflow-hidden">
                <button onClick={() => setBibleOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition">
                  <BookOpen size={13} className="opacity-60" />
                  <span className="text-[12px] font-medium flex-1">{t('chat.bible')}: {chatProject?.name ?? ''}</span>
                  <span className="text-[10px] opacity-40">{bible ? `${bible.length} ${t('chat.chars')}` : t('chat.bibleEmpty')}</span>
                </button>
                {bibleOpen && (
                  <div className="px-3 pb-3">
                    <textarea
                      value={bible}
                      onChange={(e) => setBible(chat.projectId!, e.target.value)}
                      placeholder={t('chat.biblePlaceholder')}
                      rows={4}
                      className="w-full rounded-xl bg-black/20 dark:bg-black/30 border border-white/10 px-3 py-2 text-[12px] outline-none focus:border-indigo-400/60 resize-y"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/5 dark:bg-black/20 p-4 space-y-4 min-h-[300px]">
              {chat.messages.length === 0 && (
                <div className="h-full flex items-center justify-center text-center text-[12px] opacity-40 px-8">{t('chat.firstMessage')}</div>
              )}
              {chat.messages.map((m) => (
                <MessageBubble key={m.id} m={m} color={m.serviceId ? services?.[m.serviceId]?.color : undefined} />
              ))}
              <div ref={bottomRef} />
            </div>

            {/* komponist */}
            <div
              className={cn('rounded-2xl border transition', dragOver ? 'border-indigo-400/70 bg-indigo-500/10' : 'border-white/10 glass-panel')}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            >
              {pending.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                  {pending.map((a, i) => <AttachmentChip key={i} a={a} onRemove={() => setPending((p) => p.filter((_, j) => j !== i))} />)}
                </div>
              )}
              <div className="flex items-end gap-2 p-2.5">
                <button onClick={() => fileInputRef.current?.click()} className="p-2 rounded-xl hover:bg-white/10 opacity-70 hover:opacity-100 transition shrink-0" title={t('chat.attach')}>
                  <Paperclip size={16} />
                </button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onPaste={onPaste}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  rows={Math.min(6, Math.max(1, text.split('\n').length))}
                  placeholder={t('chat.placeholder')}
                  className="flex-1 min-w-0 bg-transparent outline-none resize-none text-[13px] py-2 placeholder:opacity-40"
                />
                <select
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  className="rounded-xl bg-black/20 dark:bg-black/30 border border-white/10 px-2 py-2 text-[12px] outline-none shrink-0 max-w-[130px]"
                >
                  <option value="auto">⚡ {t('chat.serviceAuto')}</option>
                  {Object.values(services ?? {}).filter((s) => s.available).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {running ? (
                  <button onClick={() => abortRef.current?.abort()} className="p-2.5 rounded-xl bg-rose-500/80 hover:bg-rose-500 text-white transition shrink-0" title={t('chat.stop')}>
                    <Square size={15} />
                  </button>
                ) : (
                  <button
                    onClick={send}
                    disabled={(!text.trim() && pending.length === 0) || (service !== 'auto' && !services?.[service]?.available)}
                    className={cn('p-2.5 rounded-xl text-white transition shrink-0', service === 'auto' ? 'bg-gradient-to-br from-indigo-500 to-violet-600 hover:opacity-90 shadow-lg shadow-indigo-500/30' : 'bg-slate-600 hover:bg-slate-500', 'disabled:opacity-30')}
                    title={service === 'auto' ? t('chat.runHint') : t('chat.send')}
                  >
                    {service === 'auto' ? <Play size={15} /> : <ArrowUp size={15} />}
                  </button>
                )}
              </div>
              <div className="px-3 pb-2 text-[10px] opacity-35 flex items-center gap-1.5">
                {uploading ? <Loader2 size={10} className="animate-spin" /> : null}
                {t('chat.composerHint')}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

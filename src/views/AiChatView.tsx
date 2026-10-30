import ChatMarkdown from '../components/ChatMarkdown';
import AttachmentPreview from '../components/AttachmentPreview';
import { useChatDraft } from '../lib/useChatDraft';
import ProjectScopePanel from '../components/ProjectScopePanel';
import { workLimitReason } from '../lib/workLimits';
import { useSwarm } from '../lib/swarm';
import OrbitRunPanel from '../components/OrbitRunPanel';
import ProjectExecutionSettings from '../components/ProjectExecutionSettings';
import CreateProjectChat from '../components/CreateProjectChat';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  Bookmark,
  Check,
  ClipboardList,
  Copy,
  Download,
  Gavel,
  Loader2,
  Paperclip,
  Play,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useSearchParams } from 'react-router-dom';
import { useLang, t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { companionStatus } from '../lib/companion';
import {
  deletePrompt,
  fetchAiServices,
  fetchAttachmentText,
  fetchTemplates,
  fetchPrompts,
  saveAiPrefs,
  savePrompt,
  saveService,
  streamChat,
  cancelRun,
  sendRunMessage,
  streamOrchestrate,
  suggestTemplate,
  uploadAiFile,
  type AiPrompt,
  type AiServiceInfo,
} from '../lib/aiApi';
import type { AiAttachment, AiChat, AiMessage } from '../lib/types';
import { pushNow } from '../lib/sync';

const BASE_URL = 'http://127.0.0.1:4310';

/* ---------- vedhæftninger / artefakter ---------- */

function AttachmentChip({ a, onRemove }: { a: AiAttachment; onRemove?: () => void }) {
  return <AttachmentPreview attachment={a} onRemove={onRemove} />;
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
            {isUser ? <span className="whitespace-pre-wrap break-words">{m.text}</span> : <ChatMarkdown text={m.text} />}
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

function ServiceRow({ s, onChanged }: { s: AiServiceInfo; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [model, setModel] = useState(s.model ?? '');
  const [baseUrl, setBaseUrl] = useState('');
  const [command, setCommand] = useState(s.cmd ?? '');
  const [cliTemplate, setCliTemplate] = useState(s.cliTemplate ?? '');
  const [checkingCli, setCheckingCli] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [keyFeedback, setKeyFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const needsKey = s.kind === 'sub-api' || s.kind === 'paid-api';
  const saveApiKey = async () => {
    const value = key.trim();
    if (!value || savingKey) return;
    setSavingKey(true);
    setKeyFeedback(null);
    const result = await saveService(s.id, { apiKey: value, model: model || undefined });
    if (result.ok && result.hasKey) {
      setKey('');
      setKeyFeedback({ ok: true, text: 'API-nøglen er gemt og bekræftet.' });
    } else {
      // Behold nøglen i feltet ved fejl, så brugeren ikke skal indtaste den igen.
      setKeyFeedback({ ok: false, text: result.reason ?? 'Nøglen blev ikke gemt. Prøv igen.' });
    }
    setSavingKey(false);
    onChanged();
  };
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
          {s.billing?.mode === 'local' ? 'Lokal' : s.billing?.allowed ? 'Inkluderet · bekræftet af dig' : 'Adgang skal afklares'}
        </span>
      </button>
      {s.reason && <div className="px-2.5 pb-1.5 text-[10px] opacity-50 leading-snug">{s.reason}</div>}
      {open && s.capabilities && <p className="px-2.5 pb-2 text-[10px] opacity-65">{s.capabilities.repository ? 'Adapter: repository, kommandoer, MCP og livehændelser.' : s.capabilities.produces ? `Adapter: ${s.capabilities.produces === 'model3d' ? '3D-modeller' : s.capabilities.produces === 'audio' ? 'lyd' : 'video'}.` : 'Adapter: tekst og analyse. Kan ikke selv ændre projektfiler.'}{s.customTemplate ? ' Egen CLI-skabelon: native flag og liveformat tilføjes ikke automatisk.' : ''}</p>}
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
          {(s.kind !== 'local' || s.billing?.mode !== 'local') && (
            <label className="flex items-start gap-2 text-[11px] leading-relaxed">
              <input type="checkbox" className="mt-1 accent-indigo-500"
                checked={s.billing?.allowed === true}
                onChange={async e => {
                  const checked = e.target.checked;
                  const result = await saveService(s.id, { billingMode: checked ? 'included' : 'unknown', noExtraCharges: checked });
                  setKeyFeedback({ ok: result.ok, text: result.ok ? 'Betalingsvalg gemt. Dette er din bekræftelse, ikke en måling af resterende kvote.' : result.reason ?? 'Kunne ikke gemme.' });
                  onChanged();
                }} />
              Jeg har kontrolleret, at denne adgang bruger inkluderet abonnementsforbrug, og at ekstraforbrug er slået fra hos leverandøren.
            </label>
          )}
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
                  onClick={saveApiKey}
                  disabled={savingKey || !key.trim()}
                  className="rounded-lg bg-indigo-500/80 hover:bg-indigo-500 disabled:opacity-50 px-2 py-1 text-[11px] text-white transition"
                >
                  {savingKey ? 'Gemmer…' : t('chat.save')}
                </button>
              </div>
              {keyFeedback && (
                <div className={cn('text-[10px] leading-snug', keyFeedback.ok ? 'text-emerald-300' : 'text-rose-300')} role="status">
                  {keyFeedback.text}
                </div>
              )}
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={t('chat.model')}
                className="w-full rounded-lg bg-black/20 dark:bg-black/30 border border-white/10 px-2 py-1 text-[11px] outline-none focus:border-indigo-400/60"
              />
            </>
          )}
          {s.id === 'heygen' && <div className="space-y-2">
            <label className="block text-[11px]">Avatar-id<input className="input w-full" defaultValue={s.avatarId ?? ''} onBlur={async e => { await saveService(s.id, { avatarId: e.target.value.trim() }); onChanged(); }} /></label>
            <label className="block text-[11px]">Stemme-id<input className="input w-full" defaultValue={s.voiceId ?? ''} onBlur={async e => { await saveService(s.id, { voiceId: e.target.value.trim() }); onChanged(); }} /></label>
          </div>}
          {s.kind === 'cli' && <div className="space-y-2 text-[11px]">
            <p className="opacity-70">Log ind med leverandørens eget værktøj på denne maskine. Orbit genbruger den lokale opsætning.</p>
            <button className="btn-ghost text-xs" disabled={checkingCli} onClick={async () => {
              setCheckingCli(true);
              try {
                const result = await (await fetch(`${BASE_URL}/api/ai/services/${s.id}/inspect`, { method: 'POST' })).json();
                setKeyFeedback({ ok: result.ok, text: result.ok ? result.installation.note : result.reason });
                onChanged();
              } catch { setKeyFeedback({ ok: false, text: 'Companion svarer ikke.' }); }
              finally { setCheckingCli(false); }
            }}>{checkingCli ? 'Kontrollerer…' : 'Kontrollér installation'}</button>
            {s.installation && <p className="break-words opacity-70">{s.installation.version} · kontrolleret {new Date(s.installation.checkedAt).toLocaleDateString()}</p>}
            <details><summary className="cursor-pointer opacity-70">Program og model</summary><div className="mt-2 space-y-2">
              <label className="block">Program eller fuld sti<input aria-label={`${s.name} program`} className="input w-full" value={command} onChange={e => setCommand(e.target.value)} /></label>
              <label className="block">Valgfri model<input aria-label={`${s.name} model`} className="input w-full" value={model} onChange={e => setModel(e.target.value)} placeholder="Brug CLI-værktøjets standard" /></label>
              <label className="block">Egen argumentskabelon<input aria-label={`${s.name} argumentskabelon`} className="input w-full font-mono" value={cliTemplate} onChange={e => setCliTemplate(e.target.value)} placeholder="Tomt felt bruger Orbits adapter" /></label>
              <p className="opacity-60">En egen skabelon skal indeholde {'{prompt}'}. Den overtager selv tilladelser og outputformat. Brug standardadapteren, når det er muligt.</p>
              <button className="btn-primary text-xs" onClick={async () => {
                const result = await saveService(s.id, { cmd: command.trim(), model: model.trim() || null, cliTemplate });
                setKeyFeedback({ ok: result.ok, text: result.ok ? 'CLI-opsætning gemt.' : result.reason ?? 'Kunne ikke gemme.' }); onChanged();
              }}>Gem CLI-opsætning</button>
            </div></details>
            {keyFeedback && <p role="status" className={keyFeedback.ok ? 'text-emerald-400' : 'text-rose-400'}>{keyFeedback.text}</p>}
          </div>}
          {s.kind === 'local' && (
            <>
              <div className="flex gap-1.5">
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://127.0.0.1:11434"
                  className="flex-1 min-w-0 rounded-lg bg-black/20 dark:bg-black/30 border border-white/10 px-2 py-1 text-[11px] outline-none focus:border-indigo-400/60 font-mono"
                />
                <button
                  onClick={async () => { if (baseUrl.trim()) { await saveService(s.id, { baseUrl: baseUrl.trim() }); setBaseUrl(''); } onChanged(); }}
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
              <button
                onClick={async () => { await saveService(s.id, { model: model || undefined }); onChanged(); }}
                className="rounded-lg bg-white/10 hover:bg-white/15 px-2 py-1 text-[10px] transition"
              >
                {t('chat.save')} · {t('chat.model')}
              </button>
              {s.models && s.models.length > 0 && (
                <div className="text-[10px] opacity-60 leading-snug">
                  Ollama-modeller: <code className="font-mono">{s.models.join(', ')}</code>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectionPanel({ services, prefs, onChanged }: {
  services: Record<string, AiServiceInfo> | null;
  prefs: { allowPaidApis: boolean; orchestrator: string; autoJudge?: boolean; selfHeal?: boolean; minimumReviewScore?: number } | null;
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
          <p className="text-[11px] font-semibold">Kun inkluderet forbrug</p>
          <p className="text-[10px] opacity-70">Ingen automatisk ekstra betaling. Bekræft adgang og betalingsgrænser for hver tjeneste. Kvoter kontrolleres hos leverandøren.</p>
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
          <label className="flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={prefs.autoJudge !== false}
              onChange={async (e) => { await saveAiPrefs({ autoJudge: e.target.checked }); onChanged(); }}
              className="accent-emerald-500"
            />
            <span className="text-emerald-300 flex items-center gap-1"><Gavel size={11} /> {t('chat.autoJudge')}</span>
          </label>
          <p className="text-[10px] opacity-50 leading-snug">{t('chat.autoJudgeHint')}</p>
          {prefs.autoJudge !== false && <label className="flex items-center gap-2 text-[11px]"><span>Minimumscore</span><select aria-label="Minimumscore for review" className="input text-xs" value={prefs.minimumReviewScore ?? 8} onChange={async e => { await saveAiPrefs({ minimumReviewScore: Number(e.target.value) }); onChanged(); }}>{[6, 7, 8, 9, 10].map(score => <option key={score} value={score}>{score}/10</option>)}</select></label>}
          <label className="flex items-start gap-2 text-[11px]"><input type="checkbox" className="mt-0.5 accent-indigo-500" checked={prefs.selfHeal !== false} onChange={async e => { await saveAiPrefs({ selfHeal: e.target.checked }); onChanged(); }} /><span>Afgrænsede rettelsesforsøg</span></label>
          <p className="text-[10px] opacity-50 leading-snug">Højst ét genforsøg ved en agentfejl og én rettelse efter en faktisk testfejl. Testresultater bevares. Der tilkøbes ikke ekstra forbrug.</p>
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
  const tasks = useStore(s => s.tasks);
  const [search, setSearch] = useSearchParams();
  const chatId = search.get('chat') ?? sessionStorage.getItem('orbit-active-chat');
  const taskId = search.get('task') ?? '';
  const setChatId = (id: string | null) => {
    if (id) sessionStorage.setItem('orbit-active-chat', id); else sessionStorage.removeItem('orbit-active-chat');
    setSearch(prev => { const next = new URLSearchParams(prev); if (id) next.set('chat', id); else next.delete('chat'); next.delete('task'); return next; }, { replace: true });
    const selected = useStore.getState().aiChats.find(c => c.id === id);
    if (selected) useStore.getState().setActiveProject(selected.projectId);
  };
  const setTaskId = (id: string) => setSearch(prev => { const next = new URLSearchParams(prev); if (id) next.set('task', id); else next.delete('task'); return next; }, { replace: true });
  const aiChats = useStore((s) => s.aiChats);
  const addAiChat = useStore((s) => s.addAiChat);
  const deleteAiChat = useStore((s) => s.deleteAiChat);
  const addAiMessage = useStore((s) => s.addAiMessage);
  const updateAiMessage = useStore((s) => s.updateAiMessage);
  const bibles = useStore((s) => s.bibles);
  const setBible = useStore((s) => s.setBible);
  const bibleVersions = useStore(s => s.bibleVersions);
  const publishBible = useStore(s => s.publishBible);
  const [sendIssue, setSendIssue] = useState('');

  const [newProjectId, setNewProjectId] = useState<string>(() => useStore.getState().activeProjectId ?? projects[0]?.id ?? '');
  const [services, setServices] = useState<Record<string, AiServiceInfo> | null>(null);
  const [prefs, setPrefs] = useState<{ allowPaidApis: boolean; orchestrator: string; autoJudge?: boolean; selfHeal?: boolean; minimumReviewScore?: number } | null>(null);
  const [companionOk, setCompanionOk] = useState<boolean | null>(null);
  const [service, setService] = useState<string>('auto');
  const [runMode, setRunMode] = useState<'standard' | 'roles' | 'debate' | 'vote' | 'race'>('standard');
  const [suggestingPlan, setSuggestingPlan] = useState(false);
  const [prompts, setPrompts] = useState<AiPrompt[]>([]);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [pausePlan, setPausePlan] = useState(false);
  const [suggestingBible, setSuggestingBible] = useState(false);
  const [loadingBibleFile, setLoadingBibleFile] = useState(false);
  const { text, pending, planDraft, setText, setPending, setPlanDraft, getPending, persistenceIssue } = useChatDraft(chatId);
  const uploadQueue = useRef(Promise.resolve());
  const uploadsWaiting = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [bibleOpen, setBibleOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const swarmRun = useSwarm(s => s.run);
  const abortRef = useRef<AbortController | null>(null);
  const runningIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const chat = aiChats.find((c) => c.id === chatId) ?? null;
  const chatProject = projects.find((p) => p.id === chat?.projectId) ?? null;
  const bibleDraft = chat?.projectId ? bibles[chat.projectId] ?? '' : '';
  const publishedBible = chat?.projectId ? bibleVersions[chat.projectId]?.at(-1) : undefined;
  const bible = publishedBible?.text ?? bibleDraft;
  const activeRun = service === 'auto' && swarmRun && ['running', 'awaiting_approval'].includes(swarmRun.status) && swarmRun.projectId === chat?.projectId ? swarmRun : null;
  useEffect(() => { if (chatId) sessionStorage.setItem('orbit-active-chat', chatId); else sessionStorage.removeItem('orbit-active-chat'); }, [chatId]);

  async function prepareTakeover() {
    const serviceId = ['codex', 'claude', 'gemini', 'kimi', 'qwen-code'].find(id => services?.[id]?.available && services[id].capabilities?.repository);
    if (!serviceId) { setSendIssue('Tilslut en coding-agent først, så projektets kode kan læses.'); return; }
    if (!chatProject?.repositoryPath) { setSendIssue('Tilknyt projektets repository under Repository og kvalitetskontroller først.'); return; }
    const template = (await fetchTemplates()).find(t => t.id === 'tpl-project-takeover');
    if (!template) { setSendIssue('Skabelonen kunne ikke hentes fra Companion.'); return; }
    setSendIssue(''); setService('auto'); setRunMode('standard'); setTaskId('');
    setPlanDraft(template.jobs.map(j => ({ ...j, serviceId })));
    setText(`Overtag ${chatProject.name} som et eksisterende projekt. Kortlæg den faktiske status ud fra kode og gældende projektbibel. Foreslå derefter det nødvendige restarbejde for en færdig version. Bevar de vedtagne designvalg, og læg nye idéer til senere. Ændr ingen kode i denne gennemgang.`);
    textareaRef.current?.focus();
  }

  const refresh = useCallback(async () => {
    const ok = await companionStatus();
    setCompanionOk(Boolean(ok?.ok));
    const svc = await fetchAiServices();
    setServices(svc?.services ?? null);
    setPrefs(svc?.prefs ?? null);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 12000); return () => clearInterval(id); }, [refresh]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat?.messages.length, running]);

  // Prompt-bibliotek for det valgte chats projekt.
  useEffect(() => {
    if (!promptsOpen || !chat?.projectId) return;
    void fetchPrompts(projects.find((p) => p.id === chat.projectId)?.name ?? '').then(setPrompts);
  }, [promptsOpen, chat?.projectId, projects]);

  // Planlægningsagent: orkestratoren foreslår jobs UDEN at starte kørslen.
  const suggestPlan = async () => {
    const goal = text.trim();
    if (!goal || suggestingPlan) return;
    setSuggestingPlan(true);
    const attachments = pending.map(({ dataUrl: _d, ...rest }) => rest);
    const r = await suggestTemplate(goal, bible || undefined, attachments, chat?.projectId);
    setSuggestingPlan(false);
    if (r.ok && r.jobs?.length) setPlanDraft(r.jobs.map((j) => ({ ...j, dependsOn: j.dependsOn ?? [] })));
  };

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    uploadsWaiting.current += list.length;
    if (list.length) setUploading(true);
    for (const file of list) {
      uploadQueue.current = uploadQueue.current.then(async () => {
        try {
          if (getPending().length >= 10) { setSendIssue(`Højst 10 vedhæftninger pr. kørsel. ${file.name} blev ikke tilføjet; fjern en fil eller start en ny kørsel.`); return; }
          const uploaded = await uploadAiFile(file);
          if (uploaded) setPending(previous => [...previous, uploaded]);
          else setSendIssue(`Filen ${file.name} kunne ikke uploades. Kontrollér størrelse (maks. 25 MB) og forbindelsen.`);
        } catch { setSendIssue(`Filen ${file.name} kunne ikke læses eller uploades. Prøv igen.`); } finally { uploadsWaiting.current--; if (!uploadsWaiting.current) setUploading(false); }
      });
    }
    await uploadQueue.current;
  }, [setPending, getPending]);

  const onPaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const files = items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean) as File[];
    if (files.length) { e.preventDefault(); await addFiles(files); }
  }, [addFiles]);

  const send = useCallback(async () => {
    const body = text.trim();
    if ((!body && pending.length === 0) || !chat || sendingRef.current || uploading || uploadsWaiting.current > 0) return;
    setSendIssue('');
    const atts = pending.map(({ dataUrl: _d, extractedText: _text, ...rest }) => rest);
    if (activeRun) {
      sendingRef.current = true; setSending(true);
      try {
        const accepted = await sendRunMessage(activeRun.runId, body, atts);
        if (!accepted) { setSendIssue('Præciseringen kunne ikke sendes. Kontrollér forbindelsen og at kørslen stadig er aktiv (højst 10 vedhæftninger pr. kørsel).'); return; }
        addAiMessage(chat.id, { role: 'user', text: body, attachments: atts, status: 'done' });
        addAiMessage(chat.id, { role: 'assistant', text: 'Modtaget. Din præcisering og eventuelle vedhæftninger gælder fra næste job. Det igangværende job fortsætter med sin oprindelige kontekst.', status: 'done' });
        setText(''); setPending([]);
      } finally { sendingRef.current = false; setSending(false); }
      return;
    }
    if (running) return;
    if (taskId) {
      const store = useStore.getState();
      const task = store.tasks.find(t => t.id === taskId && t.projectId === chat.projectId);
      if (!task || (chatProject?.scopeTaskIds && !chatProject.scopeTaskIds.includes(taskId))) { setSendIssue('Opgaven er ikke i projektets aktive scope. Vælg en arbejdsordre fra versionen.'); return; }
      const reason = workLimitReason(store.tasks, store.rules, task, 'inprogress');
      if (reason) { setSendIssue(reason); return; }
    }
    sendingRef.current = true; setSending(true);
    try {
      if (service === 'auto' && chat.projectId && !await pushNow()) { setSendIssue('Projektet kunne ikke gemmes på Companion. Prøv igen, når forbindelsen er tilbage.'); return; }
    } finally { sendingRef.current = false; setSending(false); }
    setText('');
    setPending([]);
    setPlanDraft(null);
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
        { goal: body, bible: bible || undefined, projectId: chat.projectId ?? undefined, taskId: taskId || undefined, repositoryPath: chatProject?.repositoryPath, checks: chatProject?.verificationChecks, mode: runMode, pauseAfterPlan: pausePlan, jobs: planDraft ?? undefined, attachments: atts },
        {
          onEvent: (evt) => {
            if (evt.type === 'run_start') {
              runningIdRef.current = String(evt.runId);
              updateAiMessage(chat.id, msg.id, { runId: String(evt.runId) });
            }
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
              out += `${r.text.slice(0, 6000)}${r.text.length > 6000 ? `\n\n[Hent den fulde leverance](${BASE_URL}/api/ai/runs/${runningIdRef.current}/export)` : ''}\n\n`;
              if (r.artifacts?.length) {
                const cur = (useStore.getState().aiChats.find((c) => c.id === chat.id)?.messages ?? []).find((x) => x.id === msg.id);
                updateAiMessage(chat.id, msg.id, { artifacts: [...(cur?.artifacts ?? []), ...r.artifacts] });
              }
            } else if (evt.type === 'job_blocked' || evt.type === 'job_cancelled') {
              out += `⏸ ${String(evt.jobId)}: ${String(evt.error ?? 'Blokeret')}\n`;
            } else if (evt.type === 'job_error') {
              out += `⚠️ ${t('chat.jobFailed')}: ${String(evt.error ?? '')}\n`;
            } else if (evt.type === 'done') {
              const sum = (evt.summary as { title: string }[] | undefined) ?? [];
              out += `**${t('chat.runFinished')}** — ${sum.length} ${t('chat.jobsDelivered')}\n`;
            }
            if (out !== msgText()) updateAiMessage(chat.id, msg.id, { text: out });
          },
          onError: (e) => updateAiMessage(chat.id, msg.id, { text: `${msgText()}\n\n⚠️ ${e}`, status: 'error' }),
        },
        ac.signal,
      );
      const finalMessage = useStore.getState().aiChats.find(c => c.id === chat.id)?.messages.find(m => m.id === msg.id);
      if (finalMessage?.status === 'streaming') updateAiMessage(chat.id, msg.id, { status: ac.signal.aborted ? 'error' : 'done', ...(ac.signal.aborted ? { text: `${finalMessage.text}\n\nForbindelsen er stoppet. Se kørselsstatus i Orbit Live.` } : {}) });
      setPlanDraft(null);
    } else {
      const msg = addAiMessage(chat.id, { role: 'assistant', text: '', serviceId: service, status: 'streaming' });
      const history = (useStore.getState().aiChats.find((c) => c.id === chat.id)?.messages ?? [])
        .filter((m) => m.id !== msg.id && m.status === 'done')
        .slice(-12)
        .map((m) => ({ role: m.role, text: m.text, attachments: m.attachments }));
      let acc = '';
      await streamChat(
        service,
        history,
        {
          onDelta: (_d, full) => { acc = full; updateAiMessage(chat.id, msg.id, { text: full }); },
          onDone: () => updateAiMessage(chat.id, msg.id, { status: 'done' }),
          onError: (e) => updateAiMessage(chat.id, msg.id, { text: acc ? `${acc}\n\n⚠️ ${e}` : `⚠️ ${e}`, status: 'error' }),
        },
        ac.signal,
        bible || undefined,
      );
    }
    setRunning(false);
    abortRef.current = null;
    runningIdRef.current = null;
    textareaRef.current?.focus();
  }, [text, pending, running, activeRun, uploading, chat, chatProject, taskId, service, services, bible, aiChats, runMode, pausePlan, planDraft, addAiMessage, updateAiMessage, setText, setPending, setPlanDraft]);

  const availableCount = useMemo(() => (services ? Object.values(services).filter((s) => s.available).length : 0), [services]);

  return (
    <div className="flex h-full min-h-0 gap-4 p-3 md:p-6 max-w-[1500px] mx-auto overflow-hidden">
      {/* venstre: samtaler + tilslutning */}
      <aside className="w-64 shrink-0 hidden lg:flex flex-col gap-3 overflow-y-auto pr-1">
        <div className="flex items-center gap-1.5">
          <select
            aria-label="Projekt til ny samtale"
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
        <CreateProjectChat onCreate={(projectId, id) => { setNewProjectId(projectId); setChatId(id); }} />
        <div className="space-y-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider opacity-60 px-1">{t('chat.chats')}</h3>
          {aiChats.length === 0 && <p className="text-[11px] opacity-40 px-1">{t('chat.noChats')}</p>}
          {aiChats.map((c: AiChat) => (
            <div key={c.id} className={cn('group flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer transition', c.id === chatId ? 'bg-indigo-500/20 border border-indigo-400/30' : 'hover:bg-white/5 border border-transparent')}>
              <button className="flex-1 min-w-0 text-left" onClick={() => { setChatId(c.id); }}>
                <div className="text-[12px] truncate">{c.title}</div>
                <div className="text-[10px] opacity-40 truncate">{projects.find((p) => p.id === c.projectId)?.name ?? '—'}</div>
              </button>
              <button aria-label={`Slet samtalen ${c.title}`} onClick={() => { deleteAiChat(c.id); if (chatId === c.id) setChatId(null); }} className="opacity-0 group-hover:opacity-40 focus:opacity-100 hover:opacity-100 transition shrink-0">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex-1" />
        <details className="rounded-xl border border-current/10 p-3">
          <summary className="cursor-pointer text-xs font-medium">Forbindelser · {availableCount} klar</summary>
          <div className="mt-3"><ConnectionPanel services={services} prefs={prefs} onChanged={refresh} /></div>
        </details>
      </aside>

      {/* hoved: beskeder + komponist */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col gap-3 overflow-y-auto pr-1 [&>*]:shrink-0">
        <details className="lg:hidden rounded-xl border border-current/10 p-3 text-xs">
          <summary className="cursor-pointer font-medium">Samtaler og forbindelser</summary>
          <div className="mt-3 space-y-3">
            <CreateProjectChat onCreate={(projectId, id) => { setNewProjectId(projectId); setChatId(id); }} />
            <label className="block">Projekt<select aria-label="Projekt til ny mobil-samtale" className="input w-full mt-1" value={newProjectId} onChange={e => setNewProjectId(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <button className="btn-primary text-xs" onClick={() => { const c = addAiChat({ projectId: newProjectId, title: t('chat.untitled') }); setChatId(c.id); }}>{t('chat.newChat')}</button>
            <div className="max-h-48 overflow-auto">{aiChats.map(c => <button key={c.id} className="block w-full text-left rounded-lg p-2 hover:bg-indigo-500/10" onClick={() => { setChatId(c.id); }}>{c.title}</button>)}</div>
            <details><summary className="cursor-pointer">Forbindelser · {availableCount} klar</summary><ConnectionPanel services={services} prefs={prefs} onChanged={refresh} /></details>
          </div>
        </details>
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
            {chatProject && <ProjectScopePanel key={`scope-${chatProject.id}`} project={chatProject} />}
            {chatProject && <ProjectExecutionSettings key={chatProject.id} project={chatProject} />}
            <label className="flex items-center gap-2 text-xs">Arbejdsordre
              <select aria-label="Arbejdsordre" value={taskId} onChange={e => setTaskId(e.target.value)} className="input flex-1" disabled={running}>
                <option value="">Samtale uden tilknyttet opgave</option>
                {tasks.filter(t => t.projectId === chat.projectId && !['done', 'canceled'].includes(t.status) && (!chatProject?.scopeTaskIds || chatProject.scopeTaskIds.includes(t.id))).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </label>
            <OrbitRunPanel projectId={chat.projectId} />
            {chat.projectId && (
              <div className="rounded-2xl border border-white/10 bg-black/10 dark:bg-white/5 overflow-hidden">
                <button onClick={() => setBibleOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition">
                  <BookOpen size={13} className="opacity-60" />
                  <span className="text-[12px] font-medium flex-1">{t('chat.bible')}: {chatProject?.name ?? ''}</span>
                  <span className="text-[10px] opacity-40">{bible ? `${bible.length} ${t('chat.chars')}` : t('chat.bibleEmpty')}</span>
                </button>
                {bibleOpen && (
                  <div className="px-3 pb-3 space-y-1.5">
                    <textarea
                      value={bibleDraft}
                      onChange={(e) => setBible(chat.projectId!, e.target.value)}
                      placeholder={t('chat.biblePlaceholder')}
                      rows={4}
                      className="w-full rounded-xl bg-black/20 dark:bg-black/30 border border-white/10 px-3 py-2 text-[12px] outline-none focus:border-indigo-400/60 resize-y"
                    />
                    <p className="text-xs opacity-70">{publishedBible ? `Gældende version ${publishedBible.version}. ${bibleDraft !== publishedBible.text ? 'Der er upublicerede ændringer.' : 'Kladde og gældende version er ens.'}` : 'Ingen fastlagt version. Kørsler bruger den gemte kladde.'}</p>
                    <button className="btn-primary text-xs" disabled={!bibleDraft.trim() || bibleDraft === publishedBible?.text} onClick={() => publishBible(chat.projectId!)}>Gør kladden gældende</button>
                    {chat.projectId && (bibleVersions[chat.projectId]?.length ?? 0) > 0 && <details className="text-xs"><summary className="cursor-pointer">Tidligere versioner</summary>{[...(bibleVersions[chat.projectId] ?? [])].reverse().map(v => <button key={v.id} className="block underline mt-1" onClick={() => setBible(chat.projectId!, v.text)}>Hent version {v.version} som kladde</button>)}</details>}
                    <button
                      disabled={suggestingBible}
                      onClick={async () => {
                        if (!chat.projectId) return;
                        setSuggestingBible(true);
                        try {
                          const r = await fetch(`${BASE_URL}/api/ai/bible/suggest`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ project: chatProject?.name ?? '', current: bible }),
                          });
                          const j = await r.json();
                          if (j?.ok && j.bible) setBible(chat.projectId, j.bible);
                        } finally {
                          setSuggestingBible(false);
                        }
                      }}
                      className="rounded-lg border border-indigo-400/40 text-indigo-300 px-2 py-1 text-[10.5px] hover:bg-indigo-400/10 transition disabled:opacity-40 flex items-center gap-1"
                    >
                      {suggestingBible ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                      {suggestingBible ? t('chat.suggestingBible') : t('chat.suggestBible')}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/5 dark:bg-black/20 p-4 space-y-4 min-h-[300px] max-h-[65vh]">
              {sendIssue && <p role="alert" className="text-rose-400 text-sm">{sendIssue}</p>}
              {chat.messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center text-[12px] px-8 gap-4"><p className="opacity-60">{t('chat.firstMessage')}</p><div className="flex flex-wrap justify-center gap-2"><button className="btn-ghost text-xs" onClick={prepareTakeover}>Kortlæg eksisterende projekt</button><button className="btn-ghost text-xs" onClick={() => { setText('Undersøg og ret fejlen på det vedhæftede billede. Find årsagen i projektet, gennemfør den mindste nødvendige rettelse, og dokumentér en faktisk kontrol af det berørte forløb.'); textareaRef.current?.focus(); }}>Ret en fejl fra et billede</button><button className="btn-ghost text-xs" onClick={() => { fileInputRef.current?.click(); setBibleOpen(true); }}>Upload projektbibel</button></div></div>
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
                  {pending.map((a, i) => <div key={a.id ?? i} className="space-y-1"><AttachmentChip a={a} onRemove={() => setPending(p => p.filter((_, j) => j !== i))} />{chat.projectId && (a.extractedText || /\.(pdf|docx|txt|md|csv|json|yaml|yml)$/i.test(a.name)) && <button disabled={loadingBibleFile} className="text-[10px] underline text-indigo-400 disabled:opacity-40" onClick={async () => { setLoadingBibleFile(true); try { const result = a.extractedText ? { ok: true, text: a.extractedText } : await fetchAttachmentText(a); if (!result.ok || !result.text) { setSendIssue(result.reason ?? 'Dokumentteksten kunne ikke læses.'); return; } setBible(chat.projectId!, result.text); setBibleOpen(true); } finally { setLoadingBibleFile(false); } }}>{a.extractedText ? 'Brug teksten som bibelkladde' : 'Hent tekst til bibelkladde'}</button>}{a.extractionError && <p className="text-[10px] text-amber-400">Tekst kunne ikke udtrækkes: {a.extractionError}</p>}</div>)}
                </div>
              )}
              <div className="flex items-end gap-2 p-2.5">
                <button onClick={() => fileInputRef.current?.click()} className="p-2 rounded-xl hover:bg-white/10 opacity-70 hover:opacity-100 transition shrink-0" title={t('chat.attach')}>
                  <Paperclip size={16} />
                </button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
                <textarea
                  aria-label="Besked til Orbit"
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onPaste={onPaste}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  rows={Math.min(6, Math.max(1, text.split('\n').length))}
                  placeholder={activeRun ? 'Præcisér arbejdet — gælder fra næste job…' : t('chat.placeholder')}
                  className="flex-1 min-w-0 bg-transparent outline-none resize-none text-[13px] py-2 placeholder:opacity-40"
                />
                <select
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  disabled={running || Boolean(activeRun)}
                  className="rounded-xl bg-black/20 dark:bg-black/30 border border-white/10 px-2 py-2 text-[12px] outline-none shrink-0 max-w-[130px] disabled:opacity-60"
                >
                  <option value="auto">⚡ {t('chat.serviceAuto')}</option>
                  {Object.values(services ?? {}).filter((s) => s.available).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                  {Object.values(services ?? {}).some((s) => !s.available) && (
                    <optgroup label={t('chat.unavailable')}>
                      {Object.values(services ?? {}).filter((s) => !s.available).map((s) => (
                        <option key={s.id} value={s.id} disabled>{s.name} — {s.reason ?? 'offline'}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {(running || activeRun) && (
                  <button onClick={async () => { const id = activeRun?.runId ?? runningIdRef.current; if (service === 'auto' && !id) { setSendIssue('Afventer kørsels-id fra serveren. Prøv Stop igen om et øjeblik.'); return; } if (id) { const stopped = await cancelRun(id); if (!stopped) return; } abortRef.current?.abort(); }} className="p-2.5 rounded-xl bg-rose-500/80 hover:bg-rose-500 text-white transition shrink-0" title={t('chat.stop')}>
                    <Square size={15} />
                  </button>
                )}
                {(!running || activeRun) && (
                  <button
                    onClick={send}
                    disabled={sending || uploading || (!text.trim() && pending.length === 0) || (service !== 'auto' && !services?.[service]?.available)}
                    className={cn('p-2.5 rounded-xl text-white transition shrink-0', service === 'auto' ? 'bg-gradient-to-br from-indigo-500 to-violet-600 hover:opacity-90 shadow-lg shadow-indigo-500/30' : 'bg-slate-600 hover:bg-slate-500', 'disabled:opacity-30')}
                    title={activeRun ? 'Send præcisering til næste job' : service === 'auto' ? t('chat.runHint') : t('chat.send')}
                  >
                    {service === 'auto' && !activeRun ? <Play size={15} /> : <ArrowUp size={15} />}
                  </button>
                )}
              </div>
              {service === 'auto' && (
                <div className="px-3 pb-2 flex flex-wrap items-center gap-2">
                  <select
                    value={runMode}
                    onChange={(e) => setRunMode(e.target.value as 'standard' | 'roles' | 'debate' | 'vote' | 'race')}
                    title={t('chat.modeHint')}
                    className="rounded-lg bg-black/20 dark:bg-black/30 border border-white/10 px-2 py-1 text-[10.5px] outline-none"
                  >
                    <option value="standard">{t('swarm.mode.standard')}</option>
                    <option value="roles">{t('swarm.mode.roles')}</option>
                    <option value="debate">{t('swarm.mode.debate')}</option>
                    <option value="vote">{t('swarm.mode.vote')}</option>
                    <option value="race">{t('swarm.mode.race')}</option>
                  </select>
                  <label className="flex items-center gap-1.5 text-[10.5px] opacity-60 cursor-pointer" title={t('chat.modeHint')}>
                    <input type="checkbox" checked={pausePlan} onChange={(e) => setPausePlan(e.target.checked)} className="accent-indigo-500" />
                    {t('chat.pausePlan')}
                  </label>
                  <button
                    onClick={() => void suggestPlan()}
                    disabled={suggestingPlan || !text.trim()}
                    title={t('chat.suggestPlanHint')}
                    className="rounded-lg border border-violet-400/40 text-violet-300 px-2 py-1 text-[10.5px] hover:bg-violet-400/10 transition disabled:opacity-40 flex items-center gap-1"
                  >
                    {suggestingPlan ? <Loader2 size={10} className="animate-spin" /> : <ClipboardList size={10} />}
                    {t('chat.suggestPlan')}
                  </button>
                  <button
                    onClick={() => setPromptsOpen((o) => !o)}
                    title={t('chat.promptLibrary')}
                    className={cn('rounded-lg border px-2 py-1 text-[10.5px] transition flex items-center gap-1', promptsOpen ? 'border-amber-400/50 text-amber-300 bg-amber-400/10' : 'border-white/15 opacity-70 hover:opacity-100')}
                  >
                    <Bookmark size={10} /> {t('chat.promptLibrary')}
                  </button>
                </div>
              )}

              {/* Prompt-bibliotek (gem/indsæt genbrugelige prompts pr. projekt) */}
              {promptsOpen && chat?.projectId && (
                <div className="mx-3 mb-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[10.5px] font-semibold text-amber-300 flex-1">{t('chat.promptLibrary')}</h4>
                    {text.trim() && (
                      <button
                        onClick={async () => {
                          const name = window.prompt(t('chat.promptNamePrompt'), text.trim().slice(0, 40));
                          if (!name) return;
                          await savePrompt({ name, project: chatProject?.name ?? '', text: text.trim() });
                          void fetchPrompts(chatProject?.name ?? '').then(setPrompts);
                        }}
                        className="rounded-lg border border-amber-400/40 text-amber-300 px-2 py-0.5 text-[10px] hover:bg-amber-400/10 transition flex items-center gap-1"
                      >
                        <Plus size={10} /> {t('chat.savePrompt')}
                      </button>
                    )}
                  </div>
                  {prompts.length === 0 && <p className="text-[10px] opacity-45">{t('chat.noPrompts')}</p>}
                  {prompts.map((p) => (
                    <div key={p.id} className="flex items-center gap-1.5 rounded-lg bg-black/15 dark:bg-black/25 px-2 py-1">
                      <button
                        onClick={() => setText((cur) => (cur ? `${cur}\n\n${p.text}` : p.text))}
                        className="flex-1 min-w-0 text-left text-[10.5px] truncate hover:text-amber-200 transition"
                        title={p.text}
                      >
                        <b>{p.name}</b> — {p.text.slice(0, 80)}
                      </button>
                      <button onClick={async () => { await deletePrompt(p.id); void fetchPrompts(chatProject?.name ?? '').then(setPrompts); }} className="opacity-40 hover:opacity-100 hover:text-rose-400 transition shrink-0">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Planlægningsagentens forslag — redigér og brug som prædefineret plan */}
              {planDraft && (
                <div className="mx-3 mb-2 rounded-xl border border-violet-400/30 bg-violet-500/[0.06] p-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[10.5px] font-semibold text-violet-300 flex-1 flex items-center gap-1"><ClipboardList size={11} /> {t('chat.planDraft')}</h4>
                    <button onClick={() => setPlanDraft(null)} className="opacity-40 hover:opacity-100 transition"><X size={12} /></button>
                  </div>
                  {planDraft.map((j, i) => (
                    <div key={j.id ?? i} className="flex items-center gap-1.5">
                      <span className="text-[9.5px] opacity-40 w-4 tabular-nums">{i + 1}</span>
                      <input
                        value={j.title}
                        onChange={(e) => setPlanDraft((d) => d ? d.map((x, xi) => (xi === i ? { ...x, title: e.target.value } : x)) : d)}
                        className="flex-1 min-w-0 rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-[11px] outline-none focus:border-violet-400/50"
                      />
                      <select
                        value={j.serviceId ?? ''}
                        onChange={(e) => setPlanDraft((d) => d ? d.map((x, xi) => (xi === i ? { ...x, serviceId: e.target.value || null } : x)) : d)}
                        className="rounded-lg bg-black/30 border border-white/10 px-1.5 py-1 text-[10.5px] outline-none max-w-[110px]"
                      >
                        <option value="">—</option>
                        {Object.values(services ?? {}).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  ))}
                  <p className="text-[9.5px] opacity-45">{t('chat.planDraftHint')}</p>
                </div>
              )}
              <div className="px-3 pb-2 text-[10px] opacity-35 flex items-center gap-1.5">
                {persistenceIssue && <span className="text-amber-500">{persistenceIssue}</span>}
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

// Orbit AI-motor — abonnement-first orkestrering.
// Primære motorer: lokale CLI-værktøjer (Codex, Claude Code, Kimi Code, Gemini CLI, Ollama/Qwen).
// API-baserede tjenester grupperes: 'sub-api' (dækket af abonnement: Meshy, ElevenLabs, HeyGen)
// og 'paid-api' (betalt pr. brug — kræver eksplicit tilladelse i aiPrefs.allowPaidApis).

import { spawn, execFile } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { promisify } from 'util';

const execFileP = promisify(execFile);

// ---- Tjenestekatalog ------------------------------------------------------
// kind: 'cli' | 'local' | 'sub-api' | 'paid-api' | 'manual'
// cliTemplate: argumenter hvor {prompt} erstattes med selve beskeden (ingen shell, token-baseret).
export const AI_SERVICES = [
  { id: 'codex',      name: 'Codex',          kind: 'cli',      cmd: 'codex',  cliTemplate: 'exec --skip-git-repo-check {prompt}', color: 'emerald',  strengths: ['kode', 'arkitektur', 'refaktorering', 'test'] },
  { id: 'claude',     name: 'Claude Code',    kind: 'cli',      cmd: 'claude', cliTemplate: '-p {prompt}',                        color: 'amber',    strengths: ['kode', 'planlægning', 'skrivning', 'analyse', 'orkestrering'] },
  { id: 'kimi',       name: 'Kimi Code',      kind: 'cli',      cmd: 'kimi',   cliTemplate: '-p {prompt}',                        color: 'indigo',   strengths: ['kode', 'lang kontekst', 'dokumentation', 'orkestrering'] },
  { id: 'gemini',     name: 'Gemini CLI',     kind: 'cli',      cmd: 'gemini', cliTemplate: '-p {prompt}',                        color: 'sky',      strengths: ['multimodal', 'research', 'design-feedback'] },
  { id: 'qwen',       name: 'Qwen (lokal)',   kind: 'local',    baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5-coder:7b',     color: 'slate',    strengths: ['privat', 'hurtig kode', 'gratis'] },
  { id: 'meshy',      name: 'Meshy',          kind: 'sub-api',  baseUrl: 'https://api.meshy.ai/v1',                            color: 'teal',     strengths: ['3D-modeller', 'teksturer'] },
  { id: 'elevenlabs', name: 'ElevenLabs',     kind: 'sub-api',  baseUrl: 'https://api.elevenlabs.io/v1',                       color: 'rose',     strengths: ['stemmer', 'lyd', 'TTS'] },
  { id: 'heygen',     name: 'HeyGen',         kind: 'sub-api',  baseUrl: 'https://api.heygen.com/v2',                          color: 'violet',   strengths: ['avatar-video', 'præsentation'] },
  { id: 'deepseek',   name: 'DeepSeek Flash', kind: 'paid-api', baseUrl: 'https://api.deepseek.com/v1',  model: 'deepseek-chat', color: 'cyan',    strengths: ['hurtig kode', 'billig chat'] },
  { id: 'openai',     name: 'OpenAI (API)',   kind: 'paid-api', baseUrl: 'https://api.openai.com/v1',    model: 'gpt-4o-mini',   color: 'lime',    strengths: ['generel chat'] },
  { id: 'anthropic',  name: 'Anthropic (API)',kind: 'paid-api', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', color: 'orange', strengths: ['skrivning', 'kode'] },
  { id: 'moonshot',   name: 'Moonshot (API)', kind: 'paid-api', baseUrl: 'https://api.moonshot.ai/v1',   model: 'kimi-k2',       color: 'blue',    strengths: ['lang kontekst'] },
  { id: 'xai',        name: 'xAI (API)',      kind: 'paid-api', baseUrl: 'https://api.x.ai/v1',          model: 'grok-3-mini',   color: 'orange',  strengths: ['hurtig chat'] },
  { id: 'grok',       name: 'Grok',           kind: 'manual',                                                        color: 'orange',   strengths: ['chat'] },
];

const serviceById = (id) => AI_SERVICES.find((s) => s.id === id);

// ---- Konfiguration --------------------------------------------------------
function aiCfg(cfg) {
  return {
    providers: cfg.aiProviders ?? {},
    prefs: { allowPaidApis: false, orchestrator: 'claude', selfHeal: true, ...(cfg.aiPrefs ?? {}) },
  };
}

function mask(key) {
  if (!key) return null;
  return key.length <= 6 ? '••••' : `••••${key.slice(-4)}`;
}

// CLI-detektion med cache (gør status-endpointen hurtig).
let cliCache = { at: 0, found: {} };
async function detectClis() {
  if (Date.now() - cliCache.at < 30_000) return cliCache.found;
  const found = {};
  await Promise.all(AI_SERVICES.filter((s) => s.kind === 'cli').map(async (s) => {
    try {
      const r = await execFileP(process.platform === 'win32' ? 'where' : 'which', [s.cmd], { timeout: 3000 });
      found[s.id] = Boolean(r.stdout.trim());
    } catch { found[s.id] = false; }
  }));
  cliCache = { at: Date.now(), found };
  return found;
}

async function ollamaUp(baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1200) });
    return r.ok;
  } catch { return false; }
}

// Må tjenesten bruges nu? Cost-gate: paid-api kræver allowPaidApis.
export async function serviceAvailability(cfg) {
  const { providers, prefs } = aiCfg(cfg);
  const clis = await detectClis();
  const out = {};
  for (const s of AI_SERVICES) {
    const p = providers[s.id] ?? {};
    let available = false, reason = null;
    if (s.kind === 'cli') {
      available = clis[s.id] && p.enabled !== false;
      reason = clis[s.id] ? null : `CLI '${s.cmd}' ikke fundet`;
    } else if (s.kind === 'local') {
      const up = await ollamaUp(p.baseUrl ?? s.baseUrl);
      available = up && p.enabled !== false;
      reason = up ? null : 'Ollama kører ikke (127.0.0.1:11434)';
    } else if (s.kind === 'sub-api') {
      available = Boolean(p.apiKey) && p.enabled !== false;
      reason = p.apiKey ? null : 'API-nøgle mangler';
    } else if (s.kind === 'paid-api') {
      available = Boolean(p.apiKey) && p.enabled !== false && prefs.allowPaidApis;
      reason = !p.apiKey ? 'API-nøgle mangler' : !prefs.allowPaidApis ? 'Betalt API låst (tillad i indstillinger)' : (p.enabled === false ? 'Deaktiveret' : null);
    } else {
      reason = 'Klar til manuel tilslutning';
    }
    out[s.id] = {
      id: s.id, name: s.name, kind: s.kind, color: s.color, strengths: s.strengths,
      available, reason, enabled: p.enabled !== false,
      hasKey: Boolean(p.apiKey), keyMask: mask(p.apiKey),
      model: p.model ?? s.model ?? null, cmd: p.cmd ?? s.cmd ?? null,
      subscriptionCovered: s.kind === 'sub-api',
    };
  }
  return out;
}

export function assertUsable(svc, cfg) {
  const { providers, prefs } = aiCfg(cfg);
  const p = providers[svc.id] ?? {};
  if (svc.kind === 'paid-api' && !prefs.allowPaidApis) {
    throw new Error(`${svc.name} er betalt pr. brug og låst. Slå 'Tillad betalte API'er' til i AI-indstillinger for at bruge det.`);
  }
  if ((svc.kind === 'sub-api' || svc.kind === 'paid-api') && !p.apiKey) {
    throw new Error(`${svc.name}: API-nøgle mangler. Indtast den i tilslutningspanelet.`);
  }
  if (p.enabled === false) throw new Error(`${svc.name} er deaktiveret.`);
}

// ---- Beskedkonvertering ----------------------------------------------------
// Intern besked: { role: 'user'|'assistant'|'system', text, attachments?: [{kind,name,mime,url,path}] }
function contentToText(msg) {
  let t = msg.text ?? '';
  for (const a of msg.attachments ?? []) {
    t += `\n\n[Vedhæftet ${a.kind === 'image' ? 'billede' : 'fil'}: ${a.name}${a.path ? ` — tilgængelig på disk: ${a.path}` : ''}]`;
  }
  return t;
}

function toOpenAiMessages(messages) {
  return messages.map((m) => {
    const content = [{ type: 'text', text: contentToText(m) }];
    for (const a of m.attachments ?? []) {
      if (a.kind === 'image' && a.dataUrl) content.push({ type: 'image_url', image_url: { url: a.dataUrl } });
    }
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content };
  });
}

function toAnthropicMessages(messages) {
  const sys = messages.filter((m) => m.role === 'system').map(contentToText).join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system').map((m) => {
    const content = [{ type: 'text', text: contentToText(m) }];
    for (const a of m.attachments ?? []) {
      if (a.kind === 'image' && a.dataUrl) {
        const [head, b64] = a.dataUrl.split(',');
        const media = head.match(/data:(.*?);/)?.[1] ?? 'image/png';
        content.push({ type: 'image', source: { type: 'base64', media_type: media, data: b64 } });
      }
    }
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content };
  });
  return { system: sys || undefined, messages: rest };
}

function toGeminiContents(messages) {
  return messages.filter((m) => m.role !== 'system').map((m) => {
    const parts = [{ text: (m.role === 'system' ? '' : '') + contentToText(m) }];
    for (const a of m.attachments ?? []) {
      if (a.kind === 'image' && a.dataUrl) {
        const [head, b64] = a.dataUrl.split(',');
        parts.push({ inlineData: { mimeType: head.match(/data:(.*?);/)?.[1] ?? 'image/png', data: b64 } });
      }
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });
}

// ---- Provider-kald (alle streamer delta via onDelta) -----------------------
async function readSse(res, onData) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith('data: ')) onData(line.slice(6));
    }
  }
}

async function chatOpenAiCompat({ baseUrl, apiKey, model, messages, onDelta, signal }) {
  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: toOpenAiMessages(messages), stream: true, temperature: 0.7 }),
  });
  if (!r.ok) throw new Error(`OpenAI-kompatibel fejl ${r.status}: ${(await r.text()).slice(0, 300)}`);
  await readSse(r, (data) => {
    const j = JSON.parse(data);
    const d = j.choices?.[0]?.delta?.content;
    if (d) onDelta(d);
  });
}

async function chatAnthropic({ baseUrl, apiKey, model, messages, onDelta, signal }) {
  const { system, messages: msgs } = toAnthropicMessages(messages);
  const r = await fetch(`${baseUrl}/messages`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4096, system, messages: msgs, stream: true }),
  });
  if (!r.ok) throw new Error(`Anthropic fejl ${r.status}: ${(await r.text()).slice(0, 300)}`);
  await readSse(r, (data) => {
    const j = JSON.parse(data);
    if (j.type === 'content_block_delta' && j.delta?.text) onDelta(j.delta.text);
  });
}

async function chatGemini({ baseUrl, apiKey, model, messages, onDelta, signal }) {
  const r = await fetch(`${baseUrl.replace(/\/$/, '')}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: toGeminiContents(messages) }),
  });
  if (!r.ok) throw new Error(`Gemini fejl ${r.status}: ${(await r.text()).slice(0, 300)}`);
  await readSse(r, (data) => {
    const j = JSON.parse(data);
    const d = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('');
    if (d) onDelta(d);
  });
}

async function chatOllama({ baseUrl, model, messages, onDelta, signal }) {
  const r = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: contentToText(m) })), stream: true }),
  });
  if (!r.ok) throw new Error(`Ollama fejl ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value, { stream: true }).split('\n')) {
      if (!line.trim()) continue;
      try { const j = JSON.parse(line); if (j.message?.content) onDelta(j.message.content); } catch { /* deltastreng */ }
    }
  }
}

// CLI: prompt som argument ud fra skabelon; stdout streames linjevis.
// jsonl: stdout parses som Claude stream-json (én JSON pr. linje) → onEvent i stedet for rå delta.
function chatCli({ cmd, cliTemplate, prompt, cwd, onDelta, onEvent, jsonl, signal }) {
  return new Promise((resolve, reject) => {
    const parts = (cliTemplate || '-p {prompt}').split(' ').map((t) => (t === '{prompt}' ? prompt : t));
    const child = spawn(cmd, parts, { cwd: cwd ?? process.cwd(), env: { ...process.env, NO_COLOR: '1' } });
    const kill = () => { try { child.kill('SIGTERM'); } catch { /* */ } };
    signal?.addEventListener('abort', kill);
    const timer = setTimeout(kill, 15 * 60 * 1000);
    let out = '';
    let lineBuf = '';
    const feed = (chunk) => {
      if (jsonl) {
        lineBuf += chunk;
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          try { onEvent?.(JSON.parse(t)); } catch { onDelta?.(`${line}\n`); }
        }
        return;
      }
      out += chunk;
      onDelta(chunk);
    };
    child.stdout.on('data', (d) => feed(d.toString()));
    child.stderr.on('data', (d) => { const s = d.toString(); if (!s.startsWith('∆')) feed(s); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Kunne ikke starte '${cmd}': ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (signal?.aborted) reject(new Error('Afbrudt'));
      else if (code === 0 || out.trim()) resolve(out);
      else reject(new Error(`'${cmd}' afsluttede med kode ${code} uden output`));
    });
  });
}

// Claude Code stream-json → tekst-delta + Task-underagent-hændelser.
// Gør det muligt at vise Claude's egne subagenter som separate underlinjer i sværmen.
function watchClaudeStreamJson({ onText, onSubagent }) {
  const byTool = new Map(); // tool_use_id → subagent
  return (ev) => {
    if (!ev || typeof ev !== 'object') return;
    if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
      for (const b of ev.message.content) {
        if (b.type === 'text' && b.text) onText?.(b.text);
        else if (b.type === 'tool_use' && b.name === 'Task') {
          const desc = String(b.input?.description ?? b.input?.prompt ?? 'Underagent').slice(0, 180);
          byTool.set(b.id, { subId: b.id });
          onSubagent?.({ phase: 'start', subId: b.id, name: desc });
        }
      }
    } else if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
      for (const b of ev.message?.content) {
        if (b.type === 'tool_result' && byTool.has(b.tool_use_id)) {
          const txt = typeof b.content === 'string'
            ? b.content
            : Array.isArray(b.content) ? b.content.map((c) => c?.text ?? '').join('') : '';
          onSubagent?.({ phase: 'done', subId: b.tool_use_id, text: String(txt).slice(0, 600) });
          byTool.delete(b.tool_use_id);
        }
      }
    }
  };
}

// Samlet chat-dispatcher. Returnerer samlet tekst.
// onSubagent: kun for CLI'er der streamer strukturerede events (Claude stream-json).
export async function runChat({ serviceId, messages, cfg, dirs, onDelta, onSubagent, signal, cwd }) {
  const svc = serviceById(serviceId);
  if (!svc) throw new Error(`Ukendt tjeneste: ${serviceId}`);
  assertUsable(svc, cfg);
  const { providers } = aiCfg(cfg);
  const p = providers[serviceId] ?? {};
  let acc = '';
  const delta = (d) => { acc += d; onDelta?.(d, acc); };
  if (svc.kind === 'cli') {
    const prompt = messages.map(contentToText).join('\n\n---\n\n');
    const template = p.cliTemplate ?? svc.cliTemplate;
    // Claude køres med stream-json så Task-underagenter kan spores som egne linjer.
    // Brugerdefinerede skabeloner respekteres (så går subagent-sporing stille tabt).
    const useJson = serviceId === 'claude' && template === svc.cliTemplate;
    await chatCli({
      cmd: p.cmd ?? svc.cmd,
      cliTemplate: useJson ? `${template} --output-format stream-json --verbose` : template,
      prompt,
      cwd: cwd ?? dirs.cwd,
      jsonl: useJson,
      onDelta: delta,
      onEvent: useJson ? watchClaudeStreamJson({ onText: delta, onSubagent }) : undefined,
      signal,
    });
  } else if (svc.kind === 'local') {
    await chatOllama({ baseUrl: p.baseUrl ?? svc.baseUrl, model: p.model ?? svc.model, messages, onDelta: delta, signal });
  } else {
    const args = { baseUrl: p.baseUrl ?? svc.baseUrl, apiKey: p.apiKey, model: p.model ?? svc.model, messages, onDelta: delta, signal };
    if (serviceId === 'anthropic') await chatAnthropic(args);
    else if (serviceId === 'gemini') await chatGemini(args);
    else await chatOpenAiCompat(args); // openai, deepseek, moonshot, xai
  }
  return acc;
}

// ---- Medie-produktion (sub-api) ---------------------------------------------
async function elevenTts({ text, cfg, dirs }) {
  const { providers } = aiCfg(cfg);
  const p = providers.elevenlabs ?? {};
  const voice = p.model ?? '21m00Tcm4TlvDq8ikWAM';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': p.apiKey },
    body: JSON.stringify({ text: text.slice(0, 4500), model_id: 'eleven_multilingual_v2' }),
  });
  if (!r.ok) throw new Error(`ElevenLabs fejl ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const name = ` tale-${Date.now()}.mp3`;
  return saveArtifact(buf, name, dirs);
}

async function meshyTextTo3d({ prompt, cfg, dirs, onStatus }) {
  const { providers } = aiCfg(cfg);
  const p = providers.meshy ?? {};
  const r = await fetch('https://api.meshy.ai/v1/text-to-3d', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({ mode: 'preview', prompt, art_style: 'realistic' }),
  });
  if (!r.ok) throw new Error(`Meshy fejl ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const { result } = await r.json();
  for (let i = 0; i < 60; i++) {
    await new Promise((r2) => setTimeout(r2, 5000));
    const st = await (await fetch(`https://api.meshy.ai/v1/text-to-3d/${result}`, { headers: { Authorization: `Bearer ${p.apiKey}` } })).json();
    onStatus?.(`Meshy: ${st.status}`);
    if (st.status === 'SUCCEEDED') {
      const glb = await (await fetch(st.model_urls.glb)).arrayBuffer();
      return saveArtifact(Buffer.from(glb), ` model-${Date.now()}.glb`, dirs);
    }
    if (st.status === 'FAILED') throw new Error('Meshy 3D-generering slog fejl');
  }
  throw new Error('Meshy: timeout efter 5 minutter');
}

async function heygenAvatar({ text, cfg, dirs, onStatus }) {
  const { providers } = aiCfg(cfg);
  const p = providers.heygen ?? {};
  const r = await fetch('https://api.heygen.com/v2/video/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': p.apiKey },
    body: JSON.stringify({ video_inputs: [{ character: { type: 'avatar', avatar_id: p.avatarId ?? 'Kristin_public_3_20240108' }, voice: { type: 'text', input_text: text.slice(0, 1800), voice_id: p.voiceId ?? '2d5b0e6cf36f460aa60fa5876e7c0bc6' } }] }),
  });
  if (!r.ok) throw new Error(`HeyGen fejl ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const { data } = await r.json();
  for (let i = 0; i < 60; i++) {
    await new Promise((r2) => setTimeout(r2, 6000));
    const st = await (await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${data.video_id}`, { headers: { 'X-Api-Key': p.apiKey } })).json();
    onStatus?.(`HeyGen: ${st.data?.status}`);
    if (st.data?.status === 'completed') return { kind: 'link', name: 'heygen-video.mp4', url: st.data.video_url, mime: 'video/mp4' };
    if (st.data?.status === 'failed') throw new Error('HeyGen-video slog fejl');
  }
  throw new Error('HeyGen: timeout efter 6 minutter');
}

function saveArtifact(buf, name, dirs) {
  const id = randomUUID().slice(0, 8);
  const fname = `${id}${name.replace(/[^\w.\-() ]/g, '')}`;
  writeFileSync(join(dirs.artifacts, fname), buf);
  return { kind: 'file', name: name.trim(), url: `/api/ai/file/${fname}`, mime: guessMime(fname), size: buf.length };
}

function guessMime(n) {
  if (/\.mp3$/i.test(n)) return 'audio/mpeg';
  if (/\.glb$/i.test(n)) return 'model/gltf-binary';
  if (/\.png$/i.test(n)) return 'image/png';
  if (/\.jpe?g$/i.test(n)) return 'image/jpeg';
  if (/\.mp4$/i.test(n)) return 'video/mp4';
  return 'application/octet-stream';
}

// ---- Langtidshukommelse (idé 4 + 17) ----------------------------------------
// Per-service hukommelse: hver service husker hvad den tidligere har lavet.
// Kørsels-hukommelse: tværgående log over afsluttede kørsler der fodres til planlæggeren.
function serviceMemoryTail(dirs, serviceId) {
  try {
    const p = join(dirs.memory, `${serviceId}.md`);
    if (!existsSync(p)) return '';
    const txt = readFileSync(p, 'utf8');
    return txt.slice(-1400);
  } catch { return ''; }
}

function appendServiceMemory(dirs, serviceId, line) {
  try {
    mkdirSync(dirs.memory, { recursive: true });
    appendFileSync(join(dirs.memory, `${serviceId}.md`), `${line}\n`);
  } catch { /* hukommelse er ikke kritisk */ }
}

function runsMemoryTail(dirs) {
  try {
    const p = join(dirs.memory, 'runs.md');
    if (!existsSync(p)) return '';
    return readFileSync(p, 'utf8').slice(-1800);
  } catch { return ''; }
}

function appendRunMemory(dirs, run) {
  try {
    mkdirSync(dirs.memory, { recursive: true });
    const done = run.jobs.filter((j) => j.status === 'done').length;
    const errs = run.jobs.filter((j) => j.status === 'error').length;
    const line = `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · "${String(run.goal).slice(0, 90)}" · ${done}/${run.jobs.length} færdige${errs ? ` · ${errs} fejl` : ''} · orkestrator: ${run.orchestratorId ?? 'regler'}`;
    appendFileSync(join(dirs.memory, 'runs.md'), `${line}\n`);
  } catch { /* ikke kritisk */ }
}

// ---- Leverance-mapper + git per kørsel (idé 7 + 13) --------------------------
// Hver kørsel får sin egen arbejdsmappe med et git-repo; hvert job efterlader
// en leverance-fil (job-XX.md) som efterfølgende jobs læser direkte ind.
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9æøå]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'job';
}

function initRunWorkdir(runDir, goal) {
  try {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, '00-MÅL.md'), `# Mål\n\n${goal}\n`);
    execFile('git', ['init', '-q'], { cwd: runDir, timeout: 5000 }, () => {
      execFile('git', ['add', '-A'], { cwd: runDir, timeout: 5000 }, () => {
        execFile('git', ['-c', 'user.name=Orbit AI', '-c', 'user.email=orbit@local', 'commit', '-q', '-m', 'Start: mål', '--allow-empty'], { cwd: runDir, timeout: 5000 }, () => {});
      });
    });
  } catch { /* git er bedste forsøg */ }
}

function gitCommit(runDir, message) {
  try {
    execFile('git', ['add', '-A'], { cwd: runDir, timeout: 5000 }, () => {
      execFile('git', ['-c', 'user.name=Orbit AI', '-c', 'user.email=orbit@local', 'commit', '-q', '-m', message, '--allow-empty'], { cwd: runDir, timeout: 5000 }, () => {});
    });
  } catch { /* ikke kritisk */ }
}

function writeDeliverable(runDir, job, text) {
  try {
    const idx = job.id.replace(/\D/g, '').padStart(2, '0') || '00';
    const fname = `${idx}-${slugify(job.title)}.md`;
    writeFileSync(join(runDir, fname), `# ${job.title}\n\n**Fase:** ${job.phase} · **Tjeneste:** ${job.serviceId ?? '—'}\n\n${text}\n`);
    return fname;
  } catch { return null; }
}

function readDeliverables(runDir, jobs, dependsOn, doneText) {
  const out = [];
  for (const d of dependsOn) {
    const src = jobs[d];
    const text = src ? doneText.get(src.id) : null;
    if (src && typeof text === 'string' && text.trim()) {
      const idx = src.id.replace(/\D/g, '').padStart(2, '0') || '00';
      const fname = `${idx}-${slugify(src.title)}.md`;
      let body = text.slice(0, 2600);
      try {
        const p = join(runDir, fname);
        if (existsSync(p)) body = readFileSync(p, 'utf8').slice(0, 2600);
      } catch { /* brug tekst i stedet */ }
      out.push(`--- Leverance fra "${src.title}" (${fname}) ---\n${body}`);
    }
  }
  return out;
}

// ---- Omkostningsregnskab (idé 8) --------------------------------------------
// CLI/lokale = abonnement (0 kr). sub-api = abonnement-dækket men tælles.
// paid-api kan ikke nås uden allowPaidApis, så regnskab viser altid 0 kr for dem.
function recordUsage(run, serviceId) {
  const svc = serviceById(serviceId);
  if (!svc) return;
  run.usage = run.usage ?? { byService: {}, jobs: 0 };
  run.usage.jobs += 1;
  const cur = run.usage.byService[serviceId] ?? { jobs: 0, kind: svc.kind };
  cur.jobs += 1;
  run.usage.byService[serviceId] = cur;
}

function usageCostKr(usage) {
  let kr = 0;
  for (const [id, u] of Object.entries(usage?.byService ?? {})) {
    if (u.kind === 'paid-api') kr += u.jobs * 0.25; // estimat, når låst op
  }
  return Math.round(kr * 100) / 100;
}

// ---- Orkestrator: planlægning + eksekvering ----------------------------------
async function pickOrchestrator(cfg, availability) {
  const { prefs } = aiCfg(cfg);
  const order = [prefs.orchestrator, 'claude', 'codex', 'kimi', 'gemini', 'qwen'].filter(Boolean);
  for (const id of order) if (availability[id]?.available) return id;
  return null;
}

const PLAN_SCHEMA = `Svar KUN med JSON (intet andet): {"jobs":[{"title":string,"service":string,"phase":"koncept"|"design"|"prototype"|"produktion"|"test"|"polering"|"release","dependsOn":number[],"description":string}]}`;

async function planWithLLM({ orchestratorId, goal, bible, cfg, dirs, availability, extra }) {
  const roster = AI_SERVICES.map((s) => {
    const a = availability[s.id];
    return `- ${s.id} (${s.name}): stærke sider: ${s.strengths.join(', ')} — ${a?.available ? 'TILGÆNGELIG' : 'ikke tilgængelig'}`;
  }).join('\n');
  const runMem = runsMemoryTail(dirs);
  const prompt = `Du er orkestrator for et AI-drevet projekt. Mål: ${goal}\n\n${bible ? `Projektets bibel (roller/stil): ${bible.slice(0, 6000)}\n\n` : ''}${runMem ? `Tidligere kørsler (kontekst — undgå at gentage fejl):\n${runMem}\n\n` : ''}Roster:\n${roster}\n\nFordel arbejdet til de TILGÆNGELIGE tjenester efter deres stærke sider. 4-10 jobs med afhængigheder (dependsOn = indeks i listen, tidligere jobs). ${extra ?? ''} ${PLAN_SCHEMA}`;
  const raw = await runChat({ serviceId: orchestratorId, messages: [{ role: 'user', text: prompt }], cfg, dirs });
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Orkestratoren returnerede ikke en plan');
  const plan = JSON.parse(m[0]);
  if (!Array.isArray(plan.jobs)) throw new Error('Planen manglede jobs');
  return plan.jobs.map((j, i) => ({
    id: `job-${i}`,
    title: String(j.title ?? `Job ${i + 1}`),
    serviceId: availability[j.service]?.available ? j.service : null,
    phase: j.phase ?? 'produktion',
    dependsOn: Array.isArray(j.dependsOn) ? j.dependsOn.filter((d) => d < i) : [],
    description: String(j.description ?? ''),
  }));
}

// Regelbaseret fallback (ingen orkestrator tilgængelig): fordel efter styrker.
function planByRules({ goal, availability }) {
  const pick = (...ids) => ids.find((id) => availability[id]?.available) ?? null;
  const steps = [
    { title: 'Afklar mål og scope', svc: pick('claude', 'kimi', 'gemini', 'qwen'), phase: 'koncept', desc: `Afklar mål, scope og succeskriterier for: ${goal}` },
    { title: 'Design og struktur', svc: pick('gemini', 'claude', 'kimi'), phase: 'design', desc: 'Lav design, struktur og oversigt over leverancer.' },
    { title: 'Byg prototype', svc: pick('codex', 'qwen', 'claude'), phase: 'prototype', desc: 'Implementér en første prototype ud fra designet.' },
    { title: 'Produktion', svc: pick('codex', 'kimi', 'claude'), phase: 'produktion', desc: 'Færdiggør kerneproduktionen.' },
    { title: 'Medieproduktion', svc: pick('meshy', 'elevenlabs'), phase: 'produktion', desc: 'Lav nødvendige medieaktiver (3D/lyd) hvis relevant.' },
    { title: 'Test og feedback', svc: pick('gemini', 'claude'), phase: 'test', desc: 'Gennemgå resultatet, find fejl og forbedringer.' },
    { title: 'Polering', svc: pick('codex', 'claude'), phase: 'polering', desc: 'Ret og polér ud fra feedback.' },
    { title: 'Release', svc: pick('claude', 'kimi', 'codex'), phase: 'release', desc: 'Lav frigørelsesnoter og sidste tjek.' },
  ];
  const jobs = [];
  steps.forEach((s, i) => {
    if (!s.svc) return;
    jobs.push({ id: `job-${i}`, title: s.title, serviceId: s.svc, phase: s.phase, dependsOn: i === 0 ? [] : [i - 1], description: s.desc });
  });
  return jobs;
}

// ---- Specifikke kørselsformer (idé 2 + 12 + 18) -------------------------------
// Debattilstand: N gratis motorer svarer på samme spørgsmål; dommeren smelter sammen.
// Afstemning: dommeren vælger det bedste svar og begrunder.
// Rolle-pipeline: arkitekt → koder → reviewer (anden service!) → tester.
function buildDebatePlan({ goal, availability, vote }) {
  const free = ['claude', 'codex', 'kimi', 'gemini', 'qwen'].filter((id) => availability[id]?.available).slice(0, 3);
  if (free.length < 2) return null;
  const judge = ['claude', 'kimi', 'gemini', 'codex'].find((id) => availability[id]?.available);
  if (!judge) return null;
  const jobs = free.map((id, i) => ({
    id: `job-${i}`,
    title: vote ? `Svar fra ${availability[id].name}` : `Indlæg fra ${availability[id].name}`,
    serviceId: id,
    phase: 'koncept',
    dependsOn: [],
    description: vote
      ? `Besvar følgende så godt du kan (du deltager i en afstemning — giv dit bedste endelige svar):\n${goal}`
      : `Giv dit professionelle bud på følgende (du deltager i et panels debat):\n${goal}`,
  }));
  jobs.push({
    id: `job-${free.length}`,
    title: vote ? 'Dommer: vælg det bedste svar' : 'Dommer: saml debatten',
    serviceId: judge,
    phase: 'test',
    dependsOn: free.map((_, i) => i),
    description: vote
      ? `Du er dommer. Ovenstående svar kommer fra forskellige AI-modeller. Vælg det bedste svar, begrund dit valg, og præsentér derefter vinder-svaret som det endelige svar på: ${goal}`
      : `Du er ordstyrer. Ovenstående indlæg kommer fra forskellige AI-modeller. Sammenfag de bedste pointer fra hvert indlæg til ét samlet, skarpt svar på: ${goal}`,
  });
  return jobs;
}

function buildRolesPlan({ goal, availability, bible }) {
  const pick = (...ids) => ids.find((id) => availability[id]?.available) ?? null;
  const arch = pick('claude', 'kimi', 'gemini');
  const coder = pick('codex', 'qwen', 'kimi');
  const reviewer = pick('kimi', 'gemini', 'claude');
  const tester = pick('gemini', 'claude', 'codex');
  const jobs = [];
  if (arch) jobs.push({ id: 'job-0', title: 'Arkitekt: spec', serviceId: arch, phase: 'design', dependsOn: [], description: `Du er ARKITEKT. Skriv en kort, præcis spec (krav, struktur, filer, grænseflader) for: ${goal}.${bible ? ` Respekér projektets bibel.` : ''}` });
  if (coder) jobs.push({ id: `job-${jobs.length}`, title: 'Koder: implementér', serviceId: coder, phase: 'produktion', dependsOn: jobs.length ? [jobs.length - 1] : [], description: `Du er KODER. Implementér ud fra arkitektens spec. Aflever KØRbar, komplet kode — ingen stedholdere.` });
  if (reviewer) jobs.push({ id: `job-${jobs.length}`, title: 'Reviewer: gennemgang', serviceId: reviewer, phase: 'test', dependsOn: [jobs.length - 1], description: `Du er REVIEWER (en ANDEN model end koderen). Gennemgå koden kritisk: fejl, sikkerhed, kvalitet, bibel-overholdelse. Returnér en nummereret liste over fund + konkrete rettelser.` });
  if (tester) jobs.push({ id: `job-${jobs.length}`, title: 'Tester: verificér', serviceId: tester, phase: 'test', dependsOn: [jobs.length - 1], description: `Du er TESTER. Skriv og beskriv tests der verificerer løsningen, kør dem hvis muligt (ellers mentalt), og rapportér pas/fail + eventuelle rettelser.` });
  return jobs.length >= 2 ? jobs : null;
}

async function produceMedia(job, text, cfg, dirs, emit) {
  const p = (job.description + ' ' + text).toLowerCase();
  try {
    if (job.serviceId === 'elevenlabs') return [await elevenTts({ text: text || job.description, cfg, dirs })];
    if (job.serviceId === 'meshy') return [await meshyTextTo3d({ prompt: job.description || text.slice(0, 500), cfg, dirs, onStatus: (s) => emit({ type: 'job_status', jobId: job.id, status: s }) })];
    if (job.serviceId === 'heygen') return [await heygenAvatar({ text: text || job.description, cfg, dirs, onStatus: (s) => emit({ type: 'job_status', jobId: job.id, status: s }) })];
  } catch (e) {
    emit({ type: 'job_note', jobId: job.id, note: `Medieproduktion: ${e.message}` });
  }
  return [];
}

// ---- live swarm-tilstand (deles til alle WS-klienter) ----------------------
const swarmState = { active: null, last: null };
// Aktive kørsler med kontrol-håndtag: beskedindsprøjtning, skip, godkendelse, aflysning.
const activeRuns = new Map(); // runId -> { run, instructions: [], skip: Set, resolveApproval, mode }

function updateSwarm(run, obj) {
  try {
    if (obj.type === 'orchestrator') {
      run.orchestratorId = obj.serviceId ?? null;
      run.mode = obj.mode ?? null;
    } else if (obj.type === 'plan') {
      run.jobs = (obj.jobs ?? []).map((j) => ({
        ...j,
        status: 'queued',
        liveText: '',
        notes: [],
        deltaCount: 0,
        startedAt: null,
        finishedAt: null,
        text: '',
        artifacts: [],
        error: null,
        subagents: [],
      }));
    } else if (obj.type === 'subagent_start') {
      const j = run.jobs.find((x) => x.id === obj.jobId);
      if (j) {
        j.subagents = [
          ...(j.subagents ?? []).filter((s) => s.subId !== obj.subId),
          { subId: obj.subId, name: obj.name, status: 'running', startedAt: Date.now(), finishedAt: null, text: '' },
        ];
      }
    } else if (obj.type === 'subagent_delta') {
      const j = run.jobs.find((x) => x.id === obj.jobId);
      const s = j?.subagents?.find((x) => x.subId === obj.subId);
      if (s) s.text = ((s.text ?? '') + String(obj.delta ?? '')).slice(-300);
    } else if (obj.type === 'subagent_done') {
      const j = run.jobs.find((x) => x.id === obj.jobId);
      const s = j?.subagents?.find((x) => x.subId === obj.subId);
      if (s) { s.status = 'done'; s.text = String(obj.text ?? '').slice(0, 400); s.finishedAt = Date.now(); }
    } else if (obj.type === 'job_start') {
      const j = run.jobs.find((x) => x.id === obj.job?.id);
      if (j) { j.status = 'running'; j.startedAt = Date.now(); }
    } else if (obj.type === 'job_delta') {
      const j = run.jobs.find((x) => x.id === obj.jobId);
      if (j) {
        j.deltaCount = (j.deltaCount ?? 0) + 1;
        j.liveText = ((j.liveText ?? '') + String(obj.delta ?? '')).slice(-400);
        j.lastDeltaAt = Date.now();
      }
    } else if (obj.type === 'job_status') {
      const j = run.jobs.find((x) => x.id === obj.jobId);
      if (j) j.notes = [...(j.notes ?? []).slice(-3), String(obj.status ?? '')];
    } else if (obj.type === 'job_note') {
      if (obj.jobId) {
        const j = run.jobs.find((x) => x.id === obj.jobId);
        if (j) j.notes = [...(j.notes ?? []).slice(-3), String(obj.note ?? '')];
      } else {
        run.notes = [...(run.notes ?? []).slice(-4), String(obj.note ?? '')];
      }
    } else if (obj.type === 'job_skipped') {
      const j = run.jobs.find((x) => x.id === obj.jobId);
      if (j) { j.status = 'done'; j.text = '(sprunget over)'; j.finishedAt = Date.now(); }
    } else if (obj.type === 'job_done') {
      const r = obj.result ?? {};
      const j = run.jobs.find((x) => x.id === r.jobId);
      if (j) {
        j.status = 'done';
        j.text = String(r.text ?? '').slice(0, 2000);
        j.artifacts = r.artifacts ?? [];
        j.finishedAt = Date.now();
      }
    } else if (obj.type === 'job_error') {
      const j = run.jobs.find((x) => x.id === obj.jobId);
      if (j) { j.status = 'error'; j.error = String(obj.error ?? ''); j.finishedAt = Date.now(); }
    } else if (obj.type === 'job_healing') {
      const j = run.jobs.find((x) => x.id === obj.jobId);
      if (j) { j.status = 'running'; j.notes = [...(j.notes ?? []).slice(-3), `Selvhealing: forsøger igen (${obj.attempt}. forsøg)`]; }
    }
  } catch { /* swarm-tilstand er ikke kritisk */ }
}

// ---- Hierarkiske teams (idé 1/11) --------------------------------------------
// Et job markeret med team: true fungerer som holdleder: orkestratoren laver en
// underplan for delmålet, og holdet kører som en lille under-sværm med egne
// subagent-linjer (inkl. live-tekst) i sværm-visningen.
async function runTeamJob({ job, handle, goal, bible, cfg, dirs, availability, orchestratorId, track }) {
  const subGoal = job.description || job.title;
  track({ type: 'job_note', jobId: job.id, note: `Holdleder planlægger: ${subGoal.slice(0, 120)}` });
  let subJobs;
  if (orchestratorId) {
    try {
      subJobs = (await planWithLLM({ orchestratorId, goal: `${goal} — DELMÅL: ${subGoal}`, bible, cfg, dirs, availability, extra: 'Lav 2-4 SMÅ jobs til netop dette delmål.' })).slice(0, 4);
    } catch { subJobs = null; }
  }
  if (!subJobs || !subJobs.length) {
    subJobs = [
      { id: 'sub-0', title: `Udfør: ${job.title}`, serviceId: job.serviceId, phase: job.phase, dependsOn: [], description: subGoal },
      { id: 'sub-1', title: 'Kvalitetstjek', serviceId: orchestratorId ?? job.serviceId, phase: 'test', dependsOn: [0], description: `Gennemgå resultatet af "${job.title}" og ret de vigtigste fejl.` },
    ];
  }
  const texts = [];
  const pending = new Set(subJobs.map((j) => j.id));
  const running = new Set();
  const runSub = async (sj) => {
    const subId = `${job.id}:${sj.id}`;
    track({ type: 'subagent_start', jobId: job.id, subId, name: sj.title });
    const ctx = [
      bible ? { role: 'system', text: `Projektets bibel:\n${bible.slice(0, 4000)}\n\nOverordnet mål: ${goal}` } : { role: 'user', text: `Overordnet mål: ${goal}` },
      { role: 'user', text: `Du er en del af holdet "${job.title}". Din opgave: ${sj.description}\n\nLav et konkret, færdigt resultat. Svar på dansk.` },
    ].filter(Boolean);
    try {
      let acc = '';
      const text = await runChat({
        serviceId: sj.serviceId, messages: ctx, cfg, dirs, cwd: handle.runDir,
        onDelta: (d) => { acc = (acc + d).slice(-300); track({ type: 'subagent_delta', jobId: job.id, subId, delta: d }); },
        onSubagent: (sub) => track({ type: sub.phase === 'start' ? 'subagent_start' : 'subagent_done', jobId: job.id, ...sub }),
      });
      texts.push(`## ${sj.title}\n${text}`);
      track({ type: 'subagent_done', jobId: job.id, subId, text });
    } catch (e) {
      track({ type: 'subagent_done', jobId: job.id, subId, text: `Fejl: ${e.message}` });
    }
    pending.delete(sj.id);
  };
  for (;;) {
    const ready = subJobs.filter((j) => pending.has(j.id) && !running.has(j.id) && j.dependsOn.every((d) => !pending.has(subJobs[d]?.id)));
    while (ready.length && running.size < 2) {
      const sj = ready.shift();
      running.add(sj.id);
      runSub(sj).finally(() => running.delete(sj.id));
    }
    if (!running.size && !ready.length) break;
    if (handle.skip.has(job.id)) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  return texts.join('\n\n');
}

// ---- Hovedkørsel --------------------------------------------------------------
async function executeRun({ runId, goal, bible, predefinedJobs, cfg, dirs, emit, mode = 'standard', pauseAfterPlan = false }) {
  const run = {
    runId, goal,
    mode,
    startedAt: Date.now(),
    orchestratorId: null,
    status: 'running',
    jobs: [],
    notes: [],
    events: [],
    usage: { byService: {}, jobs: 0 },
    instructions: [],
    finishedAt: null,
  };
  const handle = { run, instructions: run.instructions, skip: new Set(), runDir: join(dirs.runs, 'work', runId), cancelled: false };
  activeRuns.set(runId, handle);
  initRunWorkdir(handle.runDir, goal);
  swarmState.active = run;
  // Event-log til replay/simulering: alle strukturelle hændelser med tidsstempel.
  const track = (obj) => {
    if (!['job_delta', 'delta'].includes(obj.type)) run.events.push({ at: Date.now(), ...obj });
    else if ((run.events.length === 0 || run.events[run.events.length - 1].type !== 'job_delta')) run.events.push({ at: Date.now(), type: 'job_delta', jobId: obj.jobId });
    updateSwarm(run, obj);
    emit({ ...obj, runId, goal });
  };
  try {
  track({ type: 'run_start', runId, goal, startedAt: new Date().toISOString() });
  const availability = await serviceAvailability(cfg);
  const orchestratorId = await pickOrchestrator(cfg, availability);
  track({ type: 'orchestrator', serviceId: orchestratorId, mode: orchestratorId ? 'llm' : 'regler' });

  let jobs;
  if (Array.isArray(predefinedJobs) && predefinedJobs.length) {
    jobs = predefinedJobs;
  } else if (mode === 'debate' || mode === 'vote') {
    jobs = buildDebatePlan({ goal, availability, vote: mode === 'vote' })
      ?? planByRules({ goal, availability });
    if (!jobs.some((j) => j.title.startsWith('Dommer'))) track({ type: 'job_note', jobId: null, note: 'For få gratis motorer til debat — bruger standardplan.' });
  } else if (mode === 'roles') {
    jobs = buildRolesPlan({ goal, availability, bible })
      ?? planByRules({ goal, availability });
  } else if (orchestratorId) {
    try { jobs = await planWithLLM({ orchestratorId, goal, bible, cfg, dirs, availability }); }
    catch (e) { track({ type: 'job_note', jobId: null, note: `Orkestrator-plan fejlede (${e.message}) — bruger regelbaseret plan.` }); jobs = planByRules({ goal, availability }); }
  } else {
    jobs = planByRules({ goal, availability });
  }

  // Godkendelsespause (idé 1/2): planen sendes til klienten og kørslen venter,
  // indtil brugeren godkender — evt. med redigerede jobs.
  if (pauseAfterPlan) {
    const evt = { type: 'plan', jobs: jobs.map(({ id, title, serviceId, phase, dependsOn, description }) => ({ id, title, serviceId, phase, dependsOn, description })) };
    run.events.push({ at: Date.now(), ...evt });
    updateSwarm(run, evt);
    emit({ ...evt, runId, goal, paused: true });
    jobs = await new Promise((resolve) => {
      handle.jobsSnapshot = jobs;
      handle.resolveApproval = resolve;
      // Auto-godkend efter 10 min, så kørslen aldrig hænger uendeligt.
      handle.approvalTimer = setTimeout(() => { if (handle.resolveApproval) resolve(handle.jobsSnapshot ?? []); }, 10 * 60 * 1000);
    });
    clearTimeout(handle.approvalTimer);
    handle.resolveApproval = null;
    jobs = (jobs ?? []).map((j, i) => ({
      id: j.id ?? `job-${i}`,
      title: String(j.title ?? `Job ${i + 1}`),
      serviceId: j.serviceId && availability[j.serviceId]?.available ? j.serviceId : j.serviceId,
      phase: j.phase ?? 'produktion',
      dependsOn: Array.isArray(j.dependsOn) ? j.dependsOn : [],
      description: String(j.description ?? ''),
    })).filter((j) => j.title.trim());
    track({ type: 'job_note', jobId: null, note: `Plan godkendt — ${jobs.length} jobs kører nu.` });
  }
  if (handle.cancelled) throw new Error('Kørslen er aflyst af brugeren.');
  track({ type: 'plan', jobs: jobs.map(({ id, title, serviceId, phase, dependsOn, description, team }) => ({ id, title, serviceId, phase, dependsOn, description, team: Boolean(team) })) });

  const doneText = new Map();
  const results = [];
  const pending = new Set(jobs.map((j) => j.id));
  const { prefs } = aiCfg(cfg);

  const runJob = async (job) => {
    if (handle.skip.has(job.id)) {
      track({ type: 'job_skipped', jobId: job.id });
      doneText.set(job.id, '');
      pending.delete(job.id);
      return;
    }
    if (handle.cancelled) { pending.delete(job.id); return; }
    track({ type: 'job_start', job });

    const serviceMemory = serviceMemoryTail(dirs, job.serviceId);
    const userInstructions = run.instructions.length
      ? [{ role: 'user', text: `INSTRUKTIONER FRA BRUGEREN (gælder for resten af kørslen — følg dem):\n${run.instructions.map((x, i) => `${i + 1}. ${x}`).join('\n')}` }]
      : [];
    const deliverables = readDeliverables(handle.runDir, jobs, job.dependsOn, doneText);
    const baseCtx = [
      bible ? { role: 'system', text: `Projektets bibel:\n${bible.slice(0, 6000)}` } : null,
      serviceMemory ? { role: 'system', text: `Hvad du tidligere har lavet for denne bruger (din hukommelse):\n${serviceMemory}` } : null,
      ...userInstructions,
      { role: 'user', text: `Projektmål: ${goal}\n\nDin opgave (${job.phase}): ${job.title}\n${job.description}\n\nLav et konkret, færdigt resultat. Svar på dansk.` },
      ...deliverables.map((d) => ({ role: 'user', text: d })),
    ].filter(Boolean);

    const attempt = async (extra) => {
      const text = job.team
        ? await runTeamJob({ job, run, handle, goal, bible, cfg, dirs, availability, orchestratorId, emit, track })
        : await runChat({
            serviceId: job.serviceId, messages: [...baseCtx, ...extra], cfg, dirs, cwd: handle.runDir,
            onDelta: (d) => track({ type: 'job_delta', jobId: job.id, delta: d }),
            onSubagent: (sub) => track({ type: sub.phase === 'start' ? 'subagent_start' : 'subagent_done', jobId: job.id, ...sub }),
          });
      return text;
    };

    try {
      let text;
      try {
        text = await attempt([]);
      } catch (e1) {
        // Selvhealing (idé 3): ét genforsøg med fejlen som kontekst.
        if (prefs.selfHeal && !handle.skip.has(job.id) && !handle.cancelled) {
          track({ type: 'job_healing', jobId: job.id, attempt: 2, error: String(e1.message).slice(0, 300) });
          track({ type: 'job_note', jobId: job.id, note: 'Forsøger igen med fejlkontekst (selvhealing).' });
          text = await attempt([{ role: 'user', text: `Dit første forsøg slog fejl med: "${e1.message}". Ret årsagen og leverér resultatet.` }]);
        } else {
          throw e1;
        }
      }
      recordUsage(run, job.serviceId);
      appendServiceMemory(dirs, job.serviceId, `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · "${job.title}" · ${text.length} tegn leveret`);
      const fname = writeDeliverable(handle.runDir, job, text);
      if (fname) gitCommit(handle.runDir, `${job.title}`);
      doneText.set(job.id, text);
      const artifacts = await produceMedia(job, text, cfg, dirs, track);
      const res = { jobId: job.id, title: job.title, serviceId: job.serviceId, phase: job.phase, text, artifacts, deliverable: fname };
      results.push(res);
      track({ type: 'job_done', result: res });
    } catch (e) {
      recordUsage(run, job.serviceId);
      track({ type: 'job_error', jobId: job.id, error: e.message });
    }
    pending.delete(job.id);
  };

  // Kør i topologisk rækkefølge, op til 2 parallelt.
  const running = new Set();
  for (;;) {
    if (handle.cancelled) break;
    const ready = jobs.filter((j) => pending.has(j.id) && !running.has(j.id) && j.dependsOn.every((d) => !pending.has(jobs[d]?.id)));
    while (ready.length && running.size < 2) {
      const job = ready.shift();
      running.add(job.id);
      runJob(job).finally(() => running.delete(job.id));
    }
    if (!running.size && !ready.length) {
      const stuck = jobs.filter((j) => pending.has(j.id));
      if (stuck.length) track({ type: 'job_note', jobId: null, note: `${stuck.length} job(s) sprunget over pga. afhængigheder: ${stuck.map((j) => j.title).join(', ')}` });
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  run.status = handle.cancelled ? 'error' : 'running';
  writeFileSync(join(dirs.runs, `${runId}.json`), JSON.stringify({ runId, goal, mode, orchestratorId, jobs: run.jobs, results, usage: run.usage, events: run.events, finishedAt: new Date().toISOString() }, null, 2));
  appendRunMemory(dirs, run);
  gitCommit(handle.runDir, 'Kørsel afsluttet');
  track({ type: 'done', summary: results.map((r) => ({ title: r.title, serviceId: r.serviceId })) });
  } finally {
    activeRuns.delete(runId);
    if (swarmState.active === run) {
      if (run.status === 'running') run.status = handle.cancelled ? 'error' : 'done';
      run.finishedAt = Date.now();
      swarmState.last = run;
      swarmState.active = null;
    }
  }
}

// ---- Pipeline-skabeloner (idé 16) ---------------------------------------------
const BUILTIN_TEMPLATES = [
  {
    id: 'tpl-spilfabrikken', builtin: true, name: 'Spilfabrikken',
    description: 'Koncept → konceptkunst → 3D-model → kode → lyd → trailer → release-note',
    jobs: [
      { id: 'job-0', title: 'Koncept og spildesign', serviceId: 'kimi', phase: 'koncept', dependsOn: [], description: 'Lav et kompakt spilkoncept: kernemekanik, målgruppe, stemning og 3 sælgende bulletpoints.' },
      { id: 'job-1', title: 'Visuel retning', serviceId: 'gemini', phase: 'design', dependsOn: [0], description: 'Beskriv den visuelle stil, farvepalet og karakterdesign ud fra konceptet.' },
      { id: 'job-2', title: '3D-hovedkarakter (Meshy)', serviceId: 'meshy', phase: 'produktion', dependsOn: [1], description: 'Generér hovedkarakteren som 3D-model ud fra den visuelle retning.' },
      { id: 'job-3', title: 'Spilkode-prototype', serviceId: 'codex', phase: 'prototype', dependsOn: [0], description: 'Byg en kørbar prototype af kernemekanikken. Brug beskrivelsen af karakteren som input.' },
      { id: 'job-4', title: 'Lydlogo og stemning (ElevenLabs)', serviceId: 'elevenlabs', phase: 'produktion', dependsOn: [1], description: 'Skriv en kort åbningstale/voiceover til traileren, ca. 3 sætninger, dramatisk.' },
      { id: 'job-5', title: 'Trailer-script (HeyGen)', serviceId: 'heygen', phase: 'release', dependsOn: [4], description: 'Lav en præsentationstale til spillet på ca. 4 sætninger der sælger konceptet.' },
      { id: 'job-6', title: 'Release-note', serviceId: 'claude', phase: 'release', dependsOn: [3, 5], description: 'Skriv en frigørelsesnote der samler koncept, features og medier.' },
    ],
  },
  {
    id: 'tpl-hurtig-feature', builtin: true, name: 'Hurtig feature',
    description: 'Spec → kode → review — én feature fra idé til reviewed kode',
    jobs: [
      { id: 'job-0', title: 'Skriv spec', serviceId: 'claude', phase: 'koncept', dependsOn: [], description: 'Skriv en kort spec for featuren: formål, grænseflade, edge cases, testkriterier.' },
      { id: 'job-1', title: 'Implementér', serviceId: 'codex', phase: 'produktion', dependsOn: [0], description: 'Implementér featuren præcist efter spec. Aflever komplet kode.' },
      { id: 'job-2', title: 'Review', serviceId: 'kimi', phase: 'test', dependsOn: [1], description: 'Review koden som en kritisk seniorudvikler. Find fejl og foreslå konkrete rettelser.' },
    ],
  },
  {
    id: 'tpl-indholdspakke', builtin: true, name: 'Indholdspakke',
    description: 'Emne → tekst → lyd → video — færdig indholdspakke til ét emne',
    jobs: [
      { id: 'job-0', title: 'Vinkel og disposition', serviceId: 'gemini', phase: 'koncept', dependsOn: [], description: 'Find den skarpeste vinkel og lav en disposition i 5 punkter.' },
      { id: 'job-1', title: 'Tekst', serviceId: 'kimi', phase: 'produktion', dependsOn: [0], description: 'Skriv den færdige tekst ud fra dispositionen — klar til oplæsning.' },
      { id: 'job-2', title: 'Oplæsning (ElevenLabs)', serviceId: 'elevenlabs', phase: 'produktion', dependsOn: [1], description: 'Lav en MP3-tale af teksten.' },
      { id: 'job-3', title: 'Video-tale (HeyGen)', serviceId: 'heygen', phase: 'release', dependsOn: [1], description: 'Lav en avatar-video der præsenterer teksten.' },
    ],
  },
];

function loadTemplates(dirs) {
  try {
    const p = join(dirs.runs, 'ai-templates.json');
    const user = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
    return [...BUILTIN_TEMPLATES, ...(Array.isArray(user) ? user : [])];
  } catch { return BUILTIN_TEMPLATES; }
}

function saveUserTemplates(dirs, list) {
  try {
    writeFileSync(join(dirs.runs, 'ai-templates.json'), JSON.stringify(list.filter((t) => !t.builtin), null, 2));
  } catch { /* ikke kritisk */ }
}

// ---- Autonome triggere (idé 15) ------------------------------------------------
// cron: minut-baseret plan (5 felter, * , og */n understøttes) — kører et mål på fast tidspunkt.
// webhook: POST /api/ai/hook/<token> starter kørslen (fx fra GitHub eller en færdig Meshy-job).
function cronMatches(expr, date) {
  const fields = String(expr ?? '').trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const vals = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()];
  return fields.every((f, i) => {
    if (f === '*') return true;
    const m = f.match(/^\*\/(\d+)$/);
    if (m) return vals[i] % Number(m[1]) === 0;
    return Number(f) === vals[i];
  });
}

let triggerTimer = null;
function startTriggerScheduler({ loadConfig, dirs, broadcast }) {
  if (triggerTimer) return;
  const lastFire = new Map();
  triggerTimer = setInterval(async () => {
    try {
      const cfg = loadConfig();
      const triggers = cfg.aiTriggers ?? [];
      if (!triggers.length) return;
      const now = new Date();
      const minuteKey = now.toISOString().slice(0, 16);
      for (const tr of triggers) {
        if (tr.kind !== 'cron' || !tr.enabled) continue;
        if (!cronMatches(tr.cron, now)) continue;
        if (lastFire.get(tr.id) === minuteKey) continue;
        lastFire.set(tr.id, minuteKey);
        if (swarmState.active) { broadcast?.({ type: 'toast', level: 'info', text: `Trigger "${tr.name}" sprunget over — en kørsel er allerede aktiv.` }); continue; }
        const runId = randomUUID().slice(0, 12);
        broadcast?.({ type: 'toast', level: 'info', text: `Trigger "${tr.name}" starter en kørsel: ${String(tr.goal).slice(0, 80)}` });
        executeRun({ runId, goal: tr.goal, bible: tr.bible ?? '', cfg, dirs, mode: tr.mode ?? 'standard', emit: (obj) => broadcast?.({ kind: 'ai', ...obj, runId }) }).catch(() => {});
      }
    } catch { /* triggerfejl må ikke crashe companion */ }
  }, 15_000);
}

// ---- HTTP-ruter --------------------------------------------------------------
export function registerAiRoutes(app, { loadConfig, saveConfig, broadcast, APP_DIR, EXPORT_DIR }) {
  const dirs = {
    uploads: join(APP_DIR, 'ai-uploads'),
    artifacts: join(APP_DIR, 'ai-artifacts'),
    runs: join(APP_DIR, 'ai-runs'),
    memory: join(APP_DIR, 'ai-memory'),
    cwd: process.cwd(),
  };
  for (const d of Object.values(dirs)) if (typeof d === 'string') mkdirSync(d, { recursive: true });

  startTriggerScheduler({ loadConfig, dirs, broadcast });

  const sse = (res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write('retry: 2000\n\n');
    const lastWs = new Map();
    return (obj) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      // Throttle hurtige delta-hændelser over WebSocket, så swarm-visningen ikke oversvømmes.
      const key = obj.jobId ? `${obj.type}:${obj.jobId}` : obj.type;
      const now = Date.now();
      if (obj.type === 'delta' || obj.type === 'job_delta') {
        const t0 = lastWs.get(key) ?? 0;
        if (now - t0 < 120) return;
        lastWs.set(key, now);
      }
      broadcast?.({ kind: 'ai', ...obj });
    };
  };

  app.get('/api/ai/services', async (_req, res) => {
    const cfg = loadConfig();
    res.json({ ok: true, services: await serviceAvailability(cfg), prefs: aiCfg(cfg).prefs });
  });

  app.post('/api/ai/prefs', (req, res) => {
    const cfg = loadConfig();
    cfg.aiPrefs = { allowPaidApis: false, ...(cfg.aiPrefs ?? {}), ...(req.body ?? {}) };
    saveConfig(cfg);
    res.json({ ok: true, prefs: cfg.aiPrefs });
  });

  app.post('/api/ai/services/:id', (req, res) => {
    const svc = serviceById(req.params.id);
    if (!svc) return res.status(404).json({ ok: false, reason: 'ukendt tjeneste' });
    const cfg = loadConfig();
    cfg.aiProviders = cfg.aiProviders ?? {};
    const cur = cfg.aiProviders[svc.id] ?? {};
    const { enabled, apiKey, model, cmd, cliTemplate, baseUrl, avatarId, voiceId } = req.body ?? {};
    cfg.aiProviders[svc.id] = {
      ...cur,
      ...(enabled !== undefined ? { enabled } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(apiKey === '' ? { apiKey: undefined } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(cmd ? { cmd } : {}),
      ...(cliTemplate ? { cliTemplate } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(avatarId ? { avatarId } : {}),
      ...(voiceId ? { voiceId } : {}),
    };
    saveConfig(cfg);
    res.json({ ok: true });
  });

  // Upload: {name, mime, dataBase64} → gemt på disk; billeder kan indlæses som data-URL.
  app.post('/api/ai/upload', (req, res) => {
    const { name, mime, dataBase64 } = req.body ?? {};
    if (!name || !dataBase64) return res.status(400).json({ ok: false, reason: 'name og dataBase64 kræves' });
    const buf = Buffer.from(dataBase64, 'base64');
    if (buf.length > 25 * 1024 * 1024) return res.status(413).json({ ok: false, reason: 'Filen er over 25 MB' });
    const id = randomUUID().slice(0, 8);
    const safe = String(name).replace(/[^\w.\-() ]/g, '_').slice(-80);
    writeFileSync(join(dirs.uploads, `${id}-${safe}`), buf);
    const isImage = String(mime).startsWith('image/');
    res.json({ ok: true, file: { id, name: String(name), mime: String(mime), size: buf.length, url: `/api/ai/file/${id}-${safe}`, path: join(dirs.uploads, `${id}-${safe}`), kind: isImage ? 'image' : 'file', dataUrl: isImage ? `data:${mime};base64,${buf.toString('base64')}` : undefined } });
  });

  app.get('/api/ai/file/:name', (req, res) => {
    for (const base of [dirs.uploads, dirs.artifacts]) {
      const p = join(base, req.params.name);
      if (existsSync(p) && p.startsWith(base)) return res.sendFile(p);
    }
    res.status(404).end();
  });

  // Live swarm-tilstand: aktiv kørsel eller seneste afsluttede.
  app.get('/api/ai/swarm', (_req, res) => {
    res.json({ ok: true, run: swarmState.active ?? swarmState.last });
  });

  app.get('/api/ai/runs', (_req, res) => {
    const runs = readdirSync(dirs.runs).filter((f) => f.endsWith('.json')).map((f) => {
      try { return { file: f, ...JSON.parse(readFileSync(join(dirs.runs, f), 'utf8')) }; } catch { return null; }
    }).filter(Boolean).sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt))).slice(0, 20);
    res.json({ ok: true, runs });
  });

  // ---- kørselskontrol: godkend plan / besked til orkestrator / skip / aflys ----
  app.post('/api/ai/runs/:runId/approve', (req, res) => {
    const h = activeRuns.get(req.params.runId);
    if (!h?.resolveApproval) return res.status(409).json({ ok: false, reason: 'Ingen kørsel afventer godkendelse.' });
    h.resolveApproval(Array.isArray(req.body?.jobs) ? req.body.jobs : h.jobsSnapshot ?? []);
    res.json({ ok: true });
  });

  app.post('/api/ai/runs/:runId/message', (req, res) => {
    const h = activeRuns.get(req.params.runId);
    const text = String(req.body?.text ?? '').trim();
    if (!h) return res.status(409).json({ ok: false, reason: 'Ingen aktiv kørsel.' });
    if (!text) return res.status(400).json({ ok: false, reason: 'Tom besked.' });
    h.instructions.push(text);
    h.run.notes = [...(h.run.notes ?? []).slice(-4), `Besked fra dig: ${text.slice(0, 120)}`];
    broadcast?.({ kind: 'ai', type: 'job_note', jobId: null, note: `Besked fra dig: ${text.slice(0, 120)}`, runId: req.params.runId });
    res.json({ ok: true, instructions: h.instructions });
  });

  app.post('/api/ai/runs/:runId/skip', (req, res) => {
    const h = activeRuns.get(req.params.runId);
    if (!h) return res.status(409).json({ ok: false, reason: 'Ingen aktiv kørsel.' });
    const jobId = String(req.body?.jobId ?? '');
    h.skip.add(jobId);
    const j = h.run.jobs.find((x) => x.id === jobId);
    if (j && j.status === 'queued') { j.status = 'done'; j.text = '(sprunget over)'; j.finishedAt = Date.now(); }
    broadcast?.({ kind: 'ai', type: 'job_skipped', runId: req.params.runId, jobId });
    res.json({ ok: true });
  });

  app.post('/api/ai/runs/:runId/cancel', (req, res) => {
    const h = activeRuns.get(req.params.runId);
    if (!h) return res.status(409).json({ ok: false, reason: 'Ingen aktiv kørsel.' });
    h.cancelled = true;
    h.skip.add('*');
    if (h.resolveApproval) h.resolveApproval([]);
    h.run.notes = [...(h.run.notes ?? []).slice(-4), 'Kørslen aflyses — afventer igangværende job.'];
    res.json({ ok: true });
  });

  // ---- omkostningsregnskab ----
  app.get('/api/ai/costs', (_req, res) => {
    try {
      const byService = {};
      let totalJobs = 0, totalRuns = 0, estKr = 0;
      for (const f of readdirSync(dirs.runs).filter((f) => f.endsWith('.json')).slice(0, 60)) {
        let run;
        try { run = JSON.parse(readFileSync(join(dirs.runs, f), 'utf8')); } catch { continue; }
        if (!run.usage) continue;
        totalRuns += 1;
        totalJobs += run.usage.jobs ?? 0;
        estKr += usageCostKr(run.usage);
        for (const [id, u] of Object.entries(run.usage.byService ?? {})) {
          const cur = byService[id] ?? { id, jobs: 0, kind: u.kind };
          cur.jobs += u.jobs;
          byService[id] = cur;
        }
      }
      const services = Object.values(byService).map((u) => ({
        ...u,
        name: serviceById(u.id)?.name ?? u.id,
        subscriptionCovered: serviceById(u.id)?.kind === 'sub-api' || serviceById(u.id)?.kind === 'cli' || serviceById(u.id)?.kind === 'local',
        estKr: serviceById(u.id)?.kind === 'paid-api' ? Math.round(u.jobs * 0.25 * 100) / 100 : 0,
      })).sort((a, b) => b.jobs - a.jobs);
      res.json({ ok: true, totalRuns, totalJobs, estKr: Math.round(estKr * 100) / 100, byService: services });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // ---- pipeline-skabeloner ----
  app.get('/api/ai/templates', (_req, res) => res.json({ ok: true, templates: loadTemplates(dirs) }));

  app.post('/api/ai/templates', (req, res) => {
    const { name, description, jobs } = req.body ?? {};
    if (!name || !Array.isArray(jobs) || !jobs.length) return res.status(400).json({ ok: false, reason: 'name og jobs kræves' });
    const tpl = { id: `tpl-${randomUUID().slice(0, 8)}`, name: String(name).slice(0, 80), description: String(description ?? ''), jobs: jobs.slice(0, 20), createdAt: new Date().toISOString() };
    const user = loadTemplates(dirs).filter((t) => !t.builtin);
    user.push(tpl);
    saveUserTemplates(dirs, user);
    res.json({ ok: true, template: tpl });
  });

  app.delete('/api/ai/templates/:id', (req, res) => {
    const all = loadTemplates(dirs);
    const target = all.find((t) => t.id === req.params.id);
    if (!target) return res.status(404).json({ ok: false, reason: 'Skabelon ikke fundet' });
    if (target.builtin) return res.status(400).json({ ok: false, reason: 'Indbyggede skabeloner kan ikke slettes' });
    saveUserTemplates(dirs, all.filter((t) => t.id !== req.params.id));
    res.json({ ok: true });
  });

  // Selvforbedrende orkestrator (idé 20): foreslå en pipeline ud fra én sætning.
  app.post('/api/ai/templates/suggest', async (req, res) => {
    const { goal, bible } = req.body ?? {};
    if (!goal) return res.status(400).json({ ok: false, reason: 'goal kræves' });
    const cfg = loadConfig();
    try {
      const availability = await serviceAvailability(cfg);
      const orchestratorId = await pickOrchestrator(cfg, availability);
      if (!orchestratorId) return res.status(409).json({ ok: false, reason: 'Ingen orkestrator tilgængelig (installér et CLI).' });
      const jobs = await planWithLLM({ orchestratorId, goal: String(goal), bible: String(bible ?? ''), cfg, dirs, availability });
      res.json({ ok: true, jobs, orchestratorId });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // ---- bibel-assistent ----
  app.post('/api/ai/bible/suggest', async (req, res) => {
    const { project, current, notes } = req.body ?? {};
    const cfg = loadConfig();
    try {
      const availability = await serviceAvailability(cfg);
      const orchestratorId = await pickOrchestrator(cfg, availability);
      if (!orchestratorId) return res.status(409).json({ ok: false, reason: 'Ingen orkestrator tilgængelig (installér et CLI).' });
      const prompt = `Skriv en projekt-bibel (rollebog) for projektet "${project ?? 'Uden navn'}". ${notes ? `Stikord/noter fra brugeren:\n${String(notes).slice(0, 3000)}\n\n` : ''}${current ? `Nuværende udkast:\n${String(current).slice(0, 2000)}\n\nForbedr og udbyg det.` : ''}Bibelen skal fastlægge: overordnet vision/stil, hvilken AI-tjeneste der har hvilken rolle (kodning, design, 3D, lyd, video, review), tone/sprog og kvalitetskrav. Skriv den på dansk, kompakt (max 400 ord), så den kan prependes til enhver agent-prompt.`;
      const text = await runChat({ serviceId: orchestratorId, messages: [{ role: 'user', text: prompt }], cfg, dirs });
      res.json({ ok: true, bible: text.trim() });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // ---- autonome triggere ----
  app.get('/api/ai/triggers', (_req, res) => {
    const cfg = loadConfig();
    const triggers = (cfg.aiTriggers ?? []).map((tr) => ({
      ...tr,
      webhookUrl: tr.kind === 'webhook' ? `/api/ai/hook/${tr.token}` : null,
    }));
    res.json({ ok: true, triggers });
  });

  app.post('/api/ai/triggers', (req, res) => {
    const { name, kind, cron, goal, bible, mode } = req.body ?? {};
    if (!name || !goal) return res.status(400).json({ ok: false, reason: 'name og goal kræves' });
    if (kind === 'cron' && !cronMatches(cron, new Date()) && !/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(String(cron ?? ''))) {
      return res.status(400).json({ ok: false, reason: 'cron skal have 5 felter, fx "0 8 * * 1"' });
    }
    const cfg = loadConfig();
    cfg.aiTriggers = cfg.aiTriggers ?? [];
    const tr = {
      id: `trg-${randomUUID().slice(0, 8)}`,
      name: String(name).slice(0, 60),
      kind: kind === 'webhook' ? 'webhook' : 'cron',
      cron: kind === 'webhook' ? undefined : String(cron ?? '* * * * *'),
      token: randomUUID().replace(/-/g, '').slice(0, 24),
      goal: String(goal).slice(0, 500),
      bible: String(bible ?? ''),
      mode: ['standard', 'roles', 'debate', 'vote'].includes(mode) ? mode : 'standard',
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    cfg.aiTriggers.push(tr);
    saveConfig(cfg);
    res.json({ ok: true, trigger: { ...tr, webhookUrl: tr.kind === 'webhook' ? `/api/ai/hook/${tr.token}` : null } });
  });

  app.delete('/api/ai/triggers/:id', (req, res) => {
    const cfg = loadConfig();
    cfg.aiTriggers = (cfg.aiTriggers ?? []).filter((t) => t.id !== req.params.id);
    saveConfig(cfg);
    res.json({ ok: true });
  });

  // Webhook-endpoint: POST starter kørslen i baggrunden.
  app.post('/api/ai/hook/:token', (req, res) => {
    const cfg = loadConfig();
    const trigger = (cfg.aiTriggers ?? []).find((t) => t.kind === 'webhook' && t.token === req.params.token);
    if (!trigger) return res.status(404).json({ ok: false, reason: 'Ukendt webhook-token' });
    if (swarmState.active) return res.status(409).json({ ok: false, reason: 'En kørsel er allerede aktiv.' });
    const runId = randomUUID().slice(0, 12);
    const extra = req.body?.goal ? String(req.body.goal).slice(0, 500) : '';
    broadcast?.({ type: 'toast', level: 'info', text: `Webhook "${trigger.name}" starter en kørsel.` });
    executeRun({ runId, goal: extra || trigger.goal, bible: trigger.bible ?? '', cfg, dirs, mode: trigger.mode ?? 'standard', emit: (obj) => broadcast?.({ kind: 'ai', ...obj, runId }) }).catch(() => {});
    res.json({ ok: true, runId });
  });

  // Chat: POST {service, messages} → SSE {delta}|{done}|{error}
  app.post('/api/ai/chat', async (req, res) => {
    const emit = sse(res);
    const { service, messages } = req.body ?? {};
    const cfg = loadConfig();
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    try {
      const text = await runChat({ serviceId: service, messages, cfg, dirs, onDelta: (d) => emit({ type: 'delta', delta: d }), signal: ac.signal });
      emit({ type: 'done', text });
    } catch (e) {
      emit({ type: 'error', error: e.message });
    }
    res.end();
  });

  // Orkestrering: POST {goal, bible?, jobs?, mode?, pauseAfterPlan?} → SSE hændelser
  app.post('/api/ai/orchestrate', async (req, res) => {
    const emit = sse(res);
    const { goal, bible, jobs, mode, pauseAfterPlan } = req.body ?? {};
    const runId = randomUUID().slice(0, 12);
    const cfg = loadConfig();
    const ac = new AbortController();
    res.on('close', () => {
      ac.abort();
      // Ved afbrydelse: aflys evt. afventende godkendelse, så kørslen ikke hænger.
      const h = activeRuns.get(runId);
      if (h) { h.cancelled = true; if (h.resolveApproval) h.resolveApproval(h.jobsSnapshot ?? []); }
    });
    try {
      if (ac.signal.aborted) return;
      await executeRun({
        runId,
        goal: String(goal ?? ''),
        bible: String(bible ?? ''),
        predefinedJobs: jobs,
        cfg, dirs, emit,
        mode: ['standard', 'roles', 'debate', 'vote'].includes(mode) ? mode : 'standard',
        pauseAfterPlan: Boolean(pauseAfterPlan),
      });
    } catch (e) {
      emit({ type: 'error', error: e.message });
    }
    res.end();
  });
}

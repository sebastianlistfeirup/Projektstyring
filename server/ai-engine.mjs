// Orbit AI-motor — abonnement-first orkestrering.
// Primære motorer: lokale CLI-værktøjer (Codex, Claude Code, Kimi Code, Gemini CLI, Ollama/Qwen).
// API-baserede tjenester grupperes: 'sub-api' (dækket af abonnement: Meshy, ElevenLabs, HeyGen)
// og 'paid-api' (betalt pr. brug — kræver eksplicit tilladelse i aiPrefs.allowPaidApis).

import { spawn, execFile } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
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
    prefs: { allowPaidApis: false, orchestrator: 'claude', ...(cfg.aiPrefs ?? {}) },
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
    let available = false, reason = null, mode = s.kind;
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
function chatCli({ cmd, cliTemplate, prompt, cwd, onDelta, signal }) {
  return new Promise((resolve, reject) => {
    const parts = (cliTemplate || '-p {prompt}').split(' ').map((t) => (t === '{prompt}' ? prompt : t));
    const child = spawn(cmd, parts, { cwd: cwd ?? process.cwd(), env: { ...process.env, NO_COLOR: '1' } });
    const kill = () => { try { child.kill('SIGTERM'); } catch { /* */ } };
    signal?.addEventListener('abort', kill);
    const timer = setTimeout(kill, 15 * 60 * 1000);
    let out = '';
    const feed = (chunk) => {
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

// Samlet chat-dispatcher. Returnerer samlet tekst.
export async function runChat({ serviceId, messages, cfg, dirs, onDelta, signal }) {
  const svc = serviceById(serviceId);
  if (!svc) throw new Error(`Ukendt tjeneste: ${serviceId}`);
  assertUsable(svc, cfg);
  const { providers } = aiCfg(cfg);
  const p = providers[serviceId] ?? {};
  let acc = '';
  const delta = (d) => { acc += d; onDelta?.(d, acc); };
  if (svc.kind === 'cli') {
    const prompt = messages.map(contentToText).join('\n\n---\n\n');
    await chatCli({ cmd: p.cmd ?? svc.cmd, cliTemplate: p.cliTemplate ?? svc.cliTemplate, prompt, cwd: dirs.cwd, onDelta: delta, signal });
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

// ---- Orkestrator: planlægning + eksekvering ----------------------------------
// Vælger orkestrator efter præference blandt tilgængelige CLI/lokale motorer.
async function pickOrchestrator(cfg, availability) {
  const { prefs } = aiCfg(cfg);
  const order = [prefs.orchestrator, 'claude', 'codex', 'kimi', 'gemini', 'qwen'].filter(Boolean);
  for (const id of order) if (availability[id]?.available) return id;
  return null;
}

const PLAN_SCHEMA = `Svar KUN med JSON (intet andet): {"jobs":[{"title":string,"service":string,"phase":"koncept"|"design"|"prototype"|"produktion"|"test"|"polering"|"release","dependsOn":number[],"description":string}]}`;

async function planWithLLM({ orchestratorId, goal, bible, cfg, dirs, availability }) {
  const roster = AI_SERVICES.map((s) => {
    const a = availability[s.id];
    return `- ${s.id} (${s.name}): stærke sider: ${s.strengths.join(', ')} — ${a?.available ? 'TILGÆNGELIG' : 'ikke tilgængelig'}`;
  }).join('\n');
  const prompt = `Du er orkestrator for et AI-drevet projekt. Mål: ${goal}\n\n${bible ? `Projektets bibel (roller/stil): ${bible.slice(0, 6000)}\n\n` : ''}Roster:\n${roster}\n\nFordel arbejdet til de TILGÆNGELIGE tjenester efter deres stærke sider. 4-10 jobs med afhængigheder (dependsOn = indeks i listen, tidligere jobs). ${PLAN_SCHEMA}`;
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
      }));
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
    }
  } catch { /* swarm-tilstand er ikke kritisk */ }
}

async function executeRun({ runId, goal, bible, predefinedJobs, cfg, dirs, emit }) {
  const run = {
    runId, goal,
    startedAt: Date.now(),
    orchestratorId: null,
    mode: null,
    status: 'running',
    jobs: [],
    notes: [],
    finishedAt: null,
  };
  swarmState.active = run;
  const track = (obj) => { updateSwarm(run, obj); emit({ ...obj, runId, goal }); };
  try {
  track({ type: 'run_start', runId, goal, startedAt: new Date().toISOString() });
  const availability = await serviceAvailability(cfg);
  const orchestratorId = await pickOrchestrator(cfg, availability);
  track({ type: 'orchestrator', serviceId: orchestratorId, mode: orchestratorId ? 'llm' : 'regler' });

  let jobs;
  if (Array.isArray(predefinedJobs) && predefinedJobs.length) {
    jobs = predefinedJobs;
  } else if (orchestratorId) {
    try { jobs = await planWithLLM({ orchestratorId, goal, bible, cfg, dirs, availability }); }
    catch (e) { track({ type: 'job_note', jobId: null, note: `Orkestrator-plan fejlede (${e.message}) — bruger regelbaseret plan.` }); jobs = planByRules({ goal, availability }); }
  } else {
    jobs = planByRules({ goal, availability });
  }
  track({ type: 'plan', jobs: jobs.map(({ id, title, serviceId, phase, dependsOn, description }) => ({ id, title, serviceId, phase, dependsOn, description })) });

  const doneText = new Map();
  const results = [];
  const pending = new Set(jobs.map((j) => j.id));

  const runJob = async (job) => {
    track({ type: 'job_start', job });
    const ctx = [
      bible ? { role: 'system', text: `Projektets bibel:\n${bible.slice(0, 6000)}` } : null,
      { role: 'user', text: `Projektmål: ${goal}\n\nDin opgave (${job.phase}): ${job.title}\n${job.description}\n\nLav et konkret, færdigt resultat. Svar på dansk.` },
      ...[...doneText.entries()].filter(([id]) => job.dependsOn.includes(jobs.findIndex((j) => j.id === id))).map(([, text]) => ({ role: 'user', text: `Resultat fra tidligere job:\n${text.slice(0, 3000)}` })),
    ].filter(Boolean);
    try {
      const text = await runChat({ serviceId: job.serviceId, messages: ctx, cfg, dirs, onDelta: (d) => track({ type: 'job_delta', jobId: job.id, delta: d }) });
      doneText.set(job.id, text);
      const artifacts = await produceMedia(job, text, cfg, dirs, track);
      const res = { jobId: job.id, title: job.title, serviceId: job.serviceId, phase: job.phase, text, artifacts };
      results.push(res);
      track({ type: 'job_done', result: res });
    } catch (e) {
      track({ type: 'job_error', jobId: job.id, error: e.message });
    }
    pending.delete(job.id);
  };

  // Kør i topologisk rækkefølge, op til 2 parallelt.
  const running = new Set();
  for (;;) {
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

  writeFileSync(join(dirs.runs, `${runId}.json`), JSON.stringify({ runId, goal, orchestratorId, jobs, results, finishedAt: new Date().toISOString() }, null, 2));
  track({ type: 'done', summary: results.map((r) => ({ title: r.title, serviceId: r.serviceId })) });
  } finally {
    if (swarmState.active === run) {
      if (run.status === 'running') run.status = 'error';
      run.finishedAt = Date.now();
      swarmState.last = run;
      swarmState.active = null;
    }
  }
}

// ---- HTTP-ruter --------------------------------------------------------------
export function registerAiRoutes(app, { loadConfig, saveConfig, broadcast, APP_DIR, EXPORT_DIR }) {
  const dirs = {
    uploads: join(APP_DIR, 'ai-uploads'),
    artifacts: join(APP_DIR, 'ai-artifacts'),
    runs: join(APP_DIR, 'ai-runs'),
    cwd: process.cwd(),
  };
  for (const d of Object.values(dirs)) if (typeof d === 'string') mkdirSync(d, { recursive: true });

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
      broadcast?.({ type: 'ai', ...obj });
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

  // Orkestrering: POST {goal, bible?, jobs?} → SSE hændelser (plan, job_start, job_delta, job_done, done)
  app.post('/api/ai/orchestrate', async (req, res) => {
    const emit = sse(res);
    const { goal, bible, jobs } = req.body ?? {};
    const runId = randomUUID().slice(0, 12);
    const cfg = loadConfig();
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    try {
      if (ac.signal.aborted) return;
      await executeRun({ runId, goal: String(goal ?? ''), bible: String(bible ?? ''), predefinedJobs: jobs, cfg, dirs, emit });
    } catch (e) {
      emit({ type: 'error', error: e.message });
    }
    res.end();
  });
}

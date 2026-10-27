// Orbit AI-motor — abonnement-first orkestrering.
// Primære motorer: lokale CLI-værktøjer (Codex, Claude Code, Kimi Code, Gemini CLI, Ollama/Qwen).
// API-baserede tjenester grupperes: 'sub-api' (dækket af abonnement: Meshy, ElevenLabs, HeyGen)
// og 'paid-api' (betalt pr. brug — kræver eksplicit tilladelse i aiPrefs.allowPaidApis).

import { spawn, execFile, execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync, chmodSync, statSync } from 'fs';
import { dirname, join } from 'path';
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
  { id: 'grok',       name: 'Grok',           kind: 'cli',      cmd: 'grok',   cliTemplate: '-p {prompt}',                               color: 'orange',   strengths: ['chat'] },
];

export const serviceById = (id) => AI_SERVICES.find((s) => s.id === id);

// ---- Hemmelig nøgleboks ------------------------------------------------------
// API-nøgler gemmes KUN i <APP_DIR>/ai-keys.json — aldrig i companion.json,
// aldrig i repo'et, aldrig i logs. UI'en viser kun maskeret sidste-4 tegn,
// og nøglen sendes aldrig tilbage til browseren i klartekst.
let secretsDir = null; // sættes af registerAiRoutes
export function setSecretsDir(dir) { secretsDir = dir; }
const secretsPath = () => join(secretsDir ?? process.cwd(), 'ai-keys.json');
export function loadKeySecrets() {
  try { return JSON.parse(readFileSync(secretsPath(), 'utf8')); } catch { return {}; }
}
export function saveKeySecrets(secrets) {
  const p = secretsPath();
  const json = JSON.stringify(secrets, null, 2);
  const acl = () => [p, '/inheritance:r', '/grant:r', `${process.env.USERNAME ?? '%USERNAME%'}:F`];
  try {
    writeFileSync(p, json);
  } catch (e) {
    // Selvhealing: en ældre version låste filen med kun-læsning (:R).
    // Giv din bruger fuld kontrol og prøv igen, før vi melder fejl.
    if (process.platform !== 'win32') { console.warn('[orbit] ai-keys.json kunne ikke gemmes:', e.message); return false; }
    try {
      execFileSync('icacls', acl(), { timeout: 5000 });
      writeFileSync(p, json);
    } catch (e2) {
      console.warn('[orbit] ai-keys.json kunne ikke gemmes:', e2.message);
      return false;
    }
  }
  try { chmodSync(p, 0o600); } catch { /* Windows har ikke chmod */ }
  if (process.platform === 'win32') {
    // Afgræns filen, så kun din egen Windows-bruger kan åbne den.
    // F (fuld kontrol) — IKKE R, for så kan næste gemning ikke skrive til filen.
    execFile('icacls', acl(), { timeout: 5000 }, () => {});
  }
  return true;
}

// ---- Konfiguration --------------------------------------------------------
export function aiCfg(cfg) {
  // Nøgler fra den hemmelige nøgleboks overtrumler altid (og fjernes aldrig
  // fra companion.json, hvor gamle nøgler kan have ligget — de migreres væk).
  const providers = { ...(cfg.aiProviders ?? {}) };
  const secrets = loadKeySecrets();
  for (const [id, entry] of Object.entries(secrets)) {
    if (entry && typeof entry.apiKey === 'string' && entry.apiKey) {
      providers[id] = { ...(providers[id] ?? {}), apiKey: entry.apiKey };
    }
  }
  return {
    providers,
    prefs: { allowPaidApis: false, orchestrator: 'claude', selfHeal: true, ...(cfg.aiPrefs ?? {}) },
  };
}

function mask(key) {
  if (!key) return null;
  return key.length <= 6 ? '••••' : `••••${key.slice(-4)}`;
}

// CLI-detektion med cache (gør status-endpointen hurtig).
// Gem den faktiske sti: på Windows kan `where claude` finde claude.cmd, mens
// spawn('claude') alligevel giver ENOENT, fordi .cmd ikke er et selvstændigt program.
export function chooseCliCandidate(output, platform = process.platform) {
  const paths = String(output ?? '').split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
  if (platform !== 'win32') return paths[0] ?? null;
  return paths.find((p) => /\.exe$/i.test(p))
    ?? paths.find((p) => /\.(?:cmd|bat)$/i.test(p))
    ?? null;
}

async function resolveCliCommand(cmd) {
  if (!cmd) return null;
  if (/[\\/]/.test(cmd) && existsSync(cmd)) return cmd;
  try {
    const r = await execFileP(process.platform === 'win32' ? 'where' : 'which', [cmd], { timeout: 3000 });
    return chooseCliCandidate(r.stdout);
  } catch { return null; }
}

let cliCache = { at: 0, signature: '', found: {} };
async function detectClis(providers) {
  const cliServices = AI_SERVICES.filter((s) => s.kind === 'cli');
  const signature = JSON.stringify(cliServices.map((s) => [s.id, providers[s.id]?.cmd ?? s.cmd]));
  if (Date.now() - cliCache.at < 30_000 && signature === cliCache.signature) return cliCache.found;
  const found = {};
  await Promise.all(cliServices.map(async (s) => {
    found[s.id] = await resolveCliCommand(providers[s.id]?.cmd ?? s.cmd);
  }));
  cliCache = { at: Date.now(), signature, found };
  return found;
}

async function ollamaUp(baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1200) });
    return r.ok;
  } catch { return false; }
}

// Hent listen af hentede modeller fra Ollama (tom liste ved fejl).
async function ollamaModels(baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.models ?? []).map((m) => m.name).filter(Boolean);
  } catch { return []; }
}

// Vælg den model, der faktisk findes: foretrukken → første qwen* → første model.
function pickOllamaModel(models, wanted) {
  if (!models.length) return wanted;
  if (wanted && models.includes(wanted)) return wanted;
  return models.find((n) => /qwen/i.test(n)) ?? models[0];
}

// Må tjenesten bruges nu? Cost-gate: paid-api kræver allowPaidApis.
export async function serviceAvailability(cfg) {
  const { providers, prefs } = aiCfg(cfg);
  const clis = await detectClis(providers);
  const out = {};
  for (const s of AI_SERVICES) {
    const p = providers[s.id] ?? {};
    let available = false, reason = null;
    let models = null, resolvedModel = null;
    if (s.kind === 'cli') {
      let launchError = null;
      if (clis[s.id]) {
        try { cliSpawnSpec(clis[s.id], []); }
        catch (e) { launchError = e.message; }
      }
      available = Boolean(clis[s.id]) && !launchError && p.enabled !== false;
      reason = !clis[s.id] ? `CLI '${p.cmd ?? s.cmd}' ikke fundet`
        : launchError ? `CLI kan ikke startes: ${launchError}`
        : p.enabled === false ? 'Deaktiveret' : null;
    } else if (s.kind === 'local') {
      const baseUrl = p.baseUrl ?? s.baseUrl;
      const up = await ollamaUp(baseUrl);
      models = up ? await ollamaModels(baseUrl) : [];
      const wanted = p.model ?? s.model;
      resolvedModel = pickOllamaModel(models, wanted);
      available = up && models.length > 0 && p.enabled !== false;
      if (!up) {
        reason = `Ollama kører ikke (${baseUrl}) – tjek at Docker-containeren er startet, og at port 11434 er mappet til værten`;
      } else if (models.length === 0) {
        reason = 'Ollama kører, men der er ikke hentet nogen modeller endnu';
      } else if (wanted && !models.includes(wanted)) {
        reason = `Modellen '${wanted}' findes ikke – bruger i stedet '${resolvedModel}'`;
      }
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
      model: resolvedModel ?? (p.model ?? s.model ?? null),
      models, cmd: p.cmd ?? s.cmd ?? null,
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

// Npm's Windows-shims kan ikke startes direkte uden en shell. Find shim'ens
// faktiske Node- eller EXE-mål, så prompten fortsat sendes som ét sikkert argument.
// Nyere shims kan bruge uden citationstegn eller pege på en flyttet native pakke.
function windowsShimTarget(cmdPath) {
  try {
    const npmDir = dirname(cmdPath);
    const shim = readFileSync(cmdPath, 'utf8');
    const candidates = [];
    for (const m of shim.matchAll(/["']?(%~?dp0%[^"'\r\n]+?\.(?:[cm]?js|exe))["']?/gi)) {
      const relative = m[1].replace(/^%~?dp0%[\\/]?/i, '');
      if (!/(?:^|[\\/])node\.exe$/i.test(relative)) candidates.push(join(npmDir, ...relative.split(/[\\/]+/).filter(Boolean)));
    }
    // Nogle installationer skriver en absolut sti direkte i shim'en. node.exe er
    // kun launcher og må aldrig vælges som selve CLI-programmet.
    for (const m of shim.matchAll(/["']?([A-Za-z]:[\\/][^"'\r\n]+?\.(?:[cm]?js|exe))["']?/g)) {
      if (!/(?:^|[\\/])node\.exe$/i.test(m[1])) candidates.push(m[1]);
    }
    const isCodex = /(?:^|[\\/])codex\.(?:cmd|bat)$/i.test(cmdPath);
    if (isCodex) {
      candidates.push(join(npmDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
      const existing = candidates.find((p) => existsSync(p));
      if (existing) return existing;

      // Codex' native EXE kan ligge i en platformspakke ved siden af hovedpakken.
      // Søg kun i @openai/codex*-mapperne og med en lille, fast dybdegrænse.
      const scopeDir = join(npmDir, 'node_modules', '@openai');
      const roots = [];
      for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
        if (entry.isDirectory() && /^codex(?:-|$)/i.test(entry.name)) roots.push(join(scopeDir, entry.name));
      }
      let jsTarget = null;
      const queue = roots.map((dir) => ({ dir, depth: 0 }));
      while (queue.length) {
        const { dir, depth } = queue.shift();
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, entry.name);
          if (entry.isDirectory() && depth < 7) queue.push({ dir: p, depth: depth + 1 });
          else if (entry.isFile() && entry.name.toLowerCase() === 'codex.exe') return p;
          else if (entry.isFile() && entry.name.toLowerCase() === 'codex.js' && /[\\/]bin$/i.test(dir)) jsTarget ??= p;
        }
      }
      return jsTarget;
    }
    return candidates.find((p) => existsSync(p)) ?? null;
  } catch { return null; }
}

export function cliSpawnSpec(cmd, args, platform = process.platform) {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(cmd)) return { cmd, args };
  const target = windowsShimTarget(cmd);
  if (!target) throw new Error(`Windows-shim'en '${cmd}' kunne ikke opløses til et Node- eller EXE-mål`);
  if (/\.exe$/i.test(target)) return { cmd: target, args };
  return { cmd: process.execPath, args: [target, ...args] };
}

// Undgå at Claude Code ved et uheld vælger WSL's bash.exe på Windows.
// Brug en eksisterende Git Bash, ellers Claudes indbyggede PowerShell-værktøj.
function windowsGitBash(env) {
  const candidates = [
    env.CLAUDE_CODE_GIT_BASH_PATH,
    env.ProgramFiles && join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter(Boolean);
  try {
    const output = execFileSync('where', ['git'], { encoding: 'utf8', timeout: 3000 });
    for (const git of output.split(/\r?\n/).map((p) => p.trim()).filter(Boolean)) {
      candidates.push(join(dirname(git), 'bash.exe'), join(dirname(git), '..', 'bin', 'bash.exe'));
    }
  } catch { /* standardstierne ovenfor kan stadig bruges */ }
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function cliChildEnv(baseEnv = process.env, { platform = process.platform, claude = false } = {}) {
  const env = { ...baseEnv };
  if (platform !== 'win32' || !claude) return env;
  const bash = windowsGitBash(env);
  if (bash) env.CLAUDE_CODE_GIT_BASH_PATH = bash;
  else {
    delete env.CLAUDE_CODE_GIT_BASH_PATH;
    env.CLAUDE_CODE_USE_POWERSHELL_TOOL = '1';
  }
  return env;
}

const MAX_ACCESS_DIRECTORIES = 12;

function validatedAccessDirectory(value) {
  try {
    const candidate = String(value ?? '').trim().replace(/[.,;:!?)\]}]+$/g, '');
    if (!candidate) return null;
    const normalized = candidate.replace(/\\/g, '/').replace(/\/+$/g, '');
    // En roddrive er ikke en projektmappe og gives aldrig som ekstra adgang.
    if (!normalized || normalized === '/' || /^[A-Za-z]:$/.test(normalized)) return null;
    return statSync(candidate).isDirectory() ? candidate : null;
  } catch { return null; }
}

function existingAccessDirectory(raw) {
  let candidate = String(raw ?? '').trim();
  // Hvis en sti står midt i en sætning, afprøves den længste eksisterende
  // sti først. Der falder aldrig tilbage til en roddrive eller en ikke-eksisterende mappe.
  for (let i = 0; i < 40 && candidate; i += 1) {
    const valid = validatedAccessDirectory(candidate);
    if (valid) return valid;
    const next = candidate.replace(/\s+\S+$/g, '').replace(/[.,;:!?)\]}]+$/g, '');
    if (next === candidate) break;
    candidate = next;
  }
  return null;
}

// Auto kører i en isoleret arbejdsmappe. Giv standard-CLI'erne udtrykkelig
// adgang til uploadmapper og de projektmapper, brugeren selv har skrevet i målet.
export function cliAccessDirectories(messages, platform = process.platform) {
  const dirs = [];
  const seen = new Set();
  const add = (candidate) => {
    if (dirs.length >= MAX_ACCESS_DIRECTORIES) return;
    const dir = existingAccessDirectory(candidate);
    if (!dir) return;
    const key = platform === 'win32' ? dir.replace(/\//g, '\\').toLowerCase() : dir;
    if (seen.has(key)) return;
    seen.add(key);
    dirs.push(dir);
  };
  for (const msg of messages ?? []) {
    for (const attachment of msg?.attachments ?? []) {
      if (attachment?.path) add(dirname(attachment.path));
    }
  }
  for (const msg of messages ?? []) {
    const text = String(msg?.text ?? '');
    for (const line of text.split(/\r?\n/)) {
      const windowsStarts = [...line.matchAll(/[A-Za-z]:[\\/]/g)].map((m) => m.index);
      windowsStarts.forEach((start, i) => add(line.slice(start, windowsStarts[i + 1] ?? line.length)));
      // POSIX-stier bruges også ved lokale kørsler på macOS/Linux. Kræv en
      // projektmappemarkør på linien, så almindelige URL'er ikke bliver mapper.
      if (!/\b(projekt(?:mappe|rod)?|project(?:\s+(?:dir|directory|root))?|mappe|directory|folder|root)\b/i.test(line)) continue;
      // En markør efterfulgt af en sti kan også indeholde mellemrum i mappenavnet.
      const marked = line.match(/\b(?:projekt(?:mappe|rod)?|project(?:\s+(?:dir|directory|root))?|mappe|directory|folder|root)\b\s*[:=]?\s*["'`]?(\/.*)$/i);
      if (marked) add(marked[1]);
      for (const m of line.matchAll(/\/[^\s<>"'`|?*]+/g)) add(m[0]);
    }
  }
  return dirs;
}

// CLI: prompt som argument ud fra skabelon; stdout streames linjevis.
// jsonl: stdout parses som Claude stream-json (én JSON pr. linje) → onEvent i stedet for rå delta.
async function chatCli({ cmd, cliTemplate, prompt, cwd, onDelta, onEvent, jsonl, claude = false, extraArgs = [], signal }) {
  const resolvedCmd = await resolveCliCommand(cmd);
  if (!resolvedCmd) throw new Error(`Kunne ikke starte '${cmd}': CLI'en blev ikke fundet`);
  const tokens = (cliTemplate || '-p {prompt}').split(' ');
  const parts = [];
  let promptInserted = false;
  for (const token of tokens) {
    if (token === '{prompt}') {
      // Indstillinger og mapper skal stå før prompten; array-elementer bevarer
      // stier med mellemrum som nøjagtigt ét argument uden shell-evaluering.
      parts.push(...extraArgs, prompt);
      promptInserted = true;
    } else parts.push(token);
  }
  if (!promptInserted) parts.push(...extraArgs);
  const launch = cliSpawnSpec(resolvedCmd, parts);
  return new Promise((resolve, reject) => {
    const env = cliChildEnv({ ...process.env, NO_COLOR: '1' }, { claude });
    const child = spawn(launch.cmd, launch.args, { cwd: cwd ?? process.cwd(), env });
    // Prompten ligger allerede i argv. Luk stdin, så Claude ikke venter på input,
    // og så headless CLI'er aldrig hænger på en åben datakanal.
    try { child.stdin.end(); } catch { /* processen kan allerede være afsluttet */ }
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
      for (const b of ev.message.content) {
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
    const useDefaultTemplate = template === svc.cliTemplate;
    // Claude køres med stream-json så Task-underagenter kan spores som egne linjer.
    // Brugerdefinerede skabeloner respekteres uden ekstra permissions eller mapper.
    const useJson = serviceId === 'claude' && useDefaultTemplate;
    const accessDirs = useDefaultTemplate && (serviceId === 'codex' || serviceId === 'claude')
      ? cliAccessDirectories(messages) : [];
    const extraArgs = [];
    if (serviceId === 'codex' && useDefaultTemplate) {
      extraArgs.push('--sandbox', 'workspace-write');
      for (const dir of accessDirs) extraArgs.push('--add-dir', dir);
    } else if (serviceId === 'claude' && useDefaultTemplate) {
      // Print-mode er ikke-interaktiv. Uden dette afvises selv læsning i --add-dir.
      extraArgs.push('--permission-mode', 'bypassPermissions');
      if (accessDirs.length) extraArgs.push('--add-dir', ...accessDirs);
    }
    if (useJson) extraArgs.push('--output-format', 'stream-json', '--verbose');
    await chatCli({
      cmd: p.cmd ?? svc.cmd,
      cliTemplate: template,
      extraArgs,
      prompt,
      cwd: cwd ?? dirs.cwd,
      jsonl: useJson,
      claude: serviceId === 'claude',
      onDelta: delta,
      onEvent: useJson ? watchClaudeStreamJson({ onText: delta, onSubagent }) : undefined,
      signal,
    });
  } else if (svc.kind === 'local') {
    const baseUrl = p.baseUrl ?? svc.baseUrl;
    const models = await ollamaModels(baseUrl);
    await chatOllama({ baseUrl, model: pickOllamaModel(models, p.model ?? svc.model), messages, onDelta: delta, signal });
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
export async function produceMedia(job, text, cfg, dirs, emit) {
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

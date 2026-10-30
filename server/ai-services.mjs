// Orbit AI-motor — abonnement-first orkestrering.
// Primære motorer: lokale CLI-værktøjer (Codex, Claude Code, Kimi Code, Gemini CLI, Ollama/Qwen).
// The historical kind names do not establish billing. Every external connection
// requires a separately confirmed, included allowance with no extra charges.

import { readProviderSse as readSse, readLines } from './ai-stream.mjs';
import { hydrateAttachment } from './ai-documents.mjs';
import { billingPolicy } from './ai-billing.mjs';
import { agentEvents } from './ai-events.mjs';
import { nativeCliOptions } from './ai-cli-options.mjs';
import { serviceCapabilities } from './ai-capabilities.mjs';
import { trackAiProcess } from './ai-processes.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn, execFile, execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, statSync } from 'fs';
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
  { id: 'qwen-code',  name: 'Qwen Code',      kind: 'cli',      cmd: 'qwen', cliTemplate: '-p {prompt}', color: 'slate', strengths: ['kode', 'MCP', 'underagenter', 'test'] },
  { id: 'meshy',      name: 'Meshy',          kind: 'sub-api',  baseUrl: 'https://api.meshy.ai/openapi/v2',                    color: 'teal',     strengths: ['3D-modeller', 'teksturer'] },
  { id: 'elevenlabs', name: 'ElevenLabs',     kind: 'sub-api',  baseUrl: 'https://api.elevenlabs.io/v1',                       color: 'rose',     strengths: ['stemmer', 'lyd', 'TTS'] },
  { id: 'heygen',     name: 'HeyGen',         kind: 'sub-api',  baseUrl: 'https://api.heygen.com/v2',                          color: 'violet',   strengths: ['avatar-video', 'præsentation'] },
  { id: 'deepseek',   name: 'DeepSeek Flash', kind: 'paid-api', baseUrl: 'https://api.deepseek.com/v1',  model: 'deepseek-chat', color: 'cyan',    strengths: ['hurtig kode', 'billig chat'] },
  { id: 'openai',     name: 'OpenAI (API)',   kind: 'paid-api', baseUrl: 'https://api.openai.com/v1',    model: 'gpt-4o-mini',   color: 'lime',    strengths: ['generel chat'] },
  { id: 'anthropic',  name: 'Anthropic (API)',kind: 'paid-api', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', color: 'orange', strengths: ['skrivning', 'kode'] },
  { id: 'moonshot',   name: 'Moonshot (API)', kind: 'paid-api', baseUrl: 'https://api.moonshot.ai/v1',   model: 'kimi-k2',       color: 'blue',    strengths: ['lang kontekst'] },
  { id: 'xai',        name: 'xAI (API)',      kind: 'paid-api', baseUrl: 'https://api.x.ai/v1',          model: 'grok-3-mini',   color: 'orange',  strengths: ['hurtig chat'] },
  { id: 'grok',       name: 'Grok Build',     kind: 'cli',      cmd: 'grok',   cliTemplate: '-p {prompt}',                               color: 'orange',   strengths: ['kode', 'analyse'] },
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
    prefs: { orchestrator: 'claude', selfHeal: true, minimumReviewScore: 8, ...(cfg.aiPrefs ?? {}), allowPaidApis: false },
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

export async function inspectCliInstallation(serviceId, cfg) {
  const service = serviceById(serviceId), provider = aiCfg(cfg).providers[serviceId] ?? {};
  if (service?.kind !== 'cli') throw new Error('Denne forbindelse bruger ikke en lokal CLI.');
  const command = await resolveCliCommand(provider.cmd ?? service.cmd);
  if (!command) throw new Error('Programmet blev ikke fundet. Installer leverandørens CLI eller angiv stien til programmet.');
  const launch = cliSpawnSpec(command, ['--version']);
  const result = await execFileP(launch.cmd, launch.args, { timeout: 5000, maxBuffer: 64000, env: cliChildEnv(process.env, { claude: serviceId === 'claude' }) });
  const version = `${result.stdout}\n${result.stderr}`.trim().slice(0, 500);
  if (!/\d+\.\d+/.test(version)) throw new Error('Programmet svarede, men versionen kunne ikke genkendes. Kontrollér at stien peger på den rigtige CLI.');
  return { version, checkedAt: new Date().toISOString(), login: 'not_checked', note: 'Installation svarer. Login, modeladgang og resterende abonnementskvote er ikke kontrolleret.' };
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
async function ollamaInventory(baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.models ?? []).filter(m => typeof m.name === 'string');
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
  const { providers } = aiCfg(cfg);
  const clis = await detectClis(providers);
  const out = {};
  for (const s of AI_SERVICES) {
    const p = providers[s.id] ?? {};
    let available = false, reason = null;
    let models = null, resolvedModel = null, remoteModel = false;
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
      const inventory = up ? await ollamaInventory(baseUrl) : [];
      models = inventory.map(m => m.name);
      const wanted = p.model ?? s.model;
      resolvedModel = pickOllamaModel(models, wanted);
      remoteModel = Boolean(inventory.find(m => m.name === resolvedModel)?.remote_host);
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
      available = Boolean(p.apiKey) && p.enabled !== false;
      reason = !p.apiKey ? 'API-nøgle mangler' : (p.enabled === false ? 'Deaktiveret' : null);
    } else {
      reason = 'Klar til manuel tilslutning';
    }
    if (s.id === 'heygen' && available && (!p.avatarId || !p.voiceId)) { available = false; reason = 'Angiv avatar-id og stemme-id fra din HeyGen-konto.'; }
    const billing = billingPolicy(s, { ...p, model: resolvedModel ?? p.model, remoteModel });
    if (!billing.allowed) { available = false; reason = billing.reason; }
    out[s.id] = {
      installation: p.installation ?? null, cliTemplate: p.cliTemplate ?? null,
      capabilities: serviceCapabilities(s),
      customTemplate: Boolean(p.cliTemplate && p.cliTemplate !== s.cliTemplate),
      billing,
      avatarId: p.avatarId ?? null, voiceId: p.voiceId ?? null,
      id: s.id, name: s.name, kind: s.kind, color: s.color, strengths: s.strengths,
      available, reason, enabled: p.enabled !== false,
      hasKey: Boolean(p.apiKey), keyMask: mask(p.apiKey),
      model: resolvedModel ?? (p.model ?? s.model ?? null),
      models, cmd: p.cmd ?? s.cmd ?? null,
      subscriptionCovered: billing.mode === 'included' && billing.allowed,
    };
  }
  return out;
}

export function assertUsable(svc, cfg) {
  const { providers } = aiCfg(cfg);
  const p = providers[svc.id] ?? {};
  const billing = billingPolicy(svc, p);
  if (!billing.allowed) throw new Error(`${svc.name}: ${billing.reason}`);
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
    if (a.extractedText) t += `\n\nDokumentindhold fra ${a.name}:\n${a.extractedText}\n`;
    t += `\n\n[Vedhæftet ${a.kind === 'image' ? 'billede' : 'fil'}: ${a.name}${a.path ? ` — tilgængelig på disk: ${a.path}` : ''}]`;
    if (a.kind === 'image') t += '\nUndersøg selve billedet via billedinput eller et billedlæseværktøj. Hvis billedet ikke kan læses, skal du sige det; gæt ikke ud fra filnavnet.';
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
    body: JSON.stringify({ model, messages: messages.map(m => ({ role: ['assistant', 'system'].includes(m.role) ? m.role : 'user', content: contentToText(m), ...((m.attachments ?? []).some(a => a.kind === 'image') ? { images: m.attachments.filter(a => a.kind === 'image').map(a => a.dataUrl.split(',')[1]) } : {}) })), stream: true }),
  });
  if (!r.ok) throw new Error(`Ollama fejl ${r.status}`);
  await readLines(r, line => {
    if (!line.trim()) return;
    const data = JSON.parse(line);
    if (data.error) throw new Error(String(data.error));
    if (data.message?.content) onDelta(data.message.content);
  });
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
export function parseCliTemplate(template) {
  const tokens = []; let token = '', quote = null, present = false;
  for (const char of template) {
    if (quote) { if (char === quote) quote = null; else token += char; present = true; }
    else if (char === '"' || char === "'") { quote = char; present = true; }
    else if (/\s/.test(char)) { if (present) { tokens.push(token); token = ''; present = false; } }
    else { token += char; present = true; }
  }
  if (quote) throw new Error('CLI-skabelonen har et uafsluttet anførselstegn.');
  if (present) tokens.push(token);
  return tokens;
}

export function cliArguments(template, prompt, extraArgs = []) {
  const tokens = parseCliTemplate(template || '-p {prompt}');
  if (!tokens.includes('{prompt}')) throw new Error('CLI-skabelonen skal indeholde {prompt}.');
  const parts = tokens.map(token => token === '{prompt}' ? prompt : token);
  parts.splice(tokens[0] === 'exec' ? 1 : 0, 0, ...extraArgs);
  return parts;
}

export async function chatCli({ cmd, cliTemplate, prompt, cwd, onDelta, onEvent, onProcess, jsonl, claude = false, grok = false, extraArgs = [], signal }) {
  signal?.throwIfAborted();
  const resolvedCmd = await resolveCliCommand(cmd);
  if (!resolvedCmd) throw new Error(`Kunne ikke starte '${cmd}': CLI'en blev ikke fundet`);
  const parts = cliArguments(cliTemplate, prompt, extraArgs);
  const launch = cliSpawnSpec(resolvedCmd, parts);
  return new Promise((resolve, reject) => {
    const env = cliChildEnv({ ...process.env, NO_COLOR: '1' }, { claude });
    for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'MOONSHOT_API_KEY', 'DASHSCOPE_API_KEY', 'QWEN_API_KEY', 'KIMI_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY', 'GROK_DEPLOYMENT_KEY']) delete env[key];
    if (grok) { env.GROK_DISABLE_AUTOUPDATER = '1'; env.GROK_MEMORY = '0'; }
    const child = spawn(launch.cmd, launch.args, { cwd: cwd ?? process.cwd(), env, detached: process.platform !== 'win32' });
    let terminationTimer, windowsStop, callbackError, stopped = false, out = '', lineBuf = '', bytes = 0;
    const kill = () => {
      if (stopped) return;
      stopped = true;
      try { if (process.platform === 'win32') windowsStop = new Promise(done => execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { timeout: 10000 }, () => done())); else process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ }
      terminationTimer = setTimeout(() => { try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill(); } catch { /* already stopped */ } }, 5000);
      terminationTimer.unref();
    };
    const call = fn => { try { fn(); } catch (e) { callbackError ??= e; kill(); } };
    const untrack = trackAiProcess(child.pid, { kind: 'agent', command: String(cmd).split(/[\\/]/).at(-1), stop: () => { callbackError ??= new Error('AI-processen stoppes, fordi Companion lukkes.'); kill(); } });
    const line = text => {
      if (!text.trim()) return;
      let event;
      try { event = JSON.parse(text); } catch { out += text + '\n'; return; }
      // Event-handler failures must not be misclassified as invalid JSON.
      call(() => onEvent?.(event));
    };
    const timer = setTimeout(kill, 60 * 60 * 1000);
    const clean = () => { clearTimeout(timer); clearTimeout(terminationTimer); signal?.removeEventListener('abort', kill); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 20 * 1024 * 1024) { callbackError ??= new Error('Agentens output overskred 20 MB. Del opgaven i mindre jobs.'); kill(); return; }
      if (jsonl) {
        lineBuf += chunk; const lines = lineBuf.split('\n'); lineBuf = lines.pop() ?? '';
        for (const value of lines) line(value);
      } else { out += chunk; call(() => onDelta?.(chunk)); }
    });
    child.stderr.on('data', chunk => { out = (out + chunk).slice(-20000); });
    child.on('error', e => { untrack(); clean(); reject(new Error(`Kunne ikke starte '${cmd}': ${e.message}`)); });
    child.on('close', async code => {
      if (jsonl && lineBuf.trim()) line(lineBuf);
      // Do not cancel escalation just because the parent exited: grandchildren
      // with separate stdio may still be running in the same process group.
      if (stopped && child.pid && process.platform !== 'win32') try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already stopped */ }
      if (windowsStop) await windowsStop;
      untrack();
      if (child.pid) call(() => onProcess?.({ pid: child.pid, finished: true }));
      clean();
      if (callbackError) reject(callbackError);
      else if (signal?.aborted) reject(new Error('Afbrudt'));
      else if (stopped) reject(new Error('Jobbet nåede tidsgrænsen på 60 minutter.'));
      else if (code === 0) resolve(out);
      else reject(new Error(`'${cmd}' afsluttede med kode ${code}${out.trim() ? `: ${out.trim().slice(-1200)}` : ' uden output'}`));
    });
    signal?.addEventListener('abort', kill);
    if (signal?.aborted) kill();
    if (child.pid) call(() => onProcess?.({ pid: child.pid, startedAt: Date.now(), finished: false }));
    try { child.stdin.end(); } catch { /* process may have exited */ }
  });
}

// Samlet chat-dispatcher. Returnerer samlet tekst.
// onSubagent: kun for CLI'er der streamer strukturerede events (Claude stream-json).
export async function runChat({ serviceId, messages, cfg, dirs, onDelta, onSubagent, onProcess, onAction, signal, cwd, readOnly = false }) {
  messages = (messages ?? []).map(m => ({ ...m, attachments: m.attachments?.map(a => hydrateAttachment(a, dirs)) }));
  if (messages.some(message => message.attachments?.some(attachment => attachment.kind === 'image' && !attachment.path && !attachment.dataUrl))) throw new Error('Billedets indhold kunne ikke indlæses. Upload billedet igen.');
  if (readOnly) messages = [{ role: 'system', text: 'Denne tur er kun til læsning og rådgivning. Du må læse relevant materiale, men ikke ændre filer, installere noget, sende beskeder eller udføre andre eksterne ændringer. Returnér dit resultat til samtalen.' }, ...messages];
  const svc = serviceById(serviceId);
  if (!svc) throw new Error(`Ukendt tjeneste: ${serviceId}`);
  assertUsable(svc, cfg);
  if (['meshy', 'elevenlabs', 'heygen'].includes(serviceId)) throw new Error('Denne tjeneste producerer medier. Vælg Auto og beskriv den ønskede leverance.');
  const { providers } = aiCfg(cfg);
  const p = providers[serviceId] ?? {};
  let acc = '';
  const delta = (d) => { acc += d; onDelta?.(d, acc); };
  if (svc.kind === 'cli') {
    let prompt = messages.map(contentToText).join('\n\n---\n\n');
    const contextDir = join(dirs.runs ?? dirs.uploads ?? dirs.cwd, 'contexts');
    let contextPath;
    if (prompt.length > 6000) {
      mkdirSync(contextDir, { recursive: true });
      contextPath = join(contextDir, `${randomUUID()}.txt`);
      writeFileSync(contextPath, prompt, { mode: 0o600 });
      prompt = `Læs hele opgaven og alle gældende instruktioner i UTF-8-filen ${contextPath}. Filen indeholder den fulde samtale og projektkontekst. Følg opgavens fase og afgrænsning. Udfør ikke arbejde før du har læst filen.`;
    }
    const template = p.cliTemplate ?? svc.cliTemplate;
    const useDefaultTemplate = template === svc.cliTemplate;
    // Preserve native MCP configuration. Custom templates own their arguments.
    const accessDirs = useDefaultTemplate
      ? cliAccessDirectories(cwd ? messages.map(m => ({ attachments: m.attachments })) : messages) : [];
    if (useDefaultTemplate && contextPath) accessDirs.push(contextDir);
    const imagePaths = [...new Set(messages.flatMap(message => (message.attachments ?? []).filter(attachment => attachment.kind === 'image' && attachment.path).map(attachment => attachment.path)))];
    const native = useDefaultTemplate ? nativeCliOptions(serviceId, { readOnly, accessDirs, contextDir, model: p.model, imagePaths }) : { args: [], jsonl: false };
    const callId = randomUUID().slice(0, 12);
    await chatCli({
      cmd: p.cmd ?? svc.cmd,
      cliTemplate: template,
      extraArgs: native.args,
      prompt,
      cwd: cwd ?? dirs.cwd,
      jsonl: native.jsonl,
      claude: serviceId === 'claude',
      grok: serviceId === 'grok',
      onDelta: delta,
      onProcess,
      onEvent: native.jsonl ? agentEvents(serviceId, { onText: delta, onSubagent: event => onSubagent?.({ ...event, subId: `${callId}:${event.subId}`, parentSubId: event.parentSubId ? `${callId}:${event.parentSubId}` : undefined }), onAction: action => onAction?.({ ...action, id: `${callId}:${action.id}` }) }) : undefined,
      signal,
    });
  } else if (svc.kind === 'local') {
    const baseUrl = p.baseUrl ?? svc.baseUrl;
    const inventory = await ollamaInventory(baseUrl);
    const model = pickOllamaModel(inventory.map(m => m.name), p.model ?? svc.model);
    const profileResponse = await fetch(`${baseUrl}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
    if (!profileResponse.ok) throw new Error('Ollamas modelprofil kunne ikke kontrolleres før brug. Kontrollér modelnavn og Ollama-installation.');
    const profile = await profileResponse.json();
    const policy = billingPolicy(svc, { ...p, model, remoteModel: Boolean(profile.remote_host || profile.remote_model || inventory.find(m => m.name === model)?.remote_host) });
    if (!policy.allowed) throw new Error(policy.reason);
    if (messages.some(message => message.attachments?.some(attachment => attachment.kind === 'image')) && !profile.capabilities?.includes('vision')) throw new Error('Den valgte lokale model bekræfter ikke billedstøtte. Vælg en vision-model i Qwen/Ollama eller en anden billedkyndig tjeneste.');
    await chatOllama({ baseUrl, model, messages, onDelta: delta, signal });
  } else {
    const args = { baseUrl: p.baseUrl ?? svc.baseUrl, apiKey: p.apiKey, model: p.model ?? svc.model, messages, onDelta: delta, signal };
    if (serviceId === 'anthropic') await chatAnthropic(args);
    else if (serviceId === 'gemini') await chatGemini(args);
    else await chatOpenAiCompat(args); // openai, deepseek, moonshot, xai
  }
  return acc;
}

function requestSignal(signal) { return signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000); }

// ---- Medie-produktion (sub-api) ---------------------------------------------
const MESHY_TEXT_TO_3D = 'https://api.meshy.ai/openapi/v2/text-to-3d';

async function mediaHttpError(provider, response, apiKey) {
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { /* Some gateways return plain text. */ }
  const code = data?.detail?.code ?? data?.detail?.status;
  if (provider === 'ElevenLabs' && code === 'invalid_api_key') {
    return new Error(`ElevenLabs fejl ${response.status}: API-nøglen blev afvist. Indsæt selve den hemmelige API-nøgle i Orbit, ikke nøglens ID eller navn. Nye nøgler starter med sk_ og vises ved oprettelsen. Opret en ny nøgle i ElevenLabs, hvis du kun har ID'et, og gem den under ElevenLabs i Orbit.`);
  }
  // Never echo a credential even if a provider includes it in its error response.
  const detail = (apiKey ? raw.split(apiKey).join('[skjult]') : raw).slice(0, 500);
  return new Error(`${provider} fejl ${response.status}: ${detail}`);
}

async function elevenTts({ text, cfg, dirs, signal }) {
  const { providers } = aiCfg(cfg);
  const p = providers.elevenlabs ?? {};
  const voice = p.voiceId ?? p.model ?? '21m00Tcm4TlvDq8ikWAM';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST', signal: requestSignal(signal),
    headers: { 'Content-Type': 'application/json', 'xi-api-key': p.apiKey },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
  });
  if (!r.ok) throw await mediaHttpError('ElevenLabs', r, p.apiKey);
  const buf = Buffer.from(await r.arrayBuffer());
  const name = ` tale-${Date.now()}.mp3`;
  return saveArtifact(buf, name, dirs);
}

async function meshyTextTo3d({ prompt, cfg, dirs, onStatus, signal, existingId, onSubmitted }) {
  const { providers } = aiCfg(cfg);
  const p = providers.meshy ?? {};
  let result = existingId;
  if (!result) {
  const r = await fetch(MESHY_TEXT_TO_3D, {
    method: 'POST', signal: requestSignal(signal),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({ mode: 'preview', prompt, art_style: 'realistic' }),
  });
  if (!r.ok) throw await mediaHttpError('Meshy', r, p.apiKey);
  ({ result } = await r.json());
  if (!result) throw new Error('Meshy returnerede ikke et job-id.');
  onSubmitted(result);
  }
  for (let i = 0; i < 60; i++) {
    if (i > 0) await delay(5000, undefined, { signal });
    const response = await fetch(`${MESHY_TEXT_TO_3D}/${encodeURIComponent(result)}`, { signal: requestSignal(signal), headers: { Authorization: `Bearer ${p.apiKey}` } });
    if (!response.ok) throw await mediaHttpError('Meshy', response, p.apiKey);
    const st = await response.json();
    onStatus?.(`Meshy: ${st.status}`);
    if (st.status === 'SUCCEEDED') {
      if (!st.model_urls?.glb) throw new Error('Meshy meldte færdig, men leverede ingen GLB-downloadadresse.');
      const glb = await downloadMedia(st.model_urls.glb, signal);
      if (glb.subarray(0, 4).toString() !== 'glTF') throw new Error('Meshy returnerede ikke en gyldig GLB-fil.');
      return saveArtifact(glb, ` model-${Date.now()}.glb`, dirs);
    }
    if (['FAILED', 'CANCELED', 'CANCELLED', 'EXPIRED'].includes(st.status)) throw new Error(`Meshy 3D-generering stoppede (${st.status}). Kontrollér jobbet ${result} på din Meshy-konto før en ny bestilling.`);
    if (!['PENDING', 'IN_PROGRESS'].includes(st.status)) throw new Error(`Meshy returnerede en ukendt jobstatus: ${String(st.status).slice(0, 80)}`);
  }
  throw new Error('Meshy: timeout efter 5 minutter');
}

async function heygenAvatar({ text, cfg, dirs, onStatus, signal, existingId, onSubmitted }) {
  const { providers } = aiCfg(cfg);
  const p = providers.heygen ?? {};
  if (!p.avatarId || !p.voiceId) throw new Error('HeyGen kræver et valgt avatar-id og stemme-id fra din konto.');
  let videoId = existingId;
  if (!videoId) {
  const r = await fetch('https://api.heygen.com/v2/video/generate', {
    method: 'POST', signal: requestSignal(signal),
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': p.apiKey },
    body: JSON.stringify({ video_inputs: [{ character: { type: 'avatar', avatar_id: p.avatarId }, voice: { type: 'text', input_text: text, voice_id: p.voiceId } }] }),
  });
  if (!r.ok) throw new Error(`HeyGen fejl ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const { data } = await r.json();
  videoId = data?.video_id;
  if (!videoId) throw new Error('HeyGen returnerede ikke et job-id.');
  onSubmitted(videoId);
  }
  for (let i = 0; i < 60; i++) {
    if (i > 0) await delay(6000, undefined, { signal });
    const st = await (await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, { signal: requestSignal(signal), headers: { 'X-Api-Key': p.apiKey } })).json();
    onStatus?.(`HeyGen: ${st.data?.status}`);
    if (st.data?.status === 'completed') {
      const video = await downloadMedia(st.data.video_url, signal);
      if (video.subarray(4, 8).toString() !== 'ftyp') throw new Error('HeyGen returnerede ikke en gyldig MP4-fil.');
      return saveArtifact(video, ` video-${Date.now()}.mp4`, dirs);
    }
    if (st.data?.status === 'failed') throw new Error('HeyGen-video slog fejl');
  }
  throw new Error('HeyGen: timeout efter 6 minutter');
}

async function downloadMedia(url, signal) {
  if (new URL(url).protocol !== 'https:') throw new Error('Mediefilen skal hentes via HTTPS.');
  const response = await fetch(url, { signal: requestSignal(signal) });
  if (!response.ok || !response.body) throw new Error(`Mediefilen kunne ikke hentes (${response.status}).`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 256 * 1024 * 1024) throw new Error('Mediefilen er over 256 MB. Hent den hos leverandøren.');
    chunks.push(Buffer.from(chunk));
  }
  if (!size) throw new Error('Leverandøren returnerede en tom fil.');
  return Buffer.concat(chunks);
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
export async function produceMedia(job, text, cfg, dirs, emit, signal) {
  assertUsable(serviceById(job.serviceId), cfg);
  signal?.throwIfAborted();
  const media = { ...(job.media ?? {}) };
  const checkpoint = patch => {
    Object.assign(media, patch);
    emit({ type: 'job_media', jobId: job.id, media: { ...media } });
  };
  if (media.state === 'completed' && media.artifacts?.length) return media.artifacts;
  if (media.state === 'submitting' && !media.remoteId) throw new Error('En tidligere mediebestilling kan være modtaget af leverandøren, men kvitteringen mangler. Kontrollér leverandørens historik før en ny bestilling. Orbit genbestiller ikke automatisk.');
  if (!media.remoteId) checkpoint({ state: 'submitting', serviceId: job.serviceId, submittedAt: Date.now() });
  const options = {
    cfg, dirs, signal, existingId: media.remoteId,
    onSubmitted: remoteId => checkpoint({ state: 'processing', remoteId }),
    onStatus: status => emit({ type: 'job_status', jobId: job.id, status }),
  };
  try {
    let artifact;
    if (job.serviceId === 'elevenlabs') artifact = await elevenTts({ text: text || job.description, ...options });
    else if (job.serviceId === 'meshy') artifact = await meshyTextTo3d({ prompt: job.description || text, ...options });
    else if (job.serviceId === 'heygen') artifact = await heygenAvatar({ text: text || job.description, ...options });
    else throw new Error('Ukendt medietjeneste.');
    checkpoint({ state: 'completed', artifacts: [artifact] });
    return [artifact];
  } catch (e) {
    throw new Error(`Medieproduktion fejlede: ${e.message}`);
  }
}

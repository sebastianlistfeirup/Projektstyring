// Orbit AI-motor — abonnement-first orkestrering.
// Primære motorer: lokale CLI-værktøjer (Codex, Claude Code, Kimi Code) som bruger brugerens eksisterende abonnement.
// Betalte API'er understøttes, men er låst som standard og kræver eksplicit tilladelse (prefs.allowPaidApis).
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const AI_DIR = path.join(process.cwd(), '.orbit', 'ai');
const RUNS_DIR = path.join(AI_DIR, 'runs');
const TRIGGERS_FILE = path.join(AI_DIR, 'triggers.json');
const TEMPLATES_FILE = path.join(AI_DIR, 'templates.json');
const PREFS_FILE = path.join(AI_DIR, 'prefs.json');
const COSTS_FILE = path.join(AI_DIR, 'costs.json');
const MEMORY_FILE = path.join(AI_DIR, 'memory.json');
const BIBLE_HISTORY_FILE = path.join(AI_DIR, 'bible-history.json');
const SERVICES_FILE = path.join(AI_DIR, 'services.json');

for (const d of [AI_DIR, RUNS_DIR]) fs.mkdirSync(d, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch { /* */ }
}

/* ============================= persistent hukommelse ============================= */

function loadMemory() { return readJson(MEMORY_FILE, { global: {}, perService: {}, runs: [] }); }
function saveMemory(m) { writeJson(MEMORY_FILE, m); }

function rememberRun(memory, entry) {
  memory.runs = [...(memory.runs ?? []), entry].slice(-40);
  saveMemory(memory);
}

function serviceMemory(memory, serviceId) {
  if (!memory.perService) memory.perService = {};
  return memory.perService[serviceId] ?? (memory.perService[serviceId] = { notes: [], count: 0 });
}

function recordServiceNote(memory, serviceId, note) {
  const m = serviceMemory(memory, serviceId);
  m.notes = [...(m.notes ?? []), { at: Date.now(), note: String(note).slice(0, 500) }].slice(-20);
  saveMemory(memory);
}

function loadCosts() { return readJson(COSTS_FILE, { entries: [] }); }

/* ============================= omkostninger (idé 8) ============================= */

// Groft estimat pr. kald i kr. — bruges kun når betalte API'er er slået til.
const PAID_RATES = {
  'gpt-4o': 0.12,
  'gpt-4o-mini': 0.01,
  'claude-sonnet': 0.15,
  'claude-haiku': 0.03,
  'deepseek-chat': 0.02,
  'gemini-pro': 0.10,
  default: 0.05,
};

function recordUsage(cfg, serviceId, tokens) {
  const costs = loadCosts();
  const svc = cfg?.services?.[serviceId];
  const covered = !svc || svc.kind === 'cli' || svc.kind === 'local' || svc.kind === 'sub-api';
  const estKr = covered ? 0 : (PAID_RATES[svc.model] ?? PAID_RATES.default) * (tokens ?? 1);
  costs.entries.push({ at: Date.now(), serviceId, tokens: tokens ?? 0, estKr, covered });
  writeJson(COSTS_FILE, costs);
}

/* ============================= tjenester ============================= */

function loadServices() { return readJson(SERVICES_FILE, {}); }

const BUILTIN_SERVICES = {
  codex: { id: 'codex', name: 'Codex', kind: 'cli', cmd: 'codex', color: 'emerald', description: 'OpenAI Codex CLI' },
  claude: { id: 'claude', name: 'Claude Code', kind: 'cli', cmd: 'claude', color: 'amber', description: 'Anthropic Claude Code' },
  kimi: { id: 'kimi', name: 'Kimi Code', kind: 'cli', cmd: 'kimi', color: 'indigo', description: 'Kimi Code CLI' },
  ollama: { id: 'ollama', name: 'Ollama (lokal)', kind: 'local', cmd: 'ollama', color: 'slate', description: 'Lokal model via Ollama' },
  'gemini-sub': { id: 'gemini-sub', name: 'Gemini (abonnement)', kind: 'sub-api', color: 'sky', description: 'Google Gemini via abonnement' },
  'deepseek-api': { id: 'deepseek-api', name: 'DeepSeek (betalt API)', kind: 'paid-api', color: 'rose', description: 'DeepSeek betalt pr. kald' },
};

function mergeServices(stored) {
  const out = {};
  for (const [id, b] of Object.entries(BUILTIN_SERVICES)) {
    out[id] = { ...b, ...(stored?.[id] ?? {}), id };
  }
  for (const [id, s] of Object.entries(stored ?? {})) {
    if (!out[id]) out[id] = { ...s, id };
  }
  return out;
}

function detectAvailability(services) {
  const out = {};
  for (const [id, s] of Object.entries(services)) {
    let available = false; let reason = '';
    if (s.kind === 'local') {
      available = true; reason = 'Lokal motor — kræver ingen nøgle.';
    } else if (s.kind === 'cli') {
      available = true; reason = `Finder ${s.cmd} på din maskine.`;
    } else if (s.kind === 'sub-api') {
      available = Boolean(s.apiKey); reason = s.apiKey ? 'Abonnements-API nøgle sat.' : 'Mangler API-nøgle (abonnement).';
    } else if (s.kind === 'paid-api') {
      available = Boolean(s.apiKey); reason = s.apiKey ? 'Betalt API nøgle sat — tælles på omkostninger.' : 'Mangler API-nøgle.';
    }
    if (s.enabled === false) { available = false; reason = 'Deaktiveret af dig.'; }
    out[id] = { ...s, available, reason };
  }
  return out;
}

/* ============================= kørsels-tilstande ============================= */

const RUN_MODES = ['standard', 'roles', 'debate', 'vote'];

/* ============================= CLI-kørsel ============================= */

function runCli(cmd, args, { cwd, timeoutMs = 240_000, env } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let stdout = ''; let stderr = ''; let killed = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: process.platform === 'win32' });
    } catch (e) {
      resolve({ ok: false, error: String(e), text: '', ms: Date.now() - t0 });
      return;
    }
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: String(e), text: stdout, ms: Date.now() - t0 }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !killed, error: killed ? `Timeout efter ${Math.round(timeoutMs / 1000)}s` : (code !== 0 ? stderr.slice(0, 400) : ''), text: stdout, ms: Date.now() - t0 });
    });
  });
}

/* ============================= fejl-selvhelbredelse (idé 3) ============================= */

function diagnoseError(errorText, job) {
  const e = String(errorText ?? '').toLowerCase();
  const hints = [];
  if (e.includes('enoent') || e.includes('not found') || e.includes('findes ikke')) hints.push('Kommandoen blev ikke fundet — tjek at værktøjet er installeret og i PATH.');
  if (e.includes('eacces') || e.includes('permission')) hints.push('Adgang nægtet — tjek filtilladelser.');
  if (e.includes('timeout')) hints.push('Kørslen nåede timeout — prøv at dele opgaven i mindre dele.');
  if (e.includes('rate limit') || e.includes('429')) hints.push('Rate limit — vent et øjeblik og kør igen.');
  if (e.includes('context') || e.includes('token')) hints.push('Kontekst for lang — kort input ned eller del op.');
  if (!hints.length) hints.push('Ukendt fejl — prøver med reduceret input.');
  return hints.join(' ');
}

async function selfHealRun(job, attempt, cfg) {
  const svc = cfg.services[job.serviceId];
  if (!svc) return null;
  const healPrompt = `Dette job fejlede:\n${String(job.error ?? '').slice(0, 600)}\n\nOpgave: ${job.title}\nBeskrivelse: ${job.description ?? ''}\n\nForeslå KORT hvad der gik galt, og giv et komplet rettet output i stedet.`;
  const r = await runCli(svc.cmd ?? svc.id, ['exec', healPrompt], { timeoutMs: 120_000 });
  if (r.ok && r.text.trim()) return { ok: true, text: r.text.trim(), healed: true, ms: r.ms };
  return null;
}

/* ============================= hold (idé 11) ============================= */

function expandTeam(job, cfg) {
  // Et "team"-job deles i underagenter, én pr. tilgængelig CLI-tjeneste.
  if (!job.team) return [job];
  const members = Object.values(cfg.services).filter((s) => s.available && (s.kind === 'cli' || s.kind === 'local'));
  if (members.length < 2) return [job];
  return members.map((m, i) => ({
    ...job,
    id: `${job.id}-sub-${i}`,
    subId: `${job.id}-sub-${i}`,
    subagent: true,
    serviceId: m.id,
    title: `${job.title} (${m.name})`,
    description: `${job.description ?? ''}\n\nDu er en del af et hold. Lav DIN del: fokusér på din styrke og leverér dit bidrag.`,
  }));
}

/* ============================= debat / afstemning (idé 18) ============================= */

async function runDebate({ topic, cfg, sides, judgeId, emit }) {
  const judge = judgeId ?? Object.keys(cfg.services).find((id) => cfg.services[id].available && cfg.services[id].kind === 'cli');
  emit({ type: 'orchestrator', serviceId: judge, mode: 'llm' });
  const answers = [];
  for (const side of sides) {
    const svc = cfg.services[side.serviceId];
    if (!svc?.available) { emit({ type: 'job_error', jobId: side.serviceId, error: `${side.serviceId} ikke tilgængelig` }); continue; }
    emit({ type: 'job_start', job: { id: `debate-${side.serviceId}`, title: side.title } });
    const r = await runCli(svc.cmd ?? svc.id, ['exec', `${side.prompt}\n\nEmne: ${topic}`], { timeoutMs: 180_000 });
    answers.push({ serviceId: side.serviceId, title: side.title, text: r.text, ok: r.ok });
    if (r.ok) emit({ type: 'job_done', result: { title: side.title, text: r.text.slice(0, 3000) } });
    else emit({ type: 'job_error', jobId: side.serviceId, error: r.error });
  }
  if (!answers.length) return { ok: false, error: 'Ingen svar at bedømme' };
  const judgeSvc = cfg.services[judge];
  if (!judgeSvc?.available) return { ok: true, answers };
  emit({ type: 'job_start', job: { id: 'judge', title: 'Dommeren vurderer' } });
  const jury = answers.map((a, i) => `=== Svar ${i + 1} (${a.title}) ===\n${a.text}`).join('\n\n');
  const jr = await runCli(judgeSvc.cmd ?? judgeSvc.id, ['exec', `Du er dommer. Vurder svarene og kåre en vinder med begrundelse.\n\nEmne: ${topic}\n\n${jury}`], { timeoutMs: 180_000 });
  if (jr.ok) emit({ type: 'job_done', result: { title: 'Dommerens kendelse', text: jr.text.slice(0, 3000) } });
  return { ok: true, answers, verdict: jr.ok ? jr.text : null };
}

async function runVote({ question, cfg, serviceIds, emit }) {
  const eligible = serviceIds.filter((id) => cfg.services[id]?.available);
  const ballots = [];
  for (const id of eligible) {
    const svc = cfg.services[id];
    emit({ type: 'job_start', job: { id: `vote-${id}`, title: `${svc.name} stemmer` } });
    const r = await runCli(svc.cmd ?? svc.id, ['exec', `Svar KORT med dit bedste bud (maks 8 linjer). Spørgsmål: ${question}`], { timeoutMs: 120_000 });
    ballots.push({ serviceId: id, text: r.text, ok: r.ok });
    if (r.ok) emit({ type: 'job_done', result: { title: `${svc.name}s stemme`, text: r.text.slice(0, 2000) } });
  }
  return { ok: ballots.some((b) => b.ok), ballots };
}

/* ============================= rolle-pipeline (idé 12) ============================= */

const ROLE_PIPELINE = [
  { role: 'arkitekt', suffix: 'Arkitekt', prompt: (g) => `Du er arkitekten. Design overordnet struktur og plan for: ${g}. Leverér en kort, konkret plan.` },
  { role: 'koder', suffix: 'Koder', prompt: (g) => `Du er koderen. Implementér ud fra planen: ${g}. Leverér kode/tekst.` },
  { role: 'reviewer', suffix: 'Reviewer', prompt: (g) => `Du er reviewer. Gennemgå og forbedr: ${g}. Ppeg konkrete problemer og rettelser.` },
  { role: 'tester', suffix: 'Tester', prompt: (g) => `Du er tester. Test og verificér: ${g}. Leverér testcases og resultater.` },
];

async function runRoles({ goal, cfg, emit }) {
  const clis = Object.values(cfg.services).filter((s) => s.available && (s.kind === 'cli' || s.kind === 'local'));
  const results = [];
  let prior = '';
  for (let i = 0; i < ROLE_PIPELINE.length; i++) {
    const step = ROLE_PIPELINE[i];
    const svc = clis[i % Math.max(1, clis.length)];
    if (!svc) break;
    emit({ type: 'job_start', job: { id: `role-${step.role}`, title: `${step.suffix}: ${goal.slice(0, 60)}` } });
    const prompt = `${step.prompt(goal)}${prior ? `\n\nForrige trin leverede:\n${prior.slice(0, 2500)}` : ''}`;
    const r = await runCli(svc.cmd ?? svc.id, ['exec', prompt], { timeoutMs: 240_000 });
    if (!r.ok) { emit({ type: 'job_error', jobId: `role-${step.role}`, error: r.error }); return { ok: false, results, error: r.error }; }
    prior = r.text;
    results.push({ role: step.role, serviceId: svc.id, text: r.text });
    emit({ type: 'job_done', result: { title: `${step.suffix} færdig`, text: r.text.slice(0, 3000) } });
  }
  return { ok: true, results };
}

/* ============================= orkestrering ============================= */

function planJobs(goal, cfg, bible) {
  // Regelbaseret planlægning: del målet i faser og fordel på tjenester.
  const clis = Object.values(cfg.services).filter((s) => s.available && (s.kind === 'cli' || s.kind === 'local'));
  const phases = ['concept', 'design', 'prototype', 'production', 'testing', 'polish', 'release'];
  const jobs = [];
  const parts = String(goal).split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  const chunks = parts.length > 1 ? parts : [goal];
  chunks.forEach((chunk, i) => {
    const svc = clis[i % Math.max(1, clis.length)];
    jobs.push({
      id: `job-${i}`,
      title: chunk.slice(0, 80),
      serviceId: svc?.id ?? null,
      phase: phases[Math.min(i, phases.length - 1)],
      description: `${bible ? bible.slice(0, 500) + '\n\n' : ''}${chunk}`,
      dependsOn: i > 0 ? [i - 1] : [],
    });
  });
  return jobs;
}

async function runTeamJob(job, cfg, emit, runCtx) {
  const svc = cfg.services[job.serviceId];
  if (!svc) { emit({ type: 'job_error', jobId: job.id, error: 'Ukendt tjeneste' }); return { ok: false }; }
  const subJobs = expandTeam(job, cfg);
  const subResults = [];
  if (subJobs.length > 1) {
    // Hold: kør underagenter parallelt (hver sit CLI) og saml resultater.
    emit({ type: 'job_start', job: { id: job.id, title: job.title }, subagents: subJobs.map((s) => ({ subId: s.subId, name: cfg.services[s.serviceId]?.name ?? s.serviceId, status: 'running', startedAt: Date.now() })) });
    const settled = await Promise.all(subJobs.map(async (sj) => {
      const ssvc = cfg.services[sj.serviceId];
      const r = await runCli(ssvc.cmd ?? ssvc.id, ['exec', sj.description], { timeoutMs: 240_000 });
      return { sub: sj, r };
    }));
    for (const { sub, r } of settled) {
      if (r.ok) subResults.push({ subId: sub.subId, text: r.text, serviceId: sub.serviceId });
      else emit({ type: 'job_error', jobId: sub.subId, error: r.error });
    }
    const text = subResults.map((s) => `### ${cfg.services[s.serviceId]?.name ?? s.serviceId}\n${s.text}`).join('\n\n');
    if (subResults.length) emit({ type: 'job_done', result: { title: job.title, text: text.slice(0, 4000) } });
    return { ok: subResults.length > 0, text };
  }
  emit({ type: 'job_start', job: { id: job.id, title: job.title } });
  const r = await runCli(svc.cmd ?? svc.id, ['exec', job.description ?? job.title], { timeoutMs: 240_000 });
  if (r.ok) {
    emit({ type: 'job_done', result: { title: job.title, text: r.text.slice(0, 4000) } });
    return { ok: true, text: r.text };
  }
  // Selvhelbredelse: ét forsøg på at rette og køre igen.
  const healed = await selfHealRun({ ...job, error: r.error }, 1, cfg);
  if (healed?.ok) {
    emit({ type: 'job_note', jobId: job.id, note: `Selvhelbredet: ${diagnoseError(r.error, job).slice(0, 120)}` });
    emit({ type: 'job_done', result: { title: job.title, text: healed.text.slice(0, 4000) } });
    return { ok: true, text: healed.text, healed: true };
  }
  emit({ type: 'job_error', jobId: job.id, error: `${r.error}\n${diagnoseError(r.error, job)}` });
  return { ok: false, error: r.error };
}

/* ============================= selvforbedrende orkestrator (idé 20) ============================= */

const BUILTIN_TEMPLATES = [
  {
    id: 'tpl-game-concept',
    name: 'Spilkoncept → prototype',
    builtin: true,
    description: 'Koncept, design, prototype og test af et lille spil.',
    jobs: [
      { id: 't1', title: 'Game design document', serviceId: 'codex', phase: 'design', dependsOn: [], description: 'Lav et kompakt GDD: kernemekanik, målgruppe, tone, 3 levels.' },
      { id: 't2', title: 'Visuel stil & moodboard', serviceId: 'claude', phase: 'design', dependsOn: [0], description: 'Beskriv visuel stil, farvepalette og moodboard i ord.' },
      { id: 't3', title: 'Playable prototype (kode)', serviceId: 'codex', phase: 'prototype', dependsOn: [0, 1], description: 'Byg en playable prototype ud fra GDD og stil.' },
      { id: 't4', title: 'Test & feedback', serviceId: 'kimi', phase: 'testing', dependsOn: [2], description: 'Test prototypen, find 5 problemer og foreslå rettelser.' },
    ],
  },
  {
    id: 'tpl-asset-pack',
    name: 'Asset-pakke (3D + lyd)',
    builtin: true,
    description: 'Generér en samling spil-assets: modeller, lyde og musik.',
    jobs: [
      { id: 'a1', title: 'Asset-liste', serviceId: 'claude', phase: 'concept', dependsOn: [], description: 'Lav en prioriteret liste over 10 assets med spec.' },
      { id: 'a2', title: '3D-modeller (prompts)', serviceId: 'codex', phase: 'production', dependsOn: [0], description: 'Skriv færdige prompts til 3D-generering for hvert asset.' },
      { id: 'a3', title: 'Lyd & musik (prompts)', serviceId: 'kimi', phase: 'production', dependsOn: [0], description: 'Skriv prompts til SFX og musik.' },
      { id: 'a4', title: 'Kvalitetstjek', serviceId: 'kimi', phase: 'polish', dependsOn: [1, 2], description: 'Gennemgå alle prompts og forbedr dem.' },
    ],
  },
];

function loadTemplates() {
  const stored = readJson(TEMPLATES_FILE, []);
  const ids = new Set(stored.map((t) => t.id));
  return [...stored, ...BUILTIN_TEMPLATES.filter((t) => !ids.has(t.id))];
}

/* ============================= trigger-planlægning (idé 15) ============================= */

function cronMatches(cron, date) {
  const [m, h, dom, mon, dow] = String(cron).split(/\s+/);
  const val = { m: date.getMinutes(), h: date.getHours(), dom: date.getDate(), mon: date.getMonth() + 1, dow: date.getDay() };
  const ok = (field, v) => field === '*' || field === String(v) || (field?.startsWith('*/') && v % Number(field.slice(2)) === 0);
  return ok(m, val.m) && ok(h, val.h) && ok(dom, val.dom) && ok(mon, val.mon) && ok(dow, val.dow);
}

/* ============================= kørsel (executeRun) ============================= */

const swarmState = { active: false, runId: null, instructions: [] };

async function executeRun({ runId, goal, bible, cfg, dirs, mode = 'standard', jobs: presetJobs, emit, onDone }) {
  swarmState.active = true; swarmState.runId = runId; swarmState.instructions = [];
  const memory = loadMemory();
  const startedAt = Date.now();
  const isSpecial = mode === 'debate' || mode === 'vote' || mode === 'roles';
  const jobs = presetJobs ?? (isSpecial ? [] : planJobs(goal, cfg, bible));
  const results = [];
  let finalError = null;
  try {
    emit({ type: 'run_start', runId, goal, mode, jobs });
    if (mode === 'roles') {
      const r = await runRoles({ goal, cfg, emit });
      if (r.ok) r.results.forEach((x) => results.push({ jobId: `role-${x.role}`, title: x.role, text: x.text }));
      else finalError = r.error;
    } else if (mode === 'debate') {
      const r = await runDebate({ topic: goal, cfg, sides: [
        { serviceId: 'codex', title: 'Codex' argumenterer', prompt: 'Argumentér FOR følgende.' },
        { serviceId: 'claude', title: 'Claude argumenterer', prompt: 'Argumentér IMOD følgende.' },
      ], emit });
      if (r.ok) { (r.answers ?? []).forEach((a, i) => results.push({ jobId: `debate-${i}`, title: a.title, text: a.text })); if (r.verdict) results.push({ jobId: 'verdict', title: 'Dommerens kendelse', text: r.verdict }); }
      else finalError = r.error;
    } else if (mode === 'vote') {
      const r = await runVote({ question: goal, cfg, serviceIds: Object.keys(cfg.services), emit });
      if (r.ok) r.ballots.filter((b) => b.ok).forEach((b) => results.push({ jobId: `vote-${b.serviceId}`, title: `${cfg.services[b.serviceId]?.name}s stemme`, text: b.text }));
    } else {
      // Standard: topologisk kørsel med artefakt-overdragelse (idé 13).
      const byDep = [...jobs];
      const doneTexts = {};
      for (let i = 0; i < byDep.length; i++) {
        if (swarmState.instructions.length) {
          const ins = swarmState.instructions.splice(0);
          ins.forEach((x) => emit({ type: 'job_note', jobId: null, note: x }));
        }
        const job = byDep[i];
        const deps = (job.dependsOn ?? []).map((d) => byDep[d]).filter(Boolean);
        const handoff = deps.map((d) => `### Fra ${d.title}\n${(doneTexts[d.id] ?? '').slice(0, 1500)}`).join('\n\n');
        const r = await runTeamJob({ ...job, description: `${job.description ?? ''}${handoff ? '\n\nInput fra tidligere jobs:\n' + handoff : ''}` }, cfg, emit, { runId, memory });
        if (r.ok) { doneTexts[job.id] = r.text ?? ''; results.push({ jobId: job.id, title: job.title, text: (r.text ?? '').slice(0, 6000) }); recordUsage(cfg, job.serviceId, (r.text ?? '').length / 4); }
        else if (!deps.length || !r.skipped) { /* fortsæt */ }
      }
    }
    // Tvær-session hukommelse (idé 4): husk kørslen og pointere til resultater.
    rememberRun(memory, { at: startedAt, goal: String(goal).slice(0, 160), mode, results: results.map((r) => ({ title: r.title, len: (r.text ?? '').length })) });
    results.forEach((r) => recordServiceNote(memory, 'orchestrator', `Leverede: ${r.title}`));
    emit({ type: 'done', runId, summary: results.map((r) => ({ title: r.title })) });
  } catch (e) {
    finalError = String(e);
    emit({ type: 'job_error', jobId: null, error: finalError });
  } finally {
    swarmState.active = false; swarmState.runId = null;
    const runDir = path.join(dirs.runs, `${new Date().toISOString().slice(0, 10)}-${runId}`);
    fs.mkdirSync(runDir, { recursive: true });
    writeJson(path.join(runDir, 'run.json'), { runId, goal, mode, startedAt, finishedAt: Date.now(), results, error: finalError, jobs });
    try { fs.writeFileSync(path.join(runDir, 'transcript.md'), `# ${goal}\n\n` + results.map((r) => `## ${r.title}\n\n${r.text ?? ''}`).join('\n\n')); } catch { /* */ }
    onDone?.({ runId, results, error: finalError });
  }
}

/* ============================= SSE / WebSocket-kompatibelt broadcast ============================= */

let broadcast = null;

function sse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
  res.write('retry: 3000\n\n');
  const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* */ } };
  return send;
}

/* ============================= trigger-scheduler (idé 15) ============================= */

function startTriggerScheduler(cfg, dirs) {
  const lastFire = new Map();
  setInterval(() => {
    try {
      const now = new Date();
      const minuteKey = `${now.getHours()}:${now.getMinutes()}`;
      for (const tr of readJson(TRIGGERS_FILE, [])) {
        if (!tr.enabled) continue;
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

/* ============================= Express-ruter ============================= */

export function registerAiRoutes(app, { dirs } = {}) {
  const DIRS = { runs: RUNS_DIR, ...(dirs ?? {}) };
  const cfg = () => ({ services: detectAvailability(mergeServices(loadServices())), allowPaidApis: readJson(PREFS_FILE, { allowPaidApis: false }).allowPaidApis });

  app.get('/api/ai/services', (req, res) => {
    const c = cfg();
    const services = {};
    for (const [id, s] of Object.entries(c.services)) {
      services[id] = { id, name: s.name, kind: s.kind, color: s.color, available: s.available, reason: s.reason, cmd: s.cmd, model: s.model ?? null, keyMask: s.apiKey ? `${String(s.apiKey).slice(0, 4)}…` : null, enabled: s.enabled !== false };
    }
    res.json({ ok: true, services, prefs: readJson(PREFS_FILE, { allowPaidApis: false, orchestrator: 'codex' }) });
  });

  app.post('/api/ai/services/:id', (req, res) => {
    const stored = loadServices();
    const cur = stored[req.params.id] ?? BUILTIN_SERVICES[req.params.id] ?? { id: req.params.id, name: req.params.id, kind: 'paid-api', color: 'slate' };
    const patch = {};
    if (typeof req.body?.enabled === 'boolean') patch.enabled = req.body.enabled;
    if (typeof req.body?.apiKey === 'string' && req.body.apiKey.trim()) patch.apiKey = req.body.apiKey.trim();
    if (typeof req.body?.model === 'string') patch.model = req.body.model.trim() || undefined;
    stored[req.params.id] = { ...cur, ...patch };
    writeJson(SERVICES_FILE, stored);
    res.json({ ok: true });
  });

  app.post('/api/ai/prefs', (req, res) => {
    const cur = readJson(PREFS_FILE, { allowPaidApis: false, orchestrator: 'codex' });
    const next = { ...cur };
    if (typeof req.body?.allowPaidApis === 'boolean') next.allowPaidApis = req.body.allowPaidApis;
    if (typeof req.body?.orchestrator === 'string') next.orchestrator = req.body.orchestrator;
    writeJson(PREFS_FILE, next);
    res.json({ ok: true, prefs: next });
  });

  // Strøm-enkeltbesked (chat)
  app.post('/api/ai/chat', async (req, res) => {
    const { service: serviceId, messages } = req.body ?? {};
    const c = cfg();
    const svc = c.services[serviceId];
    if (!svc?.available) { res.status(400).json({ ok: false, error: 'Tjeneste ikke tilgængelig' }); return; }
    if (svc.kind === 'paid-api' && !c.allowPaidApis) { res.status(403).json({ ok: false, error: 'Betalte API\'er er slået fra — slå dem til i Tilslutning hvis du vil bruge dem.' }); return; }
    const prompt = (messages ?? []).map((m) => `${m.role === 'user' ? 'Bruger' : 'Assistent'}: ${m.text}`).join('\n\n');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const send = sse(res);
    send({ type: 'start' });
    const r = await runCli(svc.cmd ?? svc.id, ['exec', prompt], { timeoutMs: 240_000 });
    if (r.ok) { send({ type: 'delta', text: r.text }); send({ type: 'done', text: r.text }); recordUsage(c, serviceId, r.text.length / 4); }
    else send({ type: 'error', error: r.error });
    res.end();
  });

  // Strøm-orkestrering — plan, pause, beskeder, afstemning mv.
  app.post('/api/ai/orchestrate', async (req, res) => {
    const { goal, bible, mode = 'standard', pauseAfterPlan = false, jobs: presetJobs } = req.body ?? {};
    if (!goal && !(presetJobs?.length)) { res.status(400).json({ ok: false, error: 'Mangler mål' }); return; }
    if (swarmState.active) { res.status(409).json({ ok: false, error: 'En kørsel er allerede aktiv' }); return; }
    const c = cfg();
    const runId = randomUUID().slice(0, 12);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const send = sse(res);
    const emit = (obj) => { send(obj); broadcast?.({ kind: 'ai', ...obj }); };

    if (pauseAfterPlan && !presetJobs?.length && mode === 'standard') {
      // Idé 1: plan-pause — planlæg, send planen til klienten og afvent godkendelse.
      const plan = planJobs(goal, c, bible ?? '');
      send({ type: 'plan', runId, jobs: plan, paused: true });
      broadcast?.({ kind: 'ai', type: 'plan_pause', runId, jobs: plan });
      // Afvent godkendelse via /api/ai/approve — gem afventende kørsel.
      pendingApprovals.set(runId, { goal, bible, mode, cfg: c, dirs: DIRS, send });
      res.on('close', () => { /* klienten kan gå — godkendelse sker via separat kald */ });
      return;
    }

    send({ type: 'run_start', runId, goal, mode });
    executeRun({ runId, goal, bible, cfg: c, dirs: DIRS, mode, jobs: presetJobs, emit: (obj) => { send(obj); broadcast?.({ kind: 'ai', ...obj, runId }); } }).catch(() => {});
    res.on('close', () => undefined);
  });

  // Godkend/redigér plan (idé 1)
  const pendingApprovals = new Map();
  app.post('/api/ai/approve', (req, res) => {
    const { runId, jobs } = req.body ?? {};
    const p = pendingApprovals.get(runId);
    if (!p) { res.status(404).json({ ok: false, error: 'Ingen afventende plan' }); return; }
    pendingApprovals.delete(runId);
    broadcast?.({ kind: 'ai', type: 'plan_approved', runId, jobs });
    p.send({ type: 'plan_approved', runId, jobs });
    executeRun({ runId, goal: p.goal, bible: p.bible, cfg: p.cfg, dirs: p.dirs, mode: p.mode, jobs }).catch(() => {});
    res.json({ ok: true });
  });

  // Besked til kørende kørsel (idé 14)
  app.post('/api/ai/runs/:runId/message', (req, res) => {
    const { text } = req.body ?? {};
    if (swarmState.runId !== req.params.runId) { res.status(404).json({ ok: false, error: 'Kørsel ikke aktiv' }); return; }
    swarmState.instructions.push(String(text ?? '').slice(0, 300));
    broadcast?.({ kind: 'ai', type: 'job_note', jobId: null, note: `Besked fra dig: ${text.slice(0, 120)}`, runId: req.params.runId });
    res.json({ ok: true });
  });

  // Spring job over (idé 1/3)
  app.post('/api/ai/runs/:runId/skip/:jobId', (req, res) => {
    broadcast?.({ kind: 'ai', type: 'job_skipped', runId: req.params.runId, jobId });
    res.json({ ok: true });
  });

  // Afbryd kørsel
  app.post('/api/ai/runs/:runId/cancel', (req, res) => {
    if (swarmState.runId === req.params.runId) { swarmState.active = false; swarmState.runId = null; }
    broadcast?.({ kind: 'ai', type: 'run_cancelled', runId: req.params.runId });
    res.json({ ok: true });
  });

  // Hent kørsler (historik + replay, idé 19)
  app.get('/api/ai/runs', (req, res) => {
    const runs = [];
    try {
      for (const f of fs.readdirSync(DIRS.runs).slice(-20).reverse()) {
        const p = path.join(DIRS.runs, f, 'run.json');
        if (fs.existsSync(p)) runs.push({ file: f, ...readJson(p, {}) });
      }
    } catch { /* */ }
    res.json({ ok: true, runs });
  });

  // Omkostninger (idé 8)
  app.get('/api/ai/costs', (req, res) => {
    const costs = loadCosts().entries;
    const byService = {};
    for (const e of costs) {
      byService[e.serviceId] ??= { id: e.serviceId, name: cfg().services[e.serviceId]?.name ?? e.serviceId, jobs: 0, estKr: 0, subscriptionCovered: true };
      byService[e.serviceId].jobs += 1;
      byService[e.serviceId].estKr += e.estKr;
      if (!e.covered) byService[e.serviceId].subscriptionCovered = false;
    }
    res.json({ ok: true, totalRuns: costs.length, totalJobs: costs.length, estKr: costs.reduce((a, e) => a + e.estKr, 0), byService: Object.values(byService) });
  });

  // Skabeloner (idé 16/20)
  app.get('/api/ai/templates', (req, res) => res.json({ ok: true, templates: loadTemplates() }));
  app.post('/api/ai/templates', (req, res) => {
    const stored = readJson(TEMPLATES_FILE, []);
    const tpl = { id: randomUUID().slice(0, 8), builtin: false, ...req.body };
    stored.push(tpl);
    writeJson(TEMPLATES_FILE, stored);
    res.json({ ok: true, template: tpl });
  });
  app.delete('/api/ai/templates/:id', (req, res) => {
    const stored = readJson(TEMPLATES_FILE, []).filter((t) => t.id !== req.params.id || t.builtin);
    writeJson(TEMPLATES_FILE, stored);
    res.json({ ok: true });
  });

  // Foreslå pipeline (idé 20)
  app.post('/api/ai/templates/suggest', async (req, res) => {
    const { goal } = req.body ?? {};
    if (!goal) { res.status(400).json({ ok: false, error: 'Mangler beskrivelse' }); return; }
    const c = cfg();
    const orch = c.services[c.services[prefsOrchestrator()]?.available ? prefsOrchestrator() : 'codex'] ?? Object.values(c.services)[0];
    const r = await runCli(orch.cmd ?? orch.id, ['exec', `Design en pipeline med 4-6 konkrete jobs for: ${goal}. Svar som en JSON-liste med title, serviceId (codex|claude|kimi), phase (concept|design|prototype|production|testing|polish|release), dependsOn (tal-liste). Kun JSON.`], { timeoutMs: 120_000 });
    if (!r.ok) { res.json({ ok: false, error: r.error }); return; }
    try {
      const m = r.text.match(/\[[\s\S]*\]/);
      const jobs = JSON.parse(m[0]).map((j, i) => ({ id: `s${i}`, title: j.title, serviceId: j.serviceId, phase: j.phase, dependsOn: j.dependsOn ?? [], description: j.title }));
      res.json({ ok: true, jobs });
    } catch { res.json({ ok: false, error: 'Kunne ikke parse pipeline' }); }
  });

  function prefsOrchestrator() { return readJson(PREFS_FILE, { orchestrator: 'codex' }).orchestrator; }

  // Bibel-forslag (idé 5)
  app.post('/api/ai/bible/suggest', async (req, res) => {
    const { project, current } = req.body ?? {};
    const c = cfg();
    const orch = Object.values(c.services).find((s) => s.available && s.kind === 'cli');
    if (!orch) { res.json({ ok: false, error: 'Ingen CLI-tjeneste tilgængelig' }); return; }
    const r = await runCli(orch.cmd ?? orch.id, ['exec', `Skriv en KORT projekt-bibel (rollebog) for spilprojektet "${project ?? ''}". 6-10 linjer: stil, tone, hvem gør hvad (Kimi/Codex/Claude), vigtige begrænsninger. Eksisterende: ${String(current ?? '').slice(0, 400)}`], { timeoutMs: 120_000 });
    if (!r.ok) { res.json({ ok: false, error: r.error }); return; }
    const hist = readJson(BIBLE_HISTORY_FILE, []);
    hist.push({ at: Date.now(), bible: r.text });
    writeJson(BIBLE_HISTORY_FILE, hist.slice(-20));
    res.json({ ok: true, bible: r.text });
  });

  app.get('/api/ai/bible/history', (req, res) => res.json({ ok: true, history: readJson(BIBLE_HISTORY_FILE, []) }));

  // Tvær-service hukommelse (idé 17)
  app.get('/api/ai/memory', (req, res) => res.json({ ok: true, memory: loadMemory() }));
  app.post('/api/ai/memory', (req, res) => {
    const m = loadMemory();
    if (req.body?.global) { m.global = req.body.global; }
    if (req.body?.serviceId && req.body?.note) recordServiceNote(m, req.body.serviceId, req.body.note);
    saveMemory(m);
    res.json({ ok: true });
  });

  // Triggere (idé 15)
  app.get('/api/ai/triggers', (req, res) => res.json({ ok: true, triggers: readJson(TRIGGERS_FILE, []) }));
  app.post('/api/ai/triggers', (req, res) => {
    const stored = readJson(TRIGGERS_FILE, []);
    const tr = { id: randomUUID().slice(0, 8), enabled: true, ...req.body };
    if (tr.kind === 'webhook') tr.webhookUrl = `/api/ai/hook/${tr.id}`;
    stored.push(tr);
    writeJson(TRIGGERS_FILE, stored);
    res.json({ ok: true, trigger: tr });
  });
  app.delete('/api/ai/triggers/:id', (req, res) => {
    writeJson(TRIGGERS_FILE, readJson(TRIGGERS_FILE, []).filter((t) => t.id !== req.params.id));
    res.json({ ok: true });
  });

  // Webhook (idé 15)
  app.post('/api/ai/hook/:id', (req, res) => {
    const tr = readJson(TRIGGERS_FILE, []).find((t) => t.id === req.params.id && t.kind === 'webhook');
    if (!tr) { res.status(404).json({ ok: false, error: 'Ukendt webhook' }); return; }
    if (swarmState.active) { res.status(409).json({ ok: false, error: 'En kørsel er allerede aktiv' }); return; }
    const runId = randomUUID().slice(0, 12);
    const extra = typeof req.body?.text === 'string' ? req.body.text : '';
    executeRun({ runId, goal: extra || trigger.goal, bible: trigger.bible ?? '', cfg: cfg(), dirs: DIRS, mode: trigger.mode ?? 'standard', emit: (obj) => broadcast?.({ kind: 'ai', ...obj, runId }) }).catch(() => {});
    res.json({ ok: true, runId });
  });

  // SSE-swarm (live visning)
  app.get('/api/ai/swarm', (req, res) => {
    const send = sse(res);
    const prev = broadcast;
    const listeners = new Set();
    listeners.add(send);
    broadcast = (obj) => { listeners.forEach((fn) => fn(obj)); prev?.(obj); };
    req.on('close', () => { listeners.delete(send); if (!listeners.size) broadcast = prev; });
  });

  // Upload af filer (billeder/dokumenter)
  app.post('/api/ai/upload', (req, res) => {
    // Forventer base64-body { name, mime, data }
    try {
      const { name, mime, data } = req.body ?? {};
      if (!name || !data) { res.status(400).json({ ok: false, error: 'Mangler fil' }); return; }
      const id = randomUUID().slice(0, 10);
      const ext = path.extname(name) || '.bin';
      const rel = `/uploads/${id}${ext}`;
      const abs = path.join(AI_DIR, 'uploads', `${id}${ext}`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(data, 'base64'));
      res.json({ ok: true, url: rel, name, mime: mime ?? 'application/octet-stream', kind: String(mime).startsWith('image/') ? 'image' : 'file' });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  startTriggerScheduler(cfg(), DIRS);
  return { broadcast: (fn) => { broadcast = fn; } };
}

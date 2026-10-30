// Orbit AI-kørsler: planlægning, sværm, hukommelse og triggere.
import { execFile } from 'child_process';
import { promisify } from 'node:util';
import { createRunWorktree, verifyRepository, repositoryEvidence } from './ai-repository.mjs';
import { validatePlan, executeGraph, runOutcome, saveRun } from './ai-state.mjs';
import { validateProjectPlan, PROJECT_PLAN_FORMAT } from './project-plan.mjs';
const execFileAsync = promisify(execFile);
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import { AI_SERVICES, serviceById, serviceAvailability, runChat, produceMedia, aiCfg } from './ai-services.mjs';


// ---- Langtidshukommelse (idé 4 + 17) ----------------------------------------
export function projectMemoryDirs(dirs, projectId) {
  const scope = projectId ? createHash('sha256').update(String(projectId)).digest('hex').slice(0, 24) : 'unscoped';
  return { ...dirs, memory: join(dirs.memory, 'projects', scope) };
}
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

async function initRunWorkdir(runDir, goal) {
  mkdirSync(runDir, { recursive: true });
  if (existsSync(join(runDir, '.git'))) return;
  writeFileSync(join(runDir, '00-MÅL.md'), `# Mål\n\n${goal}\n`);
  await execFileAsync('git', ['init', '-q'], { cwd: runDir, timeout: 10000 });
  await gitCommit(runDir, 'Start: mål');
}

async function gitCommit(runDir, message) {
  await execFileAsync('git', ['add', '-A'], { cwd: runDir, timeout: 10000 });
  await execFileAsync('git', ['-c', 'user.name=Orbit AI', '-c', 'user.email=orbit@local', 'commit', '-q', '-m', message, '--allow-empty'], { cwd: runDir, timeout: 10000 });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: runDir, timeout: 10000 });
  return stdout.trim();
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
      let body = text;
      try {
        const p = join(runDir, fname);
        if (existsSync(p)) body = readFileSync(p, 'utf8');
      } catch { /* brug tekst i stedet */ }
      out.push(`--- Leverance fra "${src.title}" (${fname}) ---\n${body}`);
    }
  }
  return out;
}

// ---- Omkostningsregnskab (idé 8) --------------------------------------------
// Counts describe activity, not provider credits or money. No fabricated prices.
function recordUsage(run, serviceId) {
  const svc = serviceById(serviceId);
  if (!svc) return;
  run.usage = run.usage ?? { byService: {}, jobs: 0 };
  run.usage.jobs += 1;
  const cur = run.usage.byService[serviceId] ?? { jobs: 0, kind: svc.kind };
  cur.jobs += 1;
  run.usage.byService[serviceId] = cur;
}

// ---- Orkestrator: planlægning + eksekvering ----------------------------------
export async function pickOrchestrator(cfg, availability) {
  const { prefs } = aiCfg(cfg);
  const order = [prefs.orchestrator, 'claude', 'codex', 'kimi', 'gemini', 'qwen'].filter(Boolean);
  for (const id of order) if (availability[id]?.available) return id;
  return null;
}

const PLAN_SCHEMA = `Svar KUN med JSON (intet andet): {"jobs":[{"title":string,"service":string,"phase":"koncept"|"design"|"prototype"|"produktion"|"test"|"polering"|"release","dependsOn":number[],"description":string}]}`;

// CLI-svar kan indeholde korte præ/eftertekster eller mere end ét JSON-objekt.
// Find det første komplette objekt med respekt for strenge og escapes i stedet
// for en grådig regex, der fejler med "non-whitespace character after JSON".
export function parseJsonObject(raw, accept = () => true) {
  const text = String(raw ?? '').trim();
  try {
    const direct = JSON.parse(text);
    if (direct && typeof direct === 'object' && !Array.isArray(direct) && accept(direct)) return direct;
  } catch { /* søg efter et indlejret objekt nedenfor */ }
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const value = JSON.parse(text.slice(start, i + 1));
            if (value && typeof value === 'object' && !Array.isArray(value) && accept(value)) return value;
          } catch { /* prøv næste objektstart */ }
          break;
        }
      }
    }
  }
  throw new Error('Orkestratoren returnerede ikke gyldig JSON');
}

// Auto skal give både orkestratoren og alle job adgang til brugerens uploadede filer.
// CLI-tjenesterne kan læse den absolutte sti; DOCX/PDF skal udtrækkes med lokale værktøjer.
function attachmentContext(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return null;
  return {
    role: 'user',
    text: 'Brugerens vedhæftede filer er en del af opgaven. Læs filerne fra de angivne diskstier og brug deres faktiske indhold. Udtræk tekst fra DOCX/PDF med lokale værktøjer i stedet for at gætte på indholdet.',
    attachments: attachments.slice(0, 10),
  };
}

export async function planWithLLM({ orchestratorId, goal, bible, attachments = [], cfg, dirs, availability, extra, signal }) {
  const roster = AI_SERVICES.map((s) => {
    const a = availability[s.id];
    return `- ${s.id} (${s.name}): stærke sider: ${s.strengths.join(', ')} — ${a?.available ? 'TILGÆNGELIG' : 'ikke tilgængelig'}`;
  }).join('\n');
  const runMem = runsMemoryTail(dirs);
  const prompt = `PLANLÆGNINGSFASE — du må IKKE udføre målet, køre tests, ændre filer eller producere en slutrapport. Returnér kun en jobplan; selve arbejdet udføres først af de efterfølgende Auto-jobs.\n\nDu er orkestrator for et AI-drevet projekt. Mål, som du KUN skal planlægge: ${goal}\n\n${bible ? `Projektets bibel (roller/stil): ${bible}\n\n` : ''}${runMem ? `Tidligere kørsler (kontekst — undgå at gentage fejl):\n${runMem}\n\n` : ''}Roster:\n${roster}\n\nFordel arbejdet til de TILGÆNGELIGE tjenester efter deres stærke sider. Brug færrest mulige jobs (typisk 1-4, højst 10) med afhængigheder (dependsOn = indeks i listen, tidligere jobs). Respektér målets præcise scope og tilføj aldrig nye faser. Medieproduktion og release må kun planlægges, når målet udtrykkeligt beder om det. ${extra ?? ''}\n\nStop efter planen. Ingen værktøjskald, ingen kodeændringer, ingen tests og ingen forklaring. ${PLAN_SCHEMA}`;
  const raw = await runChat({ serviceId: orchestratorId, messages: [attachmentContext(attachments), { role: 'user', text: prompt }].filter(Boolean), cfg, dirs, signal, readOnly: true, cwd: dirs.cwd });
  // CLI-loggen kan indeholde test-JSON før selve planen. Vælg objektet med jobs,
  // ikke blot det første tilfældige JSON-objekt i svaret.
  const plan = parseJsonObject(raw, (value) => Array.isArray(value.jobs));
  return plan.jobs.map((j, i) => ({
    id: `job-${i}`,
    title: String(j.title ?? `Job ${i + 1}`),
    serviceId: availability[j.service]?.available ? j.service : null,
    phase: j.phase ?? 'produktion',
    dependsOn: j.dependsOn ?? [],
    description: String(j.description ?? ''),
  }));
}

// En afgrænset Phase A/EI-A1+EI-A2-kørsel må ikke blive til en generisk pipeline.
// Returnér en forklaring, når planen bryder målets eksplicitte scope.
export function planScopeIssue(jobs, goal) {
  if (!/\b(afgrænset|phase\s+a|ei-a1|ei-a2)\b/i.test(goal)) return null;
  if (!jobs.length) return 'Planen indeholder ingen jobs.';
  if (jobs.length > 3) return `Planen indeholder ${jobs.length} jobs; en afgrænset kørsel må højst have 3.`;
  const forbidden = jobs.find((j) => j.phase === 'release'
    || ['meshy', 'elevenlabs', 'heygen'].includes(j.serviceId)
    || /\b(medieproduktion|release)\b/i.test(j.title));
  if (forbidden) return `Jobbet “${forbidden.title}” ligger uden for den afgrænsede kørsel.`;
  if (/\bei-a1\b/i.test(goal) && /\bei-a2\b/i.test(goal)) {
    const text = jobs.map((j) => `${j.title}\n${j.description}`).join('\n');
    if (!/\b(ei-a1|baseline)\b/i.test(text) || !/\b(ei-a2|ok-coach)\b/i.test(text)) {
      return 'Planen dækker ikke både EI-A1-baseline og EI-A2 OK-coach-kontrol.';
    }
  }
  return null;
}

// Sikker fallback: bevar målet ordret i stedet for at opfinde en generisk pipeline.
export function planByRules({ goal, availability }) {
  const pick = (...ids) => ids.find((id) => availability[id]?.available) ?? null;
  const steps = [
    {
      title: 'Udfør målet uden scope-udvidelse',
      svc: pick('codex', 'claude', 'kimi', 'qwen', 'gemini'),
      phase: 'produktion',
      desc: `Arbejd kun på dette mål. Tilføj ingen faser, assets, medieproduktion eller release:\n${goal}`,
    },
    {
      title: 'Verificér tests og rapportér faktiske resultater',
      svc: pick('claude', 'codex', 'kimi', 'gemini', 'qwen'),
      phase: 'test',
      desc: `Kør præcis de kontroller og tests, målet kræver. Rapportér faktiske kommandoer, resultater, ændrede filer og restfejl. Opfind ingen PASS-resultater:\n${goal}`,
    },
  ];
  const jobs = [];
  for (const s of steps) {
    if (!s.svc) continue;
    jobs.push({
      id: `job-${jobs.length}`,
      title: s.title,
      serviceId: s.svc,
      phase: s.phase,
      dependsOn: jobs.length ? [jobs.length - 1] : [],
      description: s.desc,
    });
  }
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

// Race-tilstand (A/B-race): to forskellige motorer løser samme opgave uafhængigt;
// en tredje (dommer) kårer vinderen og præsenterer det endelige svar.
function buildRacePlan({ goal, availability }) {
  const free = ['claude', 'codex', 'kimi', 'gemini', 'qwen'].filter((id) => availability[id]?.available);
  if (free.length < 3) return null;
  const [a, b] = free;
  const judge = free.find((id) => id !== a && id !== b) ?? free[2];
  return [
    {
      id: 'job-0',
      title: `Kandidat A: ${availability[a].name}`,
      serviceId: a,
      phase: 'produktion',
      dependsOn: [],
      description: `Du er KANDIDAT A i et race. Løs opgaven så godt du kan — kun det bedste svar vinder:\n${goal}`,
    },
    {
      id: 'job-1',
      title: `Kandidat B: ${availability[b].name}`,
      serviceId: b,
      phase: 'produktion',
      dependsOn: [],
      description: `Du er KANDIDAT B i et race. Løs opgaven så godt du kan — kun det bedste svar vinder:\n${goal}`,
    },
    {
      id: 'job-2',
      title: 'Dommer: kåring',
      serviceId: judge,
      phase: 'test',
      dependsOn: [0, 1],
      description: `Du er dommer i et race mellem to AI-modeller. Begge kandidater har løst: ${goal}\n\nBedøm begge svar kritisk (korrekthed, kvalitet, fuldstændighed). Forklar kort forskellene, kår en vinder — og aflever derefter vinderens svar som det ENDELIGE svar på opgaven.`,
    },
  ];
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
  if (tester) jobs.push({ id: `job-${jobs.length}`, title: 'Tester: verificér', serviceId: tester, phase: 'test', dependsOn: [jobs.length - 1], description: `Du er TESTER. Skriv og beskriv tests der verificerer løsningen, kør dem i det faktiske projekt. Rapportér kommando, exitkode og resultat. Hvis du ikke kan køre en test, skal den stå som IKKE KØRT, aldrig bestået. Dokumentér eventuelle rettelser.` });
  return jobs.length >= 2 ? jobs : null;
}


// ---- Kvalitets-dommer (auto-judge): scorer hver leverance mod opgaven ----
const JUDGE_SCHEMA = `Svar KUN med JSON (intet andet): {"score":number(0-10),"note":string}`;

async function judgeDeliverable({ judgeId, job, text, goal, bible, cfg, dirs, signal }) {
  const prompt = `Du er kvalitets-dommer for et AI-projekt.\nProjektmål: ${String(goal).slice(0, 800)}\n${bible ? `Bibel (stil/krav): ${String(bible)}\n` : ''}Job: ${job.title}\nOpgavebeskrivelse: ${String(job.description ?? '').slice(0, 1200)}\n\nLeverancen:\n${String(text).slice(0, 6000)}\n\nBedøm leverancen mod opgavebeskrivelsen: 0-10, hvor 6 er "accepterbar" og 8+ er "rigtig god". Giv én kort, konkret begrundelse på dansk. ${JUDGE_SCHEMA}`;
  const raw = await runChat({ serviceId: judgeId, messages: [{ role: 'user', text: prompt }], cfg, dirs, signal, readOnly: true, cwd: dirs.cwd });
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Dommeren returnerede ikke JSON');
  const j = JSON.parse(m[0]);
  return { score: Math.max(0, Math.min(10, Number(j.score) || 0)), note: String(j.note ?? '').slice(0, 300) };
}

// ---- Begrænset kontekst-grep: læs brugerudpegede filer ind som kontekst ----
function readContextFiles(runDir, cwd, files) {
  if (!Array.isArray(files) || !files.length) return [];
  const out = [];
  for (const f of files.slice(0, 3)) {
    const rel = String(f ?? '').trim();
    if (!rel || rel.includes('..')) continue;
    for (const base of [runDir, cwd]) {
      const p = join(base, rel);
      if (existsSync(p) && p.startsWith(base)) {
        try {
          out.push({ role: 'user', text: `Kontekst fra filen "${rel}" (brugeren har udpeget den):\n\`\`\`\n${readFileSync(p, 'utf8').slice(0, 4000)}\n\`\`\`` });
        } catch { /* fil kunne ikke læses */ }
        break;
      }
    }
  }
  return out;
}

// ---- live swarm-tilstand (deles til alle WS-klienter) ----------------------
export const swarmState = { active: null, last: null };
// Aktive kørsler med kontrol-håndtag: beskedindsprøjtning, skip, godkendelse, aflysning.
export const activeRuns = new Map(); // runId -> { run, instructions: [], skip: Set, resolveApproval, mode }

function updateSwarm(run, obj) {
  try {
    if (obj.type === 'orchestrator') {
      run.orchestratorId = obj.serviceId ?? null;
      run.plannerMode = obj.mode ?? null;
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
    } else if (obj.type === 'job_action') {
      const j = run.jobs.find(x => x.id === obj.jobId);
      if (j) j.actions = [...(j.actions ?? []).filter(a => a.id !== obj.action.id).slice(-99), obj.action];
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
      if (s) { s.status = obj.error ? 'error' : 'done'; s.text = String(obj.text ?? '').slice(0, 400); s.finishedAt = Date.now(); }
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
    } else if (obj.type === 'job_media') {
      const j = run.jobs.find(x => x.id === obj.jobId);
      if (j) j.media = obj.media;
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
      if (j) { j.status = 'skipped'; j.text = '(sprunget over)'; j.finishedAt = Date.now(); }
    } else if (obj.type === 'job_done') {
      const r = obj.result ?? {};
      const j = run.jobs.find((x) => x.id === r.jobId);
      if (j) {
        j.status = 'done';
        j.text = String(r.text ?? '').slice(0, 2000);
        j.artifacts = r.artifacts ?? [];
        j.finishedAt = Date.now();
      }
    } else if (obj.type === 'job_blocked' || obj.type === 'job_cancelled') {
      const j = run.jobs.find(x => x.id === obj.jobId);
      if (j) { j.status = obj.type === 'job_blocked' ? 'blocked' : 'cancelled'; j.error = obj.error; j.finishedAt = Date.now(); }
    } else if (obj.type === 'job_error') {
      const j = run.jobs.find((x) => x.id === obj.jobId);
      if (j) { j.status = 'error'; j.error = String(obj.error ?? ''); j.finishedAt = Date.now(); }
    } else if (obj.type === 'job_healing') {
      const j = run.jobs.find((x) => x.id === obj.jobId);
      if (j) { j.status = 'running'; j.notes = [...(j.notes ?? []).slice(-3), `Selvhealing: forsøger igen (${obj.attempt}. forsøg)`]; }
    } else if (obj.type === 'job_judged') {
      const j = run.jobs.find((x) => x.id === obj.jobId);
      if (j) { j.score = typeof obj.score === 'number' ? obj.score : null; j.judgeNote = String(obj.note ?? ''); }
    }
  } catch { /* swarm-tilstand er ikke kritisk */ }
}

// ---- Hierarkiske teams (idé 1/11) --------------------------------------------
// Et job markeret med team: true fungerer som holdleder: orkestratoren laver en
// underplan for delmålet, og holdet kører som en lille under-sværm med egne
// subagent-linjer (inkl. live-tekst) i sværm-visningen.
async function runTeamJob({ job, handle, goal, bible, attachments, cfg, dirs, availability, orchestratorId, track }) {
  const subGoal = job.description || job.title;
  track({ type: 'job_note', jobId: job.id, note: `Holdleder planlægger: ${subGoal.slice(0, 120)}` });
  let subJobs;
  if (orchestratorId) {
    try {
      subJobs = (await planWithLLM({ orchestratorId, goal: `${goal} — DELMÅL: ${subGoal}`, bible, attachments, cfg, dirs, availability, extra: 'Lav 2-4 SMÅ jobs til netop dette delmål.', signal: handle.abort.signal })).slice(0, 4);
    } catch { subJobs = null; }
  }
  if (!subJobs || !subJobs.length) {
    subJobs = [
      { id: 'sub-0', title: `Udfør: ${job.title}`, serviceId: job.serviceId, phase: job.phase, dependsOn: [], description: subGoal },
      { id: 'sub-1', title: 'Kvalitetstjek', serviceId: orchestratorId ?? job.serviceId, phase: 'test', dependsOn: [0], description: `Gennemgå resultatet af "${job.title}" og ret de vigtigste fejl.` },
    ];
  }
  subJobs = validatePlan(subJobs);
  const texts = new Map(), states = new Map(subJobs.map(j => [j.id, 'queued']));
  await executeGraph(subJobs, {
    status: id => states.get(id),
    cancelled: () => handle.cancelled,
    transition: (id, state, error) => {
      states.set(id, state);
      track({ type: 'subagent_done', jobId: job.id, subId: `${job.id}:${id}`, error, text: error });
    },
    execute: async sj => {
      const subId = `${job.id}:${sj.id}`;
      track({ type: 'subagent_start', jobId: job.id, subId, name: sj.title });
      try {
        const text = await runChat({ serviceId: sj.serviceId, cfg, dirs, cwd: handle.runDir, signal: handle.abort.signal, readOnly: job.readOnly === true,
          messages: [
            { role: 'system', text: `Overordnet mål: ${goal}\nProjektbibel: ${bible ?? ''}` },
            { role: 'user', text: `Seneste præciseringer fra brugeren:\n${handle.instructions.join('\n')}` },
            attachmentContext(attachments),
            { role: 'user', text: `Din opgave: ${sj.description}\nTidligere leverancer:\n${sj.dependsOn.map(d => texts.get(subJobs[d].id)).join('\n')}\nUdfør arbejdet og dokumentér faktiske kontroller.` },
          ].filter(Boolean),
          onDelta: delta => track({ type: 'subagent_delta', jobId: job.id, subId, delta }),
          onProcess: process => track({ type: 'job_process', jobId: job.id, ...process }),
          onAction: action => track({ type: 'job_action', jobId: job.id, action }),
          onSubagent: sub => track({ type: sub.phase === 'start' ? 'subagent_start' : 'subagent_done', jobId: job.id, ...sub }),
        });
        if (handle.cancelled) throw new Error('Kørslen er stoppet.');
        texts.set(sj.id, `## ${sj.title}\n${text}`); states.set(sj.id, 'done');
        track({ type: 'subagent_done', jobId: job.id, subId, text });
      } catch (e) {
        states.set(sj.id, 'error');
        track({ type: 'subagent_done', jobId: job.id, subId, error: e.message, text: `Fejl: ${e.message}` });
      }
    },
  });
  if ([...states.values()].some(s => s !== 'done')) throw new Error('Underteamet kunne ikke levere alle nødvendige delopgaver.');
  return [...texts.values()].join('\n\n');
}

// ---- Hovedkørsel --------------------------------------------------------------
export async function executeRun({ runId, goal, bible, attachments = [], predefinedJobs, cfg, dirs, emit, mode = 'standard', pauseAfterPlan = false, resumeDir = null, previousRun = null, projectId = null, taskId = null, repository = null, checks = [] }) {
  dirs = projectMemoryDirs(dirs, projectId);
  const run = {
    runId, goal, projectId, taskId, repository, checks,
    verification: { status: 'not_run', checks: [] },
    bible: String(bible ?? ''),
    parentRunId: previousRun?.runId ?? null,
    workDir: resumeDir ?? join(dirs.runs, 'work', runId),
    results: [...(previousRun?.results ?? [])],
    auditDir: previousRun?.auditDir ?? join(dirs.runs, 'deliverables', runId),
    attachments: Array.isArray(attachments) ? attachments.slice(0, 10) : [],
    mode,
    startedAt: Date.now(),
    orchestratorId: null,
    status: 'running',
    jobs: [],
    notes: [],
    processes: [],
    events: [],
    usage: { byService: {}, jobs: 0 },
    instructions: [...(previousRun?.instructions ?? [])],
    finishedAt: null,
  };
  const handle = { run, instructions: run.instructions, skip: new Set(), runDir: run.workDir, cancelled: false, abort: new AbortController() };
  activeRuns.set(runId, handle);
  swarmState.active = run;
  // Event-log til replay/simulering: alle strukturelle hændelser med tidsstempel.
  const track = (obj) => {
    if (!['job_delta', 'delta', 'subagent_delta'].includes(obj.type)) run.events.push({ at: Date.now(), ...obj });
    else if ((run.events.length === 0 || run.events[run.events.length - 1].type !== 'job_delta')) run.events.push({ at: Date.now(), type: 'job_delta', jobId: obj.jobId });
    if (obj.type === 'job_process') run.processes = [...run.processes.filter(p => p.pid !== obj.pid), ...(obj.finished ? [] : [{ pid: obj.pid, jobId: obj.jobId, startedAt: obj.startedAt }])];
    updateSwarm(run, obj);
    if (!['job_delta', 'delta', 'subagent_delta'].includes(obj.type)) saveRun(dirs, run);
    try { emit({ ...obj, runId, goal }); } catch { /* client disconnect does not cancel work */ }
  };
  handle.track = track;
  handle.persist = () => saveRun(dirs, run);
  const heartbeat = setInterval(() => {
    run.heartbeatAt = Date.now();
    try { saveRun(dirs, run); } catch { handle.cancelled = true; handle.abort.abort(); handle.resolveApproval?.([]); }
  }, 10000);
  heartbeat.unref();
  try {
  track({ type: 'run_start', runId, goal, projectId, taskId, startedAt: new Date().toISOString() });
  handle.abort.signal.throwIfAborted();
  if (repository && !previousRun) run.repository = await createRunWorktree(repository.source, handle.runDir, runId);
  handle.abort.signal.throwIfAborted();
  await initRunWorkdir(handle.runDir, goal);
  mkdirSync(run.auditDir, { recursive: true });
  writeFileSync(join(run.auditDir, 'PROJEKTBIBEL.md'), run.bible);
  saveRun(dirs, run);
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
  } else if (mode === 'race') {
    jobs = buildRacePlan({ goal, availability })
      ?? planByRules({ goal, availability });
    if (!jobs.some((j) => j.title.startsWith('Dommer'))) track({ type: 'job_note', jobId: null, note: 'For få gratis motorer til race (kræver 3) — bruger standardplan.' });
  } else if (orchestratorId) {
    try { jobs = await planWithLLM({ orchestratorId, goal, bible, attachments: run.attachments, cfg, dirs: { ...dirs, cwd: handle.runDir }, availability, signal: handle.abort.signal }); }
    catch (e) { track({ type: 'job_note', jobId: null, note: `Orkestrator-plan fejlede (${e.message}) — bruger regelbaseret plan.` }); jobs = planByRules({ goal, availability }); }
  } else {
    jobs = planByRules({ goal, availability });
  }

  const scopeIssue = planScopeIssue(jobs, goal);
  if (scopeIssue) {
    track({ type: 'job_note', jobId: null, note: `${scopeIssue} Bruger i stedet den sikre, målstyrede to-job-plan.` });
    jobs = planByRules({ goal, availability });
  }

  jobs = validatePlan(jobs);
  if (pauseAfterPlan) {
    run.status = 'awaiting_approval';
    track({ type: 'plan', jobs, paused: true });
    jobs = await new Promise(resolve => {
      handle.jobsSnapshot = jobs;
      handle.resolveApproval = resolve;
    });
    handle.resolveApproval = null;
    if (handle.cancelled) throw new Error('Kørslen er aflyst af brugeren.');
    jobs = validatePlan(jobs);
    track({ type: 'job_note', jobId: null, note: `Plan godkendt — ${jobs.length} jobs kører nu.` });
  }
  if (handle.cancelled) throw new Error('Kørslen er aflyst af brugeren.');
  run.status = 'running';
  track({ type: 'plan', jobs });
  const results = run.results;
  const doneText = new Map(results.map(r => [r.jobId, r.text]));
  for (const result of results) updateSwarm(run, { type: 'job_done', result });
  saveRun(dirs, run);
  const { prefs } = aiCfg(cfg);

  const runJob = async (job) => {
    if (handle.skip.has(job.id)) {
      track({ type: 'job_skipped', jobId: job.id });

      return;
    }
    if (handle.cancelled) return;
    track({ type: 'job_start', job });
    recordUsage(run, job.serviceId);

    const serviceMemory = serviceMemoryTail(dirs, job.serviceId);
    const userInstructions = run.instructions.length
      ? [{ role: 'user', text: `INSTRUKTIONER FRA BRUGEREN (gælder for resten af kørslen — følg dem):\n${run.instructions.map((x, i) => `${i + 1}. ${x}`).join('\n')}` }]
      : [];
    const deliverables = readDeliverables(run.auditDir, jobs, job.dependsOn, doneText);
    const baseCtx = [
      bible ? { role: 'system', text: `Projektets bibel:\n${bible}` } : null,
      serviceMemory ? { role: 'system', text: `Hvad du tidligere har lavet for denne bruger (din hukommelse):\n${serviceMemory}` } : null,
      ...userInstructions,
      attachmentContext(run.attachments),
      { role: 'user', text: `EKSEKVERINGSFASE — udfør din tildelte opgave nu. Returnér ikke blot en plan eller en beskrivelse af, hvad der bør gøres. Eventuelle planlægningsinstruktioner i det oprindelige projektmål gjaldt kun orkestratorens tidligere planfase.\n\nProjektmål: ${goal}\n\nDin opgave (${job.phase}): ${job.title}\n${job.description}\n\nLav et konkret, færdigt resultat. Svar på dansk.` },
      ...deliverables.map((d) => ({ role: 'user', text: d })),
      ...readContextFiles(handle.runDir, dirs.cwd, job.context),
    ].filter(Boolean);

    const attempt = async (extra) => {
      const text = job.team
        ? await runTeamJob({ job, run, handle, goal, bible, attachments: run.attachments, cfg, dirs, availability, orchestratorId, emit, track })
        : await runChat({
            serviceId: job.serviceId, messages: [...baseCtx, ...extra], cfg, dirs, cwd: handle.runDir, signal: handle.abort.signal, readOnly: job.readOnly === true,
            onDelta: (d) => track({ type: 'job_delta', jobId: job.id, delta: d }),
            onProcess: process => track({ type: 'job_process', jobId: job.id, ...process }),
            onAction: action => track({ type: 'job_action', jobId: job.id, action }),
            onSubagent: (sub) => track({ type: sub.phase === 'start' ? 'subagent_start' : 'subagent_done', jobId: job.id, ...sub }),
          });
      return text;
    };

    const baseCommit = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: handle.runDir })).stdout.trim();
    try {
      if (run.repository && ['prototype', 'produktion', 'polering'].includes(job.phase) && !['codex', 'claude', 'kimi', 'gemini', 'meshy', 'elevenlabs', 'heygen'].includes(job.serviceId)) throw new Error('Dette repository-job kræver en coding-agent med fil- og kommandoadgang.');
      const isMedia = ['meshy', 'elevenlabs', 'heygen'].includes(job.serviceId);
      let text;
      let artifacts = [];
      if (isMedia) {
        text = job.description || job.title;
        artifacts = await produceMedia(job, text, cfg, dirs, track, handle.abort.signal);
        if (!artifacts.length) throw new Error('Mediejobbet leverede ingen fil.');
      } else try {
        text = await attempt([]);
      } catch (e1) {
        // Selvhealing kan ikke rette en manglende/ugyldig CLI-sti; undgå et spildt genforsøg.
        const startupFailure = /ENOENT|Kunne ikke starte|Windows-shim/i.test(String(e1.message));
        if (prefs.selfHeal && !startupFailure && !handle.skip.has(job.id) && !handle.cancelled) {
          track({ type: 'job_healing', jobId: job.id, attempt: 2, error: String(e1.message).slice(0, 300) });
          track({ type: 'job_note', jobId: job.id, note: 'Forsøger igen med fejlkontekst (selvhealing).' });
          text = await attempt([{ role: 'user', text: `Dit første forsøg slog fejl med: "${e1.message}". Ret årsagen og leverér resultatet.` }]);
        } else {
          throw e1;
        }
      }
      // Kvalitets-dommer (idé: auto-judge): en ANDEN tilgængelig tjeneste scorer
      // leverancen. Lav score blokerer; der ændres ikke kode bag det valgte tekstsvar.
      let score = null;
      let judgeNote = null;
      if (!isMedia && prefs.autoJudge !== false && !job.team) {
        const judgeId = ['claude', 'kimi', 'gemini', 'codex'].find((id) => id !== job.serviceId && availability[id]?.available);
        if (judgeId) {
          try {
            const judged = await judgeDeliverable({ judgeId, job, text, goal, bible, cfg, dirs: { ...dirs, cwd: handle.runDir }, signal: handle.abort.signal });
            score = judged.score;
            judgeNote = judged.note;
            track({ type: 'job_judged', jobId: job.id, score, note: judgeNote, judge: judgeId });
            if (judged.score < 6) {
              throw new Error(`Leverancen kræver review: ${judged.score}/10 — ${judged.note}`);
            }
          } catch (e) {
            throw new Error(`Kvalitetskontrol ikke bestået: ${e.message}`);
          }
        }
      }
      appendServiceMemory(dirs, job.serviceId, `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · "${job.title}" · ${text.length} tegn leveret${score !== null ? ` · dommer ${score}/10` : ''}`);
      if (handle.cancelled) throw new Error('Kørslen blev stoppet.');
      const fname = writeDeliverable(run.auditDir, job, text);
      if (!fname) throw new Error('Leverancen kunne ikke gemmes.');
      if (job.readOnly) {
        const dirty = (await execFileAsync('git', ['status', '--porcelain'], { cwd: handle.runDir })).stdout.trim();
        const head = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: handle.runDir })).stdout.trim();
        if (dirty || head !== baseCommit) throw new Error('Analysejobbet ændrede repository, selv om det kun måtte læse. Ændringerne kræver separat gennemgang.');
      }
      const commit = await gitCommit(handle.runDir, job.title);
      doneText.set(job.id, text);
      const res = { jobId: job.id, title: job.title, serviceId: job.serviceId, phase: job.phase, text, artifacts, deliverable: fname, commit, verification: 'requires_review', score, judgeNote };
      results.push(res);
      track({ type: 'job_done', result: res });
    } catch (e) {
      // Preserve the failed attempt on a separate branch before restoring this
      // run's checkout. Independent jobs must never inherit failed code changes.
      try {
        const failedCommit = await gitCommit(handle.runDir, `Ikke godkendt: ${job.title}`);
        const failedBranch = `orbit-attempt/${runId}/${job.id}`;
        await execFileAsync('git', ['branch', failedBranch, failedCommit], { cwd: handle.runDir, timeout: 10000 });
        await execFileAsync('git', ['reset', '--hard', baseCommit], { cwd: handle.runDir, timeout: 10000 });
        track({ type: 'job_note', jobId: job.id, note: `Forsøget er bevaret i ${failedBranch} (${failedCommit}). Arbejdsgrenen er tilbageført før næste job.` });
      } catch (checkpointError) {
        handle.cancelled = true;
        handle.abort.abort();
        track({ type: 'job_note', jobId: job.id, note: `Kørslen standses, fordi arbejdsområdet ikke kunne sikres: ${checkpointError.message}` });
      }
      track({ type: handle.cancelled ? 'job_cancelled' : 'job_error', jobId: job.id, error: e.message });
    }
  };

  await executeGraph(jobs, {
    execute: runJob,
    status: id => run.jobs.find(j => j.id === id)?.status,
    cancelled: () => handle.cancelled,
    transition: (jobId, status, error) => track({ type: `job_${status}`, jobId, error }),
  });
  let outcome = runOutcome(run.jobs, handle.cancelled);
  if (outcome === 'done' && run.repository) {
    track({ type: 'job_note', note: 'Kontrollerer den samlede repository-leverance.' });
    const analysisOnly = jobs.every(j => j.readOnly === true);
    const checkResults = analysisOnly ? [] : await verifyRepository(handle.runDir, checks, handle.abort.signal);
    run.verification = { status: analysisOnly ? 'not_run' : !checks.length ? 'not_configured' : checkResults.length === checks.length && checkResults.every(c => c.status === 'passed') ? 'passed' : 'failed', checks: checkResults };
    run.evidence = await repositoryEvidence(handle.runDir, run.repository.baseCommit);
    if (run.evidence.trackedChangesAfterChecks) {
      run.verification.status = 'failed';
      run.verification.checks.push({ name: 'Testet commit uændret', status: 'failed', exitCode: null, output: 'Kontrollerne ændrede versionsstyrede filer. Resultatet kan ikke knyttes til det gemte commit.' });
    }
    if (run.verification.status === 'failed') outcome = 'blocked';
    track({ type: 'verification', verification: run.verification, evidence: run.evidence });
  }
  run.status = handle.cancelled ? 'cancelled' : outcome;
  if (run.status === 'done') {
    const proposalText = [...run.results].reverse().find(r => r.text?.includes('"orbitProjectPlan"'))?.text;
    if (proposalText) {
      try { run.projectPlan = validateProjectPlan(parseJsonObject(proposalText, x => Boolean(x.orbitProjectPlan)).orbitProjectPlan); }
      catch (e) { run.projectPlanError = `Opgaveforslaget kunne ikke valideres: ${e.message}`; }
    }
  }
  run.finishedAt = Date.now();
  appendRunMemory(dirs, run);
  track({ type: 'run_finished', status: run.status });
  if (run.status === 'done') track({ type: 'done', status: run.status, summary: results.map(r => ({ title: r.title, serviceId: r.serviceId })) });
  else track({ type: 'error', status: run.status, error: run.status === 'cancelled' ? 'Kørslen blev stoppet af brugeren.' : 'Kørslen leverede ikke alle nødvendige jobs. Se fejl og blokeringer.' });
  } catch (e) {
    run.status = handle.cancelled ? 'cancelled' : 'error';
    run.error = e.message;
    run.finishedAt = Date.now();
    track({ type: 'run_finished', status: run.status });
    track({ type: 'error', status: run.status, error: e.message });
  } finally {
    clearInterval(heartbeat);
    activeRuns.delete(runId);
    if (swarmState.active === run) {
      swarmState.last = run;
      swarmState.active = null;
    }
  }
}

// ---- Pipeline-skabeloner (idé 16) ---------------------------------------------
const BUILTIN_TEMPLATES = [
  {
    id: 'tpl-project-takeover', builtin: true, name: 'Overtag eksisterende projekt',
    description: 'Læs kode og bibel → dokumentér faktisk status → foreslå afgrænset restarbejde. Ingen kodeændringer.',
    jobs: [
      { id: 'job-0', title: 'Kortlæg kode og gældende beslutninger', serviceId: 'codex', phase: 'design', readOnly: true, dependsOn: [], description: 'Læs repository, gældende projektbibel og eksisterende testresultater. Skeln for hvert centralt spillerforløb mellem besluttet, implementeret, faktisk afprøvet og godkendt. Henvis til filer. Udfør ingen ændringer, og påstå aldrig at en test er kørt, hvis du kun har læst koden.' },
      { id: 'job-1', title: 'Forslag til færdiggørelsesplan', serviceId: 'codex', phase: 'design', readOnly: true, dependsOn: [0], description: `Udled en prioriteret liste fra de dokumenterede huller. Hver opgave skal have formål, afgrænsning, acceptkriterier, afhængigheder og en konkret kontrol. Gruppér i nødvendigt for version 1 og senere idéer. Markér ukendte forhold. Foreslå ét lille, spilbart første mål. Ændr ingen kode eller godkendte designbeslutninger.\n\n${PROJECT_PLAN_FORMAT}` },
    ],
  },
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

export function loadTemplates(dirs) {
  try {
    const p = join(dirs.runs, 'ai-templates.json');
    const user = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
    return [...BUILTIN_TEMPLATES, ...(Array.isArray(user) ? user : [])];
  } catch { return BUILTIN_TEMPLATES; }
}

export function saveUserTemplates(dirs, list) {
  try {
    writeFileSync(join(dirs.runs, 'ai-templates.json'), JSON.stringify(list.filter((t) => !t.builtin), null, 2));
  } catch { /* ikke kritisk */ }
}

// ---- Autonome triggere (idé 15) ------------------------------------------------
// cron: minut-baseret plan (5 felter, * , og */n understøttes) — kører et mål på fast tidspunkt.
// webhook: POST /api/ai/hook/<token> starter kørslen (fx fra GitHub eller en færdig Meshy-job).
export function cronMatches(expr, date) {
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
export function startTriggerScheduler({ loadConfig, dirs, broadcast }) {
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
  triggerTimer.unref();
}

// Orbit AI-kørsler: planlægning, sværm, hukommelse og triggere.
import { execFile } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { AI_SERVICES, serviceById, serviceAvailability, runChat, produceMedia, aiCfg } from './ai-services.mjs';


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

export function usageCostKr(usage) {
  let kr = 0;
  for (const [id, u] of Object.entries(usage?.byService ?? {})) {
    if (u.kind === 'paid-api') kr += u.jobs * 0.25; // estimat, når låst op
  }
  return Math.round(kr * 100) / 100;
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
  const prompt = `PLANLÆGNINGSFASE — du må IKKE udføre målet, køre tests, ændre filer eller producere en slutrapport. Returnér kun en jobplan; selve arbejdet udføres først af de efterfølgende Auto-jobs.\n\nDu er orkestrator for et AI-drevet projekt. Mål, som du KUN skal planlægge: ${goal}\n\n${bible ? `Projektets bibel (roller/stil): ${bible.slice(0, 6000)}\n\n` : ''}${runMem ? `Tidligere kørsler (kontekst — undgå at gentage fejl):\n${runMem}\n\n` : ''}Roster:\n${roster}\n\nFordel arbejdet til de TILGÆNGELIGE tjenester efter deres stærke sider. Brug færrest mulige jobs (typisk 1-4, højst 10) med afhængigheder (dependsOn = indeks i listen, tidligere jobs). Respektér målets præcise scope og tilføj aldrig nye faser. Medieproduktion og release må kun planlægges, når målet udtrykkeligt beder om det. ${extra ?? ''}\n\nStop efter planen. Ingen værktøjskald, ingen kodeændringer, ingen tests og ingen forklaring. ${PLAN_SCHEMA}`;
  const raw = await runChat({ serviceId: orchestratorId, messages: [attachmentContext(attachments), { role: 'user', text: prompt }].filter(Boolean), cfg, dirs, signal, readOnly: true });
  // CLI-loggen kan indeholde test-JSON før selve planen. Vælg objektet med jobs,
  // ikke blot det første tilfældige JSON-objekt i svaret.
  const plan = parseJsonObject(raw, (value) => Array.isArray(value.jobs));
  return plan.jobs.map((j, i) => ({
    id: `job-${i}`,
    title: String(j.title ?? `Job ${i + 1}`),
    serviceId: availability[j.service]?.available ? j.service : null,
    phase: j.phase ?? 'produktion',
    dependsOn: Array.isArray(j.dependsOn) ? j.dependsOn.filter((d) => d < i) : [],
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
      phase: 'koncept',
      dependsOn: [],
      description: `Løs denne opgave bedst muligt. Du er i et A/B-race mod en anden AI — vær præcis og grundig:\n${goal}`,
    },
    {
      id: 'job-1',
      title: `Kandidat B: ${availability[b].name}`,
      serviceId: b,
      phase: 'koncept',
      dependsOn: [],
      description: `Løs denne opgave bedst muligt. Du er i et A/B-race mod en anden AI — vær præcis og grundig:\n${goal}`,
    },
    {
      id: 'job-2',
      title: 'Dommer: kår vinderen',
      serviceId: judge,
      phase: 'test',
      dependsOn: [0, 1],
      description: `Du er dommer i et A/B-race. To kandidater har løst: ${goal}\n\nVælg den bedste løsning, begrund kort, og præsentér den som det endelige svar.`,
    },
  ];
}

// En "team"-opgave: to tjenester arbejder sammen om én leverance.
// Rollen: arkitekt/skribent laver udkast → makker forbedrer → arkitekt finaliserer.
async function runTeamJob({ job, run, handle, goal, bible, attachments = [], cfg, dirs, availability, orchestratorId, emit, track }) {
  const partner = ['claude', 'codex', 'kimi', 'gemini', 'qwen'].find((id) => id !== job.serviceId && availability[id]?.available);
  if (!partner) {
    track({ type: 'job_note', jobId: job.id, note: 'Team: ingen ledig makker — kører solo.' });
    return runChat({ serviceId: job.serviceId, messages: [{ role: 'user', text: `Opgave: ${job.description}\nMål: ${goal}` }], cfg, dirs, signal: handle.abort.signal });
  }
  track({ type: 'job_note', jobId: job.id, note: `Team: ${job.serviceId} + ${partner} arbejder sammen.` });
  const draft = await runChat({
    serviceId: job.serviceId,
    messages: [attachmentContext(attachments), { role: 'user', text: `${bible ? `Bibel: ${bible.slice(0, 2000)}\n\n` : ''}Du er i et team med ${partner}. Lav et stærkt UDkast til denne opgave (makkeren forbedrer det bagefter):\n${job.description}\n\nMål: ${goal}` }].filter(Boolean),
    cfg, dirs, signal: handle.abort.signal,
  });
  track({ type: 'subagent_done', jobId: job.id, role: `${job.serviceId} (udkast)`, note: `${draft.length} tegn` });
  const improved = await runChat({
    serviceId: partner,
    messages: [{ role: 'user', text: `Du er i et team med ${job.serviceId}. Her er deres udkast til opgaven "${job.title}":\n\n${draft}\n\nForbedr det: ret fejl, tilføj det der mangler, og returnér den FORBEDREDE version.` }],
    cfg, dirs, signal: handle.abort.signal,
  });
  track({ type: 'subagent_done', jobId: job.id, role: `${partner} (forbedring)`, note: `${improved.length} tegn` });
  return improved;
}

// Kvalitets-dommer: en anden tjeneste scorer en leverance 0-10.
async function judgeDeliverable({ judgeId, job, text, goal, bible, cfg, dirs, signal }) {
  const raw = await runChat({
    serviceId: judgeId,
    messages: [{ role: 'user', text: `Du er kvalitets-dommer. Scor denne leverance 0-10 for opgaven "${job.title}" (mål: ${String(goal).slice(0, 500)}).\n${bible ? `Bibel/kvalitetsramme: ${bible.slice(0, 1500)}\n` : ''}\nLeverance:\n${text.slice(0, 6000)}\n\nSvar KUN med JSON: {"score":number,"note":string} — note = kort begrundelse + hvad der mangler for 10/10.` }],
    cfg, dirs, signal,
  });
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : raw);
    return { score: Math.max(0, Math.min(10, Number(j.score) || 0)), note: String(j.note ?? '').slice(0, 300) };
  } catch { return { score: 7, note: 'Dommer-svaret kunne ikke parses' }; }
}

// ---- Swarm-state (shared med companion via closure) ---------------------------
export const swarmState = { active: null, last: null };
const activeRuns = new Map();
export function activeRunIds() { return [...activeRuns.keys()]; }

function writeContextFile(runDir, name, content) {
  try {
    const p = join(runDir, 'context');
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, name), content);
    return `context/${name}`;
  } catch { return null; }
}

function readContextFiles(runDir, cwd, context) {
  const out = [];
  const read = (base, rel, label) => {
    if (!rel || typeof rel !== 'string') return;
    const p = join(base, rel);
    if (!existsSync(p)) return;
    try {
      const txt = readFileSync(p, 'utf8').slice(0, 8000);
      out.push({ role: 'user', text: `${label} "${rel}":\n\`\`\`\n${txt}\n\`\`\`` });
    } catch { /* ikke læsbar */ }
  };
  if (Array.isArray(context)) {
    for (const c of context) {
      if (typeof c !== 'string') continue;
      const rel = c.replace(/^\.orbit\/[^/]+\//, '');
      read(runDir, rel, 'Kørselsfil');
      read(cwd, rel, 'Projektfil');
    }
  }
  return out;
}

export async function executeRun({ runId, goal, bible, attachments = [], cfg, dirs, mode, jobs: presetJobs, instructions = [], emit, resume = null, approval = false, extraPlanPrompt = '' }) {
  const availability = serviceAvailability(cfg, dirs);
  const orchestratorId = await pickOrchestrator(cfg, availability);
  const run = {
    runId, goal, mode, orchestratorId, attachments,
    startedAt: Date.now(), status: 'running',
    events: [], jobs: [], instructions: [...instructions],
  };
  const handle = { run, instructions: run.instructions, skip: new Set(), runDir: join(dirs.runs, 'work', runId), cancelled: false, abort: new AbortController() };
  activeRuns.set(runId, handle);
  swarmState.active = run;
  try {
  const track = (evt) => {
    const e = { ...evt, ts: Date.now(), runId };
    run.events.push(e);
    if (evt.type === 'plan') run.jobs = evt.jobs.map((j) => ({ ...j, status: 'pending', stream: '' }));
    if (evt.type === 'job_start') {
      const j = run.jobs.find((x) => x.id === evt.job.id);
      if (j) { j.status = 'running'; j.startedAt = Date.now(); }
    }
    if (evt.type === 'job_delta') {
      const j = run.jobs.find((x) => x.id === evt.jobId);
      if (j) j.stream = (j.stream ?? '') + evt.delta;
    }
    if (evt.type === 'job_done' || evt.type === 'job_error' || evt.type === 'job_skipped') {
      const j = run.jobs.find((x) => x.id === evt.jobId);
      if (j) {
        j.status = evt.type === 'job_done' ? 'done' : evt.type === 'job_error' ? 'error' : 'skipped';
        j.finishedAt = Date.now();
        if (evt.type === 'job_error') j.error = evt.error;
      }
    }
    emit(e);
  };

  track({ type: 'run_start', goal, mode, orchestratorId });

  // Arbejdsmappe med git for denne kørsel
  if (!resume) initRunWorkdir(handle.runDir, goal);
  const resumeDir = resume ? join(dirs.runs, 'work', resume.runId) : null;

  let jobs;
  if (presetJobs?.length) {
    jobs = presetJobs;
  } else if (mode === 'debate' || mode === 'vote') {
    jobs = buildDebatePlan({ goal, availability, vote: mode === 'vote' });
  } else if (mode === 'race') {
    jobs = buildRacePlan({ goal, availability });
  } else {
    // Resume: genbrug plan, spring færdige jobs over.
    if (resume?.jobs?.length) {
      jobs = resume.jobs;
      for (const j of jobs) if (j.status === 'done') handle.skip.add(j.id);
      track({ type: 'job_note', jobId: null, note: `Genoptager kørsel ${resume.runId} — ${handle.skip.size} færdige job beholdes.` });
    } else if (orchestratorId) {
      track({ type: 'job_note', jobId: null, note: `${availability[orchestratorId]?.name ?? orchestratorId} planlægger fordelingen…` });
      try {
        jobs = await planWithLLM({ orchestratorId, goal, bible, attachments, cfg, dirs, availability, extra: extraPlanPrompt, signal: handle.abort.signal });
      } catch (e) {
        track({ type: 'job_note', jobId: null, note: `LLM-plan fejlede (${String(e.message).slice(0, 120)}) — bruger regelbaseret fordeling.` });
      }
    }
    if (!jobs?.length) jobs = planByRules({ goal, availability });
    const scopeIssue = planScopeIssue(jobs, goal);
    if (scopeIssue) throw new Error(`Planen blev stoppet: ${scopeIssue}`);
    if (!jobs.length) throw new Error('Ingen tilgængelige AI-tjenester. Forbind en tjeneste under Tilkoblinger.');
  }
  if (approval && !presetJobs?.length && !resume) {
    track({ type: 'plan', jobs: jobs.map(({ id, title, serviceId, phase, dependsOn, description }) => ({ id, title, serviceId, phase, dependsOn, description })) });
    track({ type: 'awaiting_approval', runId, goal, paused: true });
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
    const deliverables = readDeliverables(resumeDir ?? handle.runDir, jobs, job.dependsOn, doneText);
    const baseCtx = [
      bible ? { role: 'system', text: `Projektets bibel:\n${bible.slice(0, 6000)}` } : null,
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
            serviceId: job.serviceId, messages: [...baseCtx, ...extra], cfg, dirs, cwd: handle.runDir, signal: handle.abort.signal,
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
      recordUsage(run, job.serviceId);
      // Kvalitets-dommer (idé: auto-judge): en ANDEN tilgængelig tjeneste scorer
      // leverancen; under 6/10 udløser ét forbedringsforsøg med dommerens feedback.
      let score = null;
      let judgeNote = null;
      if (prefs.autoJudge !== false && !job.team) {
        const judgeId = ['claude', 'kimi', 'gemini', 'codex'].find((id) => id !== job.serviceId && availability[id]?.available);
        if (judgeId) {
          try {
            const judged = await judgeDeliverable({ judgeId, job, text, goal, bible, cfg, dirs, signal: handle.abort.signal });
            score = judged.score;
            judgeNote = judged.note;
            track({ type: 'job_judged', jobId: job.id, score, note: judgeNote, judge: judgeId });
            if (judged.score < 6 && !handle.skip.has(job.id) && !handle.cancelled) {
              track({ type: 'job_note', jobId: job.id, note: `Dommer: ${judged.score}/10 — forbedrer leverancen.` });
              const improved = await attempt([{ role: 'user', text: `Kvalitets-dommeren gav kun ${judged.score}/10 med begrundelsen: "${judged.note}". Ret og forbedr leverancen, så den fortjener mindst 8/10.` }]);
              try {
                const rej = await judgeDeliverable({ judgeId, job, text: improved, goal, bible, cfg, dirs, signal: handle.abort.signal });
                if (rej.score >= score) {
                  text = improved;
                  score = rej.score;
                  judgeNote = rej.note;
                  track({ type: 'job_judged', jobId: job.id, score, note: judgeNote, judge: judgeId, round: 2 });
                }
              } catch { /* behold oprindelige leverance */ }
            }
          } catch (e) {
            track({ type: 'job_note', jobId: job.id, note: `Dommer fejlede: ${String(e.message).slice(0, 100)}` });
          }
        }
      }
      appendServiceMemory(dirs, job.serviceId, `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · "${job.title}" · ${text.length} tegn leveret${score !== null ? ` · dommer ${score}/10` : ''}`);
      const fname = writeDeliverable(handle.runDir, job, text);
      if (fname) gitCommit(handle.runDir, `${job.title}`);
      doneText.set(job.id, text);
      const artifacts = await produceMedia(job, text, cfg, dirs, track);
      const res = { jobId: job.id, title: job.title, serviceId: job.serviceId, phase: job.phase, text, artifacts, deliverable: fname, score, judgeNote };
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
  writeFileSync(join(dirs.runs, `${runId}.json`), JSON.stringify({ runId, goal, mode, orchestratorId, attachments: run.attachments, jobs: run.jobs, results, usage: run.usage, events: run.events, finishedAt: new Date().toISOString() }, null, 2));
  appendRunMemory(dirs, run);
  gitCommit(handle.runDir, 'Kørsel afsluttet');
  if (handle.cancelled) track({ type: 'error', error: 'Kørslen blev stoppet af brugeren.' });
  else track({ type: 'done', summary: results.map((r) => ({ title: r.title, serviceId: r.serviceId })) });
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
}

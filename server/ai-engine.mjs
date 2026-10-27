// Orbit AI HTTP-ruter.
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { serviceById, serviceAvailability, runChat, setSecretsDir, loadKeySecrets, saveKeySecrets, aiCfg } from './ai-services.mjs';
import { executeRun, swarmState, activeRuns, loadTemplates, saveUserTemplates, startTriggerScheduler, usageCostKr, pickOrchestrator, planWithLLM } from './ai-runtime.mjs';

// ---- HTTP-ruter --------------------------------------------------------------
export function registerAiRoutes(app, { loadConfig, saveConfig, broadcast, APP_DIR, EXPORT_DIR }) {
  setSecretsDir(APP_DIR); // nøgleboksen bor ved siden af companion.json i ~/.orbit
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
    const patch = req.body ?? {};
    cfg.aiPrefs = { allowPaidApis: false, ...(cfg.aiPrefs ?? {}), ...patch };
    try {
      saveConfig(cfg);
    } catch (e) {
      return res.status(500).json({ ok: false, reason: `Kunne ikke gemme AI-indstillingerne: ${e.message}` });
    }
    // Bekræft fra disken, så UI aldrig viser en tilladelse som ikke er gemt.
    const persisted = loadConfig();
    if (patch.allowPaidApis !== undefined && persisted.aiPrefs?.allowPaidApis !== patch.allowPaidApis) {
      return res.status(500).json({ ok: false, reason: 'Betalingsindstillingen kunne ikke genlæses fra companion.json. Genstart companion-serveren og prøv igen.' });
    }
    res.json({ ok: true, prefs: aiCfg(persisted).prefs });
  });

  app.post('/api/ai/services/:id', (req, res) => {
    const svc = serviceById(req.params.id);
    if (!svc) return res.status(404).json({ ok: false, reason: 'ukendt tjeneste' });
    const cfg = loadConfig();
    cfg.aiProviders = cfg.aiProviders ?? {};
    const cur = cfg.aiProviders[svc.id] ?? {};
    const { enabled, apiKey, model, cmd, cliTemplate, baseUrl, avatarId, voiceId } = req.body ?? {};

    // Nøglehåndtering: nye nøgler gemmes i den hemmelige nøgleboks, og en
    // evt. gammel nøgle i companion.json migreres straks derover og slettes.
    const secrets = loadKeySecrets();
    if (apiKey) {
      secrets[svc.id] = { ...(secrets[svc.id] ?? {}), apiKey: String(apiKey) };
    } else if (apiKey === '') {
      delete secrets[svc.id];
    }
    if (cur.apiKey) delete cur.apiKey;
    if (apiKey !== undefined && !saveKeySecrets(secrets)) {
      return res.status(500).json({ ok: false, reason: 'Kunne ikke skrive til ai-keys.json — se companion-loggen.' });
    }
    // Gemning må ikke rapporteres som vellykket, før nøglen kan genlæses fra disken.
    // Det fanger både Windows ACL-problemer og en gammel companion-proces uden hot-reload.
    const persisted = loadKeySecrets();
    if (apiKey && persisted[svc.id]?.apiKey !== String(apiKey)) {
      return res.status(500).json({ ok: false, reason: 'Nøglen kunne ikke genlæses fra ai-keys.json. Genstart companion-serveren og prøv igen.' });
    }
    if (apiKey === '' && persisted[svc.id]?.apiKey) {
      return res.status(500).json({ ok: false, reason: 'Den gamle nøgle kunne ikke fjernes fra ai-keys.json.' });
    }

    cfg.aiProviders[svc.id] = {
      ...cur,
      ...(enabled !== undefined ? { enabled } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(cmd ? { cmd } : {}),
      ...(cliTemplate ? { cliTemplate } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(avatarId ? { avatarId } : {}),
      ...(voiceId ? { voiceId } : {}),
    };
    try {
      saveConfig(cfg);
    } catch (e) {
      return res.status(500).json({ ok: false, reason: `Kunne ikke gemme companion-konfigurationen: ${e.message}` });
    }
    res.json({ ok: true, hasKey: Boolean(loadKeySecrets()[svc.id]?.apiKey) });
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
          cur.jobs += 1;
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
    const { goal, bible, attachments } = req.body ?? {};
    if (!goal) return res.status(400).json({ ok: false, reason: 'goal kræves' });
    const cfg = loadConfig();
    try {
      const availability = await serviceAvailability(cfg);
      const orchestratorId = await pickOrchestrator(cfg, availability);
      if (!orchestratorId) return res.status(409).json({ ok: false, reason: 'Ingen orkestrator tilgængelig (installér et CLI).' });
      const jobs = await planWithLLM({ orchestratorId, goal: String(goal), bible: String(bible ?? ''), attachments, cfg, dirs, availability });
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
      const prompt = `Skriv en projekt-bibel (rollebog) for projektet "${project ?? 'Uden navn'}". ${notes ? `Stikord/noter fra brugeren:\n${String(notes).slice(0, 3000)}\n\n` : ''}${current ? `Nuværende udkast:\n${String(current).slice(0, 2000)}\n\nForbedr og udbyg det.` : ''}Biblen skal fastlægge: overordnet vision/stil, hvilken AI-tjeneste der har hvilken rolle (kodning, design, 3D, lyd, video, review), tone/sprog og kvalitetskrav. Skriv den på dansk, kompakt (max 400 ord), så den kan prependes til enhver agent-prompt.`;
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
    if (kind === 'cron' && !cronMatches(cron, new Date()) && !/^\S+\s+\S+\s+\S+\s+\S+$/.test(String(cron ?? ''))) {
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
      mode: ['standard', 'roles', 'debate', 'vote', 'race'].includes(mode) ? mode : 'standard',
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    cfg.aiTriggers.push(tr);
    saveConfig(cfg);
    res.json({ ok: true, trigger: { ...tr, webhookUrl: tr.kind === 'webhook' ? `/api/ai/hook/${tr.token}` : null } });
  });

  app.delete('/api/ai/triggers/:id', (req, res) => {
    const cfg = loadConfig();
    cfg.aiTriggers = (cfg.aiTriggers ?? []).filter((tr) => tr.id !== req.params.id);
    saveConfig(cfg);
    res.json({ ok: true });
  });

  // Webhook-endpoint: POST starter kørslen i baggrunden.
  app.post('/api/ai/hook/:token', (req, res) => {
    const cfg = loadConfig();
    const trigger = (cfg.aiTriggers ?? []).find((tr) => tr.kind === 'webhook' && tr.token === req.params.token);
    if (!trigger) return res.status(404).json({ ok: false, reason: 'Ukendt webhook-token' });
    if (swarmState.active) return res.status(409).json({ ok: false, reason: 'En kørsel er allerede aktiv.' });
    const runId = randomUUID().slice(0, 12);
    const extra = req.body?.goal ? String(req.body.goal).slice(0, 500) : '';
    broadcast?.({ type: 'toast', level: 'info', text: `Webhook "${trigger.name}" starter en kørsel.` });
    executeRun({ runId, goal: extra || trigger.goal, bible: trigger.bible ?? '', cfg, dirs, mode: trigger.mode ?? 'standard', emit: (obj) => broadcast?.({ kind: 'ai', ...obj, runId }) }).catch(() => {});
    res.json({ ok: true, runId });
  });

  // ---- genoptagelse (resume): kør kun de jobs der aldrig leverede ----
  app.post('/api/ai/runs/:runId/resume', (req, res) => {
    try {
      const p = join(dirs.runs, `${req.params.runId}.json`);
      if (!existsSync(p)) return res.status(404).json({ ok: false, reason: 'Kørsel ikke fundet' });
      const prev = JSON.parse(readFileSync(p, 'utf8'));
      if (swarmState.active) return res.status(409).json({ ok: false, reason: 'En kørsel er allerede aktiv.' });
      const doneIds = new Set((prev.results ?? []).map((r) => r.jobId));
      const unfinished = (prev.jobs ?? []).filter((j) => !doneIds.has(j.id));
      if (!unfinished.length) return res.status(400).json({ ok: false, reason: 'Alle jobs leverede — intet at genoptage.' });
      const prevJobs = prev.jobs ?? [];
      const idxMap = new Map(unfinished.map((j, i) => [j.id, i]));
      const jobs = unfinished.map((j) => ({
        ...j,
        dependsOn: (j.dependsOn ?? []).map((d) => idxMap.get(prevJobs[d]?.id)).filter((d) => d !== undefined),
      }));
      const runId = randomUUID().slice(0, 12);
      broadcast?.({ type: 'toast', level: 'info', text: `Kørslen genoptages — ${jobs.length} job(s) køres igen.` });
      executeRun({
        runId,
        goal: prev.goal ?? '',
        bible: '',
        attachments: prev.attachments ?? [],
        predefinedJobs: jobs,
        cfg: loadConfig(),
        dirs,
        resumeDir: join(dirs.runs, 'work', prev.runId),
        mode: prev.mode ?? 'standard',
        emit: (obj) => broadcast?.({ kind: 'ai', ...obj, runId }),
      }).catch(() => {});
      res.json({ ok: true, runId });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // ---- leverance-eksport: samlet markdown-pakke til download ----
  app.get('/api/ai/runs/:runId/export', (req, res) => {
    try {
      const p = join(dirs.runs, `${req.params.runId}.json`);
      if (!existsSync(p)) return res.status(404).json({ ok: false, reason: 'Kørsel ikke fundet' });
      const run = JSON.parse(readFileSync(p, 'utf8'));
      const lines = [`# ${run.goal ?? run.runId}`, '', `Kørsel: \`${run.runId}\` · Tilstand: ${run.mode ?? 'standard'} · ${run.finishedAt ?? ''}`, ''];
      for (const r of run.results ?? []) {
        lines.push(`## ${r.title}`, '', `Tjeneste: ${serviceById(r.serviceId)?.name ?? r.serviceId ?? '—'} · Dommer: ${r.score !== null && r.score !== undefined ? `${r.score}/10` : '—'}`, '', String(r.text ?? ''), '');
      }
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="orbit-run-${run.runId}.md"`);
      res.send(lines.join('\n'));
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // ---- prompt-bibliotek pr. projekt ----
  app.get('/api/ai/prompts', (req, res) => {
    const cfg = loadConfig();
    const project = String(req.query.project ?? '');
    const all = (cfg.aiPrompts ?? []).filter((p) => !project || p.project === project);
    res.json({ ok: true, prompts: all });
  });

  app.post('/api/ai/prompts', (req, res) => {
    const { name, project, text } = req.body ?? {};
    if (!name || !text) return res.status(400).json({ ok: false, reason: 'name og text kræves' });
    const cfg = loadConfig();
    cfg.aiPrompts = cfg.aiPrompts ?? [];
    const item = { id: `prm-${randomUUID().slice(0, 8)}`, name: String(name).slice(0, 80), project: String(project ?? ''), text: String(text).slice(0, 4000), createdAt: new Date().toISOString() };
    cfg.aiPrompts.push(item);
    saveConfig(cfg);
    res.json({ ok: true, prompt: item });
  });

  app.delete('/api/ai/prompts/:id', (req, res) => {
    const cfg = loadConfig();
    cfg.aiPrompts = (cfg.aiPrompts ?? []).filter((p) => p.id !== req.params.id);
    saveConfig(cfg);
    res.json({ ok: true });
  });

  // ---- opgave-assistenter (Mine opgaver): fælles JSON-hjælper ----
  async function assistJson({ prompt, cfg }) {
    const availability = await serviceAvailability(cfg);
    const orchestratorId = await pickOrchestrator(cfg, availability);
    if (!orchestratorId) throw new Error('Ingen orkestrator tilgængelig (installér et CLI).');
    const raw = await runChat({ serviceId: orchestratorId, messages: [{ role: 'user', text: prompt }], cfg, dirs });
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI\'en returnerede ikke JSON.');
    return { data: JSON.parse(m[0]), orchestratorId };
  }

  const assistHandler = (buildPrompt) => async (req, res) => {
    try {
      const cfg = loadConfig();
      const { data, orchestratorId } = await assistJson({ prompt: buildPrompt(req.body ?? {}), cfg });
      res.json({ ok: true, ...data, orchestratorId });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  };

  // Del en opgave op i underopgaver med estimater.
  app.post('/api/ai/tasks/split', assistHandler(({ title, description }) =>
    `Del opgaven op i 3-7 konkrete, afgrænsede underopgaver.\nOpgave: ${String(title ?? '')}\nBeskrivelse: ${String(description ?? '')}\n\nSvar KUN med JSON: {"subtasks":[{"title":string,"estimate":number|null}]}`));

  // Smart estimering ud fra titel/beskrivelse og lignende afsluttede opgaver.
  app.post('/api/ai/tasks/estimate', assistHandler(({ title, description, similar }) =>
    `Giv et realistisk estimat i story points (1, 2, 3, 5, 8, 13 eller 21) for opgaven.\nOpgave: ${String(title ?? '')}\nBeskrivelse: ${String(description ?? '')}\nLignende afsluttede opgaver (titel → points): ${JSON.stringify(similar ?? []).slice(0, 1500)}\n\nSvar KUN med JSON: {"estimate":number,"reason":string}`));

  // Omdan rå mødenoter til opgaver.
  app.post('/api/ai/tasks/parse', assistHandler(({ text }) =>
    `Omdan noterne til konkrete opgaver. Gæt fornuftigt på prioritet (urgent/high/medium/low) og frist (yyyy-mm-dd eller null) kun når det fremgår.\nNoter:\n${String(text ?? '').slice(0, 4000)}\n\nSvar KUN med JSON: {"tasks":[{"title":string,"description":string,"priority":string|null,"dueDate":string|null}]}`));

  // Årshjul-planlægning: foreslå rækkefølge og nye frister for en opgaveliste.
  app.post('/api/ai/tasks/plan', assistHandler(({ tasks }) =>
    `Planlæg opgaverne til årshjulet: foreslå en samlet rækkefølge og justerede frister (yyyy-mm-dd), så afhængige/tunge opgaver ligger først og intet presses unødigt.\nOpgaveR: ${JSON.stringify(tasks ?? []).slice(0, 4000)}\n\nSvar KUN med JSON: {"order":["ref",...],"plan":[{"ref":string,"suggestedDue":string|null,"note":string}]}`));

  // Uge-prioritering: rangér åbne opgaver med begrundelser.
  app.post('/api/ai/tasks/prioritize', assistHandler(({ tasks }) =>
    `Rangér opgaverne for den kommende uge efter vigtighed og frist. Giv hver opgave en kort begrundelse og evt. en justeret prioritet (urgent/high/medium/low).\nOpgaveR: ${JSON.stringify(tasks ?? []).slice(0, 4000)}\n\nSvar KUN med JSON: {"ranked":[{"ref":string,"reason":string,"suggestedPriority":string|null}]}`));

  // ---- fejl- og mønsteranalyse på tværs af kørsler ----
  app.get('/api/ai/analysis', (_req, res) => {
    try {
      const byTitle = {};
      const byService = {};
      let runs = 0, errors = 0, totalMs = 0, timed = 0;
      for (const f of readdirSync(dirs.runs).filter((f) => f.endsWith('.json')).slice(0, 60)) {
        let run;
        try { run = JSON.parse(readFileSync(join(dirs.runs, f), 'utf8')); } catch { continue; }
        runs += 1;
        for (const j of run.jobs ?? []) {
          const svc = serviceById(j.serviceId);
          const s = byService[j.serviceId] ?? { id: j.serviceId, jobs: 0, errors: 0, ms: 0 };
          s.jobs += 1;
          if (j.startedAt && j.finishedAt) { s.ms += j.finishedAt - j.startedAt; totalMs += j.finishedAt - j.startedAt; timed += 1; }
          if (j.status === 'error') { s.errors += 1; errors += 1; const t = byTitle[j.title] ?? { title: j.title, count: 0 }; t.count += 1; byTitle[j.title] = t; }
          byService[j.serviceId] = s;
          void svc;
        }
      }
      const errorTitles = Object.values(byTitle).sort((a, b) => b.count - a.count).slice(0, 5);
      const services = Object.values(byService).map((s) => ({
        ...s,
        name: serviceById(s.id)?.name ?? s.id ?? '—',
        avgMs: s.jobs ? Math.round(s.ms / Math.max(1, s.jobs - s.errors)) : 0,
        errorRate: s.jobs ? Math.round((s.errors / s.jobs) * 100) : 0,
      })).sort((a, b) => b.jobs - a.jobs);
      const insights = [];
      if (errorTitles.length) insights.push(`Hyppigste fejlende jobtype: "${errorTitles[0].title}" (${errorTitles[0].count}×). Overvej en skabelon med et ekstra review-job foran.`);
      const worst = services.find((s) => s.errorRate >= 25 && s.jobs >= 3);
      if (worst) insights.push(`"${worst.name}" fejler i ${worst.errorRate}% af jobbene — overvej at skifte tjeneste eller give jobbene mere kontekst.`);
      if (timed > 3) insights.push(`Gennemsnitlig jobtid: ${Math.round(totalMs / timed / 1000)}s. Langsomme jobs med dommer-score under 6 kan med fordel races mod en anden tjeneste.`);
      res.json({ ok: true, runs, errors, avgJobMs: timed ? Math.round(totalMs / timed / 1000) : 0, errorTitles, services, insights });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
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

  // Orkestrering: POST {goal, bible?, attachments?, jobs?, mode?, pauseAfterPlan?} → SSE hændelser
  app.post('/api/ai/orchestrate', async (req, res) => {
    const emit = sse(res);
    const { goal, bible, attachments, jobs, mode, pauseAfterPlan } = req.body ?? {};
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
        attachments,
        predefinedJobs: jobs,
        cfg, dirs, emit,
        mode: ['standard', 'roles', 'debate', 'vote', 'race'].includes(mode) ? mode : 'standard',
        pauseAfterPlan: Boolean(pauseAfterPlan),
      });
    } catch (e) {
      emit({ type: 'error', error: e.message });
    }
    res.end();
  });
}

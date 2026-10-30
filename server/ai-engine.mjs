// Orbit AI HTTP-ruter.
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, createReadStream } from 'fs';
import { join, basename, dirname } from 'path';
import { randomUUID } from 'crypto';
import { serviceById, serviceAvailability, runChat, setSecretsDir, loadKeySecrets, saveKeySecrets, aiCfg, inspectCliInstallation, parseCliTemplate } from './ai-services.mjs';
import { extractDocument, hydrateAttachment, validateAttachmentList } from './ai-documents.mjs';
import { inspectRepository, validateChecks } from './ai-repository.mjs';
import { projectExecution } from './task-execution.mjs';
import { importProjectPlan } from './project-plan.mjs';
import { DurableRunQueue } from './ai-queue.mjs';
import { readRun, recoverRuns, validatePlan, runPath, withRunEvents, eventJournalPath, liveRunView } from './ai-state.mjs';
import { importWorkshopJobs } from './ai-workshop.mjs';
import { repositoryChanges, repositoryPatch } from './ai-diff.mjs';
import { executeRun, swarmState, activeRuns, loadTemplates, saveUserTemplates, startTriggerScheduler, validateCron, pickOrchestrator, planWithLLM, parseJsonObject, projectMemoryDirs } from './ai-runtime.mjs';

// ---- HTTP-ruter --------------------------------------------------------------
export function registerAiRoutes(app, { loadConfig, saveConfig, broadcast, APP_DIR, getSnapshot, updateSnapshot }) {
  setSecretsDir(APP_DIR); // nøgleboksen bor ved siden af companion.json i ~/.orbit
  const dirs = {
    uploads: join(APP_DIR, 'ai-uploads'),
    artifacts: join(APP_DIR, 'ai-artifacts'),
    runs: join(APP_DIR, 'ai-runs'),
    memory: join(APP_DIR, 'ai-memory'),
    cwd: join(APP_DIR, 'ai-context'),
  };
  for (const d of Object.values(dirs)) if (typeof d === 'string') mkdirSync(d, { recursive: true });

  const recovered = recoverRuns(dirs);
  if (recovered.length) swarmState.last = recovered.at(-1);
  const queueInput = body => {
    const input = { goal: String(body.goal ?? '').trim(), projectId: body.projectId || null, taskId: body.taskId || null,
      mode: ['standard', 'roles', 'debate', 'vote', 'race'].includes(body.mode) ? body.mode : 'standard', pauseAfterPlan: Boolean(body.pauseAfterPlan) };
    if (input.projectId && getSnapshot) {
      const snapshot = getSnapshot(), project = snapshot.projects?.find(project => project.id === input.projectId);
      if (!project) throw new Error('Projektet skal gemmes på Companion før det kan lægges i kø.');
      if (input.taskId) {
        const task = snapshot.tasks?.find(task => task.id === input.taskId && task.projectId === input.projectId);
        if (!task || ['done', 'canceled'].includes(task.status)) throw new Error('Vælg en åben arbejdsordre i projektet.');
        if (project.scopeTaskIds && !project.scopeTaskIds.includes(task.id)) throw new Error('Arbejdsordren ligger uden for versionens scope.');
      }
    } else if (input.taskId) throw new Error('Arbejdsordren kræver et projekt.');
    if (!input.projectId) input.bible = String(body.bible ?? '');
    return input;
  };
  const orphanGuard = () => {
    const runs = [...recovered];
    for (const entry of queue.state.entries.filter(entry => entry.status === 'interrupted' && entry.runId)) { try { runs.push(readRun(dirs, entry.runId)); } catch { /* no process identity available */ } }
    const live = runs.some(run => (run.processes ?? []).some(processInfo => { try { process.kill(processInfo.pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }));
    return live ? 'En proces fra en afbrudt kørsel kan stadig arbejde. Stop den før køen fortsættes.' : '';
  };
  const queue = new DurableRunQueue({ path: join(dirs.runs, 'ai-queue.json'),
    isBusy: () => Boolean(swarmState.active), canResume: orphanGuard,
    readRun: runId => readRun(dirs, runId),
    resolveInput: input => getSnapshot ? projectExecution(getSnapshot(), input) : input,
    execute: input => executeRun({ ...input, repository: input.repositoryPath ? { source: String(input.repositoryPath), startCommit: input.repositoryStartCommit } : null,
      checks: validateChecks(input.checks ?? []), cfg: loadConfig(), dirs, emit: event => broadcast?.({ kind: 'ai', ...event }) }),
    onUpdate: state => broadcast?.({ kind: 'ai_queue', type: 'queue_updated', updatedAt: state.updatedAt }),
  });
  app.locals.orbitQueue = queue;
  queue.recover();
  if (!queue.storageError && recovered.some(run => run.status === 'interrupted' && run.processes?.length)) queue.pause('Companion genstartede under en kørsel. Kontrollér processer og leverance før arbejdskøen fortsættes.');
  startTriggerScheduler({ loadConfig, broadcast, enqueue: (body, options) => queue.enqueue(queueInput(body), options), pump: () => queue.pump() });

  app.get('/api/ai/queue', (_req, res) => res.json({ ok: true, queue: queue.snapshot() }));
  app.post('/api/ai/queue', (req, res) => {
    try {
      const input = queueInput(req.body ?? {});
      if (input.taskId && swarmState.active?.taskId === input.taskId && !queue.state.entries.some(entry => entry.status === 'running' && entry.runId === swarmState.active.runId)) throw new Error('Arbejdsordren kører allerede. Send en præcisering i chatten eller vent på resultatet.');
      const result = queue.enqueue(input); res.json({ ok: true, ...result }); void queue.pump();
    }
    catch (error) { res.status(409).json({ ok: false, reason: error.message }); }
  });
  app.post('/api/ai/queue/control', (req, res) => {
    try {
      if (req.body?.action === 'pause') queue.pause();
      else if (req.body?.action === 'resume') queue.resume();
      else throw new Error('Vælg pause eller resume.');
      res.json({ ok: true, queue: queue.snapshot() });
    } catch (error) { res.status(409).json({ ok: false, reason: error.message }); }
  });
  app.delete('/api/ai/queue/:id', (req, res) => {
    try { queue.cancel(req.params.id); res.json({ ok: true }); }
    catch (error) { res.status(409).json({ ok: false, reason: error.message }); }
  });

  const sse = (res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write('retry: 2000\n\n');
    const lastWs = new Map();
    return (obj) => {
      if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
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

  app.post('/api/ai/repository/inspect', async (req, res) => {
    try { res.json({ ok: true, repository: await inspectRepository(String(req.body?.path ?? '')) }); }
    catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  });

  app.get('/api/ai/services', async (_req, res) => {
    const cfg = loadConfig();
    res.json({ ok: true, services: await serviceAvailability(cfg), prefs: aiCfg(cfg).prefs });
  });

  app.post('/api/ai/services/:id/inspect', async (req, res) => {
    try {
      const cfg = loadConfig(), installation = await inspectCliInstallation(req.params.id, cfg);
      cfg.aiProviders ??= {};
      cfg.aiProviders[req.params.id] = { ...cfg.aiProviders[req.params.id], installation };
      saveConfig(cfg);
      res.json({ ok: true, installation });
    } catch (error) { res.status(400).json({ ok: false, reason: error.message }); }
  });

  app.post('/api/ai/prefs', (req, res) => {
    const cfg = loadConfig();
    const patch = req.body ?? {};
    if (typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['allowPaidApis', 'orchestrator', 'autoJudge', 'selfHeal', 'minimumReviewScore'].includes(key))) return res.status(400).json({ ok: false, reason: 'AI-indstillingerne indeholder et ukendt felt.' });
    if (patch.allowPaidApis !== undefined && patch.allowPaidApis !== false) return res.status(400).json({ ok: false, reason: 'Særskilt forbrugsbetaling kan ikke aktiveres. Orbit bruger kun inkluderet abonnementsforbrug.' });
    if (['autoJudge', 'selfHeal'].some(key => patch[key] !== undefined && typeof patch[key] !== 'boolean')) return res.status(400).json({ ok: false, reason: 'Review og rettelsesforsøg skal være slået til eller fra.' });
    if (patch.minimumReviewScore !== undefined && (!Number.isFinite(patch.minimumReviewScore) || patch.minimumReviewScore < 1 || patch.minimumReviewScore > 10)) return res.status(400).json({ ok: false, reason: 'Minimumscore skal være et tal mellem 1 og 10.' });
    if (patch.orchestrator !== undefined && !['cli', 'local'].includes(serviceById(patch.orchestrator)?.kind)) return res.status(400).json({ ok: false, reason: 'Vælg en kendt planlæggende AI-tjeneste.' });
    cfg.aiPrefs = { ...(cfg.aiPrefs ?? {}), ...patch, allowPaidApis: false };
    try {
      saveConfig(cfg);
    } catch (e) {
      return res.status(500).json({ ok: false, reason: `Kunne ikke gemme AI-indstillingerne: ${e.message}` });
    }
    // Bekræft fra disken, så UI aldrig viser en tilladelse som ikke er gemt.
    const persisted = loadConfig();
    if (Object.entries(patch).some(([key, value]) => persisted.aiPrefs?.[key] !== value)) {
      return res.status(500).json({ ok: false, reason: 'AI-indstillingerne kunne ikke genlæses efter gemning. Kontrollér Companion-forbindelsen.' });
    }
    res.json({ ok: true, prefs: aiCfg(persisted).prefs });
  });

  app.post('/api/ai/services/:id', (req, res) => {
    const svc = serviceById(req.params.id);
    if (!svc) return res.status(404).json({ ok: false, reason: 'ukendt tjeneste' });
    const cfg = loadConfig();
    cfg.aiProviders = cfg.aiProviders ?? {};
    const cur = cfg.aiProviders[svc.id] ?? {};
    const { enabled, apiKey, model, cmd, cliTemplate, baseUrl, avatarId, voiceId, billingMode, noExtraCharges } = req.body ?? {};
    if (cliTemplate) {
      try { if (!parseCliTemplate(String(cliTemplate)).includes('{prompt}')) throw new Error('Skabelonen skal indeholde {prompt}.'); }
      catch (error) { return res.status(400).json({ ok: false, reason: error.message }); }
    }

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
      ...(billingMode !== undefined ? { billingMode: ['included', 'usage', 'unknown'].includes(billingMode) ? billingMode : 'unknown' } : {}),
      ...(noExtraCharges !== undefined ? { noExtraCharges: noExtraCharges === true } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(cmd !== undefined ? { cmd: String(cmd).trim() || undefined, installation: null } : {}),
      ...(cliTemplate !== undefined ? { cliTemplate: String(cliTemplate).trim() || undefined } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(avatarId !== undefined ? { avatarId: String(avatarId) } : {}),
      ...(voiceId !== undefined ? { voiceId: String(voiceId) } : {}),
    };
    try {
      saveConfig(cfg);
    } catch (e) {
      return res.status(500).json({ ok: false, reason: `Kunne ikke gemme companion-konfigurationen: ${e.message}` });
    }
    res.json({ ok: true, hasKey: Boolean(loadKeySecrets()[svc.id]?.apiKey) });
  });

  // Upload: {name, mime, dataBase64} → gemt på disk; billeder kan indlæses som data-URL.
  app.post('/api/ai/upload', async (req, res) => {
    const { name, mime, dataBase64 } = req.body ?? {};
    if (!name || !dataBase64) return res.status(400).json({ ok: false, reason: 'name og dataBase64 kræves' });
    const buf = Buffer.from(dataBase64, 'base64');
    if (buf.length > 25 * 1024 * 1024) return res.status(413).json({ ok: false, reason: 'Filen er over 25 MB' });
    const id = randomUUID().slice(0, 8);
    const safe = String(name).replace(/[^\w.\-() ]/g, '_').slice(-80);
    writeFileSync(join(dirs.uploads, `${id}-${safe}`), buf);
    let extractedText = null, extractionError = null;
    try {
      extractedText = await extractDocument(join(dirs.uploads, `${id}-${safe}`), String(mime ?? ''), String(name));
      if (extractedText) writeFileSync(join(dirs.uploads, `${id}-${safe}.text.txt`), extractedText);
    } catch (e) { extractionError = e.message; }
    const isImage = String(mime).startsWith('image/');
    res.json({ ok: true, file: { id, extractedText, extractionError, name: String(name), mime: String(mime), size: buf.length, url: `/api/ai/file/${id}-${safe}`, path: join(dirs.uploads, `${id}-${safe}`), kind: isImage ? 'image' : 'file', dataUrl: isImage ? `data:${mime};base64,${buf.toString('base64')}` : undefined } });
  });

  app.get('/api/ai/file/:name', (req, res) => {
    if (basename(req.params.name) !== req.params.name || /[\\]/.test(req.params.name)) return res.status(400).end();
    for (const base of [dirs.uploads, dirs.artifacts]) {
      const p = join(base, req.params.name);
      if (existsSync(p) && dirname(realpathSync(p)) === realpathSync(base)) {
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.sendFile(p);
      }
    }
    res.status(404).end();
  });

  app.get('/api/ai/attachment-text/:name', async (req, res) => {
    try {
      const name = String(req.params.name);
      const file = hydrateAttachment({ name, kind: 'file', url: `/api/ai/file/${name}` }, dirs);
      if (!file.path) throw new Error('Filen findes ikke i Orbit.');
      const text = file.extractedText ?? await extractDocument(file.path, '', name);
      if (!text?.trim()) throw new Error('Der kunne ikke udtrækkes tekst fra filen. Brug en tekstudgave af dokumentet.');
      if (!file.extractedText) writeFileSync(`${file.path}.text.txt`, text);
      res.json({ ok: true, text });
    } catch (error) { res.status(400).json({ ok: false, reason: error.message }); }
  });

  // Live swarm-tilstand: aktiv kørsel eller seneste afsluttede.
  app.get('/api/ai/swarm', (req, res) => {
    const run = swarmState.active ?? swarmState.last;
    res.json({ ok: true, run: req.query.view === 'live' ? liveRunView(run) : run });
  });

  app.get('/api/ai/runs', (_req, res) => {
    const runs = readdirSync(dirs.runs).filter((f) => f.endsWith('.json')).map((f) => {
      try { const run = JSON.parse(readFileSync(join(dirs.runs, f), 'utf8')); return run.runId ? { file: f, ...run } : null; } catch { return null; }
    }).filter(Boolean).sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt))).slice(0, 20);
    res.json({ ok: true, runs });
  });

  app.get('/api/ai/runs/:runId', (req, res) => {
    try {
      res.json({ ok: true, run: withRunEvents(dirs, activeRuns.get(req.params.runId)?.run ?? readRun(dirs, req.params.runId)) });
    } catch (e) { res.status(404).json({ ok: false, reason: e.message }); }
  });

  app.get('/api/ai/runs/:runId/changes', async (req, res) => {
    try {
      if (req.query.file !== undefined && typeof req.query.file !== 'string') throw new Error('Vælg én fil.');
      const run = activeRuns.get(req.params.runId)?.run ?? readRun(dirs, req.params.runId);
      res.json({ ok: true, ...await repositoryChanges(run, req.query.file, req.query.commit, req.query.scope === 'project') });
    } catch (error) { res.status(400).json({ ok: false, reason: error.message }); }
  });
  app.get('/api/ai/runs/:runId/changes.patch', async (req, res) => {
    try {
      const run = activeRuns.get(req.params.runId)?.run ?? readRun(dirs, req.params.runId);
      const patch = await repositoryPatch(run, req.query.commit, req.query.scope === 'project');
      res.setHeader('Content-Disposition', `attachment; filename="orbit-${run.runId}.patch"`);
      res.type('text/x-diff').send(patch);
    } catch (error) { res.status(400).json({ ok: false, reason: error.message }); }
  });

  app.get('/api/ai/runs/:runId/events', (req, res) => {
    try {
      const run = readRun(dirs, req.params.runId), path = eventJournalPath(dirs, req.params.runId);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="orbit-events-${run.runId}.ndjson"`);
      if (run.eventsJournal && existsSync(path)) {
        const stream = createReadStream(path);
        stream.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
        res.on('close', () => stream.destroy()); stream.pipe(res);
      } else res.send((run.events ?? []).map(event => JSON.stringify(event)).join('\n'));
    } catch (error) { res.status(404).json({ ok: false, reason: error.message }); }
  });

  app.post('/api/ai/workshop/import', (req, res) => {
    try {
      if (!updateSnapshot) throw new Error('Projektlageret er ikke tilgængeligt.');
      let imported;
      updateSnapshot(snapshot => {
        imported = importWorkshopJobs(snapshot, req.body?.projectId, req.body?.selectedIds);
        return imported.snapshot;
      });
      res.json({ ok: true, createdIds: imported.createdIds, existingIds: imported.existingIds });
    } catch (error) { res.status(400).json({ ok: false, reason: error.message }); }
  });

  app.post('/api/ai/runs/:runId/import-plan', (req, res) => {
    try {
      if (!updateSnapshot) throw new Error('Projektlageret er ikke tilgængeligt.');
      const run = readRun(dirs, req.params.runId);
      let imported;
      updateSnapshot(snapshot => {
        imported = importProjectPlan(snapshot, run, req.body?.selectedIds, { includeInScope: req.body?.includeInScope === true });
        return imported.snapshot;
      });
      res.json({ ok: true, createdIds: imported.createdIds, existingIds: imported.existingIds });
    } catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  });

  // ---- kørselskontrol: godkend plan / besked til orkestrator / skip / aflys ----
  app.post('/api/ai/runs/:runId/approve', (req, res) => {
    try {
      const h = activeRuns.get(req.params.runId);
      if (!h?.resolveApproval) return res.status(409).json({ ok: false, reason: 'Genoptag den gemte kørsel for at godkende planen.' });
      const jobs = validatePlan(req.body?.jobs ?? h.jobsSnapshot);
      const resolve = h.resolveApproval;
      h.resolveApproval = null;
      resolve(jobs);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  });

  app.post('/api/ai/runs/:runId/message', (req, res) => {
    const h = activeRuns.get(req.params.runId);
    const text = String(req.body?.text ?? '').trim();
    if (!h) return res.status(409).json({ ok: false, reason: 'Ingen aktiv kørsel.' });
    try {
      const attachments = req.body?.attachments ?? [];
      if (!Array.isArray(attachments) || attachments.length + h.run.attachments.length > 10) throw new Error('En kørsel kan have højst 10 vedhæftninger.');
      if ((!text && !attachments.length) || text.length > 100000) throw new Error('Skriv en besked på højst 100.000 tegn eller vedhæft en fil.');
      // Resolve every file before mutating the run; never accept arbitrary local paths.
      const files = attachments.map(a => {
        const hydrated = hydrateAttachment(a, dirs);
        if (!hydrated.path) throw new Error('Vedhæft filen gennem Orbit først.');
        return { name: String(a.name ?? 'Vedhæftning'), kind: a.kind, mime: a.mime, url: a.url, size: a.size };
      });
      const instruction = text || `Se de nye vedhæftninger: ${files.map(a => a.name).join(', ')}`;
      h.instructions.push(instruction);
      h.run.attachments.push(...files);
      h.run.notes = [...(h.run.notes ?? []).slice(-4), `Besked fra dig: ${instruction.slice(0, 120)}`];
      h.persist();
      broadcast?.({ kind: 'ai', type: 'job_note', jobId: null, note: `Besked fra dig: ${instruction.slice(0, 120)}`, runId: req.params.runId });
      res.json({ ok: true, appliesAt: 'next_job', note: 'Beskeden gælder fra næste job. Igangværende job bruger den kontekst, det startede med.' });
    } catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  });

  app.post('/api/ai/runs/:runId/skip', (req, res) => {
    const h = activeRuns.get(req.params.runId);
    if (!h) return res.status(409).json({ ok: false, reason: 'Ingen aktiv kørsel.' });
    const jobId = String(req.body?.jobId ?? '');
    const j = h.run.jobs.find(x => x.id === jobId);
    if (!j || j.status !== 'queued') return res.status(409).json({ ok: false, reason: 'Kun et job, der endnu ikke er startet, kan springes over.' });
    h.skip.add(jobId);
    h.track({ type: 'job_skipped', runId: req.params.runId, jobId });
    res.json({ ok: true });
  });

  app.post('/api/ai/runs/:runId/cancel', (req, res) => {
    const h = activeRuns.get(req.params.runId);
    if (!h) return res.status(409).json({ ok: false, reason: 'Ingen aktiv kørsel.' });
    h.cancelled = true;
    h.skip.add('*');
    h.abort?.abort();
    if (h.resolveApproval) h.resolveApproval([]);
    h.run.notes = [...(h.run.notes ?? []).slice(-4), 'Kørslen aflyses — afventer igangværende job.'];
    res.json({ ok: true });
  });

  // ---- omkostningsregnskab ----
  app.get('/api/ai/costs', (_req, res) => {
    try {
      const byService = {};
      let totalJobs = 0, totalRuns = 0;
      for (const f of readdirSync(dirs.runs).filter((f) => f.endsWith('.json')).slice(0, 60)) {
        let run;
        try { run = JSON.parse(readFileSync(join(dirs.runs, f), 'utf8')); } catch { continue; }
        if (!run.usage) continue;
        totalRuns += 1;
        totalJobs += run.usage.jobs ?? 0;
        for (const [id, u] of Object.entries(run.usage.byService ?? {})) {
          const cur = byService[id] ?? { id, jobs: 0, kind: u.kind };
          cur.jobs += u.jobs;
          byService[id] = cur;
        }
      }
      const services = Object.values(byService).map((u) => ({
        ...u,
        name: serviceById(u.id)?.name ?? u.id,
        subscriptionCovered: false, // Historical counts cannot establish an account entitlement.
        estKr: null,
      })).sort((a, b) => b.jobs - a.jobs);
      res.json({ ok: true, totalRuns, totalJobs, estKr: null, byService: services });
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
    const { goal, bible, attachments, projectId } = req.body ?? {};
    if (!goal) return res.status(400).json({ ok: false, reason: 'goal kræves' });
    const cfg = loadConfig();
    try {
      const availability = await serviceAvailability(cfg);
      const orchestratorId = await pickOrchestrator(cfg, availability);
      if (!orchestratorId) return res.status(409).json({ ok: false, reason: 'Ingen orkestrator tilgængelig (installér et CLI).' });
      const jobs = await planWithLLM({ orchestratorId, goal: String(goal), bible: String(bible ?? ''), attachments: validateAttachmentList(attachments), cfg, dirs: projectMemoryDirs(dirs, projectId), availability });
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
      const text = await runChat({ serviceId: orchestratorId, messages: [{ role: 'user', text: prompt }], cfg, dirs, cwd: dirs.cwd, readOnly: true });
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
    const { name, kind, cron, goal, bible, mode, projectId, taskId } = req.body ?? {};
    if (!name || !goal) return res.status(400).json({ ok: false, reason: 'name og goal kræves' });
    try { if (kind !== 'webhook') validateCron(cron ?? '* * * * *'); queueInput({ goal, projectId, taskId }); }
    catch (error) { return res.status(400).json({ ok: false, reason: error.message }); }
    const cfg = loadConfig();
    cfg.aiTriggers = cfg.aiTriggers ?? [];
    const tr = {
      id: `trg-${randomUUID().slice(0, 8)}`,
      name: String(name).slice(0, 60),
      projectId: projectId || null, taskId: taskId || null,
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
    cfg.aiTriggers = (cfg.aiTriggers ?? []).filter((t) => t.id !== req.params.id);
    saveConfig(cfg);
    res.json({ ok: true });
  });

  // Webhook-endpoint: POST starter kørslen i baggrunden.
  app.post('/api/ai/hook/:token', (req, res) => {
    const cfg = loadConfig();
    const trigger = (cfg.aiTriggers ?? []).find((t) => t.kind === 'webhook' && t.token === req.params.token);
    if (!trigger || trigger.enabled === false) return res.status(404).json({ ok: false, reason: 'Ukendt webhook-token' });
    try {
      const extra = req.body?.goal ? String(req.body.goal).slice(0, 500) : '';
      const result = queue.enqueue(queueInput({ ...trigger, goal: extra || trigger.goal }), { source: trigger.id, name: trigger.name });
      res.json({ ok: true, ...result }); void queue.pump();
    } catch (error) { res.status(409).json({ ok: false, reason: error.message }); }
  });

  // ---- genoptagelse (resume): kør kun de jobs der aldrig leverede ----
  app.post('/api/ai/runs/:runId/resume', (req, res) => {
    try {
      const p = runPath(dirs, req.params.runId);
      if (!existsSync(p)) return res.status(404).json({ ok: false, reason: 'Kørsel ikke fundet' });
      const prev = readRun(dirs, req.params.runId);
      if (getSnapshot && prev.projectId) {
        const input = projectExecution(getSnapshot(), { projectId: prev.projectId, taskId: prev.taskId, goal: prev.goal });
        if (prev.repository?.source && input.repositoryPath !== prev.repository.source) return res.status(409).json({ ok: false, reason: 'Projektet har skiftet repository. Genoptag ikke en kørsel fra den tidligere mappe.' });
        if (input.repositoryStartCommit && input.repositoryStartCommit !== prev.continuationFromCommit) return res.status(409).json({ ok: false, reason: 'Projektets AI-arbejdsgren er gået videre siden dette forsøg. Start en ny arbejdsordre fra det aktuelle grundlag i stedet for at genoptage en ældre gren.' });
      }
      if (swarmState.active) return res.status(409).json({ ok: false, reason: 'En kørsel er allerede aktiv.' });
      if (prev.schemaVersion !== 2) return res.status(409).json({ ok: false, reason: 'Denne ældre kørsel mangler gemt projektkontekst. Start en ny kørsel med bibel og repository.' });
      if (!prev.jobs?.some(j => j.status !== 'done') && !['failed', 'interrupted', 'cancelled'].includes(prev.verification?.status)) return res.status(400).json({ ok: false, reason: 'Alle jobs leverede — intet at genoptage.' });
      const liveProcesses = (prev.processes ?? []).filter(p => {
        try { process.kill(p.pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
      });
      if (liveProcesses.length) return res.status(409).json({ ok: false, reason: 'En proces fra den afbrudte kørsel kan stadig arbejde. Stop den på maskinen før genoptagelse.', pids: liveProcesses.map(p => p.pid) });
      if (!existsSync(prev.workDir)) return res.status(409).json({ ok: false, reason: 'Den oprindelige arbejdsmappe mangler. Gendan den før genoptagelse.' });
      const jobs = validatePlan(prev.jobs);
      const runId = randomUUID().slice(0, 12);
      executeRun({
        runId, goal: prev.goal, bible: prev.bible, attachments: prev.attachments,
        predefinedJobs: jobs, previousRun: prev, resumeDir: prev.workDir,
        projectId: prev.projectId, taskId: prev.taskId, repository: prev.repository, checks: prev.checks ?? [],
        pauseAfterPlan: prev.status === 'awaiting_approval',
        cfg: loadConfig(), dirs, mode: prev.mode ?? 'standard',
        emit: obj => broadcast?.({ kind: 'ai', ...obj }),
      }).catch(e => broadcast?.({ kind: 'ai', type: 'error', runId, error: e.message }));
      res.json({ ok: true, runId });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // ---- leverance-eksport: samlet markdown-pakke til download ----
  app.get('/api/ai/runs/:runId/export', (req, res) => {
    try {
      const p = runPath(dirs, req.params.runId);
      if (!existsSync(p)) return res.status(404).json({ ok: false, reason: 'Kørsel ikke fundet' });
      const run = JSON.parse(readFileSync(p, 'utf8'));
      const lines = [`# ${run.goal ?? run.runId}`, '', `Kørsel: \`${run.runId}\` · Status: ${run.status ?? 'ukendt'} · Tilstand: ${run.mode ?? 'standard'}`, ''];
      if (run.repository) lines.push(`Repository: ${run.repository.source}`, `Arbejdsgren: ${run.repository.branch}`, `Commit: ${run.evidence?.commit ?? 'Ingen samlet verificeret leverance'}`, '');
      if (run.contextManifest) {
        lines.push('## Anvendt projektgrundlag', '', `Fastlagt: ${run.contextManifest.capturedAt}`, `Versionsmål: ${run.contextManifest.releaseGoal || 'Ikke fastlagt'}`, '');
        for (const doc of run.contextManifest.documents) lines.push(`- ${doc.title} (${doc.kind}${doc.version ? `, version ${doc.version}` : ''}${doc.state ? `, ${doc.state}` : ''}) · ${doc.characters} tegn · SHA-256: ${doc.sha256}`);
        lines.push('');
      }
      lines.push(`Verifikation: ${run.verification?.status ?? 'ikke kørt'}`, '');
      for (const attempt of run.verificationHistory ?? []) {
        lines.push(`### Kontrolgennemløb ${attempt.number}: ${attempt.status}`, '', `Commit: ${attempt.commit} · ${new Date(attempt.at).toISOString()}`, '');
        for (const check of attempt.checks) lines.push(`- ${check.name}: ${check.status} (exit ${check.exitCode ?? 'ukendt'})`, '', '~~~~text', String(check.output ?? ''), '~~~~', '');
      }
      for (const check of run.verification?.checks ?? []) lines.push(`### ${check.name}`, '', `Status: ${check.status} · Exitkode: ${check.exitCode ?? 'ukendt'}`, '', '~~~~text', String(check.output ?? ''), '~~~~', '');
      for (const job of (run.jobs ?? []).filter(j => j.status !== 'done')) lines.push(`### ${job.title} — ${job.status}`, '', job.error ?? 'Ingen godkendt leverance.', '');
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
    const raw = await runChat({ serviceId: orchestratorId, messages: [{ role: 'user', text: prompt }], cfg, dirs, cwd: dirs.cwd, readOnly: true });
    return { data: parseJsonObject(raw), orchestratorId };
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
      res.json({ ok: true, runs, errors, avgJobMs: timed ? Math.round(totalMs / timed) : 0, errorTitles, services, insights });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // Chat: POST {service, messages} → SSE {delta}|{done}|{error}
  app.post('/api/ai/chat', async (req, res) => {
    const emit = sse(res);
    const { service, messages, bible } = req.body ?? {};
    const cfg = loadConfig();
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    try {
      const text = await runChat({ serviceId: service, messages: [...(bible ? [{ role: 'system', text: `Projektets gældende bibel:\n${String(bible)}` }] : []), ...(messages ?? [])], cfg, dirs, cwd: dirs.cwd, readOnly: true, onDelta: (d) => emit({ type: 'delta', delta: d }), signal: ac.signal });
      emit({ type: 'done', text });
    } catch (e) {
      emit({ type: 'error', error: e.message });
    }
    res.end();
  });

  // Orkestrering: POST {goal, bible?, attachments?, jobs?, mode?, pauseAfterPlan?} → SSE hændelser
  app.post('/api/ai/orchestrate', async (req, res) => {
    // Én aktiv Auto-kørsel ad gangen: ellers kan gamle events og kørselsstatus
    // overskrive den nye kørsel i Swarm, og to agenter kan ændre samme projekt.
    if (swarmState.active) return res.status(409).json({ ok: false, reason: 'En Auto-kørsel er allerede aktiv. Stop den, og vent til den er afsluttet, før du starter en ny.' });
    let input;
    try { input = getSnapshot ? projectExecution(getSnapshot(), req.body ?? {}) : req.body ?? {}; validateAttachmentList(input.attachments); }
    catch (error) { return res.status(409).json({ ok: false, reason: error.message }); }
    const emit = sse(res);
    const { goal, bible, attachments, jobs, mode, pauseAfterPlan, projectId, taskId, repositoryPath, repositoryStartCommit, continuationTaskIds, checks, contextManifest } = input;
    const runId = randomUUID().slice(0, 12);
    const cfg = loadConfig();
    try {
      await executeRun({
        runId,
        goal: String(goal ?? ''),
        bible: String(bible ?? ''),
        attachments, projectId, taskId, contextManifest, continuationTaskIds,
        repository: repositoryPath ? { source: String(repositoryPath), startCommit: repositoryStartCommit } : null,
        checks: validateChecks(checks ?? []),
        predefinedJobs: jobs,
        cfg, dirs, emit,
        mode: ['standard', 'roles', 'debate', 'vote', 'race'].includes(mode) ? mode : 'standard',
        pauseAfterPlan: Boolean(pauseAfterPlan),
      });
    } catch (e) {
      emit({ type: 'error', runId, error: e.message });
    }
    if (!res.destroyed) res.end();
  });
}

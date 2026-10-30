// Small, explicit delivery tests through the same engine as ordinary work.
// Configuration, login, delivery and provider billing evidence stay distinct.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { writeAtomicJson } from './atomic-json.mjs';
import { aiCfg, serviceAvailability } from './ai-services.mjs';
import { executeRun, activeRuns, swarmState } from './ai-runtime.mjs';
import { readRun } from './ai-state.mjs';

const providers = new Set(['codex', 'claude', 'gemini', 'grok', 'meshy', 'heygen', 'elevenlabs', 'kimi', 'qwen', 'qwen-code']);
const media = new Set(['meshy', 'heygen', 'elevenlabs']);
const fingerprint = (cfg, id) => createHash('sha256').update(JSON.stringify(aiCfg(cfg).providers[id] ?? {})).digest('hex');

export function registerAccountChecks(app, { APP_DIR, dirs, loadConfig, broadcast, orphanGuard }) {
  const directory = join(APP_DIR, 'ai-account-checks'); mkdirSync(directory, { recursive: true });
  const path = id => join(directory, `${id}.json`);
  app.get('/api/ai/services/:id/verification', (req, res) => {
    const id = req.params.id;
    if (!providers.has(id)) return res.status(404).json({ ok: false });
    let report = null;
    try { report = JSON.parse(readFileSync(path(id), 'utf8')); } catch { /* Not checked yet. */ }
    if (report) {
      // A restart must never leave the account test looking permanently active.
      if (report.status === 'running' && !activeRuns.has(report.runId)) {
        report = { ...report, status: 'interrupted', delivery: 'unverified' };
        writeAtomicJson(path(id), report);
      }
      report = { ...report, configurationChanged: report.configurationHash !== fingerprint(loadConfig(), id) };
      delete report.configurationHash;
    }
    res.json({ ok: true, report });
  });
  app.post('/api/ai/services/:id/verify', async (req, res) => {
    const id = req.params.id;
    if (!providers.has(id)) return res.status(404).json({ ok: false, reason: 'Tjenesten understøtter ikke kontotesten.' });
    if (req.body?.execute !== true) return res.status(400).json({ ok: false, reason: 'Kontotesten sender én rigtig opgave og bruger din tilgængelige kvote.' });
    if (media.has(id) && req.body?.produceMedia !== true) return res.status(400).json({ ok: false, reason: 'Vælg medietest for at producere én rigtig fil.' });
    const cfg = loadConfig(), availability = await serviceAvailability(cfg);
    if (!availability[id]?.available) return res.status(409).json({ ok: false, reason: availability[id]?.reason ?? 'Tjenesten er ikke klar.' });
    // Recheck after async discovery. executeRun claims its slot synchronously.
    const guard = orphanGuard();
    if (swarmState.active || guard) return res.status(409).json({ ok: false, reason: guard ?? 'Vent til den aktive kørsel er afsluttet.' });
    const runId = randomUUID().slice(0, 12), marker = `ORBIT_CHECK_${randomUUID().replaceAll('-', '')}`;
    const report = { version: 1, serviceId: id, runId, checkedAt: new Date().toISOString(), platform: process.platform,
      status: 'running', delivery: 'unverified', configurationHash: fingerprint(cfg, id),
      billing: availability[id].billing, quota: { status: 'unknown', remaining: null, resetsAt: null },
      scope: media.has(id) ? 'one_media_delivery' : 'one_text_response',
      providerIdentity: 'not_independently_verified', customTemplate: availability[id].customTemplate,
      note: 'En leveret prøve dokumenterer adapterens levering. Abonnementsdækning er brugerbekræftet; kvoten er ikke målt. Repository, billeder, MCP og kvalitet testes særskilt.' };
    writeAtomicJson(path(id), report);
    const job = { id: 'account-check', serviceId: id, title: `Kontotest · ${availability[id].name}`, phase: 'test', dependsOn: [],
      readOnly: !media.has(id), description: id === 'meshy' ? 'A single simple untextured cube for an Orbit delivery test.' : media.has(id) ? 'Orbit leveringstest.' : `Svar kun med denne kontrolkode: ${marker}. Brug ingen værktøjer, læs ingen projektfiler, og foretag ingen eksterne handlinger.` };
    // No planner, independent review, repair, project context or second charge.
    const promise = executeRun({ runId, goal: job.title, bible: '', predefinedJobs: [job], cfg: { ...cfg, aiPrefs: { ...aiCfg(cfg).prefs, autoJudge: false, selfHeal: false } },
      dirs: { ...dirs, memory: join(directory, 'memory', runId) }, emit: event => broadcast?.({ kind: 'ai', ...event }) });
    const timer = setTimeout(() => { const handle = activeRuns.get(runId); if (handle) { handle.cancelled = true; handle.abort.abort(); } }, media.has(id) ? 8 * 60_000 : 120_000);
    timer.unref();
    void promise.then(() => {
      const run = readRun(dirs, runId), result = run.results?.find(item => item.jobId === job.id);
      const artifacts = (result?.artifacts ?? []).map(artifact => {
        const content = readFileSync(join(dirs.artifacts, basename(artifact.url)));
        return { name: artifact.name, mime: artifact.mime, url: artifact.url, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') };
      });
      const delivered = run.status === 'done' && (media.has(id) ? artifacts.some(item => item.bytes > 0) : result?.text?.includes(marker));
      writeAtomicJson(path(id), { ...report, status: delivered ? 'passed' : 'failed', delivery: delivered ? 'verified' : 'unverified', finishedAt: new Date().toISOString(), artifacts });
    }).catch(() => {
      writeAtomicJson(path(id), { ...report, status: 'failed', finishedAt: new Date().toISOString(), delivery: 'unverified' });
    }).finally(() => clearTimeout(timer)).catch(() => { console.error('[orbit] Kontotestens resultat kunne ikke gemmes. Se den vedvarende kørsel.'); });
    res.status(202).json({ ok: true, runId });
  });
}

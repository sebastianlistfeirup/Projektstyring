import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const base = 'http://127.0.0.1:4310';
let source: string;

test.beforeAll(async ({ request }) => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-e2e-'));
  source = join(root, 'game'); mkdirSync(source);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source });
  git('init', '-q'); writeFileSync(join(source, 'game.txt'), 'original'); git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'base');
  const fake = join(root, 'fake.mjs');
  writeFileSync(fake, `import fs from 'node:fs'; let p=process.argv.at(-1); const file=p.match(/UTF-8-filen (.*)\\. Filen indeholder/); if(file) p=fs.readFileSync(file[1],'utf8');
if(p.includes('PLANLÆGNINGSFASE')) console.log(JSON.stringify({jobs:[{title:'Verificeret rettelse',service:'codex',phase:'produktion',dependsOn:[],description:p.includes('FAIL_MARKER')?'FAIL_MARKER':'Ret game.txt efter biblen'}]}));
else if(p.includes('FAIL_MARKER')) { console.error('Reproduced test failure'); process.exit(9); }
else if(p.includes('"orbitProjectPlan"')) console.log(JSON.stringify({orbitProjectPlan:{version:1,releaseGoal:'En stabil save/load-cyklus',summary:'Et afgrænset restarbejde',firstMilestone:'Gem og indlæs en kampagne',unknowns:['Gameplay skal afprøves manuelt'],tasks:[{id:'save',title:'Verificér save-format',description:'Bevar kompatibilitet',priority:'high',scope:'version1',acceptanceCriteria:['Data bevares'],verification:['Kør save/load-test'],evidence:['game.txt'],dependsOn:[]}]}}));
else if(p.includes('Kortlæg kode og gældende beslutninger')) console.log('game.txt er læst. Ingen tests er kørt i denne analyse.');
else { await new Promise(r=>setTimeout(r,1800)); fs.writeFileSync('game.txt','fixed'); console.log('## Leverance\\n\\n| Fil | Resultat |\\n| --- | --- |\\n| game.txt | fixed |\\n\\nÆndringen er implementeret.'); }`);
  expect((await request.post(`${base}/api/ai/services/codex`, { data: { cmd: process.execPath, cliTemplate: `"${fake}" {prompt}`, billingMode: 'included', noExtraCharges: true } })).ok()).toBeTruthy();
  await request.post(`${base}/api/ai/prefs`, { data: { autoJudge: false, selfHeal: false, orchestrator: 'codex' } });
});

async function setup(page: Page) {
  await page.addInitScript(() => { localStorage.setItem('orbit-toured', '1'); localStorage.setItem('swarm-sound', 'off'); });
  await page.goto('/#/chat');
  await expect(page.getByRole('button', { name: 'Ny chat', exact: true }).first()).toBeVisible();
  const projectId = await page.evaluate(async () => {
    // Data setup only: the run, repository settings and uploads below use UI.
    // @ts-expect-error Vite serves the workspace module to the browser.
    const { useStore } = await import('/src/store/useStore.ts');
    const store = useStore.getState();
    const project = store.addProject('Realmread · browserfixture');
    store.addTask({ projectId: project.id, title: 'Ret gemt tilstand', description: 'game.txt skal være fixed. Dokumentér testen.' });
    return project.id;
  });
  await page.locator('select').first().selectOption(projectId);
  await page.getByRole('button', { name: 'Ny chat', exact: true }).first().click();
  await page.getByText('Repository og kvalitetskontroller', { exact: false }).first().click();
  await page.getByLabel('Lokal repository-mappe').fill(source);
  await page.getByRole('button', { name: 'Egen kontrol' }).click();
  const check = page.getByRole('group', { name: 'Kontrol 1' });
  await check.getByLabel('Navn', { exact: true }).fill('Faktisk filkontrol');
  await check.getByLabel('Program', { exact: true }).fill(process.execPath);
  await check.getByLabel('Argumenter').fill('-e\nif(require("fs").readFileSync("game.txt","utf8")!=="fixed") process.exit(1)');
  await page.getByRole('button', { name: 'Kontrollér og gem' }).click();
  await expect(page.getByText('Gemt. Orbit arbejder på en separat Git-gren', { exact: false })).toBeVisible();
  await page.getByLabel('Arbejdsordre', { exact: true }).selectOption({ label: 'Ret gemt tilstand' });
  return projectId;
}

test('upload bible → work order → isolated code → reload → real test evidence and review', async ({ page, request }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const projectId = await setup(page);
  await page.locator('input[type=file]').setInputFiles({ name: 'Realmread-bibel.txt', mimeType: 'text/plain', buffer: Buffer.from('RR-1: game.txt skal indeholde fixed. Bevar eksisterende design.\n'.repeat(150)) });
  await page.getByRole('button', { name: 'Brug teksten som bibelkladde' }).click();
  await page.getByRole('button', { name: 'Gør kladden gældende' }).click();
  await expect(page.getByText('Gældende version 1.', { exact: false })).toBeVisible();
  await page.locator('textarea').last().fill('Ret gemt tilstand efter arbejdsordren.');
  await page.locator('textarea').last().press('Enter');
  await expect(page.getByRole('region', { name: 'Orbit Live' })).toBeVisible();
  await expect.poll(async () => page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    return useStore.getState().aiChats.some((c: { messages: { runId?: string }[] }) => c.messages.some(m => m.runId));
  })).toBe(true);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Orbit Live' }).getByText('Leveret til gennemgang', { exact: true })).toBeVisible();
  await expect(page.getByText('Kontroller: Bestået', { exact: false })).toBeVisible();
  await expect.poll(async () => page.evaluate(async id => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    return useStore.getState().tasks.find((t: { projectId: string }) => t.projectId === id)?.status;
  }, projectId)).toBe('inreview');
  expect(readFileSync(join(source, 'game.txt'), 'utf8')).toBe('original');
  const run = (await (await request.get(`${base}/api/ai/swarm`)).json()).run;
  expect(run.bible.length).toBeGreaterThan(6000);
  expect(run.verification.checks[0].exitCode).toBe(0);
  expect(run.evidence.changedFiles).toContain('game.txt');
  await expect(page.locator('table').filter({ hasText: 'game.txt' })).toBeVisible();
  expect(errors).toEqual([]);
  await testInfo.attach('Orbit completion', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('failed execution stays failed in chat and never marks task ready for review', async ({ page, request }) => {
  const projectId = await setup(page);
  await page.locator('textarea').last().fill('FAIL_MARKER: reproducer en fejl.');
  await page.locator('textarea').last().press('Enter');
  await expect(page.getByRole('region', { name: 'Orbit Live' }).getByText('Fejlet', { exact: true }).first()).toBeVisible();
  await expect.poll(async () => page.evaluate(async id => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    const s = useStore.getState();
    return { task: s.tasks.find((t: { projectId: string }) => t.projectId === id)?.status, message: s.aiChats.find((c: { projectId: string }) => c.projectId === id)?.messages.at(-1)?.status };
  }, projectId)).toEqual({ task: 'inprogress', message: 'error' });
  expect((await (await request.get(`${base}/api/ai/swarm`)).json()).run.status).toBe('error');
});

test('steer from the same composer after reload and finish the work order with the browser closed', async ({ page, request }) => {
  const projectId = await setup(page);
  await page.getByLabel('Pause efter plan').check();
  await page.getByLabel('Besked til Orbit').fill('Ret gemt tilstand med en planpause.');
  await page.getByLabel('Besked til Orbit').press('Enter');
  await expect(page.getByRole('button', { name: 'Godkend planen', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Godkend planen', exact: true })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({ name: 'ekstra-krav.txt', mimeType: 'text/plain', buffer: Buffer.from('Bevar save-formatet.') });
  await page.getByLabel('Besked til Orbit').fill('Bevar kompatibiliteten med eksisterende savegames.');
  await page.getByRole('button', { name: 'Send præcisering til næste job', exact: true }).click();
  await expect(page.getByText('Modtaget. Din præcisering og eventuelle vedhæftninger', { exact: false })).toBeVisible();
  const before = (await (await request.get(`${base}/api/ai/swarm`)).json()).run;
  expect(before.instructions).toContain('Bevar kompatibiliteten med eksisterende savegames.');
  expect(before.attachments[0].name).toBe('ekstra-krav.txt');
  await page.getByRole('button', { name: 'Godkend planen', exact: true }).click();
  await page.close();
  await expect.poll(async () => {
    const result = await (await request.get(`${base}/api/sync/state`)).json();
    return result.snapshot.tasks.find((t: { projectId: string }) => t.projectId === projectId)?.status;
  }).toBe('inreview');
  const result = await (await request.get(`${base}/api/sync/state`)).json();
  expect(result.snapshot.tasks.find((t: { projectId: string }) => t.projectId === projectId).aiDelivery.verification).toBe('passed');
});

test('mobile chat can create a project without the desktop sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { localStorage.setItem('orbit-toured', '1'); });
  await page.goto('/#/chat');
  await page.getByText('Samtaler og forbindelser', { exact: true }).click();
  await page.getByText('Nyt projekt', { exact: true }).last().click();
  await page.getByLabel('Projektnavn').last().fill('Mobilprojekt');
  await page.getByRole('button', { name: 'Opret og åbn samtale' }).last().click();
  await expect(page.getByLabel('Besked til Orbit')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('existing project audit imports reviewed work orders once and preserves them against a stale client', async ({ page, request }) => {
  const projectId = await setup(page);
  await page.getByRole('button', { name: 'Kortlæg eksisterende projekt', exact: true }).click();
  await expect(page.getByLabel('Besked til Orbit')).toHaveValue(/Overtag/);
  await page.getByLabel('Besked til Orbit').press('Enter');
  const proposal = page.getByRole('group', { name: 'Forslag til projektplan' });
  await expect(proposal).toBeVisible();
  await proposal.locator('summary').first().click();
  await expect(proposal.getByText('Verificér save-format', { exact: true })).toBeVisible();
  const stale = (await (await request.get(`${base}/api/sync/state`)).json()).snapshot;
  await proposal.getByLabel('Optag de valgte Version 1-opgaver', { exact: false }).check();
  await proposal.getByRole('button', { name: 'Opret 1 valgte opgaver' }).click();
  await expect(proposal.getByText('1 opgaver oprettet i backlog.', { exact: false })).toBeVisible();
  await request.post(`${base}/api/sync/push`, { data: { clientId: 'stale-fixture', snapshot: stale } });
  const after = (await (await request.get(`${base}/api/sync/state`)).json()).snapshot;
  const created = after.tasks.filter((t: { projectId: string; aiProposal?: unknown }) => t.projectId === projectId && t.aiProposal);
  expect(created).toHaveLength(1);
  expect(created[0].status).toBe('backlog');
  expect(after.projects.find((p: { id: string }) => p.id === projectId).scopeTaskIds).toContain(created[0].id);
  await proposal.getByRole('button', { name: 'Opret 1 valgte opgaver' }).click();
  await expect(proposal.getByText('0 opgaver oprettet i backlog. 1 fandtes allerede', { exact: false })).toBeVisible();
  expect(readFileSync(join(source, 'game.txt'), 'utf8')).toBe('original');
});

test('task deletion and restoration reach another open tab without stale resurrection', async ({ page, context, request }) => {
  const projectId = await setup(page);
  const taskId = await page.evaluate(async id => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    // @ts-expect-error Vite browser module
    const { pushNow } = await import('/src/lib/sync.ts');
    await pushNow();
    return useStore.getState().tasks.find((t: { projectId: string }) => t.projectId === id).id;
  }, projectId);
  const stale = (await (await request.get(`${base}/api/sync/state`)).json()).snapshot;
  const second = await context.newPage(); await second.goto('/#/chat');
  const hasTask = (target: Page) => target.evaluate(async id => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    return useStore.getState().tasks.some((t: { id: string }) => t.id === id);
  }, taskId);
  await expect.poll(() => hasTask(second)).toBe(true);
  await page.evaluate(async id => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    useStore.getState().deleteTask(id);
  }, taskId);
  await expect.poll(() => hasTask(second)).toBe(false);
  await request.post(`${base}/api/sync/push`, { data: { clientId: 'stale-fixture', snapshot: stale } });
  expect((await (await request.get(`${base}/api/sync/state`)).json()).snapshot.tasks.some((t: { id: string }) => t.id === taskId)).toBe(false);
  await page.evaluate(async id => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    useStore.getState().restoreTask(id);
  }, taskId);
  await expect.poll(() => hasTask(second)).toBe(true);
  await second.close();
});

test('work map explains dependencies and preserves historical tool evidence and timestamps', async ({ page }, testInfo) => {
  const start = Date.parse('2026-10-01T09:00:00Z');
  const empty = { liveText: '', notes: [], deltaCount: 0, lastDeltaAt: null, text: '', artifacts: [], error: null, actions: [], subagents: [] };
  const run = {
    runId: 'map-fixture', goal: 'Realmread · dokumenteret forløb', startedAt: start, finishedAt: start + 7_200_000, status: 'partial', orchestratorId: 'codex', notes: [],
    jobs: [
      { ...empty, id: 'analysis', title: 'Læs den gældende bibel', serviceId: 'claude', phase: 'concept', description: 'Kortlæg beslutninger.', dependsOn: [], status: 'done', startedAt: start, finishedAt: start + 60_000,
        actions: [{ id: 'read', kind: 'file', label: 'docs/bible.md', status: 'done', detail: 'Beslutninger indlæst', at: start + 10_000 }],
        subagents: [{ subId: 'reviewer', name: 'Regelkontrol', status: 'done', startedAt: start + 20_000, finishedAt: start + 40_000, text: 'Regler er sammenholdt med koden.' }] },
      { ...empty, id: 'code', title: 'Ret genopfyldning', serviceId: 'codex', phase: 'production', description: 'Bevar kompagniets XP.', dependsOn: [0], status: 'done', startedAt: start + 60_000, finishedAt: start + 3_600_000 },
      { ...empty, id: 'test', title: 'Afprøv save/load', serviceId: 'gemini', phase: 'testing', description: 'Kør integrationstesten.', dependsOn: [1], status: 'error', startedAt: start + 3_600_000, finishedAt: start + 7_200_000, error: 'XP blev ikke bevaret.' },
      { ...empty, id: 'release', title: 'Klargør build', serviceId: 'codex', phase: 'release', description: 'Kræver beståede tests.', dependsOn: [2], status: 'blocked', startedAt: null, finishedAt: start + 7_200_000 },
    ],
    evidence: { commit: 'abc123-real-evidence', changedFiles: ['save.gd'], diffStat: 'save.gd | 2 +-' },
    verification: { status: 'failed', checks: [{ name: 'Save/load', status: 'failed', exitCode: 1, output: 'XP mismatch: expected 20, actual 0' }] },
    results: [{ jobId: 'code', title: 'Ret genopfyldning', text: 'XP bevares ved genopfyldning. Save/load kræver en rettelse.' }],
    events: [{ at: start, type: 'run_start', goal: 'Realmread · dokumenteret forløb' }, { at: start + 7_200_000, type: 'run_finished', status: 'partial' }],
  };
  await page.addInitScript(() => { localStorage.setItem('orbit-toured', '1'); localStorage.setItem('swarm-sound', 'off'); });
  await page.route(`${base}/api/ai/swarm`, route => route.fulfill({ json: { ok: true, run } }));
  await page.route(`${base}/api/ai/runs`, route => route.fulfill({ json: { ok: true, runs: [{ ...run, file: 'map-fixture.json' }] } }));
  await page.route(`${base}/api/ai/runs/map-fixture`, route => route.fulfill({ json: { ok: true, run } }));
  await page.goto('/#/swarm');
  const map = page.getByRole('region', { name: 'Arbejdskort', exact: true });
  await expect(map).toBeVisible();
  await map.getByRole('button', { name: 'Opgave 4: Klargør build' }).click();
  await expect(map.getByRole('region', { name: 'Valgt opgave' })).toContainText('Kan ikke starte: Afprøv save/load er ikke leveret.');
  await map.getByRole('button', { name: 'Opgave 1: Læs den gældende bibel' }).focus();
  await page.keyboard.press('Enter');
  await expect(map.getByRole('region', { name: 'Valgt opgave' })).toContainText('docs/bible.md');
  await expect(map.getByRole('region', { name: 'Valgt opgave' })).toContainText('Regelkontrol');
  await map.getByRole('group', { name: 'Fremhæv tjeneste' }).getByRole('button', { name: 'Codex', exact: true }).click();
  await expect(map.getByRole('button', { name: 'Opgave 1: Læs den gældende bibel' })).toHaveClass(/opacity-40/);
  await page.getByRole('button').filter({ hasText: 'Realmread · dokumenteret forløb' }).click();
  await expect(map.getByText('Gemt forløb', { exact: true })).toBeVisible();
  await map.getByRole('button', { name: 'Opgave 1: Læs den gældende bibel' }).click();
  await expect(map.getByRole('region', { name: 'Valgt opgave' })).toContainText('09.00.00');
  await expect(map).toContainText('abc123-real-evidence');
  await page.getByRole('button', { name: 'Genafspil hændelser' }).click();
  await expect(map).not.toContainText('abc123-real-evidence');
  await expect(map).toContainText('Ingen Git-leverance registreret endnu.');
  await page.getByRole('button', { name: 'Tilbage til live' }).click();
  await page.screenshot({ path: testInfo.outputPath('work-map-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(map).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await testInfo.attach('Arbejdskort mobile', { body: await page.screenshot({ path: testInfo.outputPath('work-map-mobile.png'), fullPage: true }), contentType: 'image/png' });
});

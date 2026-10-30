import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const base = 'http://127.0.0.1:4310';
let source: string;

test.afterEach(async ({ request }, info) => {
  if (info.status === info.expectedStatus) return;
  // A failed assertion at a plan pause must not leave the next test's server
  // occupied. Preserve the failure/trace, then clean up this isolated fixture.
  await request.post(`${base}/api/ai/queue/control`, { data: { action: 'pause' } });
  const state = await (await request.get(`${base}/api/ai/swarm`)).json();
  if (state.run && ['running', 'awaiting_approval'].includes(state.run.status)) {
    await request.post(`${base}/api/ai/runs/${state.run.runId}/cancel`);
    await expect.poll(async () => (await (await request.get(`${base}/api/ai/swarm`)).json()).run?.status).not.toMatch(/^(running|awaiting_approval)$/);
  }
  const { queue } = await (await request.get(`${base}/api/ai/queue`)).json();
  for (const entry of queue.entries.filter((entry: { status: string }) => entry.status === 'queued')) await request.delete(`${base}/api/ai/queue/${entry.id}`);
  await request.post(`${base}/api/ai/queue/control`, { data: { action: 'resume' } });
});

test.beforeAll(async ({ request }) => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-e2e-'));
  source = join(root, 'game'); mkdirSync(source);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source });
  git('init', '-q'); writeFileSync(join(source, 'game.txt'), 'original'); git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'base');
  const fake = join(root, 'fake.mjs');
  writeFileSync(fake, `import fs from 'node:fs'; let p=process.argv.at(-1); const file=p.match(/UTF-8-filen (.*)\\. Filen indeholder/); if(file) p=fs.readFileSync(file[1],'utf8');
if(p.includes('PLANLÆGNINGSFASE')) console.log(JSON.stringify({jobs:[{title:'Verificeret rettelse',service:'codex',phase:'produktion',dependsOn:[],description:p.includes('FAIL_MARKER')?'FAIL_MARKER':'Ret game.txt efter biblen'}]}));
else if(p.includes('READ_ONLY_PLAN')) console.log('Read-only inspection completed');
else if(p.includes('FAIL_MARKER')) { console.error('Reproduced test failure'); process.exit(9); }
else if(p.includes('REPAIR_TEST')&&!p.includes('RETTELSE EFTER FAKTISK TESTFEJL')) { fs.writeFileSync('game.txt','broken'); console.log('First implementation requires a test repair'); }
else if(p.includes('"orbitProjectPlan"')) console.log(JSON.stringify({orbitProjectPlan:{version:1,releaseGoal:'En stabil save/load-cyklus',summary:'Et afgrænset restarbejde',firstMilestone:'Gem og indlæs en kampagne',unknowns:['Gameplay skal afprøves manuelt'],tasks:[{id:'save',title:'Verificér save-format',description:'Bevar kompatibilitet',priority:'high',scope:'version1',acceptanceCriteria:['Data bevares'],verification:['Kør save/load-test'],evidence:['game.txt'],dependsOn:[]}]}}));
else if(p.includes('Kortlæg kode og gældende beslutninger')) console.log('game.txt er læst. Ingen tests er kørt i denne analyse.');
else { await new Promise(r=>setTimeout(r,1800)); if(p.includes('CHAIN_FIRST')) fs.writeFileSync('first-delivery.txt','retained first task'); if(p.includes('CHAIN_SECOND')) { if(fs.readFileSync('first-delivery.txt','utf8')!=='retained first task') process.exit(12); fs.writeFileSync('second-delivery.txt','second task built on first'); } fs.writeFileSync('game.txt','fixed'); console.log('## Leverance\\n\\n| Fil | Resultat |\\n| --- | --- |\\n| game.txt | fixed |\\n\\nÆndringen er implementeret.'); }`);
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
  expect(run.contextManifest.documents[0].version).toBe(1);
  await page.getByText('Anvendt projektgrundlag', { exact: false }).first().click();
  await expect(page.getByText('Projektbibel', { exact: false }).last()).toBeVisible();
  expect(run.verification.checks[0].exitCode).toBe(0);
  expect(run.evidence.changedFiles).toContain('game.txt');
  await page.getByRole('button', { name: 'Gennemse kodeændringer', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Kodegennemgang', exact: true });
  await expect(review.getByLabel('Diff: game.txt', { exact: true })).toContainText('+fixed');
  await expect(review.getByLabel('Diff: game.txt', { exact: true })).toContainText('-original');
  const patchUrl = await review.getByRole('link', { name: 'Hent samlet Git-patch' }).getAttribute('href');
  const patchResponse = await request.get(patchUrl!);
  expect(patchResponse.ok()).toBeTruthy(); expect(await patchResponse.text()).toContain('+fixed');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await review.evaluate(element => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
  await review.getByRole('button', { name: 'Luk kodegennemgang' }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(review).not.toBeVisible();
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
  await page.route(`${base}/api/ai/swarm*`, route => route.fulfill({ json: { ok: true, run } }));
  await page.route(`${base}/api/ai/runs?*`, route => route.fulfill({ json: { ok: true, runs: [{ ...run, file: 'map-fixture.json' }] } }));
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
  await map.getByRole('heading', { name: 'Faktiske kontroller' }).scrollIntoViewIfNeeded();
  await expect(map.getByRole('heading', { name: 'Faktiske kontroller' })).toBeInViewport();
  await map.getByRole('button', { name: 'Opgave 1: Læs den gældende bibel' }).scrollIntoViewIfNeeded();
  await map.getByRole('button', { name: 'Opgave 1: Læs den gældende bibel' }).click();
  await map.getByRole('heading', { name: 'Seneste værktøjshændelser' }).scrollIntoViewIfNeeded();
  await expect(map.getByRole('heading', { name: 'Seneste værktøjshændelser' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await testInfo.attach('Arbejdskort mobile', { body: await page.screenshot({ path: testInfo.outputPath('work-map-mobile.png'), fullPage: true }), contentType: 'image/png' });
});


test('a real failed check creates one visible repair job and retains both test results', async ({ page, request }) => {
  await request.post(`${base}/api/ai/prefs`, { data: { selfHeal: true, autoJudge: false } });
  try {
    await setup(page);
    await page.locator('textarea').last().fill('REPAIR_TEST: Ret gemt tilstand og verificér resultatet.');
    await page.locator('textarea').last().press('Enter');
    const live = page.getByRole('region', { name: 'Orbit Live' });
    await expect(live.getByText('Leveret til gennemgang', { exact: true })).toBeVisible();
    await expect(live.getByText('Ret dokumenteret testfejl (forsøg 1)', { exact: true })).toBeVisible();
    await live.getByText('Kontrolhistorik · 2 gennemløb').click();
    await expect(live.getByText('Kontrol 1: Fejlet', { exact: true })).toBeVisible();
    await expect(live.getByText('Kontrol 2: Bestået', { exact: true })).toBeVisible();
    const run = (await (await request.get(`${base}/api/ai/swarm`)).json()).run;
    expect(run.jobs).toHaveLength(2); expect(run.verificationRepairs).toBe(1);
    expect(run.verificationHistory.map((attempt: { status: string }) => attempt.status)).toEqual(['failed', 'passed']);
    expect(readFileSync(join(source, 'game.txt'), 'utf8')).toBe('original');
  } finally { await request.post(`${base}/api/ai/prefs`, { data: { selfHeal: false } }); }
});

test('work orders can be queued from their drawer and execute serially with the browser closed', async ({ page, request }) => {
  await request.post(`${base}/api/ai/queue/control`, { data: { action: 'pause' } });
  const projectId = await setup(page);
  const taskIds = await page.evaluate(async id => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    const store = useStore.getState();
    const first = store.tasks.find((task: { projectId: string }) => task.projectId === id);
    const second = store.addTask({ projectId: id, title: 'Verificér næste arbejdsordre', description: 'game.txt skal være fixed efter ændringen.' });
    store.selectTask(first.id); return [first.id, second.id];
  }, projectId);
  await page.getByRole('button', { name: 'Læg i AI-kø' }).click();
  await expect(page.getByText('Arbejdsordren er lagt i kø.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Læg i AI-kø' }).click();
  await expect(page.getByText('Arbejdsordren er allerede i køen.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(async id => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts'); useStore.getState().selectTask(id);
  }, taskIds[1]);
  await page.getByRole('button', { name: 'Læg i AI-kø' }).click();
  await expect(page.getByText('Arbejdsordren er lagt i kø.', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/#/swarm');
  const queue = page.getByRole('region', { name: 'AI-arbejdskø' });
  await expect(queue.getByText('Arbejdskø · 2 opgaver', { exact: true })).toBeVisible();
  await queue.getByRole('button', { name: 'Fortsæt køen' }).click();
  await page.close();
  await expect.poll(async () => {
    const snapshot = (await (await request.get(`${base}/api/ai/queue`)).json()).queue;
    return snapshot.entries.filter((entry: { input: { projectId: string } }) => entry.input.projectId === projectId).map((entry: { status: string }) => entry.status);
  }, { timeout: 30000 }).toEqual(['done', 'done']);
  const entries = (await (await request.get(`${base}/api/ai/queue`)).json()).queue.entries.filter((entry: { input: { projectId: string } }) => entry.input.projectId === projectId);
  expect(entries[1].startedAt).toBeGreaterThanOrEqual(entries[0].finishedAt);
  for (const entry of entries) {
    const run = (await (await request.get(`${base}/api/ai/runs/${entry.runId}`)).json()).run;
    expect(run.taskId).toBeTruthy(); expect(run.verification.status).toBe('passed'); expect(run.contextManifest.projectId).toBe(projectId);
  }
  expect(readFileSync(join(source, 'game.txt'), 'utf8')).toBe('original');
});

test('image previews and unsent drafts survive reload without leaking uploads into another chat', async ({ page }) => {
  await setup(page);
  const firstUrl = page.url();
  await page.locator('textarea').last().fill('Første kladde: undersøg billedet.');
  let uploads = 0;
  await page.route(`${base}/api/ai/upload`, async route => { await new Promise(resolve => setTimeout(resolve, 250)); await route.continue(); uploads++; });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await page.locator('input[type=file]').setInputFiles({ name: 'first-shot.png', mimeType: 'image/png', buffer: png });
  await page.locator('input[type=file]').setInputFiles({ name: 'second-shot.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Ny chat', exact: true }).first().click();
  const secondUrl = page.url();
  await expect(page.locator('textarea').last()).toHaveValue('');
  await page.locator('textarea').last().fill('Anden kladde uden billeder.');
  await expect.poll(() => uploads).toBe(2);
  await expect.poll(() => page.evaluate(() => Object.values(JSON.parse(sessionStorage.getItem('orbit-chat-drafts-v1') ?? '{}')).some(draft => (draft as { attachments: unknown[] }).attachments.length === 2))).toBe(true);
  await expect(page.getByRole('button', { name: 'Åbn billede: first-shot.png' })).toHaveCount(0);
  await page.goto(firstUrl);
  await expect(page.locator('textarea').last()).toHaveValue('Første kladde: undersøg billedet.');
  await page.getByRole('button', { name: 'Åbn billede: first-shot.png' }).click();
  const preview = page.getByRole('dialog', { name: 'Billedvisning: first-shot.png' });
  await expect(preview).toBeVisible();
  await expect(preview.getByText('1 × 1 px', { exact: false })).toBeVisible();
  await preview.getByRole('button', { name: 'Originalstørrelse' }).click();
  await expect(preview.getByRole('button', { name: 'Tilpas billedet' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Åbn billede: first-shot.png' })).toBeFocused();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Åbn billede: second-shot.png' })).toBeVisible();
  await expect(page.locator('textarea').last()).toHaveValue('Første kladde: undersøg billedet.');
  await page.goto(secondUrl);
  await expect(page.locator('textarea').last()).toHaveValue('Anden kladde uden billeder.');
  await expect(page.getByRole('button', { name: 'Åbn billede: first-shot.png' })).toHaveCount(0);
});

test('legacy workshop jobs become canonical work orders without losing dependencies or duplicating work', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('orbit-toured', '1'));
  await page.goto('/#/ai');
  const fixture = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    const store = useStore.getState(), project = store.addProject('Workshop migration');
    const first = store.addAiJob({ projectId: project.id, title: 'Gennemgå tidligere kampkode', phase: 'testing', status: 'done', result: 'Historisk vurdering uden testbevis' });
    const second = store.addAiJob({ projectId: project.id, title: 'Afprøv kamp og genopfyldning', phase: 'testing', dependsOn: [first.id], question: 'Bevar XP?', answer: 'Ja' });
    store.updateProject(project.id, { scopeTaskIds: [] });
    return { projectId: project.id, first: first.id, second: second.id };
  });
  await page.getByLabel('Projekt i AI-værksted').selectOption(fixture.projectId);
  await page.getByRole('button', { name: 'Overfør til arbejdsordrer', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Overfør AI-jobs' });
  await panel.getByRole('button', { name: 'Overfør 1 valgte jobs', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Vælg også forgængeren');
  await panel.getByRole('checkbox', { name: 'Gennemgå tidligere kampkode', exact: true }).check();
  await panel.getByRole('button', { name: 'Overfør 2 valgte jobs', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('2 arbejdsordrer oprettet');
  await panel.getByRole('button', { name: 'Overfør 2 valgte jobs', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('0 arbejdsordrer oprettet');
  const { snapshot } = await (await request.get(`${base}/api/sync/state`)).json();
  const tasks = snapshot.tasks.filter((task: { projectId: string }) => task.projectId === fixture.projectId);
  expect(tasks).toHaveLength(2); expect(tasks.map((task: { status: string }) => task.status)).toEqual(['backlog', 'backlog']);
  const first = tasks.find((task: { aiWorkshopSource?: { jobId: string } }) => task.aiWorkshopSource?.jobId === fixture.first);
  const second = tasks.find((task: { aiWorkshopSource?: { jobId: string } }) => task.aiWorkshopSource?.jobId === fixture.second);
  expect(second.blockedBy).toEqual([first.id]); expect(second.description).toContain('Bevar XP?');
  expect(first.description).toContain('ikke verificeret');
  expect(snapshot.projects.find((project: { id: string }) => project.id === fixture.projectId).scopeTaskIds).toEqual([]);
  await page.getByRole('button', { name: /Afprøv kamp og genopfyldning/ }).first().click();
  await expect(page.getByRole('dialog').getByText('Orbit-arbejdsordre', { exact: false })).toBeVisible();
});

test('immediate Enter after a work-order selection keeps the task link while navigation is pending', async ({ page, request }) => {
  const projectId = await setup(page);
  await page.getByLabel('Arbejdsordre', { exact: true }).selectOption('');
  await expect(page).not.toHaveURL(/&task=/);
  await page.getByLabel('Besked til Orbit').fill('Ret tilstanden i den valgte arbejdsordre.');
  const taskId = await page.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Arbejdsordre"]')!;
    const task = select.options[1].value;
    select.value = task;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('textarea[aria-label="Besked til Orbit"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return task;
  });
  await expect.poll(async () => {
    const run = (await (await request.get(`${base}/api/ai/swarm`)).json()).run;
    return run?.projectId === projectId ? { status: run.status, taskId: run.taskId } : null;
  }).toEqual({ status: 'done', taskId });
  const { snapshot } = await (await request.get(`${base}/api/sync/state`)).json();
  expect(snapshot.tasks.find((task: { id: string }) => task.id === taskId).status).toBe('inreview');
});

test('dependent work orders continue on verified code while their human review and source checkout remain intact', async ({ page, request }) => {
  await request.post(`${base}/api/ai/queue/control`, { data: { action: 'pause' } });
  const projectId = await setup(page);
  await page.getByLabel('Fortsæt på projektets verificerede AI-arbejdsgren', { exact: true }).check();
  await page.getByRole('button', { name: 'Kontrollér og gem', exact: true }).click();
  await expect.poll(() => page.evaluate(async id => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    return useStore.getState().projects.find((project: { id: string }) => project.id === id).continueVerifiedWork;
  }, projectId)).toBe(true);
  const taskIds = await page.evaluate(async id => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    // @ts-expect-error Vite browser module
    const { pushNow } = await import('/src/lib/sync.ts');
    const store = useStore.getState(), first = store.tasks.find((task: { projectId: string }) => task.projectId === id);
    store.updateTask(first.id, { description: 'CHAIN_FIRST: Implementér første del og bevar den til næste arbejdsordre.' });
    const second = store.addTask({ projectId: id, title: 'Byg videre på første leverance', description: 'CHAIN_SECOND: Første fil skal være bevaret før den næste kan skrives.', blockedBy: [first.id] });
    useStore.setState({ rules: { ...store.rules, wip: { ...store.rules.wip, inreview: 20 } } });
    await pushNow(); return [first.id, second.id];
  }, projectId);
  for (const taskId of taskIds) expect((await request.post(`${base}/api/ai/queue`, { data: { goal: 'Udfør arbejdsordren', projectId, taskId } })).ok()).toBeTruthy();
  await request.post(`${base}/api/ai/queue/control`, { data: { action: 'resume' } });
  await page.close();
  await expect.poll(async () => {
    const { queue } = await (await request.get(`${base}/api/ai/queue`)).json();
    return queue.entries.filter((entry: { input: { projectId: string } }) => entry.input.projectId === projectId).map((entry: { status: string }) => entry.status);
  }, { timeout: 30000 }).toEqual(['done', 'done']);
  const { snapshot } = await (await request.get(`${base}/api/sync/state`)).json();
  const project = snapshot.projects.find((project: { id: string }) => project.id === projectId);
  expect(project.aiWorkspace.includedTaskIds).toEqual(taskIds);
  const tasks = snapshot.tasks.filter((task: { id: string }) => taskIds.includes(task.id));
  expect(tasks.map((task: { status: string }) => task.status)).toEqual(['inreview', 'inreview']);
  const run = (await (await request.get(`${base}/api/ai/runs/${project.aiWorkspace.runId}`)).json()).run;
  expect(run.repository.baseCommit).toBe(tasks[0].aiDelivery.commit);
  expect(readFileSync(join(run.workDir, 'first-delivery.txt'), 'utf8')).toBe('retained first task');
  expect(readFileSync(join(run.workDir, 'second-delivery.txt'), 'utf8')).toBe('second task built on first');
  const currentChanges = await (await request.get(`${base}/api/ai/runs/${run.runId}/changes`)).json();
  expect(currentChanges.files.map((file: { path: string }) => file.path)).toEqual(['second-delivery.txt']);
  const branchChanges = await (await request.get(`${base}/api/ai/runs/${run.runId}/changes?scope=project`)).json();
  expect(branchChanges.files.map((file: { path: string }) => file.path)).toEqual(['first-delivery.txt', 'game.txt', 'second-delivery.txt']);
  expect(readFileSync(join(source, 'game.txt'), 'utf8')).toBe('original');
});


test('run history searches, filters and pages without fetching full deliveries until opened', async ({ page }) => {
  const projectId = await setup(page);
  const startedAt = Date.parse('2026-10-01T09:00:00Z');
  const records = Array.from({ length: 29 }, (_, index) => ({ runId: `history-${index}`, file: `history-${index}.json`,
    goal: index === 24 ? 'Unik genopfyldning' : `Historisk arbejdsordre ${index}`, projectId: index % 2 ? 'other-project' : projectId,
    startedAt: startedAt - index * 60000, finishedAt: startedAt - index * 60000 + 1000, status: 'done', jobs: [], results: [], eventCount: 2 }));
  let detailRequests = 0;
  await page.route(`${base}/api/ai/swarm*`, route => route.fulfill({ json: { ok: true, run: null } }));
  await page.route(`${base}/api/ai/runs?*`, route => {
    const params = new URL(route.request().url()).searchParams;
    const q = (params.get('q') ?? '').toLowerCase(), project = params.get('projectId'), offset = Number(params.get('offset') ?? 0), limit = Number(params.get('limit') ?? 20);
    const selected = records.filter(run => (!project || run.projectId === project) && run.goal.toLowerCase().includes(q));
    return route.fulfill({ json: { ok: true, runs: selected.slice(offset, offset + limit), total: selected.length, nextOffset: offset + limit < selected.length ? offset + limit : null, unreadable: 0 } });
  });
  await page.route(`${base}/api/ai/runs/history-*`, route => {
    detailRequests++;
    const run = records.find(run => route.request().url().endsWith(run.runId));
    return route.fulfill({ json: { ok: true, run: { ...run, bible: 'Full document fetched only on demand', events: [], notes: [] } } });
  });
  await page.goto('/#/swarm');
  const history = page.getByRole('region', { name: 'Kørselshistorik', exact: true });
  await expect(history).toContainText('Viser 1–12 af 29');
  await history.getByRole('button', { name: 'Ældre', exact: true }).click();
  await expect(history).toContainText('Viser 13–24 af 29');
  await history.getByRole('button', { name: 'Ældre', exact: true }).click();
  await expect(history).toContainText('Viser 25–29 af 29');
  await expect(history.getByRole('button', { name: 'Ældre', exact: true })).toBeDisabled();
  await history.getByRole('searchbox', { name: 'Søg i kørselshistorik' }).fill('genopfyldning');
  await expect(history).toContainText('Viser 1–1 af 1');
  expect(detailRequests).toBe(0);
  await history.getByRole('button').filter({ hasText: 'Unik genopfyldning' }).click();
  await expect(page.getByRole('region', { name: 'Arbejdskort', exact: true })).toContainText('Gemt forløb');
  expect(detailRequests).toBe(1);
  await history.getByRole('searchbox', { name: 'Søg i kørselshistorik' }).fill('');
  await history.getByLabel('Projekt i kørselshistorik').selectOption(projectId);
  await expect(history).toContainText('Viser 1–12 af 15');
  await history.getByRole('searchbox', { name: 'Søg i kørselshistorik' }).fill('Findes ikke');
  await expect(history).toContainText('Ingen kørsler matcher dit valg.');
  await page.setViewportSize({ width: 390, height: 844 });
  await history.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test('plan editing retains read-only context, dependency identities and visible validation errors', async ({ page, request }) => {
  await setup(page);
  await page.evaluate(async () => {
    await fetch('http://127.0.0.1:4310/api/ai/orchestrate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      goal: 'READ_ONLY_PLAN', pauseAfterPlan: true, jobs: [
        { id: 'spare', title: 'Fjernbart job', serviceId: 'codex', phase: 'design', description: 'READ_ONLY_PLAN', dependsOn: [], readOnly: true },
        { id: 'read', title: 'Læs reglerne', serviceId: 'codex', phase: 'koncept', description: 'READ_ONLY_PLAN', dependsOn: [], readOnly: true, context: ['missing-context.md'] },
        { id: 'use', title: 'Sammenhold reglerne', serviceId: 'codex', phase: 'test', description: 'READ_ONLY_PLAN', dependsOn: [1], readOnly: true },
      ],
    }) });
  });
  await page.goto('/#/swarm');
  const modal = page.getByRole('dialog', { name: 'Gennemgå jobplan' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Fjern job 1', exact: true }).click();
  const first = modal.getByRole('group', { name: 'Planjob 1', exact: true });
  const second = modal.getByRole('group', { name: 'Planjob 2', exact: true });
  await expect(first.getByLabel('Kun læsning', { exact: false })).toBeChecked();
  await expect(first).toContainText('missing-context.md');
  await expect(first.getByLabel('Fase', { exact: true })).toHaveValue('concept');
  await modal.getByRole('button', { name: 'Fjern job 1', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Sammenhold reglerne afhænger');
  await second.getByText('Afhænger af 1 jobs', { exact: true }).click();
  await expect(second.getByRole('checkbox', { name: '1. Læs reglerne', exact: true })).toBeChecked();
  await first.getByText('Afhænger af 0 jobs', { exact: true }).click();
  await first.getByRole('checkbox', { name: '2. Sammenhold reglerne', exact: true }).check();
  await modal.getByRole('button', { name: 'Godkend og kør', exact: false }).click();
  await expect(modal.getByRole('alert')).toContainText('cirkulær afhængighed');
  await first.getByRole('checkbox', { name: '2. Sammenhold reglerne', exact: true }).uncheck();
  await modal.getByRole('button', { name: 'Godkend og kør', exact: false }).click();
  await expect(modal).not.toBeVisible();
  await expect.poll(async () => (await (await request.get(`${base}/api/ai/swarm`)).json()).run?.status).toBe('done');
  const run = (await (await request.get(`${base}/api/ai/swarm`)).json()).run;
  expect(run.jobs.map((job: { id: string }) => job.id)).toEqual(['read', 'use']);
  expect(run.jobs[1].dependsOn).toEqual([0]); expect(run.jobs[0].readOnly).toBe(true);
  expect(run.jobs[0].context).toEqual(['missing-context.md']);
});

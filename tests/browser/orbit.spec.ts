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

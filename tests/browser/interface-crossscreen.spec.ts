import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.addInitScript(() => { localStorage.setItem('orbit-toured', '1'); localStorage.setItem('swarm-sound', 'off'); }); });

test('sidebar projects and archived project actions work with the keyboard', async ({ page }) => {
  await page.goto('/#/noter');
  await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    useStore.getState().addProject('Keyboard project');
    useStore.getState().addProject('Second keyboard project');
  });
  const project = page.getByRole('button', { name: 'Vælg projekt Keyboard project', exact: true });
  await project.focus(); await page.keyboard.press('Enter');
  await expect(project).toHaveAttribute('aria-pressed', 'true');
  const archive = page.getByRole('button', { name: 'Arkivér projekt Keyboard project', exact: true });
  await page.keyboard.press('Tab'); await expect(archive).toBeFocused();
  await expect(archive).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /^Arkiv\s/ }).click();
  await page.getByRole('button', { name: 'Vælg projekt Second keyboard project', exact: true }).focus();
  await page.keyboard.press('Enter');
  await project.focus(); await page.keyboard.press('Enter');
  await expect(project).toHaveAttribute('aria-pressed', 'true');
  const reactivate = page.getByRole('button', { name: 'Genaktivér Keyboard project', exact: true });
  await page.keyboard.press('Tab'); await expect(reactivate).toBeFocused();
  await expect(reactivate).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Arkivér projekt Keyboard project', exact: true })).toBeAttached();
});

test('note drafts survive note switches, navigation and reload without overwriting newer saved text', async ({ page }, testInfo) => {
  await page.goto('/#/noter');
  const fixture = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    const store = useStore.getState();
    const project = store.addProject('Persistent notes'); store.setActiveProject(project.id);
    store.addNote(project.id, 'note', 'First note', 'Original shared text');
    const first = useStore.getState().notes[0].id;
    store.addNote(project.id, 'note', 'Second note', 'Other text');
    return { first };
  });
  await page.getByRole('button', { name: /^First note/ }).click();
  const body = page.getByLabel('Notens indhold', { exact: true });
  await body.fill('My local draft');
  await expect(page.getByRole('status')).toContainText('Kladde gemt lokalt');
  await page.getByRole('button', { name: /^Second note/ }).click();
  await body.fill('Second local draft');
  await page.getByRole('button', { name: /^First note/ }).click();
  await expect(body).toHaveValue('My local draft');
  await page.getByRole('link', { name: 'Orbit', exact: true }).click();
  await page.getByRole('link', { name: 'Noter', exact: true }).click();
  await expect(body).toHaveValue('My local draft');
  await page.reload();
  await expect(body).toHaveValue('My local draft');
  await page.evaluate(async id => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    useStore.getState().updateNote(id, { body: 'Saved by another editor' });
  }, fixture.first);
  await expect(page.getByRole('alert')).toContainText('Den gemte note er ændret');
  await expect(body).toHaveValue('My local draft');
  await expect(page.locator('div.fixed[aria-hidden="true"]').filter({ hasText: 'Projektstyring' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('notes-conflict.png'), fullPage: true });
  await page.getByRole('button', { name: 'Kassér kladde' }).click();
  await expect(body).toHaveValue('Saved by another editor');
  await body.fill('Deliberately saved version');
  await page.getByRole('button', { name: 'Gem', exact: true }).click();
  await page.reload();
  await expect(body).toHaveValue('Deliberately saved version');
  await page.getByRole('button', { name: /^Second note/ }).click();
  await expect(body).toHaveValue('Second local draft');
});

test('AI workshop dialog is named, traps focus and restores it without creating a job on Escape', async ({ page }, testInfo) => {
  await page.goto('/#/ai');
  const open = page.getByRole('button', { name: 'Ny AI-opgave', exact: true }).first();
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Ny AI-opgave' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Arbejdsopgavens titel').fill('Unsaved keyboard fixture');
  const before = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts'); return useStore.getState().aiJobs.length;
  });
  await dialog.getByRole('button', { name: 'Luk arbejdsopgave' }).focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('workshop-dialog.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  expect(await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts'); return useStore.getState().aiJobs.length;
  })).toBe(before);
});

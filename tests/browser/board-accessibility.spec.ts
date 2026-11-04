import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('orbit-toured', '1'));
  await page.goto('/#/tavle');
  await expect(page.getByRole('button', { name: 'Min uge', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    const store = useStore.getState();
    const project = store.addProject('Keyboard board');
    store.setActiveProject(project.id);
    store.addTask({ projectId: project.id, title: 'First keyboard task', status: 'todo' });
    store.addTask({ projectId: project.id, title: 'Second keyboard task', status: 'todo' });
  });
});

test('keyboard reorders cards, moves into an empty column, cancels and opens without starting another drag', async ({ page }, testInfo) => {
  const planned = page.getByRole('region', { name: 'Kolonne: Planlagt', exact: true });
  const moving = page.getByRole('button', { name: 'Flyt opgave: First keyboard task', exact: true });
  await expect(planned.getByRole('article').first()).toHaveAccessibleName('First keyboard task');
  await moving.focus();
  await page.keyboard.press('Space');
  await expect(moving).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByText('Valgt placering: Planlagt, ved Second keyboard task.', { exact: true })).toBeAttached();
  await page.keyboard.press('Space');
  await expect(planned.getByRole('article').first()).toHaveAccessibleName('Second keyboard task');
  await expect(planned.getByRole('article').last()).toHaveAccessibleName('First keyboard task');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await moving.focus();
  await page.keyboard.press('Space');
  await expect(moving).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('Valgt placering: I gang.', { exact: true })).toBeAttached();
  await page.keyboard.press('Space');
  const inProgress = page.getByRole('region', { name: 'Kolonne: I gang', exact: true });
  await expect(inProgress.getByRole('article', { name: 'First keyboard task', exact: true })).toBeVisible();
  await expect(moving).toBeFocused();

  await moving.focus();
  await page.keyboard.press('Space');
  await expect(moving).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('Valgt placering: Til gennemgang.', { exact: true })).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(moving).not.toHaveAttribute('aria-pressed', 'true');
  await expect(inProgress.getByRole('article', { name: 'First keyboard task', exact: true })).toBeVisible();
  await moving.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Åbn opgave: First keyboard task', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('First keyboard task', { exact: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('keyboard-board.png'), fullPage: true });
});

test('weekly board supports a keyboard move into an empty date column', async ({ page }) => {
  await page.getByRole('button', { name: 'Min uge', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Min uge', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const moving = page.getByRole('button', { name: 'Flyt opgave: First keyboard task', exact: true });
  await moving.scrollIntoViewIfNeeded();
  await moving.focus();
  await page.keyboard.press('Space');
  await expect(moving).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('Valgt placering: Næste uge.', { exact: true })).toBeAttached();
  await page.keyboard.press('Space');
  await expect(page.getByRole('region', { name: 'Kolonne: Næste uge', exact: true }).getByRole('article', { name: 'First keyboard task', exact: true })).toBeVisible();
  await expect(moving).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

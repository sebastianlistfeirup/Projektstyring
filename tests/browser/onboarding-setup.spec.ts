import { expect, test } from '@playwright/test';

test('first-run setup opens existing controls in Orbit and keeps the natural-language draft', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('orbit-toured', '1'));
  await page.goto('/#/chat');

  const draft = page.getByLabel('Dit mål');
  await expect(draft).toBeVisible();
  await draft.fill('Fortsæt byscenen og vis mig resultatet');
  await page.getByRole('button', { name: 'Tilslut kodetjeneste' }).click();
  await expect(page.locator('#orbit-compact-navigation')).toHaveAttribute('open', '');
  await expect(page.locator('#orbit-compact-connections')).toHaveAttribute('open', '');
  await expect(draft).toHaveValue('Fortsæt byscenen og vis mig resultatet');

  await page.getByRole('button', { name: 'Vælg projektmappe' }).click();
  const repository = page.getByLabel('Tilknyt projektmappe');
  await expect(repository.getByText('Lokal repository-mappe på maskinen med Companion')).toBeVisible();
  await expect(draft).toHaveValue('Fortsæt byscenen og vis mig resultatet');
  await page.screenshot({ path: testInfo.outputPath('first-run-setup.png'), fullPage: true });

  await page.getByRole('button', { name: 'Åbn samtale' }).click();
  await expect(page.getByLabel('Besked til Orbit', { exact: true })).toHaveValue('Fortsæt byscenen og vis mig resultatet');
  await page.getByRole('button', { name: 'Vælg projektmappe' }).click();
  await expect(page.locator('.orbit-chat-embedded details').filter({ hasText: 'Repository og kvalitetskontroller' }).last()).toHaveAttribute('open', '');
});

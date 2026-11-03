import { test, expect } from '@playwright/test';

test('a new project starts from one natural-language idea without executing it implicitly', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('orbit-toured', '1'));
  await page.goto('/#/chat');
  await expect(page.getByRole('heading', { name: 'Hvad skal Orbit hjælpe dig videre med?' })).toBeVisible();
  await page.getByRole('button', { name: 'Undersøg projektet og fortæl mig, hvad der blokerer.' }).click();
  await page.getByRole('button', { name: 'Åbn samtale' }).click();
  const composer = page.getByLabel('Besked til Orbit', { exact: true });
  await expect(composer).toHaveValue('Undersøg projektet og fortæl mig, hvad der blokerer.');
  await expect(page.getByText('Projektmappe mangler endnu til kodearbejde.')).not.toBeVisible();
  await page.reload();
  await expect(composer).toHaveValue('Undersøg projektet og fortæl mig, hvad der blokerer.');
  await expect(page.getByRole('region', { name: 'Kørselsstatus' })).toHaveCount(0);
});

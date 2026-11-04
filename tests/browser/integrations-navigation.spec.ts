import { expect, test } from '@playwright/test';

test('integration search reveals relevant controls and preserves unsaved fields when filtering', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('orbit-toured', '1'));
  await page.goto('/#/integrationer');
  const search = page.getByRole('searchbox', { name: 'Find en integration eller indstilling' });
  await expect(search).toBeVisible();
  const azure = page.getByRole('region', { name: 'Azure DevOps', exact: true });
  await expect(azure.getByLabel('Azure DevOps-organisation')).toBeHidden();
  await search.fill('Azure');
  await azure.getByLabel('Azure DevOps-organisation').fill('Min organisation');
  await search.fill('Morgen');
  await expect(azure).toBeHidden();
  await expect(page.getByLabel('Tidspunkt for morgenpåmindelse')).toBeVisible();
  await search.fill('Azure');
  await expect(azure.getByLabel('Azure DevOps-organisation')).toHaveValue('Min organisation');
  await page.getByRole('button', { name: 'Ryd søgning' }).click();
  await expect(search).toHaveValue('');
});

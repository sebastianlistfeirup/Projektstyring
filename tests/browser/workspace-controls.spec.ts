import { expect, test } from '@playwright/test';

test('a failed clarification keeps the text and retries without a double submit', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('orbit-toured', '1'));
  let posts = 0;
  await page.route('http://127.0.0.1:4310/api/ai/runs/control-fixture/message', async route => {
    posts++;
    await route.fulfill({ status: posts === 1 ? 503 : 200, json: { ok: posts > 1 }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.goto('/#/chat');
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the actual component in this isolated UI fixture.
    const { default: Controls } = await import('/src/components/RunControls.tsx');
    // @ts-expect-error Vite browser module.
    const reactModule = await import('/node_modules/.vite/deps/react.js');
    // @ts-expect-error Vite browser module.
    const domModule = await import('/node_modules/.vite/deps/react-dom_client.js');
    const React = reactModule.default ?? reactModule;
    const host = document.createElement('div'); host.id = 'controls-fixture'; host.style.cssText = 'position:fixed;inset:30px;background:#17181c;color:white;padding:20px;z-index:10000'; document.body.appendChild(host);
    (domModule.createRoot ?? domModule.default.createRoot)(host).render(React.createElement(Controls, { run: { runId: 'control-fixture', instructions: [] } }));
  });
  const controls = page.locator('#controls-fixture');
  const text = controls.getByLabel('Præcisering til Orbit');
  await text.fill('Bevar gemte spil og brug den gældende bibel.');
  await text.press('Enter');
  await expect(controls.getByRole('status')).toContainText('Din tekst er bevaret');
  await expect(text).toHaveValue('Bevar gemte spil og brug den gældende bibel.');
  await text.press('Enter');
  await expect(controls.getByRole('status')).toContainText('modtaget af Orbit');
  await expect(text).toHaveValue('');
  expect(posts).toBe(2);
});

test('project work limits can be saved through setup without starting an AI run', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('orbit-toured', '1'));
  let starts = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/ai\/(orchestrate|queue)$/.test(request.url())) starts++; });
  await page.goto('/#/chat');
  const projectId = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { useStore } = await import('/src/store/useStore.ts');
    return useStore.getState().addProject('Arbejdsrammer browserprøve').id;
  });
  await page.locator('select').first().selectOption(projectId);
  await page.getByRole('button', { name: 'Ny chat', exact: true }).first().click();
  await page.getByRole('button', { name: 'Vælg projektmappe' }).click();
  // A newly created chat exposes the project's settings inline in Chat.
  // The first-run setup dialog is only used before a chat exists.
  const setup = page.getByRole('region', { name: 'Chatpanel', exact: true });
  await setup.getByText('Arbejdsrammer for Orbit', { exact: true }).click();
  await setup.getByLabel('Maksimalt antal AI-kald').fill('12');
  await setup.getByLabel('Aktiv køretid i minutter').fill('30');
  await setup.getByLabel('Automatiske rettelsesforsøg').fill('0');
  await setup.getByLabel('Stop efter fejl i træk').fill('2');
  await setup.getByRole('button', { name: 'Gem arbejdsrammer' }).click();
  await expect(setup.getByRole('status')).toContainText('gemt på Companion');
  await page.reload();
  await page.getByRole('button', { name: 'Vælg projektmappe' }).click();
  await setup.getByText('Arbejdsrammer for Orbit', { exact: true }).click();
  await expect(setup.getByLabel('Maksimalt antal AI-kald')).toHaveValue('12');
  await expect(setup.getByLabel('Aktiv køretid i minutter')).toHaveValue('30');
  await expect(setup.getByLabel('Automatiske rettelsesforsøg')).toHaveValue('0');
  expect(starts).toBe(0);
});

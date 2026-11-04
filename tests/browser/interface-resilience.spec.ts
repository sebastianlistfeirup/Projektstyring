import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('orbit-toured', '1'); localStorage.setItem('swarm-sound', 'off'); });
});

test('command search finds existing work before creating tasks and preserves the draft and keyboard focus', async ({ page }, testInfo) => {
  await page.goto('/#/chat');
  const fixture = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    // Prior browser fixtures share Companion's workspace. Hydrate those tasks
    // before recording the baseline, so their arrival is not mistaken for a
    // task created by command search (Windows CI observed 32 local / 34 remote).
    // @ts-expect-error Vite browser module
    const { pullAndMerge } = await import('/src/lib/sync.ts');
    await pullAndMerge();
    const store = useStore.getState();
    const project = store.addProject('Copper Basin');
    const chat = store.addAiChat({ projectId: project.id, title: 'City lighting review' });
    store.setActiveProject(project.id);
    return { projectId: project.id, chatId: chat.id, tasks: store.tasks.length };
  });
  await page.goto(`/#/chat?chat=${fixture.chatId}`);
  const composer = page.getByLabel('Besked til Orbit', { exact: true });
  await composer.fill('Bevar denne kladde, mens jeg søger');
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: 'Søg i Orbit' });
  await expect(search).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Luk søgning' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await search.fill('Copper Basin');
  const first = page.getByRole('dialog', { name: 'Søg og handlinger' }).getByRole('option').first();
  await expect(first).toContainText('Copper Basin');
  await expect(first).not.toContainText('Opret opgave');
  await page.keyboard.press('Escape');
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('Bevar denne kladde, mens jeg søger');

  await page.keyboard.press('Control+k');
  await search.fill('AI-forbindelser');
  await page.keyboard.press('Enter');
  await expect(page.locator('#orbit-compact-connections')).toHaveAttribute('open', '');
  await expect(composer).toHaveValue('Bevar denne kladde, mens jeg søger');
  await page.keyboard.press('Control+k');
  await search.fill('City lighting');
  await page.screenshot({ path: testInfo.outputPath('command-search.png') });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`chat=${fixture.chatId}`));
  expect(await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts'); return useStore.getState().tasks.length;
  })).toBe(fixture.tasks);
});

test('a panel rendering failure can recover without unmounting its sibling or resubmitting work', async ({ page }) => {
  await page.goto('/#/chat');
  let submissions = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/ai\/(swarm|chat|runs)/.test(request.url())) submissions++; });
  await page.evaluate(async () => {
    const { default: React } = await import('http://127.0.0.1:5173/node_modules/.vite/deps/react.js');
    const { default: { createRoot } } = await import('http://127.0.0.1:5173/node_modules/.vite/deps/react-dom_client.js');
    // @ts-expect-error Vite browser module
    const { PanelErrorBoundary } = await import('/src/components/PanelErrorBoundary.tsx');
    const container = document.createElement('div');
    container.id = 'boundary-fixture'; container.style.cssText = 'position:fixed;inset:0;z-index:100;background:white;padding:24px'; document.body.appendChild(container);
    let fail = true;
    const Child = () => { if (fail) throw new Error('Preview decoder failed'); return React.createElement('p', null, 'Preview restored'); };
    createRoot(container).render(React.createElement('div', null,
      React.createElement('input', { 'aria-label': 'Sibling draft', defaultValue: 'Do not discard' }),
      React.createElement('button', { onClick: () => { fail = false; } }, 'Restore source'),
      React.createElement(PanelErrorBoundary, { label: 'Forhåndsvisning' }, React.createElement(Child))));
  });
  await expect(page.getByRole('alert', { name: 'Forhåndsvisning: visningsfejl' })).toBeVisible();
  await page.getByLabel('Sibling draft').fill('My unsaved sibling draft');
  await page.getByRole('button', { name: 'Restore source' }).click();
  await page.getByRole('button', { name: 'Prøv panelet igen' }).click();
  await expect(page.getByText('Preview restored')).toBeVisible();
  await expect(page.getByLabel('Sibling draft')).toHaveValue('My unsaved sibling draft');
  expect(submissions).toBe(0);
});

test('work status identifies stale execution without claiming current progress', async ({ page }, testInfo) => {
  await page.goto('/#/chat');
  await expect(page.locator('div.fixed[aria-hidden="true"]').filter({ hasText: 'Projektstyring' })).toHaveCount(0);
  await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { useSwarm } = await import('/src/lib/swarm.ts');
    useSwarm.getState().setRun({ runId: 'stale-interface', status: 'running', goal: 'Inspect lighting', startedAt: Date.now() - 120000, heartbeatAt: Date.now() - 90000, finishedAt: null, jobs: [], notes: [], orchestratorId: 'codex' });
    useSwarm.getState().setConnected(true);
  });
  const status = page.getByRole('region', { name: 'Arbejdsstatus' });
  await expect(status).toContainText('Afventer en ny status');
  await expect(status).toContainText('start ikke opgaven igen');
  await page.screenshot({ path: testInfo.outputPath('workspace-status.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('div.fixed[aria-hidden="true"]').filter({ hasText: 'Projektstyring' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Orbit Live', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Søg og åbn kommandoer (Ctrl+K)' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('workspace-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

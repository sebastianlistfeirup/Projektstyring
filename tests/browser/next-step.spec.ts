import { test, expect } from '@playwright/test';

test('Orbit Live points to visual review after a technical pass and to recovery after a block', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('orbit-toured', '1'); localStorage.setItem('swarm-sound', 'off'); });
  const start = Date.now();
  const job = { id: 'graphics', serviceId: 'codex', title: 'City view', description: '', phase: 'production', dependsOn: [], status: 'done', startedAt: start, finishedAt: start, notes: [], actions: [], artifacts: [{ kind: 'image', name: 'after.png', mime: 'image/png', url: '/api/ai/artifacts/after.png' }], text: '', liveText: '', deltaCount: 0 };
  const run = { runId: 'next-step-fixture', goal: 'Make the city match references', status: 'done', startedAt: start, finishedAt: start, jobs: [job], results: [], notes: [], orchestratorId: 'codex', verification: { status: 'passed', checks: [] } };
  await page.route('http://127.0.0.1:4310/api/ai/swarm*', route => route.fulfill({ json: { ok: true, run } }));
  await page.goto('/#/chat');
  const projectId = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    return useStore.getState().addProject('Next-step fixture').id;
  });
  await page.locator('select').first().selectOption(projectId);
  await page.getByRole('button', { name: 'Ny chat', exact: true }).first().click();
  await expect(page.getByRole('region', { name: 'Orbit Live' })).toBeVisible();
  const next = page.getByRole('region', { name: 'Næste skridt' });
  await expect(next).toContainText('ikke en visuel godkendelse');
  const visual = page.locator('#orbit-run-visual');
  await expect(visual).toBeVisible();
  const chatHash = await page.evaluate(() => location.hash);
  await next.getByRole('button', { name: 'Se billeder' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(chatHash);
  await expect(visual).toBeInViewport();

  await page.evaluate(async value => {
    // @ts-expect-error Vite browser module
    const { useSwarm } = await import('/src/lib/swarm.ts'); useSwarm.getState().setRun(value);
  }, { ...run, status: 'blocked', jobs: [{ ...job, status: 'blocked', artifacts: [], error: 'Reference image missing' }], verification: { status: 'failed', checks: [] } });
  await expect(next).toContainText('Afklar blokeringen');
  const results = page.locator('#orbit-run-results');
  await expect(results).toBeVisible();
  await next.getByRole('button', { name: 'Se årsag og muligheder' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(chatHash);
  await expect(results).toBeInViewport();
});

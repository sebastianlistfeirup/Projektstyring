import { expect, test, type Page } from '@playwright/test';

async function mountGallery(page: Page, alternate = false) {
  await page.evaluate(async changed => {
    // @ts-expect-error Vite serves this module for the isolated component fixture.
    const { default: Gallery } = await import('/src/components/VisualResultGallery.tsx');
    // @ts-expect-error Vite prebundles React for local browser tests.
    const reactModule = await import('/node_modules/.vite/deps/react.js');
    // @ts-expect-error Vite prebundles React DOM for local browser tests.
    const domModule = await import('/node_modules/.vite/deps/react-dom_client.js');
    const React = reactModule.default ?? reactModule;
    const createRoot = domModule.createRoot ?? domModule.default.createRoot;
    const host = document.createElement('div'); host.id = 'media-workshop-fixture';
    host.style.cssText = 'position:fixed;inset:20px;overflow:auto;background:#17181c;color:white;z-index:10000;padding:20px'; document.body.appendChild(host);
    const first = { kind: 'image', name: 'city-before.png', mime: 'image/png', artifactId: changed ? 'different-version' : 'before-version', sha256: (changed ? 'c' : 'a').repeat(64), jobId: 'city', size: 100, url: `/api/ai/runs/media-fixture/artifacts/${changed ? 'changed' : 'before'}` };
    const second = { ...first, name: 'city-after.png', artifactId: 'after-version', sha256: 'b'.repeat(64), url: '/api/ai/runs/media-fixture/artifacts/after' };
    createRoot(host).render(React.createElement(Gallery, { run: { runId: 'media-fixture', jobs: [{ id: 'city', title: 'City views', status: 'done', notes: [], artifacts: [first, second] }], results: [] } }));
  }, alternate);
}

test('media workshop compares versions and preserves feedback only for the selected archived version', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('orbit-toured', '1'));
  await page.route('http://127.0.0.1:4310/api/ai/runs/media-fixture/artifacts/*', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN3sAAAAASUVORK5CYII=', 'base64'), headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.goto('/#/chat'); await mountGallery(page);
  const gallery = page.locator('#media-workshop-fixture');
  await gallery.getByRole('button', { name: 'Sammenlign city-before.png' }).click();
  await gallery.getByRole('button', { name: 'Sammenlign city-after.png' }).click();
  const comparison = gallery.getByRole('region', { name: 'Sammenlign leverancer' });
  await expect(comparison.getByRole('img')).toHaveCount(2);
  const before = gallery.getByRole('article', { name: 'Leverance: city-before.png' });
  await before.getByText('Tilføj feedback til denne version', { exact: true }).click();
  await before.getByLabel('Feedback til city-before.png').fill('Bevar bymuren, men gør bymidten mere sammenhængende.');
  await before.getByRole('button', { name: 'Gem feedback' }).click();
  await expect(before.getByRole('status')).toContainText('gemt lokalt');
  await expect(before).toContainText('ikke en godkendelse');
  await page.reload(); await mountGallery(page);
  await before.getByText('Din feedback til denne version', { exact: true }).click();
  await expect(before.getByLabel('Feedback til city-before.png')).toHaveValue('Bevar bymuren, men gør bymidten mere sammenhængende.');
  await page.reload(); await mountGallery(page, true);
  await before.getByText('Tilføj feedback til denne version', { exact: true }).click();
  await expect(before.getByLabel('Feedback til city-before.png')).toHaveValue('');
});

test('integration evidence distinguishes native MCP configuration from tested capability', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('orbit-toured', '1'));
  let checked = false;
  const check = { status: 'passed', configurationChanged: false, checkedAt: '2026-11-04T00:00:00Z', toolNames: ['render_preview'], complete: true };
  await page.route('http://127.0.0.1:4310/api/ai/services/claude/verification', route => route.fulfill({ json: { ok: true, report: { runId: 'test', status: 'passed', checkedAt: '2026-11-04T00:00:00Z', configurationChanged: true, customTemplate: false }, integration: { delivery: 'outdated', scope: null, repository: 'unverified', mcp: { status: 'read', source: '~/.claude.json', note: 'Brugerkonfiguration er aflæst; forbindelsen kræver en særskilt prøve.', servers: [{ name: 'blender', transport: 'stdio', enabled: true, verification: 'unverified', probeSupported: true, lastCheck: checked ? check : null }] } } } }));
  await page.route('http://127.0.0.1:4310/api/ai/services/claude/mcp/verify', async route => {
    expect(route.request().postDataJSON()).toEqual({ execute: true, serverName: 'blender' });
    checked = true; await route.fulfill({ json: { ok: true, report: check } });
  });
  await page.goto('/#/chat');
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves this module for the isolated component fixture.
    const { default: Verification } = await import('/src/components/ServiceVerification.tsx');
    // @ts-expect-error Vite prebundles React for local browser tests.
    const reactModule = await import('/node_modules/.vite/deps/react.js');
    // @ts-expect-error Vite prebundles React DOM for local browser tests.
    const domModule = await import('/node_modules/.vite/deps/react-dom_client.js');
    const host = document.createElement('div'); host.id = 'integration-fixture'; host.style.cssText = 'position:fixed;inset:20px;overflow:auto;background:#17181c;color:white;z-index:10000;padding:20px'; document.body.appendChild(host);
    (domModule.createRoot ?? domModule.default.createRoot)(host).render((reactModule.default ?? reactModule).createElement(Verification, { service: { id: 'claude', name: 'Claude Code', available: true, kind: 'cli', capabilities: { repository: true, nativeMcp: true }, billing: { allowed: true } } }));
  });
  const panel = page.locator('#integration-fixture');
  await expect(panel).toContainText('Tidligere opsætning afprøvet');
  await expect(panel).toContainText('Kræver prøve i projektet');
  await panel.getByText('MCP-forbindelser · 1 fundet i brugerkonfiguration', { exact: true }).click();
  await expect(panel).toContainText('blender');
  await expect(panel).toContainText('Lokal proces · Ikke afprøvet');
  await panel.getByRole('button', { name: 'Afprøv værktøjsliste: blender' }).click();
  await expect(panel).toContainText('Forbindelse og værktøjsliste afprøvet');
  await expect(panel).toContainText('1 værktøjsnavne');
  await expect(panel).toContainText('Adgang til konkrete data og handlinger er stadig uafprøvet');
});

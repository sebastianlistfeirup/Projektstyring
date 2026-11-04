import { expect, test } from '@playwright/test';
import type { SyncSnapshotPayload } from '../../src/lib/companion';

test('edits during delayed first hydration survive epoch adoption, while stale data and later restores stay authoritative', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('orbit-toured', '1'); localStorage.setItem('swarm-sound', 'off'); });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let pulls = 0;
  let remote!: SyncSnapshotPayload;
  let updatedAt = new Date().toISOString();
  await page.route('http://127.0.0.1:4310/api/sync/state', async route => {
    pulls++;
    await gate;
    await route.fulfill({ json: { ok: true, snapshot: remote, updatedAt }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.route('http://127.0.0.1:4310/api/sync/push', async route => {
    await gate;
    const incoming = route.request().postDataJSON().snapshot as SyncSnapshotPayload;
    if (incoming.workspaceEpoch !== remote.workspaceEpoch) {
      await route.fulfill({ status: 409, json: { ok: false, resetRequired: true }, headers: { 'Access-Control-Allow-Origin': '*' } });
      return;
    }
    remote = incoming;
    updatedAt = new Date().toISOString();
    await route.fulfill({ json: { ok: true, updatedAt, merged: false }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.goto('/#/chat');
  await expect.poll(() => pulls).toBeGreaterThan(0);
  // Wait past the actual splash, while the initial server snapshot stays held.
  await expect(page.locator('div.fixed[aria-hidden="true"]').filter({ hasText: 'Projektstyring' })).toHaveCount(0);
  remote = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { snapshotFromStore } = await import('/src/lib/sync.ts');
    const snapshot = snapshotFromStore();
    // The authoritative restored workspace no longer contains old seed data.
    snapshot.workspaceEpoch = 'first-restored-epoch';
    snapshot.projects = []; snapshot.tasks = []; snapshot.sprints = []; snapshot.activity = [];
    snapshot.workspaceState = { ...snapshot.workspaceState, projects: [], tasks: [], sprints: [], activity: [], aiChats: [], bibles: {}, activeProjectId: null };
    return snapshot;
  });
  const fixture = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    const store = useStore.getState();
    const project = store.addProject('Created during initial loading');
    const chat = store.addAiChat({ projectId: project.id, title: 'Keep my new conversation' });
    store.setBible(project.id, 'My new project bible draft');
    store.setActiveProject(project.id);
    return { projectId: project.id, chatId: chat.id };
  });
  await page.goto(`/#/chat?chat=${fixture.chatId}`);
  const composer = page.getByLabel('Besked til Orbit', { exact: true });
  await composer.fill('My unsent chat draft while the server is loading');
  release();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('orbit-workspace-epoch'))).toBe('first-restored-epoch');
  await expect(composer).toHaveValue('My unsent chat draft while the server is loading');
  const state = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    // @ts-expect-error Vite browser module
    const { pushNow } = await import('/src/lib/sync.ts');
    await pushNow();
    const s = useStore.getState();
    return { projectIds: s.projects.map((p: { id: string }) => p.id), chatIds: s.aiChats.map((c: { id: string }) => c.id), bibles: s.bibles, tasks: s.tasks };
  });
  expect(state.projectIds).toEqual([fixture.projectId]);
  expect(state.chatIds).toEqual([fixture.chatId]);
  expect(state.bibles).toEqual({ [fixture.projectId]: 'My new project bible draft' });
  expect(state.tasks).toEqual([]);
  expect(remote.workspaceEpoch).toBe('first-restored-epoch');
  expect(remote.projects.map(project => (project as { id: string }).id)).toEqual([fixture.projectId]);

  // This tab now knows its epoch. A subsequent restore must replace it, even
  // though these entities were created during the first connection.
  remote = { ...remote, workspaceEpoch: 'later-restored-epoch', projects: [], tasks: [], sprints: [], activity: [], workspaceState: { ...remote.workspaceState, projects: [], tasks: [], sprints: [], activity: [], aiChats: [], bibles: {} } };
  updatedAt = new Date(Date.now() + 1000).toISOString();
  const afterRestore = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module
    const { useStore } = await import('/src/store/useStore.ts');
    // @ts-expect-error Vite browser module
    const { pullAndMerge, getPreviousWorkspace } = await import('/src/lib/sync.ts');
    await pullAndMerge();
    return { projects: useStore.getState().projects, recovery: getPreviousWorkspace()?.projects };
  });
  expect(afterRestore.projects).toEqual([]);
  expect(afterRestore.recovery.map((project: { id: string }) => project.id)).toEqual([fixture.projectId]);
});

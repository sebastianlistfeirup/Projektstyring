import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptSnapshot, normalizeSnapshot } from '../server/workspace-state.mjs';

test('older tabs and legacy clients cannot erase newer chat and bible collections', () => {
  const prior = { tasks: [{ id: 'a' }], workspaceState: { bibles: { p: 'approved' }, aiChats: [{ id: 'chat' }] }, workspaceVersions: { bibles: '2026-10-30T10:00:00Z', aiChats: '2026-10-30T09:00:00Z' } };
  const incoming = { tasks: [], workspaceState: { bibles: {}, aiChats: [{ id: 'new' }] }, workspaceVersions: { bibles: '2026-10-30T08:00:00Z', aiChats: '2026-10-30T11:00:00Z' } };
  const { snapshot, merged } = acceptSnapshot(prior, incoming);
  assert.equal(merged, true);
  assert.deepEqual(snapshot.workspaceState.bibles, { p: 'approved' });
  assert.deepEqual(snapshot.workspaceState.aiChats, [{ id: 'new' }]);
  assert.deepEqual(snapshot.workspaceState.tasks, []);
  assert.deepEqual(acceptSnapshot(prior, { tasks: [] }).snapshot.workspaceState.bibles, prior.workspaceState.bibles);
});

test('server-side task updates are normalized before backup and persistence', () => {
  const snapshot = { tasks: [{ id: 'a', status: 'done' }], workspaceState: { tasks: [{ id: 'a', status: 'inprogress' }] } };
  assert.deepEqual(normalizeSnapshot(snapshot).workspaceState.tasks, snapshot.tasks);
  assert.equal(snapshot.workspaceState.tasks[0].status, 'inprogress');
});

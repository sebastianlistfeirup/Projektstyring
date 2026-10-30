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
  assert.deepEqual(snapshot.workspaceState.tasks, prior.tasks);
  assert.deepEqual(acceptSnapshot(prior, { tasks: [] }).snapshot.workspaceState.bibles, prior.workspaceState.bibles);
});

test('server-created tasks survive stale snapshots; explicit deletion and newer restoration synchronize', () => {
  const initial = { tasks: [{ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }, { id: 'server-created', updatedAt: '2026-01-02T00:00:00.000Z' }] };
  const stale = { tasks: [initial.tasks[0]] };
  assert.equal(acceptSnapshot(initial, stale).snapshot.tasks.length, 2);
  const removed = acceptSnapshot(initial, { tasks: [initial.tasks[0]], deletedEntities: { tasks: { 'server-created': '2026-01-03T00:00:00.000Z' } } }).snapshot;
  assert.equal(removed.tasks.length, 1);
  assert.equal(acceptSnapshot(removed, initial).snapshot.tasks.length, 1);
  const restored = acceptSnapshot(removed, { tasks: [{ ...initial.tasks[1], updatedAt: '2026-01-04T00:00:00.000Z' }] }).snapshot;
  assert.equal(restored.tasks.length, 2);
});

test('server-side task updates are normalized before backup and persistence', () => {
  const snapshot = { tasks: [{ id: 'a', status: 'done' }], workspaceState: { tasks: [{ id: 'a', status: 'inprogress' }] } };
  assert.deepEqual(normalizeSnapshot(snapshot).workspaceState.tasks, snapshot.tasks);
  assert.equal(snapshot.workspaceState.tasks[0].status, 'inprogress');
});

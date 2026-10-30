import { entityCollections, mergeEntityLists, mergeTombstones } from '../shared/workspace-merge.mjs';
const core = ['tasks', 'projects', 'sprints', 'users', 'labels', 'activity'];

export function normalizeSnapshot(snapshot) {
  if (!snapshot.workspaceState) return snapshot;
  return { ...snapshot, workspaceState: { ...snapshot.workspaceState, ...Object.fromEntries(core.filter(key => Array.isArray(snapshot[key])).map(key => [key, snapshot[key]])) } };
}

// Older tabs cannot erase newer entities or replace newer bible/chat collections.
// Core deletions carry tombstones; extra collections retain per-field versions.
export function acceptSnapshot(previous, incoming) {
  let merged = false;
  const deletedEntities = mergeTombstones(previous?.deletedEntities, incoming.deletedEntities);
  incoming = { ...incoming, deletedEntities };
  if (previous) {
    for (const key of core) {
      if (!Array.isArray(incoming[key])) continue;
      if (entityCollections.includes(key)) {
        const combined = mergeEntityLists(previous[key], incoming[key], deletedEntities[key]);
        if (JSON.stringify(combined) !== JSON.stringify(incoming[key])) merged = true;
        incoming[key] = combined;
        continue;
      }
      const old = new Map((previous[key] ?? []).map(item => [item.id, item]));
      incoming[key] = incoming[key].map(item => {
        const stored = old.get(item.id);
        if (stored?.updatedAt && (!item.updatedAt || stored.updatedAt > item.updatedAt)) { merged = true; return stored; }
        return item;
      });
    }
  }
  if (!previous?.workspaceState) return { snapshot: normalizeSnapshot(incoming), merged };
  const state = { ...previous.workspaceState, ...incoming.workspaceState };
  const versions = { ...previous.workspaceVersions, ...incoming.workspaceVersions };
  for (const key of Object.keys(previous.workspaceState)) {
    if (core.includes(key)) continue;
    const oldVersion = previous.workspaceVersions?.[key], newVersion = incoming.workspaceVersions?.[key];
    if (!Object.hasOwn(incoming.workspaceState ?? {}, key) || (oldVersion && (!newVersion || oldVersion > newVersion))) {
      state[key] = previous.workspaceState[key];
      if (oldVersion) versions[key] = oldVersion;
      merged = true;
    }
  }
  return { snapshot: normalizeSnapshot({ ...incoming, workspaceState: state, workspaceVersions: versions }), merged };
}

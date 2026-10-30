const core = ['tasks', 'projects', 'sprints', 'users', 'labels', 'activity'];

export function normalizeSnapshot(snapshot) {
  if (!snapshot.workspaceState) return snapshot;
  return { ...snapshot, workspaceState: { ...snapshot.workspaceState, ...Object.fromEntries(core.filter(key => Array.isArray(snapshot[key])).map(key => [key, snapshot[key]])) } };
}

// Do not let an older tab replace a newer bible/chat collection. Core entity
// merging remains the existing client protocol; extra collections have their
// own timestamps and are preserved when an old client omits them.
export function acceptSnapshot(previous, incoming) {
  let merged = false;
  if (previous) {
    incoming = { ...incoming };
    for (const key of core) {
      if (!Array.isArray(incoming[key])) continue;
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

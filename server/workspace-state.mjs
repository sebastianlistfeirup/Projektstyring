const core = ['tasks', 'projects', 'sprints', 'users', 'labels', 'activity'];

export function normalizeSnapshot(snapshot) {
  if (!snapshot.workspaceState) return snapshot;
  return { ...snapshot, workspaceState: { ...snapshot.workspaceState, ...Object.fromEntries(core.filter(key => Array.isArray(snapshot[key])).map(key => [key, snapshot[key]])) } };
}

// Do not let an older tab replace a newer bible/chat collection. Core entity
// merging remains the existing client protocol; extra collections have their
// own timestamps and are preserved when an old client omits them.
export function acceptSnapshot(previous, incoming) {
  if (!previous?.workspaceState) return { snapshot: normalizeSnapshot(incoming), merged: false };
  const state = { ...previous.workspaceState, ...incoming.workspaceState };
  const versions = { ...previous.workspaceVersions, ...incoming.workspaceVersions };
  let merged = false;
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

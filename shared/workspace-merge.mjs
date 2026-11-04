export const entityCollections = ['tasks', 'projects', 'sprints'];

// Deletions must be explicit. Absence in an older snapshot is not evidence
// that a newly imported/server-created entity was deleted by the user.
export function mergeTombstones(a = {}, b = {}) {
  const result = {};
  for (const key of entityCollections) {
    const entries = {};
    for (const source of [a[key], b[key]]) for (const [id, time] of Object.entries(source ?? {})) {
      if (typeof time !== 'string' || !Number.isFinite(Date.parse(time))) continue;
      const normalized = new Date(time).toISOString();
      if (!entries[id] || normalized > entries[id]) entries[id] = normalized;
    }
    result[key] = entries;
  }
  return result;
}

export function mergeEntityLists(previous = [], incoming = [], deleted = {}) {
  const items = new Map(previous.map(item => [item.id, item]));
  for (const item of incoming) {
    const prior = items.get(item.id);
    if (!prior || !prior.updatedAt || (item.updatedAt && item.updatedAt >= prior.updatedAt)) items.set(item.id, item);
  }
  return [...items.values()].filter(item => !deleted[item.id] || (item.updatedAt && item.updatedAt > deleted[item.id]));
}

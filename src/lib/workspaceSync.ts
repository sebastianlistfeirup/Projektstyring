export const coreFields = new Set(['tasks', 'projects', 'sprints', 'users', 'labels', 'activity']);
export const localFields = new Set(['selectedTaskId', 'activeProjectId', 'syncConflicts', 'currentUserId', 'theme', 'accent', 'density', 'simpleMode']);

const empty = (value: unknown) => value == null || value === '' || (typeof value === 'object' && Object.keys(value).length === 0);

// Version each additional collection independently: a chat update must never
// overwrite a newer bible draft. Legacy snapshots can fill missing data only.
export function mergeWorkspaceExtras(local: Record<string, unknown>, remote: Record<string, unknown>, localVersions: Record<string, string>, remoteVersions: Record<string, string>) {
  const patch: Record<string, unknown> = {}, versions = { ...localVersions };
  for (const [key, value] of Object.entries(remote)) {
    if (coreFields.has(key) || localFields.has(key) || !Object.hasOwn(local, key) || typeof local[key] === 'function') continue;
    const incoming = remoteVersions[key], existing = localVersions[key];
    if ((incoming && (!existing || incoming > existing)) || (!incoming && !existing && empty(local[key]) && !empty(value))) {
      patch[key] = value;
      if (incoming) versions[key] = incoming;
    }
  }
  return { patch, versions };
}

import { localFields } from './workspaceSync';

type Data = Record<string, unknown>;
const missing = Symbol('missing');
const same = (left: unknown, right: unknown) => left === right || (typeof left !== 'symbol' && typeof right !== 'symbol' && JSON.stringify(left) === JSON.stringify(right));
const record = (value: unknown): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value);
const entities = (value: unknown): value is (Data & { id: string })[] => Array.isArray(value) && value.every(item => record(item) && typeof item.id === 'string');

// First connection only: replay edits made while the initial snapshot was in
// flight. Never merge the entire stale browser workspace into a restored epoch.
// Conflicting remote edits/deletions win; the caller keeps the recovery copy.
export function preserveBootstrapEdits(before: Data, current: Data, restored: Data) {
  let conflicts = 0;
  const merge = (base: unknown, local: unknown, remote: unknown): unknown => {
    if (same(base, local) || same(local, remote)) return remote;
    if (same(base, remote)) return local;
    if (entities(base) && entities(local) && entities(remote)) {
      const prior = new Map(base.map(item => [item.id, item]));
      const edits = new Map(local.map(item => [item.id, item]));
      const incoming = new Map(remote.map(item => [item.id, item]));
      return [...new Set([...incoming.keys(), ...edits.keys()])].flatMap(id => {
        const value = merge(prior.get(id) ?? missing, edits.get(id) ?? missing, incoming.get(id) ?? missing);
        return value === missing ? [] : [value];
      });
    }
    if (record(base) && record(local) && record(remote)) {
      return Object.fromEntries([...new Set([...Object.keys(remote), ...Object.keys(local)])].flatMap(key => {
        const value = merge(Object.hasOwn(base, key) ? base[key] : missing, Object.hasOwn(local, key) ? local[key] : missing, Object.hasOwn(remote, key) ? remote[key] : missing);
        return value === missing ? [] : [[key, value]];
      }));
    }
    conflicts++;
    return remote;
  };
  const patch: Data = {};
  for (const [key, local] of Object.entries(current)) {
    if (typeof local === 'function' || same(before[key], local)) continue;
    const value = localFields.has(key) ? local : merge(before[key], local, restored[key]);
    if (!same(value, restored[key])) patch[key] = value;
  }
  return { patch, conflicts };
}

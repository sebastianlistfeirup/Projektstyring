export const entityCollections: readonly ['tasks', 'projects', 'sprints'];
export type Tombstones = Record<string, Record<string, string>>;
export function mergeTombstones(a?: Tombstones, b?: Tombstones): Tombstones;
export function mergeEntityLists<T extends { id: string; updatedAt?: string }>(previous?: T[], incoming?: T[], deleted?: Record<string, string>): T[];

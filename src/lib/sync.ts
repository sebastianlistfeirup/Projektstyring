// Synkroniseringsmotor: skubber ændringer til companion-serveren og henter
// andres ændringer via WebSocket. Sidste-ændring-vinder pr. entitet.
import { nanoid } from 'nanoid';
import { useStore } from '../store/useStore';
import type { SyncSnapshotPayload } from './companion';
import { syncPull, syncPush, getSyncToken, companionBase } from './companion';
import type { ActivityEntry, Label, Project, Sprint, Task, User } from './types';
import { localFields, mergeWorkspaceExtras } from './workspaceSync';
import { entityCollections, mergeEntityLists, mergeTombstones, type Tombstones } from '../../shared/workspace-merge.mjs';

const CLIENT_KEY = 'orbit-client-id';
const SYNC_URL_KEY = 'orbit-sync-url';
const POLL_KEY = 'orbit-sync-poll';
const VERSION_KEY = 'orbit-workspace-versions';
const DELETION_KEY = 'orbit-deleted-entities';
let deletedEntities: Tombstones = {};
try { deletedEntities = mergeTombstones(JSON.parse(localStorage.getItem(DELETION_KEY) ?? '{}')); } catch { /* old data */ }
const saveDeletions = () => localStorage.setItem(DELETION_KEY, JSON.stringify(deletedEntities));
let fieldVersions: Record<string, string> = {};
try { fieldVersions = JSON.parse(localStorage.getItem(VERSION_KEY) ?? '{}'); } catch { /* old browser data */ }
function saveVersions() { localStorage.setItem(VERSION_KEY, JSON.stringify(fieldVersions)); }

export function getClientId(): string {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = nanoid(10);
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

export function getSyncUrl(): string {
  return localStorage.getItem(SYNC_URL_KEY) ?? companionBase();
}

export function setSyncUrl(url: string) {
  localStorage.setItem(SYNC_URL_KEY, url.trim().replace(/\/$/, ''));
}

export function isSyncEnabled(): boolean {
  return localStorage.getItem(POLL_KEY) !== 'off';
}

export function setSyncEnabled(on: boolean) {
  localStorage.setItem(POLL_KEY, on ? 'on' : 'off');
}

export function snapshotFromStore(): SyncSnapshotPayload {
  const s = useStore.getState();
  return {
    schemaVersion: 2,
    deletedEntities,
    workspaceVersions: { ...fieldVersions },
    workspaceState: Object.fromEntries(Object.entries(s).filter(([, value]) => typeof value !== 'function')),
    tasks: s.tasks,
    projects: s.projects,
    sprints: s.sprints,
    users: s.users,
    labels: s.labels,
    activity: s.activity.slice(0, 300),
    updatedAt: new Date().toISOString(),
  };
}

let applying = false;
let lastSyncedAt = '';
let pushTimer: number | null = null;
let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let started = false;

function mergeById<T extends { id: string; updatedAt?: string }>(local: T[], remote: T[]): T[] {
  const map = new Map(local.map((e) => [e.id, e]));
  for (const r of remote) {
    const l = map.get(r.id);
    if (!l) {
      map.set(r.id, r);
    } else if (r.updatedAt && l.updatedAt && r.updatedAt > l.updatedAt) {
      map.set(r.id, r);
    }
  }
  return [...map.values()];
}

function mergeSnapshot(remote: SyncSnapshotPayload, excludeIds?: Set<string>) {
  applying = true;
  const s = useStore.getState();
  const remoteTasks = excludeIds ? (remote.tasks as Task[]).filter((t) => !excludeIds.has(t.id)) : (remote.tasks as Task[]);
  deletedEntities = mergeTombstones(deletedEntities, remote.deletedEntities); saveDeletions();
  const tasks = mergeEntityLists(s.tasks as Task[], remoteTasks, deletedEntities.tasks);
  const projects = mergeEntityLists(s.projects as Project[], remote.projects as Project[], deletedEntities.projects);
  const sprints = mergeEntityLists(s.sprints as Sprint[], remote.sprints as Sprint[], deletedEntities.sprints);
  const users = mergeById(s.users as User[], remote.users as User[]);
  const labels = mergeById(s.labels as Label[], remote.labels as Label[]);
  const activityIds = new Set(s.activity.map((a) => a.id));
  const activity = [...s.activity, ...(remote.activity as ActivityEntry[]).filter((a) => !activityIds.has(a.id))]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 300);
  const extra = mergeWorkspaceExtras(s as unknown as Record<string, unknown>, remote.workspaceState ?? {}, fieldVersions, remote.workspaceVersions ?? {});
  fieldVersions = extra.versions; saveVersions();
  useStore.setState({ ...extra.patch, tasks, projects, sprints, users, labels, activity });
  applying = false;
}

export async function pullAndMerge(): Promise<boolean> {
  const remote = await syncPull();
  if (!remote?.ok || !remote.snapshot || !remote.updatedAt) return false;
  if (remote.updatedAt === lastSyncedAt) return false;

  // Konfliktdetektering: både lokale ændringer OG fjernændringer siden sidste sync
  const exclude = new Set<string>();
  if (lastSyncedAt) {
    const local = useStore.getState();
    const locallyChanged = new Map(
      local.tasks.filter((t) => t.updatedAt > lastSyncedAt).map((t) => [t.id, t]),
    );
    for (const rt of remote.snapshot.tasks as Task[]) {
      const lt = locallyChanged.get(rt.id);
      if (lt && rt.updatedAt > lastSyncedAt && lt.updatedAt !== rt.updatedAt) {
        exclude.add(rt.id);
        local.addSyncConflict({ taskId: rt.id, local: lt, remote: rt });
      }
    }
  }
  mergeSnapshot(remote.snapshot, exclude);
  lastSyncedAt = remote.updatedAt;
  return true;
}

// Restore is replacement, not conflict merging. Only known data fields may be
// restored; actions and methods always remain the current application version.
export function applySnapshot(snapshot: SyncSnapshotPayload): void {
  const current = useStore.getState();
  const data = snapshot.schemaVersion === 2 && snapshot.workspaceState
    ? snapshot.workspaceState
    : { tasks: snapshot.tasks, projects: snapshot.projects, sprints: snapshot.sprints, users: snapshot.users, labels: snapshot.labels, activity: snapshot.activity };
  for (const key of ['tasks', 'projects', 'sprints', 'users', 'labels', 'activity']) {
    if (!Array.isArray(data[key])) throw new Error(`Backup mangler ${key}.`);
  }
  const restored = Object.fromEntries(Object.entries(data).filter(([key]) => Object.hasOwn(current, key) && typeof current[key as keyof typeof current] !== 'function'));
  applying = true;
  try {
    useStore.setState({ ...restored, selectedTaskId: null, syncConflicts: [] });
    deletedEntities = mergeTombstones(snapshot.deletedEntities); saveDeletions();
    fieldVersions = Object.fromEntries(Object.keys(restored).map(key => [key, new Date().toISOString()]));
    saveVersions();
    lastSyncedAt = '';
  } finally { applying = false; }
  void pushNow();
}

export async function pushNow(): Promise<boolean> {
  const s = useStore.getState();
  const me = s.users.find((u) => u.id === s.currentUserId);
  const r = await syncPush(getClientId(), { id: s.currentUserId, name: me?.name ?? 'Ukendt' }, snapshotFromStore());
  if (r.ok && r.updatedAt) {
    if (r.merged) { lastSyncedAt = ''; await pullAndMerge(); }
    else lastSyncedAt = r.updatedAt;
  }
  return r.ok;
}

function schedulePush() {
  if (pushTimer) return;
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    void pushNow();
  }, 1500);
}

function wsUrl(): string {
  return `${getSyncUrl().replace(/^http/, 'ws')}/ws`;
}

function connectWs() {
  if (ws) ws.close();
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    ws = null;
    return;
  }
  ws.onopen = () => {
    const s = useStore.getState();
    const me = s.users.find((u) => u.id === s.currentUserId);
    ws?.send(JSON.stringify({ type: 'hello', clientId: getClientId(), token: getSyncToken(), user: { id: s.currentUserId, name: me?.name ?? 'Ukendt' } }));
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(String(event.data));
      if (msg.type === 'sync') void pullAndMerge();
      else if (msg.type === 'cursor') cursorListeners.forEach((l) => l(msg));
    } catch { /* ignorer */ }
  };
  ws.onclose = () => {
    ws = null;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connectWs, 5000);
  };
}

export function startSync(): () => void {
  if (started) return () => {};
  started = true;

  const unsubscribe = useStore.subscribe((state, prev) => {
    if (applying) return;
    for (const key of entityCollections) {
      if (state[key] === prev[key]) continue;
      const remaining = new Set(state[key].map(item => item.id));
      for (const item of prev[key]) if (!remaining.has(item.id)) {
        deletedEntities[key] ??= {};
        deletedEntities[key][item.id] = new Date().toISOString();
      }
    }
    saveDeletions();
    if (!isSyncEnabled()) return;
    const changed = Object.keys(state).filter(key => !localFields.has(key) && typeof state[key as keyof typeof state] !== 'function' && state[key as keyof typeof state] !== prev[key as keyof typeof prev]);
    if (changed.length) {
      const now = new Date().toISOString();
      for (const key of changed) fieldVersions[key] = now;
      saveVersions();
      schedulePush();
    }
  });

  // Periodisk pull – holder også baggrundsfaner opdateret (mobil-paritet)
  const poll = window.setInterval(() => {
    if (isSyncEnabled()) void pullAndMerge();
  }, 45000);

  if (isSyncEnabled()) {
    void pullAndMerge().then(() => pushNow());
    connectWs();
  }

  return () => {
    started = false;
    unsubscribe();
    window.clearInterval(poll);
    if (ws) ws.close();
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (pushTimer) window.clearTimeout(pushTimer);
  };
}

// ---------------- Tilstedeværelsesmarkører ----------------
export interface RemoteCursor {
  clientId: string;
  name: string;
  x: number;
  y: number;
  view: string;
}

type CursorListener = (cursor: RemoteCursor) => void;
const cursorListeners = new Set<CursorListener>();
let lastCursorSend = 0;

export function onRemoteCursor(listener: CursorListener): () => void {
  cursorListeners.add(listener);
  return () => cursorListeners.delete(listener);
}

export function sendCursor(x: number, y: number, view: string): void {
  const now = Date.now();
  if (now - lastCursorSend < 90) return;
  lastCursorSend = now;
  if (!ws || ws.readyState !== 1) return;
  const s = useStore.getState();
  const me = s.users.find((u) => u.id === s.currentUserId);
  ws.send(
    JSON.stringify({
      type: 'cursor',
      clientId: getClientId(),
      user: { name: me?.name ?? 'Ukendt' },
      x: Math.round(x),
      y: Math.round(y),
      view,
    }),
  );
}

export function restartSync() {
  if (ws) ws.close();
  ws = null;
  if (isSyncEnabled()) {
    void pullAndMerge().then(() => pushNow());
    connectWs();
  }
}

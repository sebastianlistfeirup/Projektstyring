// Synkroniseringsmotor: skubber ændringer til companion-serveren og henter
// andres ændringer via WebSocket. Sidste-ændring-vinder pr. entitet.
import { nanoid } from 'nanoid';
import { useStore } from '../store/useStore';
import type { SyncSnapshotPayload } from './companion';
import { syncPull, syncPush, getSyncToken } from './companion';
import type { ActivityEntry, Label, Project, Sprint, Task, User } from './types';

const CLIENT_KEY = 'orbit-client-id';
const SYNC_URL_KEY = 'orbit-sync-url';
const POLL_KEY = 'orbit-sync-poll';

export function getClientId(): string {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = nanoid(10);
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

export function getSyncUrl(): string {
  return localStorage.getItem(SYNC_URL_KEY) ?? 'http://127.0.0.1:4310';
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

function snapshotFromStore(): SyncSnapshotPayload {
  const s = useStore.getState();
  return {
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

function mergeSnapshot(remote: SyncSnapshotPayload) {
  applying = true;
  const s = useStore.getState();
  const tasks = mergeById(s.tasks as Task[], remote.tasks as Task[]);
  const projects = mergeById(s.projects as Project[], remote.projects as Project[]);
  const sprints = mergeById(s.sprints as Sprint[], remote.sprints as Sprint[]);
  const users = mergeById(s.users as User[], remote.users as User[]);
  const labels = mergeById(s.labels as Label[], remote.labels as Label[]);
  const activityIds = new Set(s.activity.map((a) => a.id));
  const activity = [...s.activity, ...(remote.activity as ActivityEntry[]).filter((a) => !activityIds.has(a.id))]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 300);
  useStore.setState({ tasks, projects, sprints, users, labels, activity });
  applying = false;
}

export async function pullAndMerge(): Promise<boolean> {
  const remote = await syncPull();
  if (!remote?.ok || !remote.snapshot || !remote.updatedAt) return false;
  if (remote.updatedAt === lastSyncedAt) return false;
  mergeSnapshot(remote.snapshot);
  lastSyncedAt = remote.updatedAt;
  return true;
}

// Bruges ved gendannelse fra backup: fletter et vilkårligt snapshot ind lokalt
export function applySnapshot(snapshot: SyncSnapshotPayload): void {
  mergeSnapshot(snapshot);
  lastSyncedAt = snapshot.updatedAt ?? '';
}

export async function pushNow(): Promise<boolean> {
  const s = useStore.getState();
  const me = s.users.find((u) => u.id === s.currentUserId);
  const r = await syncPush(getClientId(), { id: s.currentUserId, name: me?.name ?? 'Ukendt' }, snapshotFromStore());
  if (r.ok && r.updatedAt) lastSyncedAt = r.updatedAt;
  return r.ok;
}

function schedulePush() {
  if (pushTimer) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
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
    if (applying || !isSyncEnabled()) return;
    if (state.tasks !== prev.tasks || state.projects !== prev.projects || state.sprints !== prev.sprints || state.users !== prev.users) {
      schedulePush();
    }
  });

  if (isSyncEnabled()) {
    void pullAndMerge().then(() => pushNow());
    connectWs();
  }

  return () => {
    started = false;
    unsubscribe();
    if (ws) ws.close();
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (pushTimer) window.clearTimeout(pushTimer);
  };
}

export function restartSync() {
  if (ws) ws.close();
  ws = null;
  if (isSyncEnabled()) {
    void pullAndMerge().then(() => pushNow());
    connectWs();
  }
}

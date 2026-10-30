import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeWorkspaceExtras } from '../src/lib/workspaceSync';
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
Object.defineProperty(globalThis, 'window', { value: { localStorage: globalThis.localStorage } });
const { useStore } = await import('../src/store/useStore');

test('WIP applies to creation, drag, bulk moves, project moves and restoration', () => {
  useStore.setState({ tasks: [], notifications: [], trash: [], rules: { wip: { todo: 1, inprogress: 1, inreview: 1 }, agingDays: 7, escalate: false } });
  const s = () => useStore.getState();
  const first = s().addTask({ projectId: 'p', title: 'First', status: 'inprogress' });
  const second = s().addTask({ projectId: 'p', title: 'Second', status: 'inprogress' });
  assert.equal(first.status, 'inprogress'); assert.equal(second.status, 'backlog');
  s().reorderTask(second.id, 'inprogress', 0);
  assert.equal(s().tasks.find(t => t.id === second.id)?.status, 'backlog');
  s().bulkUpdateTasks([second.id], { status: 'inprogress' });
  assert.equal(s().tasks.find(t => t.id === second.id)?.status, 'backlog');
  const other = s().addTask({ projectId: 'other', title: 'Other', status: 'inprogress' });
  s().moveTaskToProject(other.id, 'p');
  assert.equal(s().tasks.find(t => t.id === other.id)?.projectId, 'other');
  s().deleteTask(first.id); s().updateTask(second.id, { status: 'inprogress' }); s().restoreTask(first.id);
  assert.equal(s().tasks.find(t => t.id === first.id)?.status, 'backlog');
  assert.equal(s().tasks.filter(t => t.projectId === 'p' && t.status === 'inprogress').length, 1);
});

test('published bible remains stable while draft changes and can be restored', () => {
  useStore.setState({ bibles: {}, bibleVersions: {} });
  const s = () => useStore.getState();
  s().setBible('p', 'Version one'); s().publishBible('p'); s().setBible('p', 'Draft two');
  assert.equal(s().bibleVersions.p[0].text, 'Version one');
  s().publishBible('p'); s().publishBible('p');
  assert.equal(s().bibleVersions.p.length, 2);
  assert.equal(s().bibleVersions.p[1].version, 2);
});

test('workspace extras recover in new browser and preserve newer local drafts', () => {
  const first = mergeWorkspaceExtras({ bibles: {}, aiChats: [] }, { bibles: { p: 'remote' }, aiChats: [{ id: 'chat' }] }, {}, { bibles: '2', aiChats: '2' });
  assert.deepEqual(first.patch.bibles, { p: 'remote' });
  const next = mergeWorkspaceExtras({ bibles: { p: 'local' }, aiChats: [] }, { bibles: { p: 'old' }, aiChats: [{ id: 'new' }] }, { bibles: '3' }, { bibles: '2', aiChats: '4' });
  assert.ok(!Object.hasOwn(next.patch, 'bibles')); assert.deepEqual(next.patch.aiChats, [{ id: 'new' }]);
});

test('historical run presentation preserves actual timestamps and evidence without inventing success', async () => {
  const { presentRun, jobStages, waitingReason } = await import('../src/lib/runPresentation');
  const run = presentRun({ runId: 'r', goal: 'test', startedAt: 1000, finishedAt: 7201000, status: 'partial', jobs: [
    { id: 'a', title: 'Code', dependsOn: [], status: 'error', startedAt: 1000, finishedAt: 2000, actions: [{ id: 'tool', kind: 'file', label: 'file.gd', status: 'done', at: 1500, detail: '' }] },
    { id: 'b', title: 'Build', dependsOn: [0], status: 'blocked' },
    { id: 'c', title: 'Legacy result', dependsOn: [1] },
  ], results: [{ jobId: 'c', title: 'Legacy result', text: 'A text alone is not successful execution' }] } as unknown as import('../src/lib/swarm').SwarmRun);
  assert.equal(run.startedAt, 1000); assert.equal(run.jobs[0].startedAt, 1000);
  assert.equal(run.jobs[0].actions?.[0].label, 'file.gd');
  assert.equal(run.jobs[1].startedAt, null); assert.equal(run.jobs[2].status, 'interrupted');
  assert.match(waitingReason(run.jobs[1], run), /Code er ikke leveret/);
  assert.deepEqual(jobStages(run.jobs), [0, 1, 2]);
  assert.equal(presentRun({ ...run, startedAt: undefined } as unknown as import('../src/lib/swarm').SwarmRun).startedAt, 0);
  assert.equal(jobStages([{ ...run.jobs[0], dependsOn: [0] }]).length, 1);
});

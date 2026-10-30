import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importWorkshopJobs } from '../server/ai-workshop.mjs';
import { acceptSnapshot } from '../server/workspace-state.mjs';

const job = (id, dependsOn = []) => ({ id, projectId: 'p', title: id, description: 'Original work', agentId: 'ai-codex', phase: 'testing', status: 'done', dependsOn, question: 'Keep saves?', answer: 'Yes', result: 'Old unverified result' });
const fixture = () => ({ tasks: [], projects: [{ id: 'p', scopeTaskIds: ['approved'] }], workspaceState: { aiJobs: [job('first'), job('second', ['first']), { ...job('foreign'), projectId: 'q' }] } });

test('workshop import preserves historical context, dependency links and scope without claiming completion', () => {
  const before = fixture(), result = importWorkshopJobs(before, 'p', ['first', 'second']);
  assert.deepEqual(result.snapshot.tasks.map(task => task.status), ['backlog', 'backlog']);
  assert.deepEqual(result.snapshot.tasks[1].blockedBy, [result.createdIds[0]]);
  assert.match(result.snapshot.tasks[0].description, /Old unverified result/);
  assert.match(result.snapshot.tasks[0].description, /ikke verificeret/);
  assert.match(result.snapshot.tasks[0].description, /Keep saves/);
  assert.deepEqual(result.snapshot.projects[0].scopeTaskIds, ['approved']);
  assert.deepEqual(result.snapshot.workspaceState.aiJobs, before.workspaceState.aiJobs);
  const twice = importWorkshopJobs(result.snapshot, 'p', ['first', 'second']);
  assert.deepEqual(twice.createdIds, []); assert.equal(twice.existingIds.length, 2);
  assert.equal(acceptSnapshot(result.snapshot, before).snapshot.tasks.length, 2);
});

test('workshop import refuses to drop missing, cross-project or cyclic predecessors', () => {
  assert.throws(() => importWorkshopJobs(fixture(), 'p', ['second']), /forgængeren/);
  assert.throws(() => importWorkshopJobs(fixture(), 'p', ['foreign']), /findes ikke/);
  const first = importWorkshopJobs(fixture(), 'p', ['first']);
  assert.equal(importWorkshopJobs(first.snapshot, 'p', ['second']).createdIds.length, 1);
  const cycle = fixture(); cycle.workspaceState.aiJobs[0].dependsOn = ['second'];
  assert.throws(() => importWorkshopJobs(cycle, 'p', ['first', 'second']), /cirkulære/);
  const foreign = fixture(); foreign.workspaceState.aiJobs[0].dependsOn = ['foreign'];
  assert.throws(() => importWorkshopJobs(foreign, 'p', ['first']), /andet projekt/);
});

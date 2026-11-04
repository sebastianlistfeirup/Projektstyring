import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectPlan, importProjectPlan } from '../server/project-plan.mjs';
import { acceptSnapshot } from '../server/workspace-state.mjs';

const item = (id, dependsOn = [], scope = 'version1') => ({ id, title: `Fix ${id}`, description: 'Preserve existing behavior', priority: 'high', scope, dependsOn, acceptanceCriteria: ['Saved state survives reload'], verification: ['Run save/load integration test'], evidence: ['game/save.gd:42'] });
const plan = () => ({ version: 1, releaseGoal: 'Finish core loop', summary: 'Two verified gaps', firstMilestone: 'Save/load playable', unknowns: ['Manual gameplay test pending'], tasks: [item('save'), item('load', ['save']), item('future', [], 'later')] });
const snapshot = () => ({ tasks: [], projects: [{ id: 'p', scopeTaskIds: ['existing'], releaseGoal: 'Existing approved goal' }], users: [{ id: 'u' }] });
const run = () => ({ runId: 'r', projectId: 'p', status: 'done', projectPlan: plan() });

test('project proposals require usable acceptance criteria and acyclic dependencies', () => {
  assert.equal(validateProjectPlan(plan()).tasks.length, 3);
  const cycle = plan(); cycle.tasks[0].dependsOn = ['load'];
  assert.throws(() => validateProjectPlan(cycle), /cirkulære/);
  const bad = plan(); bad.tasks[0].acceptanceCriteria = [];
  assert.throws(() => validateProjectPlan(bad), /acceptkriterier/);
  const missing = plan(); missing.tasks[0].dependsOn = ['missing'];
  assert.throws(() => validateProjectPlan(missing), /manglende/);
});

test('project plan import creates normal backlog tasks with evidence and dependencies exactly once', () => {
  const before = snapshot(), result = importProjectPlan(before, run(), ['save', 'load', 'future'], { includeInScope: true });
  assert.equal(result.createdIds.length, 3);
  assert.deepEqual(result.snapshot.tasks.map(t => t.status), ['backlog', 'backlog', 'backlog']);
  assert.deepEqual(result.snapshot.tasks[1].blockedBy, [result.snapshot.tasks[0].id]);
  assert.match(result.snapshot.tasks[0].description, /game\/save.gd:42/);
  assert.equal(result.snapshot.projects[0].releaseGoal, 'Existing approved goal');
  assert.equal(result.snapshot.projects[0].scopeTaskIds.length, 3);
  assert.ok(!result.snapshot.projects[0].scopeTaskIds.includes(result.snapshot.tasks[2].id));
  const twice = importProjectPlan(result.snapshot, run(), ['save', 'load', 'future']);
  assert.equal(twice.createdIds.length, 0); assert.equal(twice.existingIds.length, 3);
  assert.equal(acceptSnapshot(result.snapshot, before).snapshot.tasks.length, 3);
});

test('partial import requires its predecessors and never changes scope without the explicit option', () => {
  assert.throws(() => importProjectPlan(snapshot(), run(), ['load']), /forgængerne/);
  const first = importProjectPlan(snapshot(), run(), ['save']);
  const second = importProjectPlan(first.snapshot, run(), ['load']);
  assert.equal(second.createdIds.length, 1);
  assert.deepEqual(second.snapshot.projects[0].scopeTaskIds, ['existing']);
  assert.throws(() => importProjectPlan(snapshot(), { ...run(), status: 'partial' }, ['save']), /færdigt/);
});

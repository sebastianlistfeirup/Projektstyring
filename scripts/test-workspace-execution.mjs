import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRunToWorkspace, projectExecution } from '../server/task-execution.mjs';
import { acceptSnapshot } from '../server/workspace-state.mjs';
const fixture = () => ({ tasks: [{ id: 't', projectId: 'p', title: 'Fix save', description: 'Expected behavior', status: 'todo', updatedAt: '2026-01-01' }], projects: [{ id: 'p', scopeTaskIds: ['t'], repositoryPath: '/correct/repo', verificationChecks: [{ command: 'test', args: [] }] }], workspaceState: { bibles: { p: 'draft' }, bibleVersions: { p: [{ text: 'published' }] }, rules: { wip: { inprogress: 1, inreview: 1 } } } });

test('server uses authoritative work order, published bible, repository and checks', () => {
  const input = projectExecution(fixture(), { projectId: 'p', taskId: 't', goal: 'Fix', bible: 'wrong', repositoryPath: '/wrong', checks: [] });
  assert.equal(input.bible, 'published'); assert.equal(input.repositoryPath, '/correct/repo');
  assert.equal(input.checks.length, 1); assert.match(input.goal, /Expected behavior/);
  const missing = fixture(); missing.projects[0].scopeTaskIds = [];
  assert.throws(() => projectExecution(missing, { projectId: 'p', taskId: 't' }), /scope/);
  const blocked = fixture(); blocked.tasks[0].blockedBy = ['missing'];
  assert.throws(() => projectExecution(blocked, { projectId: 'p', taskId: 't' }), /forgænger/);
});

test('server completes into review without browser and stale push cannot undo it', () => {
  const initial = fixture(), run = { runId: 'r', projectId: 'p', taskId: 't', goal: 'Fix', status: 'running' };
  const active = applyRunToWorkspace(initial, run, 'run_start');
  assert.equal(active.tasks[0].status, 'inprogress');
  const complete = applyRunToWorkspace(active, { ...run, status: 'done', verification: { status: 'passed' }, evidence: { commit: 'abc' } }, 'run_finished');
  assert.equal(complete.tasks[0].status, 'inreview'); assert.equal(complete.tasks[0].aiDelivery.commit, 'abc');
  assert.equal(acceptSnapshot(complete, initial).snapshot.tasks[0].status, 'inreview');
});

test('failures and review capacity preserve honest task status; old runs cannot overwrite new links', () => {
  const initial = fixture(), run = { runId: 'r', projectId: 'p', taskId: 't', goal: 'Fix', status: 'running' };
  const active = applyRunToWorkspace(initial, run, 'run_start');
  assert.equal(applyRunToWorkspace(active, { ...run, status: 'error' }, 'run_finished').tasks[0].status, 'inprogress');
  active.workspaceState.rules.wip.inreview = 0;
  const full = applyRunToWorkspace(active, { ...run, status: 'done' }, 'run_finished');
  assert.equal(full.tasks[0].status, 'inprogress'); assert.equal(full.tasks[0].aiDelivery.status, 'done');
  assert.equal(applyRunToWorkspace(active, { ...run, runId: 'old', status: 'done' }, 'run_finished'), null);
});

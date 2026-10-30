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

test('verified project continuation carries dependency evidence and browser edits cannot rewind it', () => {
  const initial = fixture(); initial.projects[0].continueVerifiedWork = true;
  initial.projects[0].scopeTaskIds.push('next');
  initial.tasks.push({ id: 'next', projectId: 'p', title: 'Next', status: 'todo', blockedBy: ['t'] });
  const run = { runId: 'r', projectId: 'p', taskId: 't', goal: 'Fix', status: 'running', repository: { source: '/correct/repo', sourceCommit: 'base', branch: 'orbit/r' }, continuationFromCommit: null, continuationTaskIds: [], workDir: '/work/r' };
  const active = applyRunToWorkspace(initial, run, 'run_start');
  const finished = applyRunToWorkspace(active, { ...run, status: 'done', verification: { status: 'passed' }, evidence: { commit: 'verified' } }, 'run_finished');
  assert.equal(finished.tasks[0].status, 'inreview');
  assert.deepEqual(finished.projects[0].aiWorkspace.includedTaskIds, ['t']);
  const next = projectExecution(finished, { projectId: 'p', taskId: 'next' });
  assert.equal(next.repositoryStartCommit, 'verified'); assert.deepEqual(next.continuationTaskIds, ['t']);
  const oldEdit = structuredClone(initial); oldEdit.projects[0].updatedAt = '2099-01-01'; oldEdit.projects[0].name = 'New project name';
  const merged = acceptSnapshot(finished, oldEdit).snapshot;
  assert.equal(merged.projects[0].aiWorkspace.commit, 'verified'); assert.equal(merged.projects[0].name, 'New project name');
  const failed = applyRunToWorkspace(active, { ...run, status: 'blocked', verification: { status: 'failed' }, evidence: { commit: 'broken' } }, 'run_finished');
  assert.equal(failed.projects[0].aiWorkspace, undefined);
  assert.throws(() => projectExecution(failed, { projectId: 'p', taskId: 'next' }), /forgænger/);
  const disabled = structuredClone(finished); disabled.projects[0].continueVerifiedWork = false;
  assert.throws(() => projectExecution(disabled, { projectId: 'p', taskId: 'next' }), /forgænger/);
  finished.projects[0].verificationChecks = [];
  assert.throws(() => projectExecution(finished, { projectId: 'p', taskId: 'next' }), /kvalitetskontroller/);
});

test('an older completed branch cannot replace a newer project continuation pointer', () => {
  const snapshot = fixture(); snapshot.projects[0].continueVerifiedWork = true;
  snapshot.projects[0].aiWorkspace = { source: '/correct/repo', commit: 'newer', includedTaskIds: ['other'] };
  const run = { runId: 'old', projectId: 'p', taskId: 't', goal: 'Old', status: 'running', continuationFromCommit: null, repository: { source: '/correct/repo' } };
  const active = applyRunToWorkspace(snapshot, run, 'run_start');
  const result = applyRunToWorkspace(active, { ...run, status: 'done', verification: { status: 'passed' }, evidence: { commit: 'old-completion' } }, 'run_finished');
  assert.equal(result.projects[0].aiWorkspace.commit, 'newer');
});


test('project context pins full published bible and project decisions with verifiable identities', async () => {
  const { createHash } = await import('node:crypto');
  const snapshot = fixture();
  snapshot.workspaceState.bibleVersions.p[0] = { id: 'b1', version: 1, text: 'A'.repeat(9000), createdAt: '2026-10-01' };
  snapshot.workspaceState.notes = [
    { id: 'decision', projectId: 'p', kind: 'decision', title: 'Keep XP', body: 'B'.repeat(8000) + 'DECISION_END', updatedAt: '2026-10-02' },
    { id: 'foreign', projectId: 'other', kind: 'decision', title: 'FOREIGN', body: 'Do not include' },
    { id: 'note', projectId: 'p', kind: 'note', title: 'UNDECIDED', body: 'Do not turn notes into mandates' },
  ];
  const captured = projectExecution(snapshot, { projectId: 'p', taskId: 't', goal: 'Fix' });
  assert.match(captured.bible, /DECISION_END/); assert.ok(captured.bible.startsWith('A'.repeat(9000)));
  assert.ok(!captured.bible.includes('FOREIGN')); assert.ok(!captured.bible.includes('UNDECIDED'));
  assert.equal(captured.contextManifest.documents.length, 3);
  assert.equal(captured.contextManifest.documents[0].sha256, createHash('sha256').update('A'.repeat(9000)).digest('hex'));
  assert.equal(captured.contextManifest.documents[0].state, 'published');
  snapshot.workspaceState.bibleVersions.p[0].text = 'Changed';
  snapshot.projects[0].scopeTaskIds.push('new');
  assert.ok(captured.bible.startsWith('A'.repeat(9000))); assert.deepEqual(captured.contextManifest.scopeTaskIds, ['t']);
  const draft = fixture(); delete draft.workspaceState.bibleVersions;
  assert.equal(projectExecution(draft, { projectId: 'p' }).contextManifest.documents[0].state, 'draft');
});

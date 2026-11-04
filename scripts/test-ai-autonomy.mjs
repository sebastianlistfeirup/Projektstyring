import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureProjectContext, compareProjectContext } from '../server/project-context.mjs';
import { normalizeAutonomyPolicy, autonomyLimit, retryableLocalFailure } from '../server/ai-autonomy.mjs';

test('context identity changes for decisions and repository scope but not task status or timestamps', () => {
  const project = { id: 'p', name: 'Isles', repositoryPath: '/projects/isles', repositoryBaseRef: 'fixes', scopeTaskIds: ['b', 'a'] };
  const task = { id: 'a', title: 'Build', description: 'Use reference', updatedAt: 'first', status: 'todo' };
  const state = { bibles: { p: 'Original bible' }, notes: [{ id: 'decision', projectId: 'p', kind: 'decision', title: 'Appearance', body: 'Keep approved colours' }] };
  const before = captureProjectContext(project, task, state).contextManifest;
  const unchanged = captureProjectContext({ ...project, scopeTaskIds: ['a', 'b'] }, { ...task, status: 'inprogress', updatedAt: 'second' }, state).contextManifest;
  assert.equal(compareProjectContext(before, unchanged).status, 'current');
  const changed = captureProjectContext(project, task, { ...state, notes: [{ ...state.notes[0], body: 'New colours' }] }).contextManifest;
  assert.deepEqual(compareProjectContext(before, changed).changes, ['Appearance er ændret.']);
  const repo = captureProjectContext({ ...project, repositoryBaseRef: 'different' }, task, state).contextManifest;
  assert.equal(compareProjectContext(before, repo).status, 'changed');
  assert.equal(compareProjectContext(before, null).status, 'unavailable');
});

test('publishing or replacing a bible invalidates the old plan even when text is identical', () => {
  const project = { id: 'p' };
  const before = captureProjectContext(project, null, { bibles: { p: 'Text' } }).contextManifest;
  const after = captureProjectContext(project, null, { bibleVersions: { p: [{ id: 'published', version: 1, text: 'Text' }] } }).contextManifest;
  assert.equal(compareProjectContext(before, after).status, 'changed');
  assert.equal(before.fingerprint.length, 64);
});

test('autonomy limits reject invalid input and distinguish a next call from finishing the current call', () => {
  const policy = normalizeAutonomyPolicy({ maxProviderCalls: 2, maxExecutionMinutes: 5, maxRepairAttempts: 0 });
  assert.equal(policy.maxRepairAttempts, 0);
  const state = { policy, providerCalls: 2, executionMs: 1000, consecutiveFailures: 0 };
  assert.equal(autonomyLimit(state), null);
  assert.match(autonomyLimit(state, { providerCall: true }), /2 tjenestekald/);
  assert.match(autonomyLimit({ ...state, executionMs: 300000 }), /5 minutters/);
  assert.match(autonomyLimit({ ...state, consecutiveFailures: 3 }), /3 jobs/);
  for (const input of [{ maxProviderCalls: 0 }, { maxProviderCalls: Infinity }, { maxExecutionMinutes: -1 }, { maxRepairAttempts: 4 }, { maxConsecutiveFailures: 1.5 }, []]) assert.throws(() => normalizeAutonomyPolicy(input));
});

test('self-healing never blindly repeats quota, authentication or ambiguous network failures', () => {
  assert.equal(retryableLocalFailure(new Error("'codex' afsluttede med kode 1: TypeError in local build")), true);
  for (const failure of [
    "'codex' afsluttede med kode 1: quota exhausted", "'codex' afsluttede med kode 1: 429", "'codex' afsluttede med kode 1: please login",
    "'codex' afsluttede med kode 1: network interrupted", 'fetch failed', 'Afbrudt', 'Jobbet nåede tidsgrænsen på 60 minutter.',
  ]) assert.equal(retryableLocalFailure(new Error(failure)), false, failure);
  assert.equal(retryableLocalFailure(Object.assign(new Error("'codex' afsluttede med kode 1"), { code: 'ORBIT_PERMISSION_BLOCKED' })), false);
});

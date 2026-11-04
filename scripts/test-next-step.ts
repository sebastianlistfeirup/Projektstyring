import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStepForRun } from '../src/lib/nextStep';
import type { SwarmRun } from '../src/lib/swarm';

function run(status: SwarmRun['status'], artifacts: SwarmRun['jobs'][number]['artifacts'] = []): SwarmRun {
  return { runId: 'r', goal: 'Review graphics', status, jobs: [{ artifacts, media: { artifacts: [] } }], results: [], verification: { status: 'passed', checks: [] } } as unknown as SwarmRun;
}

test('a technical pass still requires visual review, including media artifacts', () => {
  const visual = run('done');
  visual.jobs[0].media!.artifacts = [{ kind: 'file', mime: 'image/png', name: 'city.png', url: '/api/ai/artifacts/city.png' }];
  const next = nextStepForRun(visual);
  assert.equal(next.target, 'orbit-run-visual');
  assert.match(next.detail, /ikke en visuel godkendelse/);
  assert.equal(nextStepForRun(run('done', [{ kind: 'image', mime: 'image/png', name: 'missing.png' }])).target, 'orbit-run-results');
});

test('pending decisions take priority and blocked work links to inspection, not execution', () => {
  const active = run('running');
  assert.equal(nextStepForRun(active, { permission: true, approval: true }).target, 'orbit-native-permissions');
  assert.equal(nextStepForRun(active, { approval: true }).target, 'orbit-plan-approval');
  assert.equal(nextStepForRun(run('awaiting_approval')).target, 'orbit-run-results');
  assert.match(nextStepForRun(run('awaiting_approval')).detail, /ikke tilgængeligt/);
  assert.equal(nextStepForRun({ ...run('awaiting_approval'), recoveredAt: Date.now() }).action, 'Se genoptagelse');
  assert.equal(nextStepForRun(run('blocked')).target, 'orbit-run-results');
  const failedChecks = run('done'); failedChecks.verification!.status = 'failed';
  assert.equal(nextStepForRun(failedChecks).title, 'Afklar fejlede kontroller');
});

test('a recovered live plan must resume even when its approval panel is restored', () => {
  const recovered = { ...run('awaiting_approval'), recoveredAt: Date.now() };
  const next = nextStepForRun(recovered, { approval: true });
  assert.equal(next.action, 'Se genoptagelse');
  assert.equal(next.target, 'orbit-run-results');
  assert.equal(nextStepForRun(run('awaiting_approval'), { approval: true }).target, 'orbit-plan-approval');
});

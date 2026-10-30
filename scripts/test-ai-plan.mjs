import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhase, removePlanJob } from '../shared/ai-plan.mjs';
import { validatePlan } from '../server/ai-state.mjs';
import { assertJobCapability } from '../server/ai-capabilities.mjs';

test('plan editing preserves dependency identities and read-only context through removal and validation', () => {
  const original = [{ id: 'spare', title: 'Unrelated', dependsOn: [] },
    { id: 'read', title: 'Read', dependsOn: [], phase: 'koncept', readOnly: true, context: ['docs/bible.md'] },
    { id: 'use', title: 'Use', dependsOn: [1], phase: 'produktion' }];
  assert.throws(() => removePlanJob(original, 1), /Use afhænger/);
  const next = validatePlan(removePlanJob(original, 0));
  assert.equal(next[1].dependsOn[0], 0); assert.equal(next[next[1].dependsOn[0]].id, 'read');
  assert.equal(next[0].readOnly, true); assert.deepEqual(next[0].context, ['docs/bible.md']);
  assert.deepEqual(next.map(job => job.phase), ['concept', 'production']);
  assert.deepEqual(original[2].dependsOn, [1]);
  assert.throws(() => validatePlan([{ ...original[1], title: '' }]), /titel/);
  assert.throws(() => validatePlan([{ ...original[1], phase: 'invented-phase' }]), /ukendt fase/);
  assert.throws(() => validatePlan([{ ...original[1], readOnly: 'false' }]), /sand eller falsk/);
});

test('repository capabilities apply to Danish and English phases and cannot be bypassed by teams', () => {
  for (const phase of ['prototype', 'produktion', 'production', 'test', 'testing', 'polering', 'polish']) {
    assert.throws(() => assertJobCapability({ phase }, { id: 'qwen' }, true), /coding-agent/);
    assert.doesNotThrow(() => assertJobCapability({ phase }, { id: 'codex' }, true));
    assert.doesNotThrow(() => assertJobCapability({ phase }, { id: 'qwen' }, false));
  }
  assert.doesNotThrow(() => assertJobCapability({ phase: 'design' }, { id: 'qwen' }, true));
  assert.throws(() => assertJobCapability({ phase: 'production', team: true }, { id: 'meshy' }, true), /mediejob/);
  assert.equal(normalizePhase(' PRODUKTION '), 'production');
});

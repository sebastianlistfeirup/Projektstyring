import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadJobContext } from '../server/ai-job-context.mjs';

test('job context includes full files and identifies omissions without escaping the checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-context-')), work = join(root, 'work'); mkdirSync(work);
  writeFileSync(join(work, 'bible.md'), 'A'.repeat(9000) + 'END_OF_BIBLE');
  writeFileSync(join(root, 'private.txt'), 'PRIVATE_PARENT_DATA');
  writeFileSync(join(work, 'large.txt'), 'L'.repeat(1024 * 1024 + 1));
  writeFileSync(join(work, 'binary.bin'), Buffer.from([0, 1, 2]));
  const context = loadJobContext(work, ['bible.md', '../private.txt', 'missing.md', 'large.txt', 'binary.bin']);
  assert.match(context.messages[0].text, /END_OF_BIBLE/);
  assert.equal(context.documents[0].sha256.length, 64);
  assert.deepEqual(context.documents.map(d => d.status), ['included', 'unavailable', 'unavailable', 'unavailable', 'unavailable']);
  assert.ok(!context.messages.some(m => m.text.includes('PRIVATE_PARENT_DATA')));
  assert.match(context.messages[3].text, /ikke indsat.*størrelsen/);
  assert.ok(!context.messages[3].text.includes('L'.repeat(100)));
});

test('job context refuses symlinks outside the checkout', { skip: process.platform === 'win32' ? 'Windows symlink creation requires host privilege' : false }, () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-context-link-')), work = join(root, 'work'); mkdirSync(work);
  writeFileSync(join(root, 'private.txt'), 'PRIVATE_SYMLINK_DATA'); symlinkSync(join(root, 'private.txt'), join(work, 'link.txt'));
  const context = loadJobContext(work, ['link.txt']);
  assert.equal(context.documents[0].status, 'unavailable');
  assert.match(context.documents[0].reason, /link peger udenfor|link peger uden for/);
  assert.ok(!context.messages[0].text.includes('PRIVATE_SYMLINK_DATA'));
});


test('review validation requires evidence and blocks serious findings independently of score', async () => {
  const { validateReview, minimumReviewScore } = await import('../server/ai-review.mjs');
  assert.equal(minimumReviewScore({}), 8);
  assert.throws(() => validateReview({ score: '9', note: 'Claim' }), /gyldig score/);
  assert.throws(() => validateReview({ score: 9, note: 'Claim' }, { requireFiles: true }), /undersøgte filer/);
  assert.equal(validateReview({ score: 9, note: 'Critical issue', findings: [{ severity: 'critical', message: 'Data loss', file: 'save.gd' }] }).status, 'blocked');
  assert.equal(validateReview({ score: 7, note: 'Incomplete' }).status, 'blocked');
  assert.equal(validateReview({ score: 8, note: 'Reviewed', examinedFiles: ['game.gd'], findings: [] }, { requireFiles: true }).status, 'passed');
});

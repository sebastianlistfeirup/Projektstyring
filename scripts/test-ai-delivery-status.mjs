import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryBlock, permissionBlock } from '../server/ai-delivery-status.mjs';

test('an approval request or blocked final status is not a delivery', () => {
  assert.match(deliveryBlock('Her er planen.\n\nAfventer din godkendelse af planen.'), /godkendelse/);
  assert.match(deliveryBlock('Status: BLOCKED — Godot kan ikke køres'), /BLOCKED/);
  assert.match(deliveryBlock('Rapport\nORBIT_JOB_STATUS: {"status":"blocked","reason":"Godot kræver tilladelse"}'), /Godot/);
  assert.match(deliveryBlock('ORBIT_JOB_STATUS: {"status":"awaiting_approval","reason":"Læs masterbiblen"}'), /masterbiblen/);
  assert.match(deliveryBlock('ORBIT_JOB_STATUS: invalid status'), /kunne ikke læses/);
});
test('historical findings, owner review and normal delivery are not execution blocks', () => {
  assert.equal(deliveryBlock('```text\nORBIT_JOB_STATUS: {"status":"blocked"}\n```\nDokumenteret format.'), null);
  for (const text of ['Status: NOT APPROVED', 'READY_FOR_OWNER_REVIEW', 'Den gamle rapport sagde BLOCKED; nu er kontrollen kørt.', '```text\nAfventer din godkendelse af planen.\n```\nEksempel fra tidligere kørsel.', 'ORBIT_JOB_STATUS: {"status":"delivered","reason":"Audit udført: 2 tests fejler"}']) assert.equal(deliveryBlock(text), null);
});
test('structured permission denial gives a bounded reason without leaking tool inputs', () => {
  assert.equal(permissionBlock({ type: 'result', permission_denials: [] }), null);
  const reason = permissionBlock({ type: 'result', permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'secret-token' } }] });
  assert.match(reason, /Bash/);
  assert.ok(!reason.includes('secret-token'));
});

test('Godot error lines fail an exit-zero check, including errors outside the retained output tail', async () => {
  const { runCheckProcess } = await import('../server/ai-check-process.mjs');
  const result = await runCheckProcess(process.execPath, ['-e', `process.stderr.write('ER'); setTimeout(()=>{process.stderr.write('ROR: Missing texture\\n'); process.stdout.write('ok\\n'.repeat(10000));},20)`], { failOnErrorOutput: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, 'failed');
  assert.match(result.output, /1 ERROR-linjer/);
  const clean = await runCheckProcess(process.execPath, ['-e', `console.log('SMOKE_ROUTES ok')`], { failOnErrorOutput: true });
  assert.equal(clean.status, 'passed');
});

test('native CLI permission_denials blocks even when provider exits zero', async () => {
  const { chatCli } = await import('../server/ai-services.mjs');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'orbit-denial-'));
  const script = join(root, 'denied.mjs');
  writeFileSync(script, `console.log(JSON.stringify({type:'result',permission_denials:[{tool_name:'Read',tool_input:{file_path:'private'}}]}));`);
  await assert.rejects(chatCli({ cmd: process.execPath, cliTemplate: `"${script}" {prompt}`, prompt: 'inspect', cwd: root, jsonl: true }), error => error.code === 'ORBIT_PERMISSION_BLOCKED' && /Read/.test(error.message));
});

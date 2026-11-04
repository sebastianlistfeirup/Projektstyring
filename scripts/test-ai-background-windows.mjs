import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';

test('periodic CLI discovery and background execution suppress Windows consoles while retaining results', async t => {
  // Observe actual native launches, including the promisified discovery path.
  // This test file has its own Node process; restore all bindings on completion.
  const originalExec = childProcess.execFile, originalSpawn = childProcess.spawn;
  const execute = promisify(originalExec), launches = [];
  const observe = (command, args, options) => launches.push({ command, args, options });
  const wrappedExec = (command, args, options, callback) => {
    observe(command, args, options);
    return originalExec(command, args, options, callback);
  };
  wrappedExec[promisify.custom] = (command, args, options) => {
    observe(command, args, options);
    return execute(command, args, options);
  };
  childProcess.execFile = wrappedExec;
  childProcess.spawn = (command, args, options) => {
    observe(command, args, options);
    return originalSpawn(command, args, options);
  };
  syncBuiltinESMExports();
  t.after(() => {
    childProcess.execFile = originalExec; childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  });
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  const actualNow = Date.now;
  let elapsed = 0;
  t.mock.method(Date, 'now', () => actualNow() + elapsed);
  const { AI_SERVICES, serviceAvailability, inspectCliInstallation, chatCli } = await import('../server/ai-services.mjs');
  const { runCheckProcess } = await import('../server/ai-check-process.mjs');
  const cliServices = AI_SERVICES.filter(service => service.kind === 'cli');
  const cfg = { aiProviders: Object.fromEntries(cliServices.map(service => [service.id, { cmd: `orbit-missing-tool-${process.pid}-${service.id}` }])) };
  await serviceAvailability(cfg);
  const firstProbeCount = launches.length;
  assert.equal(firstProbeCount, cliServices.length);
  await serviceAvailability(cfg);
  assert.equal(launches.length, firstProbeCount, 'cached UI refresh starts no additional command lookups');
  elapsed = 31_000;
  await serviceAvailability(cfg);
  assert.equal(launches.length, firstProbeCount * 2, 'the recurring cache-expiry path is exercised');
  const installation = await inspectCliInstallation('codex', { aiProviders: { codex: { cmd: process.execPath } } });
  assert.equal(installation.version, process.version);
  const output = await chatCli({ cmd: process.execPath, cliTemplate: '-e {prompt}', prompt: 'console.log("hidden agent result")' });
  assert.match(output, /hidden agent result/);
  const check = await runCheckProcess(process.execPath, ['-e', 'console.log("hidden check result"); process.exitCode=7']);
  assert.equal(check.exitCode, 7);
  assert.equal(check.status, 'failed');
  assert.match(check.output, /hidden check result/);
  assert.ok(launches.length > firstProbeCount * 2);
  for (const launch of launches) assert.equal(launch.options?.windowsHide, true, `${launch.command} must not open a console`);
});

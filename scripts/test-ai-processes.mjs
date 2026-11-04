import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { processMayBeWorking } from '../server/ai-processes.mjs';

test('recovery detects a working descendant after its agent parent exits and ignores dead Linux zombies', { skip: process.platform !== 'linux' }, async t => {
  const parent = spawn(process.execPath, ['-e', `const {spawn}=require('child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});child.unref();setTimeout(()=>process.exit(0),100);`], { detached: true, stdio: 'ignore' });
  t.after(() => { try { process.kill(-parent.pid, 'SIGKILL'); } catch { /* already stopped */ } });
  await once(parent, 'exit');
  assert.equal(processMayBeWorking(parent.pid), true, 'grandchild still works even though parent was reaped');
  process.kill(-parent.pid, 'SIGKILL');
  let working = true;
  for (let i = 0; i < 100 && working; i++) { await new Promise(resolve => setTimeout(resolve, 20)); working = processMayBeWorking(parent.pid); }
  assert.equal(working, false);
  assert.equal(processMayBeWorking(0), false); assert.equal(processMayBeWorking(-1), false);
  assert.equal(processMayBeWorking(process.pid), true);
});

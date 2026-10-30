// Optional, zero-model-call compatibility probe of installed native CLIs.
// ORBIT_CLI_BIN=/path/to/node_modules/.bin node scripts/verify-ai-cli.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliSpawnSpec, cliChildEnv } from '../server/ai-services.mjs';
import { nativeCliOptions } from '../server/ai-cli-options.mjs';

const exec = promisify(execFile), contextDir = mkdtempSync(join(tmpdir(), 'orbit-cli-help-'));
const providers = [{ id: 'codex', command: 'codex' }, { id: 'claude', command: 'claude' }, { id: 'gemini', command: 'gemini' }, { id: 'kimi', command: 'kimi' }, { id: 'qwen-code', command: 'qwen' }];
const results = [];
try {
  for (const provider of providers) {
    try {
      const candidates = process.env.ORBIT_CLI_BIN ? (process.platform === 'win32' ? ['.cmd', '.exe', ''] : ['']).map(extension => join(process.env.ORBIT_CLI_BIN, provider.command + extension)) : [];
      const command = candidates.find(existsSync) ?? provider.command;
      const env = cliChildEnv(process.env, { claude: provider.id === 'claude' });
      const run = async args => {
        const launch = cliSpawnSpec(command, args);
        return (await exec(launch.cmd, launch.args, { cwd: contextDir, env, timeout: 30000, maxBuffer: 256000 })).stdout;
      };
      const version = (await run(['--version'])).trim();
      const help = await run(provider.id === 'codex' ? ['exec', '--help'] : ['--help']);
      const options = [true, false].flatMap(readOnly => nativeCliOptions(provider.id, { readOnly, contextDir, accessDirs: [contextDir], imagePaths: ['fixture.png'], model: 'help-check-only' }).args);
      const flags = [...new Set(options.filter(arg => arg.startsWith('--')).map(arg => arg.split('=')[0]))];
      const missing = flags.filter(flag => !new RegExp(`${flag}(?=[\\s,=<]|$)`).test(help));
      results.push({ provider: provider.id, version, checkedFlags: flags, ok: missing.length === 0, missing });
    } catch (error) { results.push({ provider: provider.id, ok: false, error: error.code === 'ENOENT' ? 'Programmet er ikke installeret eller findes ikke på PATH.' : String(error.message).slice(0, 300) }); }
  }
} finally { rmSync(contextDir, { recursive: true, force: true }); }
const ok = results.every(result => result.ok);
console.log(JSON.stringify({ ok, checkedAt: new Date().toISOString(), scope: 'Version and documented CLI flags only. No login, model, MCP or subscription verification; no prompt was sent.', results }, null, 2));
if (!ok) process.exitCode = 1;

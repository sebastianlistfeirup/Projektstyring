import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Flags follow the upstream headless references linked in docs/ai-adapters.md.
// Keep prompt-bearing flags adjacent to their values when composing arguments.
export function nativeCliOptions(provider, { readOnly, accessDirs = [], contextDir, model }) {
  const args = [];
  if (provider === 'codex') {
    args.push('--sandbox', readOnly ? 'read-only' : 'workspace-write', '--json');
    for (const path of accessDirs) args.push('--add-dir', path);
  } else if (provider === 'claude') {
    args.push('--permission-mode', readOnly ? 'plan' : 'acceptEdits', '--output-format', 'stream-json', '--verbose');
    if (accessDirs.length) args.push('--add-dir', ...accessDirs);
  } else if (provider === 'gemini' || provider === 'qwen-code') {
    args.push('--approval-mode', readOnly ? 'plan' : provider === 'gemini' ? 'auto_edit' : 'auto-edit', '--output-format', 'stream-json');
    for (const path of accessDirs) args.push(`--include-directories=${path}`);
  } else if (provider === 'kimi') {
    args.push('--output-format', 'stream-json');
    for (const path of accessDirs) args.push('--add-dir', path);
    if (readOnly) {
      // Current Kimi -p cannot be combined with --plan. An explicit agent file
      // enforces a read/search allowlist instead; no shell, edits or delegation.
      mkdirSync(contextDir, { recursive: true });
      const path = join(contextDir, 'orbit-reader.md');
      writeFileSync(path, '---\nname: orbit-reader\ndescription: Read-only Orbit project analyst\ntools:\n  - Read\n  - Grep\n  - Glob\nsubagents: []\n---\n\nRead relevant project files and answer the assigned question. Do not change files or perform external actions. Distinguish observations from untested assumptions.\n');
      args.push('--agent-file', path);
    }
  }
  if (model && ['codex', 'claude', 'gemini', 'qwen-code', 'kimi'].includes(provider)) args.push('--model', model);
  return { args, jsonl: ['codex', 'claude', 'gemini', 'qwen-code', 'kimi'].includes(provider) };
}

// Orbit AI-motor — abonnement-first orkestrering.
// Primære motorer: lokale CLI-værktøjer (Codex, Claude Code, Kimi Code, Gemini CLI, Ollama/Qwen).
// API-baserede tjenester grupperes: 'sub-api' (dækket af abonnement: Meshy, ElevenLabs, HeyGen)
// og 'paid-api' (betalt pr. brug — kræver eksplicit tilladelse i aiPrefs.allowPaidApis).

import { spawn, execFile } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { promisify } from 'util';

const execFileP = promisify(execFile);

// ---- Tjenestekatalog ------------------------------------------------------
// kind: 'cli' | 'local' | 'sub-api' | 'paid-api' | 'manual'
// cliTemplate: argumenter hvor {prompt} erstattes med selve beskeden (ingen shell, token-baseret).
export const AI_SERVICES = [
  { id: 'codex',      name: 'Codex',          kind: 'cli',      cmd: 'codex',  cliTemplate: 'exec --skip-git-repo-check {prompt}', color: 'emerald',  strengths: ['kode', 'arkitektur', 'refaktorering', 'test'] },
  { id: 'claude',     name: 'Claude Code',    kind: 'cli',      cmd: 'claude', cliTemplate: '-p {prompt}',                        color: 'amber',    strengths: ['kode', 'planlægning', 'skrivning', 'analyse', 'orkestrering'] },
  { id: 'kimi',       name: 'Kimi Code',      kind: 'cli',      cmd: 'kimi',   cliTemplate: '-p {prompt}',                        color: 'indigo',   strengths: ['kode', 'lang kontekst', 'dokumentation', 'orkestrering'] },
  { id: 'gemini',     name: 'Gemini CLI',     kind: 'cli',      cmd: 'gemini', cliTemplate: '-p {prompt}',                        color: 'sky',      strengths: ['multimodal', 'research', 'design-feedback'] },
  { id: 'qwen',       name: 'Qwen (lokal)',   kind: 'local',    baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5-coder:7b',     color: 'slate',    strengths: ['privat', 'hurtig kode', 'gratis'] },
  { id: 'meshy',      name: 'Meshy',          kind: 'sub-api',  baseUrl: 'https://api.meshy.ai/v1',                            color: 'teal',     strengths: ['3D-modeller', 'teksturer'] },
  { id: 'elevenlabs', name: 'ElevenLabs',     kind: 'sub-api',  baseUrl: 'https://api.elevenlabs.io/v1',                       color: 'rose',     strengths: ['stemmer', 'lyd', 'TTS'] },
  { id: 'heygen',     name: 'HeyGen',         kind: 'sub-api',  baseUrl: 'https://api.heygen.com/v2',                          color: 'violet',   strengths: ['avatar-video', 'præsentation'] },
  { id: 'deepseek',   name: 'DeepSeek Flash', kind: 'paid-api', baseUrl: 'https://api.deepseek.com/v1',  model: 'deepseek-chat', color: 'cyan',    strengths: ['hurtig kode', 'billig chat'] },
  { id: 'openai',     name: 'OpenAI (API)',   kind: 'paid-api', baseUrl: 'https://api.openai.com/v1',    model: 'gpt-4o-mini',   color: 'lime',    strengths: ['generel chat'] },
  { id: 'anthropic',  name: 'Anthropic (API)',kind: 'paid-api', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', color: 'orange', strengths: ['skrivning', 'kode'] },
  { id: 'moonshot',   name: 'Moonshot (API)', kind: 'paid-api', baseUrl: 'https://api.moonshot.ai/v1',   model: 'kimi-k2',       color: 'blue',    strengths: ['lang kontekst'] },
  { id: 'xai',        name: 'xAI (API)',      kind: 'paid-api', baseUrl: 'https://api.x.ai/v1',          model: 'grok-3-mini',   color: 'orange',  strengths: ['hurtig chat'] },
  { id: 'grok',       name: 'Grok',           kind: 'cli',      cmd: 'grok',   cliTemplate: '-p {prompt}',                               color: 'orange',   strengths: ['chat'] },
];
import { normalizePhase } from '../shared/ai-plan.mjs';
const coding = new Set(['codex', 'claude', 'kimi', 'gemini', 'qwen-code', 'grok']);
const media = { meshy: 'model3d', elevenlabs: 'audio', heygen: 'video' };

// Adapter support, not a claim that the installed account/version is verified.
export function serviceCapabilities(service) {
  const repository = coding.has(service.id);
  return { text: !media[service.id], repository, nativeMcp: repository, structuredEvents: repository, produces: media[service.id] ?? null };
}


export function assertJobCapability(job, service, repository) {
  const cap = serviceCapabilities(service ?? { id: '' });
  if (repository && ['prototype', 'production', 'testing', 'polish'].includes(normalizePhase(job.phase)) && !cap.repository && !cap.produces) {
    throw new Error('Dette repository-job kræver en coding-agent med fil- og kommandoadgang. Brug tekstmodeller til koncept eller design, og lad en coding-agent implementere og afprøve resultatet.');
  }
  if (cap.produces && job.team) throw new Error('Et mediejob kan ikke være et chatbaseret underteam. Opret medieproduktionen som et selvstændigt job.');
}

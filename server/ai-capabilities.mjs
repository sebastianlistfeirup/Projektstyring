const coding = new Set(['codex', 'claude', 'kimi', 'gemini', 'qwen-code']);
const media = { meshy: 'model3d', elevenlabs: 'audio', heygen: 'video' };

// Adapter support, not a claim that the installed account/version is verified.
export function serviceCapabilities(service) {
  const repository = coding.has(service.id);
  return { text: !media[service.id], repository, nativeMcp: repository, structuredEvents: repository, produces: media[service.id] ?? null };
}

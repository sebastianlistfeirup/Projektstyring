// Limits describe Orbit's work, never an estimate of provider credits or money.
export function normalizeAutonomyPolicy(input = {}, { selfHeal = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Arbejdsrammer skal være et objekt.');
  const integer = (key, fallback, min, max) => {
    const value = input[key] ?? fallback;
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} skal være et heltal mellem ${min} og ${max}.`);
    return value;
  };
  return {
    maxProviderCalls: integer('maxProviderCalls', 200, 1, 1000),
    maxExecutionMinutes: input.maxExecutionMinutes == null ? null : integer('maxExecutionMinutes', null, 1, 1440),
    maxRepairAttempts: integer('maxRepairAttempts', selfHeal ? 1 : 0, 0, 3),
    maxConsecutiveFailures: integer('maxConsecutiveFailures', 3, 1, 10),
  };
}

export function autonomyLimit(state, { providerCall = false } = {}) {
  const { policy } = state;
  if (state.blockedReason) return state.blockedReason;
  if (providerCall && state.providerCalls >= policy.maxProviderCalls) return `Rammen på ${policy.maxProviderCalls} tjenestekald er nået. Gennemgå leverancen, før en ny arbejdsramme startes.`;
  if (policy.maxExecutionMinutes !== null && state.executionMs >= policy.maxExecutionMinutes * 60000) return `Rammen på ${policy.maxExecutionMinutes} minutters udførelse er nået. Arbejdet er bevaret til gennemgang.`;
  if (state.consecutiveFailures >= policy.maxConsecutiveFailures) return `${state.consecutiveFailures} jobs i træk er fejlet. Orbit stopper nye forsøg, så årsagen kan afklares.`;
  return null;
}

/** Unknown transport outcomes and account failures are not repairable by
 * repeating a request. Only a definite local CLI failure can self-heal once. */
export function retryableLocalFailure(error) {
  if (error?.code?.startsWith('ORBIT_')) return false;
  const message = String(error?.message ?? error);
  if (/ENOENT|Kunne ikke starte|Windows-shim|401|403|429|quota|kvote|rate.?limit|login|log.?in|unauthori[sz]ed|forbidden|API.?key|API.nøgle|billing|credit|abonnement|betaling|timeout|timed out|tidsgræns|ECONN|ETIMEDOUT|fetch failed|network|netværk|Afbrudt/i.test(message)) return false;
  return /afsluttede med kode [1-9]\d*/i.test(message);
}

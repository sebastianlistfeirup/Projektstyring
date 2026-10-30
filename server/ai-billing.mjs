// A provider name, installed CLI or API key is not evidence of entitlement.
// These declarations are user-confirmed; they are not a live quota measurement.
export function billingPolicy(service, provider = {}) {
  if (service.kind === 'local') return { allowed: true, mode: 'local', source: 'local', reason: null };
  if (provider.billingMode === 'included' && provider.noExtraCharges === true) {
    return { allowed: true, mode: 'included', source: 'user_confirmed', reason: null };
  }
  return {
    allowed: false, mode: provider.billingMode ?? 'unknown', source: 'unverified',
    reason: provider.billingMode === 'usage'
      ? 'Forbrugsafregning er blokeret. Orbit bruger kun inkluderet abonnementsforbrug.'
      : 'Bekræft abonnementsadgang og at ekstraforbrug er slået fra hos leverandøren.',
  };
}

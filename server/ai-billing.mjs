// A provider name, installed CLI or API key is not evidence of entitlement.
// These declarations are user-confirmed; they are not a live quota measurement.
export function billingPolicy(service, provider = {}) {
  let localEndpoint = false;
  try { localEndpoint = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(provider.baseUrl ?? service.baseUrl ?? 'http://127.0.0.1:11434').hostname); } catch { /* Invalid endpoints are not local. */ }
  const cloudModel = provider.remoteModel === true || /(?:[:/-]cloud)(?:$|[:/-])/i.test(provider.model ?? service.model ?? '');
  if (service.kind === 'local' && localEndpoint && !cloudModel) return { allowed: true, mode: 'local', source: 'local', reason: null };
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

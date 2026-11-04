// Providers can exit successfully even when their task could not be completed.
// Keep this distinct from owner acceptance and from historical quoted failures.
export const DELIVERY_STATUS_INSTRUCTION = `Afslut dit svar med én separat linje:
ORBIT_JOB_STATUS: {"status":"delivered","reason":"Kort konkret resultat"}
Brug status "blocked", hvis en nødvendig handling eller kontrol ikke kunne udføres, og "awaiting_approval", hvis du afventer en konkret beslutning eller tilladelse. Angiv den præcise blokering i reason. Brug kun delivered, når den tildelte opgave faktisk er udført; det betyder ikke ejeraccept. En færdig planlægningsopgave kan levere en plan, men en udførelsesopgave må ikke markeres delivered for blot at beskrive en fremtidig plan.`;

export function deliveryBlock(text) {
  const source = String(text ?? '');
  const prose = source.replace(/```[\s\S]*?```/g, '');
  const marker = prose.match(/^ORBIT_JOB_STATUS:[^\n]*$/gm)?.at(-1);
  if (marker) {
    let status;
    try { status = JSON.parse(marker.slice('ORBIT_JOB_STATUS:'.length)); }
    catch { return 'Agentens afsluttende status kunne ikke læses. Leverancen kræver gennemgang.'; }
    if (!['delivered', 'blocked', 'awaiting_approval'].includes(status.status)) return 'Agenten returnerede en ukendt leverancestatus.';
    if (status.status !== 'delivered') return `${status.status === 'awaiting_approval' ? 'Afventer beslutning eller tilladelse' : 'Opgaven er blokeret'}: ${String(status.reason ?? 'Ingen årsag oplyst').slice(0, 2000)}`;
  }
  // Compatibility with older/local agents that do not emit the structured line.
  // Only recognize explicit standalone current-status statements, not mentions
  // of approval inside a specification, historical report or code sample.
  if (/^\s*(?:\*\*)?(?:Afventer (?:din|brugerens) godkendelse(?: af planen)?\.?|Awaiting (?:your|user) approval\.?)(?:\*\*)?\s*$/im.test(prose)) return 'Agenten afventer godkendelse og har ikke udført opgaven. Gennemgå leverancen og præcisér beslutningen før genoptagelse.';
  if (/^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:Status:\s*)?BLOCKED(?:\*\*)?(?:\s*[—:–-].*)?\s*$/im.test(prose)) return 'Agenten har markeret leverancen BLOCKED. Gennemgå årsagen før genoptagelse.';
  return null;
}

export function permissionBlock(event) {
  if (event?.type !== 'result' || !Array.isArray(event.permission_denials) || !event.permission_denials.length) return null;
  const tools = [...new Set(event.permission_denials.map(item => String(item.tool_name ?? 'værktøj').slice(0, 80)))];
  // Tool input can contain credentials; the native action log provides context.
  return `Tjenesten afviste ${event.permission_denials.length} værktøjstilladelse(r): ${tools.join(', ')}. Se de seneste værktøjshændelser. Adgang skal afklares før genoptagelse; opgaven er ikke leveret.`;
}

export function minimumReviewScore(prefs) {
  const value = Number(prefs?.minimumReviewScore ?? 8);
  return Number.isFinite(value) ? Math.min(10, Math.max(1, value)) : 8;
}

export function validateReview(input, { minimumScore = 8, requireFiles = false } = {}) {
  if (!input || typeof input.score !== 'number' || !Number.isFinite(input.score) || input.score < 0 || input.score > 10) throw new Error('Review mangler en gyldig score fra 0 til 10.');
  if (typeof input.note !== 'string' || !input.note.trim()) throw new Error('Review mangler en konkret begrundelse.');
  const examinedFiles = Array.isArray(input.examinedFiles) ? input.examinedFiles.filter(path => typeof path === 'string' && path.trim()).slice(0, 100) : [];
  if (requireFiles && !examinedFiles.length) throw new Error('Reviewer har ikke angivet nogen undersøgte filer. Kodeleverancen er ikke gennemgået.');
  if (input.findings !== undefined && !Array.isArray(input.findings)) throw new Error('Reviewfund skal være en liste.');
  const findings = (input.findings ?? []).slice(0, 100).map(finding => {
    if (!finding || !['critical', 'major', 'minor', 'info'].includes(finding.severity) || typeof finding.message !== 'string' || !finding.message.trim()) throw new Error('Reviewfund mangler alvor eller beskrivelse.');
    return { severity: finding.severity, file: typeof finding.file === 'string' ? finding.file : '', message: finding.message.slice(0, 4000) };
  });
  return { score: input.score, minimumScore, note: input.note.slice(0, 4000), examinedFiles, findings,
    status: input.score >= minimumScore && !findings.some(f => ['critical', 'major'].includes(f.severity)) ? 'passed' : 'blocked' };
}

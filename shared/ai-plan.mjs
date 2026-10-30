export const AI_PHASES = ['concept', 'design', 'prototype', 'production', 'testing', 'polish', 'release'];
const aliases = { koncept: 'concept', produktion: 'production', test: 'testing', polering: 'polish' };
export function normalizePhase(value) {
  const key = String(value ?? 'production').trim().toLowerCase();
  return aliases[key] ?? key;
}

// Removing an unrelated row must preserve dependency identities, not merely
// leave its old array indexes pointing at a different job.
export function removePlanJob(jobs, index) {
  if (!Number.isInteger(index) || index < 0 || index >= jobs.length) throw new Error('Jobbet findes ikke.');
  const dependants = jobs.filter(job => (job.dependsOn ?? []).includes(index));
  if (dependants.length) throw new Error(`Kan ikke fjerne jobbet: ${dependants.map(job => job.title).join(', ')} afhænger af det. Ret afhængighederne først.`);
  return jobs.filter((_, i) => i !== index).map(job => ({ ...job, dependsOn: (job.dependsOn ?? []).map(dependency => dependency > index ? dependency - 1 : dependency) }));
}

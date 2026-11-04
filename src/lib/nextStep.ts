import type { SwarmRun } from './swarm';

export type NextStep = { title: string; detail: string; action: string; target: string };

function reviewableArtifact(url: string | undefined): boolean {
  return Boolean(url && ((url.startsWith('/') && !url.startsWith('//')) || /^https?:\/\//i.test(url)));
}

/** Advice only. The button navigates to existing controls and never dispatches a run. */
export function nextStepForRun(run: SwarmRun, { approval = false, permission = false }: { approval?: boolean; permission?: boolean } = {}): NextStep {
  const artifacts = [...run.jobs.flatMap(job => [...(job.artifacts ?? []), ...(job.media?.artifacts ?? [])]), ...(run.results ?? []).flatMap(result => result.artifacts ?? [])].filter(artifact => reviewableArtifact(artifact.url));
  const hasImage = artifacts.some(artifact => artifact.kind === 'image' || artifact.mime?.toLowerCase().startsWith('image/'));
  if (permission) return { title: 'Agenten afventer din beslutning', detail: 'Læs den konkrete handling og vælg, om den må udføres én gang.', action: 'Se forespørgslen', target: 'orbit-native-permissions' };
  if (approval) return { title: 'Planen afventer dig', detail: 'Gennemgå arbejdsplanen og dens afhængigheder, før du godkender den.', action: 'Se planen', target: 'orbit-plan-approval' };
  if (run.status === 'running') return { title: 'Arbejdet er i gang', detail: 'Følg det aktuelle job. Du kan præcisere målet i samtalen.', action: 'Se aktive jobs', target: 'orbit-job-list' };
  if (run.status === 'awaiting_approval') return run.recoveredAt
    ? { title: 'Genoptag den gemte plan', detail: 'Planen er bevaret efter genstart. Genoptag den, før du træffer beslutning om udførelse.', action: 'Se genoptagelse', target: 'orbit-run-results' }
    : { title: 'Kontrollér planpausen', detail: 'Kørslen afventer godkendelse, men planens godkendelsespanel er ikke tilgængeligt. Kontrollér forbindelsen og kørslens status.', action: 'Se status', target: 'orbit-run-results' };
  if (run.status === 'done') {
    if (['failed', 'interrupted', 'cancelled'].includes(run.verification?.status ?? '')) return { title: 'Afklar fejlede kontroller', detail: 'Læs de faktiske testresultater og beslut, hvad der skal rettes, før leverancen kan godkendes.', action: 'Se kontroller og muligheder', target: 'orbit-run-results' };
    if (hasImage) return { title: 'Gennemse billedresultatet', detail: 'Sammenlign det faktiske resultat med referencerne. Beståede tekniske kontroller er ikke en visuel godkendelse.', action: 'Se billeder', target: 'orbit-run-visual' };
    if (artifacts.length) return { title: 'Gennemse leverancerne', detail: 'Åbn de faktiske filer og kontrollér, om de opfylder målet. Tekniske kontroller erstatter ikke din vurdering.', action: 'Se filer', target: 'orbit-run-visual' };
    return { title: 'Gennemse leverancen', detail: run.verification?.status === 'passed' ? 'De valgte tekniske kontroller bestod. Gennemgå ændringerne og afgør, om resultatet opfylder målet.' : 'Gennemgå leverancen og kontrollernes faktiske resultat, før opgaven godkendes.', action: 'Se leverancen', target: 'orbit-run-results' };
  }
  if (['blocked', 'partial', 'error'].includes(run.status)) return { title: 'Afklar blokeringen', detail: 'Læs fejlen og giv en konkret beslutning, før du eventuelt genoptager det resterende arbejde.', action: 'Se årsag og muligheder', target: 'orbit-run-results' };
  return { title: 'Gennemgå den afbrudte kørsel', detail: 'Kontrollér gemt arbejde og resterende jobs, før du vælger at fortsætte.', action: 'Se kørslens resultat', target: 'orbit-run-results' };
}

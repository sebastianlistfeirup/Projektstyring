import { createHash } from 'node:crypto';

const string = (value, name, max = 6000) => {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Planfeltet ${name} skal være tekst på højst ${max} tegn.`);
  return value.trim();
};
const list = (value, name, max = 20) => {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Planfeltet ${name} skal være en liste med højst ${max} punkter.`);
  return value.map(v => string(v, name));
};

export function validateProjectPlan(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.tasks) || value.tasks.length > 50) throw new Error('Projektforslaget kræver version 1 og højst 50 opgaver.');
  if (JSON.stringify(value).length > 200000) throw new Error('Projektforslaget er for stort.');
  const ids = new Set();
  const tasks = value.tasks.map(t => {
    if (!t || !/^[a-zA-Z0-9_-]{1,80}$/.test(t.id) || ids.has(t.id)) throw new Error('Forslagets opgaver skal have entydige id’er.');
    ids.add(t.id);
    const title = string(t.title, 'titel', 200);
    if (!title) throw new Error('En foreslået opgave mangler titel.');
    if (!['version1', 'later'].includes(t.scope)) throw new Error('Hver opgave skal tilhøre version1 eller later.');
    if (!['urgent', 'high', 'medium', 'low'].includes(t.priority)) throw new Error('En opgave har ugyldig prioritet.');
    const criteria = list(t.acceptanceCriteria, 'acceptkriterier'), verification = list(t.verification, 'kontroller');
    if (!criteria.length || !verification.length) throw new Error('Hver opgave skal have acceptkriterier og konkrete kontroller.');
    return { id: t.id, title, description: string(t.description, 'beskrivelse'), priority: t.priority, scope: t.scope,
      acceptanceCriteria: criteria, verification, evidence: list(t.evidence ?? [], 'kilder'), dependsOn: [...new Set(list(t.dependsOn ?? [], 'afhængigheder', 50))] };
  });
  const visiting = new Set(), visited = new Set(), byId = new Map(tasks.map(t => [t.id, t]));
  const visit = id => {
    if (visited.has(id)) return;
    if (!ids.has(id) || visiting.has(id)) throw new Error('Projektforslaget har manglende eller cirkulære afhængigheder.');
    visiting.add(id); byId.get(id).dependsOn.forEach(visit); visiting.delete(id); visited.add(id);
  };
  tasks.forEach(t => visit(t.id));
  return { version: 1, releaseGoal: string(value.releaseGoal, 'versionsmål'), summary: string(value.summary, 'opsummering'), firstMilestone: string(value.firstMilestone, 'første milepæl'), unknowns: list(value.unknowns ?? [], 'uafklarede forhold'), tasks };
}

export const PROJECT_PLAN_FORMAT = `Afslut med præcis én JSON-kodeblok med dette format (højst 50 opgaver): {"orbitProjectPlan":{"version":1,"releaseGoal":"Forslag til versionsmål","summary":"Hvad er dokumenteret?","firstMilestone":"Første lille, demonstrerbare mål","unknowns":["Uafklarede forhold"],"tasks":[{"id":"save-load","title":"Konkret leverance","description":"Formål, afgrænsning og eksisterende løsning","priority":"high","scope":"version1","acceptanceCriteria":["Observerbar korrekt adfærd"],"verification":["Faktisk kontrol der skal køres"],"evidence":["Filhenvisning eller dokumenteret observation"],"dependsOn":[]}]}}. scope er version1 eller later; dependsOn refererer til opgave-id’er i samme forslag. Opret kun dokumenteret nødvendigt arbejde. En test, som endnu ikke er kørt, er en foreslået kontrol, ikke et bevis. Returnér gerne en tom opgaveliste, hvis ingen ændringer er nødvendige.`;

export function importProjectPlan(snapshot, run, selectedIds, { includeInScope = false } = {}) {
  if (!snapshot || !run.projectId || run.status !== 'done') throw new Error('Kun et færdigt projektforslag kan importeres.');
  const project = snapshot.projects.find(p => p.id === run.projectId);
  if (!project) throw new Error('Projektet findes ikke længere.');
  const plan = validateProjectPlan(run.projectPlan);
  if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.length > 50) throw new Error('Vælg 1–50 opgaver.');
  const selected = new Set(selectedIds), now = new Date().toISOString();
  const known = new Set(plan.tasks.map(t => t.id));
  if ([...selected].some(id => !known.has(id))) throw new Error('En valgt opgave findes ikke i forslaget.');
  const taskId = id => `t-ai-${createHash('sha256').update(`${run.projectId}:${run.runId}:${id}`).digest('hex').slice(0, 20)}`;
  const existing = new Map(snapshot.tasks.filter(t => t.projectId === project.id).map(t => [t.id, t]));
  for (const t of plan.tasks.filter(t => selected.has(t.id))) {
    if (t.dependsOn.some(id => !selected.has(id) && !existing.has(taskId(id)))) throw new Error(`Vælg også forgængerne til “${t.title}”, eller importér dem først.`);
  }
  let number = Math.max(0, ...[...existing.values()].map(t => t.number ?? 0));
  let order = Math.max(0, ...[...existing.values()].filter(t => t.status === 'backlog').map(t => t.order ?? 0));
  const created = plan.tasks.filter(t => selected.has(t.id) && !existing.has(taskId(t.id))).map(t => ({
    id: taskId(t.id), number: ++number, projectId: project.id, sprintId: null, title: t.title,
    description: `${t.description}\n\nAcceptkriterier:\n${t.acceptanceCriteria.map(x => `- ${x}`).join('\n')}\n\nKontroller der skal køres:\n${t.verification.map(x => `- ${x}`).join('\n')}\n\nGrundlag:\n${t.evidence.map(x => `- ${x}`).join('\n')}\n\nForslag fra Orbit-kørsel ${run.runId}.`,
    status: 'backlog', priority: t.priority, assigneeId: null, reporterId: snapshot.workspaceState?.currentUserId ?? snapshot.users?.[0]?.id ?? 'orbit',
    labelIds: [], createdAt: now, updatedAt: now, startDate: null, dueDate: null, estimate: null, subtasks: [], comments: [], order: ++order,
    blockedBy: t.dependsOn.map(taskId), aiProposal: { runId: run.runId, itemId: t.id, scope: t.scope },
  }));
  const scopeIds = plan.tasks.filter(t => selected.has(t.id) && t.scope === 'version1').map(t => taskId(t.id));
  const projects = snapshot.projects.map(p => p.id !== project.id || !includeInScope ? p : {
    ...p, scopeTaskIds: [...new Set([...(p.scopeTaskIds ?? []), ...scopeIds])], scopeCapturedAt: p.scopeCapturedAt ?? now,
    releaseGoal: p.releaseGoal || plan.releaseGoal, updatedAt: now,
  });
  return { snapshot: { ...snapshot, tasks: [...snapshot.tasks, ...created], projects }, createdIds: created.map(t => t.id), existingIds: [...selected].map(taskId).filter(id => existing.has(id)) };
}

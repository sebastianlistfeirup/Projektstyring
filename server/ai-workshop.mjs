import { createHash } from 'node:crypto';

// The old workshop is a source of proposals. Executable work belongs to the
// normal task model so scope, dependencies and server-owned delivery apply.
export function importWorkshopJobs(snapshot, projectId, selectedIds) {
  const project = snapshot?.projects?.find(project => project.id === projectId);
  if (!project) throw new Error('Vælg et eksisterende projekt.');
  if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.length > 100 || selectedIds.some(id => typeof id !== 'string')) throw new Error('Vælg 1–100 jobs.');
  const selected = new Set(selectedIds), jobs = (snapshot.workspaceState?.aiJobs ?? []).filter(job => job.projectId === projectId);
  const byId = new Map(jobs.map(job => [job.id, job]));
  if ([...selected].some(id => !byId.has(id))) throw new Error('Et valgt job findes ikke i projektet.');
  const taskId = id => `t-workshop-${createHash('sha256').update(JSON.stringify([projectId, id])).digest('hex').slice(0, 20)}`;
  const existing = new Map((snapshot.tasks ?? []).filter(task => task.projectId === projectId).map(task => [task.id, task]));
  const visiting = new Set(), visited = new Set();
  const visit = id => {
    if (visiting.has(id)) throw new Error('De valgte jobs har cirkulære afhængigheder. Ret dem før overførsel.');
    if (visited.has(id)) return;
    const job = byId.get(id);
    if (!job) throw new Error('En afhængighed mangler eller tilhører et andet projekt. Ret den før overførsel.');
    if (!selected.has(id) && !existing.has(taskId(id))) throw new Error(`Vælg også forgængeren “${job.title}”, eller overfør den først.`);
    visiting.add(id);
    if (!Array.isArray(job.dependsOn)) throw new Error('Jobbets afhængigheder er ugyldige.');
    job.dependsOn.forEach(visit);
    visiting.delete(id); visited.add(id);
  };
  selected.forEach(visit);
  const now = new Date().toISOString();
  let number = Math.max(0, ...[...existing.values()].map(task => task.number ?? 0));
  let order = Math.max(0, ...[...existing.values()].filter(task => task.status === 'backlog').map(task => task.order ?? 0));
  const created = jobs.filter(job => selected.has(job.id) && !existing.has(taskId(job.id))).map(job => ({
    id: taskId(job.id), number: ++number, projectId, sprintId: null, title: String(job.title || 'Overført AI-job'),
    description: [String(job.description ?? ''), 'Acceptkriterier og konkrete kontroller skal gennemgås før udførelse.',
      `Overført fra AI-værkstedet. Tidligere fase: ${job.phase}; status: ${job.status}; foreslået tjeneste: ${job.agentId ?? 'ikke valgt'}.`,
      job.question ? `Tidligere spørgsmål:\n${job.question}` : '', job.answer ? `Tidligere svar:\n${job.answer}` : '',
      job.result ? `Tidligere output (ikke verificeret af denne overførsel):\n${job.result}` : '',
    ].filter(Boolean).join('\n\n'),
    status: 'backlog', priority: 'medium', assigneeId: null, reporterId: snapshot.workspaceState?.currentUserId ?? snapshot.users?.[0]?.id ?? 'orbit',
    labelIds: [], createdAt: now, updatedAt: now, startDate: null, dueDate: null, estimate: null, subtasks: [], comments: [], order: ++order,
    blockedBy: [...new Set(job.dependsOn)].map(taskId), aiWorkshopSource: { jobId: job.id, importedAt: now },
  }));
  return { snapshot: { ...snapshot, tasks: [...(snapshot.tasks ?? []), ...created] }, createdIds: created.map(task => task.id), existingIds: [...selected].map(taskId).filter(id => existing.has(id)) };
}

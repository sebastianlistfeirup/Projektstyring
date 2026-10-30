import { captureProjectContext } from './project-context.mjs';

export function projectExecution(snapshot, input) {
  if (!input.projectId) {
    if (input.taskId) throw new Error('En arbejdsordre skal tilhøre et projekt.');
    return input;
  }
  const project = snapshot?.projects?.find(p => p.id === input.projectId);
  if (!project) throw new Error('Projektet er ikke gemt på Companion endnu. Gem/synkronisér projektet først.');
  const state = snapshot.workspaceState ?? {};
  const task = input.taskId ? snapshot.tasks?.find(t => t.id === input.taskId && t.projectId === project.id) : null;
  if (input.taskId && !task) throw new Error('Arbejdsordren findes ikke i dette projekt.');
  if (task) {
    if (['done', 'canceled'].includes(task.status)) throw new Error('Vælg en åben arbejdsordre.');
    if (project.scopeTaskIds && !project.scopeTaskIds.includes(task.id)) throw new Error('Arbejdsordren ligger uden for versionens fastlagte scope.');
    if ((task.blockedBy ?? []).some(id => snapshot.tasks.find(t => t.id === id)?.status !== 'done')) throw new Error('En nødvendig forgænger er ikke færdig endnu.');
    const limit = state.rules?.wip?.inprogress;
    const count = snapshot.tasks.filter(t => t.projectId === project.id && t.id !== task.id && t.status === 'inprogress').length;
    if (task.status !== 'inprogress' && Number.isFinite(limit) && count >= limit) throw new Error('Projektets grænse for igangværende arbejde er nået.');
  }
  const context = captureProjectContext(project, task, state, input.bible ?? '');
  return { ...input, ...context, repositoryPath: project.repositoryPath || undefined, checks: project.verificationChecks ?? [],
    goal: [project.releaseGoal ? `Versionsmål: ${project.releaseGoal}` : '', input.goal, task ? `Autoritativ arbejdsordre: ${task.title}\n${task.description ?? ''}` : ''].filter(Boolean).join('\n\n') };
}

// Applied on the server even when no browser is open. A later client push must
// respect the task's updatedAt; completion never bypasses human review.
export function applyRunToWorkspace(snapshot, run, eventType) {
  if (!snapshot || !run.taskId || !['run_start', 'plan', 'run_finished'].includes(eventType)) return null;
  const task = snapshot.tasks.find(t => t.id === run.taskId && t.projectId === run.projectId);
  if (!task) return null;
  const state = snapshot.workspaceState ?? {}, link = state.aiTaskLinks?.[task.id];
  if (eventType !== 'run_start' && link?.runId !== run.runId) return null;
  const now = new Date().toISOString();
  let status = task.status;
  if (!['done', 'canceled'].includes(status)) {
    if (eventType === 'run_start') status = 'inprogress';
    else if (eventType === 'run_finished' && run.status === 'done') {
      const limit = state.rules?.wip?.inreview;
      const count = snapshot.tasks.filter(t => t.projectId === task.projectId && t.id !== task.id && t.status === 'inreview').length;
      if (!Number.isFinite(limit) || count < limit) status = 'inreview';
    }
  }
  const delivery = { runId: run.runId, status: run.status, verification: run.verification?.status ?? 'not_run', commit: run.evidence?.commit, updatedAt: now };
  const tasks = snapshot.tasks.map(t => t.id === task.id ? { ...t, status, aiDelivery: delivery, updatedAt: now } : t);
  return { ...snapshot, tasks, workspaceState: { ...state, tasks, aiTaskLinks: { ...state.aiTaskLinks, [task.id]: { runId: run.runId, goal: run.goal, linkedAt: eventType === 'run_start' ? now : link.linkedAt } } }, workspaceVersions: { ...snapshot.workspaceVersions, aiTaskLinks: now } };
}

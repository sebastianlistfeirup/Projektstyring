import { randomUUID, createHash } from 'node:crypto';

// Pending decisions belong to a live process. Never replay an approval after
// process exit or Companion restart, and never create persistent allow rules.
export class NativePermissions {
  pending = new Map();

  snapshot() { return [...this.pending.values()].map(entry => entry.view); }

  request(request, { signal, onEvent, ...context } = {}) {
    const deny = message => ({ behavior: 'deny', message });
    if (signal?.aborted) return Promise.resolve(deny('Kørslen er stoppet.'));
    if (!request || typeof request.tool_name !== 'string' || !request.input || typeof request.input !== 'object' || Array.isArray(request.input)) return Promise.resolve(deny('Ugyldig værktøjsforespørgsel.'));
    const encoded = JSON.stringify(request.input);
    if (encoded.length > 100000 || this.pending.size >= 32) return Promise.resolve(deny('Forespørgslen overskrider Orbits grænse.'));
    const input = JSON.parse(encoded);
    if (request.tool_name === 'AskUserQuestion' && (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 4 || input.questions.some(q => !q || typeof q.question !== 'string' || !q.question.trim() || (q.options !== undefined && (!Array.isArray(q.options) || q.options.length > 8 || q.options.some(o => !o || typeof o.label !== 'string' || (o.description !== undefined && typeof o.description !== 'string'))))))) return Promise.resolve(deny('Spørgsmålene har et ukendt format. Præcisér opgaven i chatten.'));
    if (context.readOnly && !['Read', 'Grep', 'Glob', 'AskUserQuestion'].includes(request.tool_name)) return Promise.resolve(deny('Denne opgave må kun læse. Start en særskilt arbejdsordre for ændringer eller kommandoer.'));
    const id = randomUUID();
    const view = { id, ...context, toolName: request.tool_name.slice(0, 120), input, requestedAt: Date.now(), reason: String(request.decision_reason ?? request.description ?? '').slice(0, 2000) };
    // The audit contains identity + digest, not potentially secret tool input.
    const audit = { permissionId: id, jobId: context.jobId ?? null, serviceId: context.serviceId, toolName: view.toolName, inputHash: createHash('sha256').update(encoded).digest('hex') };
    return new Promise(resolve => {
      const finish = (result, decision) => {
        if (!this.pending.delete(id)) return;
        signal?.removeEventListener('abort', abort);
        try { onEvent?.({ type: 'permission_resolved', ...audit, decision }); }
        catch { result = deny('Beslutningen kunne ikke gemmes. Handlingen er afvist.'); }
        resolve(result);
      };
      const abort = () => finish(deny('Forespørgslen udløb, fordi agenten stoppede.'), 'cancelled');
      this.pending.set(id, { view, finish });
      signal?.addEventListener('abort', abort, { once: true });
      try { onEvent?.({ type: 'permission_request', ...audit }); }
      catch { finish(deny('Forespørgslen kunne ikke gemmes.'), 'cancelled'); }
      if (signal?.aborted) abort();
    });
  }

  decide(id, body) {
    const entry = this.pending.get(id);
    if (!entry) throw new Error('Forespørgslen er ikke længere aktiv. Opdatér visningen.');
    if (!['allow', 'deny'].includes(body?.decision)) throw new Error('Vælg Tillad eller Afvis.');
    if (body.decision === 'deny') { entry.finish({ behavior: 'deny', message: 'Brugeren afviste handlingen i Orbit.' }, 'denied'); return; }
    let input = entry.view.input;
    if (entry.view.toolName === 'AskUserQuestion') {
      const questions = input.questions;
      if (!Array.isArray(questions) || !questions.length || questions.length > 4) throw new Error('Spørgsmålene har et ukendt format. Afvis og præcisér opgaven i chatten.');
      const answers = body.answers;
      if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).length !== questions.length || questions.some(q => typeof q.question !== 'string' || typeof answers[q.question] !== 'string' || !answers[q.question].trim() || answers[q.question].length > 10000)) throw new Error('Besvar alle spørgsmål før afsendelse.');
      input = { ...input, answers: Object.fromEntries(questions.map(q => [q.question, answers[q.question].trim()])) };
    }
    entry.finish({ behavior: 'allow', updatedInput: input }, 'allowed_once');
  }
}

export const nativePermissions = new NativePermissions();

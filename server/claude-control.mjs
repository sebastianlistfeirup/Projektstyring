import { randomUUID } from 'node:crypto';

// Claude's bidirectional CLI protocol, as used by the official Python SDK.
// Only can_use_tool is implemented. Unknown control requests fail explicitly.
export function claudeControl({ write, end, prompt, onPermission, signal, onFailure }) {
  const initId = randomUUID();
  const requests = new Map(), tasks = new Set();
  let initialized = false, resultSeen = false, sessionState = null, closed = false;
  let initTimer;
  const send = message => { if (!closed) write(JSON.stringify(message) + '\n'); };
  const response = (id, value) => send({ type: 'control_response', response: { subtype: 'success', request_id: id, response: value } });
  const maybeEnd = () => {
    if (resultSeen && !requests.size && !tasks.size && (sessionState === null || sessionState === 'idle') && !closed) { closed = true; end(); }
  };
  const close = () => { closed = true; clearTimeout(initTimer); for (const controller of requests.values()) controller.abort(); requests.clear(); };
  signal?.addEventListener('abort', close, { once: true });
  return {
    start() { initTimer = setTimeout(() => onFailure(new Error('Claude svarede ikke på Orbits godkendelsesforbindelse inden 60 sekunder. Kontrollér CLI-versionen.')), 60000); initTimer.unref(); send({ type: 'control_request', request_id: initId, request: { subtype: 'initialize', hooks: null } }); },
    close() { signal?.removeEventListener('abort', close); close(); },
    event(event) {
      if (event.type === 'control_response') {
        if (event.response?.request_id === initId && !initialized) {
          clearTimeout(initTimer);
          if (event.response.subtype !== 'success') { onFailure(new Error('Claude kunne ikke starte Orbits godkendelsesforbindelse.')); return true; }
          initialized = true;
          send({ type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null, session_id: '' });
        }
        return true;
      }
      if (event.type === 'control_cancel_request') { requests.get(event.request_id)?.abort(); requests.delete(event.request_id); maybeEnd(); return true; }
      if (event.type === 'control_request') {
        if (closed) return true;
        const id = event.request_id, request = event.request;
        if (typeof id !== 'string' || requests.has(id)) { onFailure(new Error('Claude sendte en ugyldig eller gentaget forespørgsel.')); return true; }
        if (request?.subtype !== 'can_use_tool') {
          send({ type: 'control_response', response: { subtype: 'error', request_id: id, error: 'Denne kontroltype understøttes ikke af Orbit.' } }); return true;
        }
        const controller = new AbortController(); requests.set(id, controller);
        const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        Promise.resolve().then(() => onPermission(request, { signal: combined })).then(result => {
          if (!combined.aborted && !closed) response(id, result?.behavior === 'allow' ? { behavior: 'allow', updatedInput: result.updatedInput ?? request.input } : { behavior: 'deny', message: result?.message ?? 'Ikke godkendt i Orbit.' });
        }).catch(() => { if (!combined.aborted && !closed) response(id, { behavior: 'deny', message: 'Orbit kunne ikke behandle forespørgslen.' }); })
          .finally(() => { requests.delete(id); maybeEnd(); });
        return true;
      }
      if (event.type === 'system') {
        if (event.subtype === 'session_state_changed') sessionState = event.state;
        if (event.subtype === 'task_started' && event.task_id && ['local_agent', 'local_workflow'].includes(event.task_type)) tasks.add(event.task_id);
        if (event.subtype === 'task_notification' && ['completed', 'failed', 'stopped'].includes(event.status)) tasks.delete(event.task_id);
        if (event.subtype === 'task_updated' && ['completed', 'failed', 'stopped'].includes(event.patch?.status)) tasks.delete(event.task_id);
      }
      if (event.type === 'result') resultSeen = true;
      if (event.type === 'assistant') resultSeen = false;
      maybeEnd();
      return false;
    },
  };
}

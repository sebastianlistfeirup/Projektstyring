// Batch preview text for the UI only. Status/tool events always flush first,
// so a completed job can never be followed by an older buffered delta.
export function createLiveEventBuffer(deliver, { schedule = setTimeout, cancel = clearTimeout, interval = 100 } = {}) {
  const pending = new Map(); let timer = null;
  const flush = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    const events = [...pending.values()]; pending.clear();
    if (events.length) deliver(events);
  };
  return {
    flush,
    push(event) {
      if (!['job_delta', 'subagent_delta'].includes(event.type)) { flush(); deliver([event]); return; }
      const key = JSON.stringify([event.runId, event.type, event.jobId, event.subId]);
      if (!pending.has(key) && pending.size >= 64) flush();
      const previous = pending.get(key);
      pending.set(key, { ...event, delta: `${previous?.delta ?? ''}${String(event.delta ?? '')}`.slice(-400), deltaCount: (previous?.deltaCount ?? 0) + 1 });
      if (timer === null) timer = schedule(flush, interval);
    },
  };
}

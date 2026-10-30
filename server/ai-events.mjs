// Normalize public tool activity. Internal reasoning and raw tool arguments are
// deliberately not collected. Unknown event types remain forward compatible.
export function agentEvents(provider, { onText, onAction, onSubagent }) {
  const tools = new Map();
  const action = (id, kind, label, status, detail = '') => onAction?.({ id, kind, label: String(label).slice(0, 300), status, detail: String(detail).slice(-3000), at: Date.now() });
  return ev => {
    if (!ev || typeof ev !== 'object') return;
    if (provider === 'codex') {
      if (ev.type === 'turn.failed' || ev.type === 'error') throw new Error(ev.error?.message ?? ev.message ?? 'Codex kunne ikke afslutte turen.');
      const item = ev.item;
      if (!item || !['item.started', 'item.updated', 'item.completed'].includes(ev.type)) return;
      const completed = ev.type === 'item.completed';
      const status = item.status === 'failed' || item.status === 'declined' || item.exit_code > 0 ? 'error' : completed ? 'done' : 'running';
      if (item.type === 'agent_message' && completed) onText?.(String(item.text ?? ''));
      if (item.type === 'command_execution') action(item.id, 'command', item.command, status, completed ? `Exit ${item.exit_code ?? '?'}\n${item.aggregated_output ?? ''}` : '');
      if (item.type === 'file_change') action(item.id, 'files', (item.changes ?? []).map(c => `${c.kind}: ${c.path}`).join('\n'), status);
      if (item.type === 'mcp_tool_call') action(item.id, 'mcp', `${item.server} / ${item.tool}`, status);
      if (item.type === 'web_search') action(item.id, 'search', item.query ?? 'Websøgning', status);
      if (item.type === 'collab_tool_call') {
        for (const id of item.receiver_thread_ids ?? []) onSubagent?.({ phase: completed ? 'done' : 'start', subId: id, name: `Codex · ${item.tool ?? 'underagent'}`, error: status === 'error' ? 'Underagent fejlede' : undefined });
      }
      return;
    }
    if (provider !== 'claude') return;
    if (ev.type === 'result' && ev.is_error) throw new Error(String(ev.result ?? ev.errors?.join('\n') ?? 'Claude kunne ikke afslutte turen.'));
    for (const b of ev.message?.content ?? []) {
      if (ev.type === 'assistant' && b.type === 'text' && b.text) onText?.(b.text);
      if (ev.type === 'assistant' && b.type === 'tool_use') {
        const sub = ['Task', 'Agent'].includes(b.name);
        const label = sub ? b.input?.description ?? 'Underagent' : b.name === 'Bash' ? b.input?.command : b.input?.file_path ?? b.name;
        tools.set(b.id, { sub, label, kind: b.name?.startsWith('mcp__') ? 'mcp' : b.name === 'Bash' ? 'command' : 'tool' });
        if (sub) onSubagent?.({ phase: 'start', subId: b.id, name: String(label).slice(0, 180) });
        else action(b.id, tools.get(b.id).kind, label, 'running');
      }
      if (ev.type === 'user' && b.type === 'tool_result' && tools.has(b.tool_use_id)) {
        const tool = tools.get(b.tool_use_id), error = b.is_error ? 'Værktøjet rapporterede en fejl' : undefined;
        if (tool.sub) onSubagent?.({ phase: 'done', subId: b.tool_use_id, text: error ?? 'Underagent afsluttet', error });
        else action(b.tool_use_id, tool.kind, tool.label, error ? 'error' : 'done', error ?? '');
        tools.delete(b.tool_use_id);
      }
    }
  };
}

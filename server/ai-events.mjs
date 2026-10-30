// Normalize public tool activity. Internal reasoning and raw tool arguments are
// deliberately not collected. Unknown event types remain forward compatible.
export function agentEvents(provider, { onText, onAction, onSubagent }) {
  const tools = new Map();
  const action = (id, kind, label, status, detail = '') => onAction?.({ id, kind, label: String(label).slice(0, 300), status, detail: String(detail).slice(-3000), at: Date.now() });
  const beginTool = (id, name, input = {}, parentSubId) => {
    input = input && typeof input === 'object' ? input : {};
    const sub = ['Task', 'Agent', 'AgentSwarm'].includes(name);
    const command = ['Bash', 'run_shell_command', 'shell'].includes(name);
    const label = sub ? input.description ?? 'Underagent' : command ? input.command ?? name : input.file_path ?? input.path ?? name;
    tools.set(id, { sub, label, kind: name?.startsWith('mcp__') ? 'mcp' : command ? 'command' : 'tool' });
    if (sub) onSubagent?.({ phase: 'start', subId: id, parentSubId: typeof parentSubId === 'string' ? parentSubId : undefined, name: String(label).slice(0, 180) });
    else action(id, tools.get(id).kind, label, 'running');
  };
  const endTool = (id, failed, detail = '') => {
    const tool = tools.get(id);
    if (!tool) return;
    const error = failed ? 'Værktøjet rapporterede en fejl' : undefined;
    if (tool.sub) onSubagent?.({ phase: 'done', subId: id, text: error ?? 'Underagent afsluttet', error });
    else action(id, tool.kind, tool.label, error ? 'error' : 'done', detail || error || '');
    tools.delete(id);
  };
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
        // Completion of spawn_agent means the child was created, not finished.
        for (const id of item.receiver_thread_ids ?? []) {
          const child = item.agents_states?.[id];
          const terminal = ['completed', 'errored', 'shutdown'].includes(child?.status);
          if (!terminal && !['spawn_agent', 'send_input'].includes(item.tool)) continue;
          onSubagent?.({ phase: terminal ? 'done' : 'start', subId: id, parentSubId: item.sender_thread_id, name: `Codex · ${item.tool ?? 'underagent'}`, error: child?.status === 'errored' ? 'Underagent fejlede' : undefined });
        }
      }
      return;
    }
    if (provider === 'gemini') {
      if ((ev.type === 'error' && ev.severity === 'error') || (ev.type === 'result' && ev.status === 'error')) throw new Error(ev.error?.message ?? ev.message ?? 'Gemini kunne ikke afslutte turen.');
      if (ev.type === 'message' && ev.role === 'assistant') onText?.(String(ev.content ?? ''));
      if (ev.type === 'tool_use') beginTool(ev.tool_id, ev.tool_name, ev.parameters);
      if (ev.type === 'tool_result') endTool(ev.tool_id, ev.status === 'error', ev.error?.message ?? '');
      return;
    }
    if (provider === 'kimi') {
      if (ev.type === 'error') throw new Error(ev.message ?? 'Kimi kunne ikke afslutte turen.');
      if (ev.role === 'assistant') {
        if (typeof ev.content === 'string') onText?.(ev.content);
        for (const call of ev.tool_calls ?? []) {
          let input = {};
          try { input = JSON.parse(call.function?.arguments ?? '{}'); } catch { /* partial/unknown arguments */ }
          beginTool(call.id, call.function?.name, input);
        }
      }
      if (ev.role === 'tool') {
        let result;
        try { result = JSON.parse(ev.content); } catch { /* plain text result */ }
        endTool(ev.tool_call_id, result?.isError === true || result?.is_error === true || result?.status === 'error');
      }
      return;
    }
    if (!['claude', 'qwen-code'].includes(provider)) return;
    if (ev.type === 'result' && ev.is_error) throw new Error(String(ev.result ?? ev.errors?.join('\n') ?? 'Agenten kunne ikke afslutte turen.'));
    for (const b of ev.message?.content ?? []) {
      if (ev.type === 'assistant' && b.type === 'text' && b.text) onText?.(b.text);
      if (ev.type === 'assistant' && b.type === 'tool_use') {
        beginTool(b.id, b.name, b.input, ev.parent_tool_use_id);
      }
      if (ev.type === 'user' && b.type === 'tool_result' && tools.has(b.tool_use_id)) {
        endTool(b.tool_use_id, b.is_error);
      }
    }
  };
}

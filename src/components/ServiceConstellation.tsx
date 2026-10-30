import { memo, useMemo, useState } from 'react';
import type { AiServiceInfo } from '../lib/aiApi';
import type { SwarmJob, SwarmRun } from '../lib/swarm';
import { runLabels } from '../lib/runPresentation';
import './ServiceConstellation.css';

const catalog = [
  ['claude', 'Claude Code', '#fbbf24'], ['codex', 'ChatGPT / Codex', '#34d399'], ['gemini', 'Gemini', '#60a5fa'],
  ['grok', 'Grok', '#fb923c'], ['meshy', 'Meshy', '#2dd4bf'], ['heygen', 'HeyGen', '#a78bfa'],
  ['elevenlabs', 'ElevenLabs', '#fb7185'], ['kimi', 'Kimi', '#22d3ee'], ['qwen', 'Qwen', '#cbd5e1'],
] as const;
const family = (id: string | null) => id === 'qwen-code' ? 'qwen' : id;
type Node = { id: string; x: number; y: number; parent: string; name: string; job: SwarmJob; status: string; text: string; working: boolean };

function ServiceConstellation({ run, services, active, live = false, historical = false, selectedId, onSelect }: {
  run: SwarmRun | null; services: Record<string, AiServiceInfo> | null; active: boolean; live?: boolean; historical?: boolean; selectedId?: string; onSelect?: (id: string) => void;
}) {
  const [showInactive, setShowInactive] = useState(false);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedSub, setSelectedSub] = useState<string | null>(null);
  const groups = useMemo(() => catalog.map(([id, name, color], index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / catalog.length;
    const x = 450 + Math.cos(angle) * 330, y = 265 + Math.sin(angle) * 185;
    const calls = live ? (run?.serviceCalls ?? []).filter(call => family(call.serviceId) === id) : [];
    const jobs = run?.jobs.filter(job => family(job.serviceId) === id || calls.some(call => call.jobId === job.id) || job.subagents?.some(sub => family(sub.serviceId ?? job.serviceId) === id)) ?? [];
    const current = jobs.find(job => calls.some(call => call.jobId === job.id)) ?? jobs.find(job => job.status === 'running') ?? jobs.find(job => job.status === 'queued') ?? jobs.at(-1);
    const all = jobs.flatMap(job => (job.subagents ?? []).filter(sub => family(sub.serviceId ?? job.serviceId) === id).map(sub => ({ job, sub, key: `${job.id}:${sub.subId}` })));
    const working = calls.length > 0;
    const isWorking = (item: typeof all[number]) => item.sub.status === 'running' && item.job.status === 'running' && calls.some(call => item.sub.callId ? call.callId === item.sub.callId : call.jobId === item.job.id);
    const candidates = showInactive || historical ? all : all.filter(isWorking);
    // Keep provider positions stable and bound the satellites. Full job details
    // retain all agents, and the omitted count is explicit in the UI.
    const byId = new Map(all.map(item => [item.key, item]));
    const visible: typeof all = [];
    for (const item of [...candidates].sort((a, b) => Number(isWorking(b)) - Number(isWorking(a)))) {
      if (visible.length >= 12) break;
      const chain: typeof all = []; let next: typeof item | undefined = item;
      while (next && chain.length <= 12 && !chain.some(entry => entry.key === next!.key) && !visible.some(entry => entry.key === next!.key)) {
        chain.unshift(next); const parentId: string | undefined = next.sub.parentSubId;
        next = parentId ? byId.get(`${item.job.id}:${parentId}`) : undefined;
      }
      if (visible.length + chain.length <= 12) visible.push(...chain);
    }
    const placed = new Map<string, Node>();
    const locate = (item: typeof all[number], stack = new Set<string>()): Node => {
      const prior = placed.get(item.key); if (prior) return prior;
      const parentItem = visible.find(other => other.job.id === item.job.id && other.sub.subId === item.sub.parentSubId && other.key !== item.key);
      const cycle = stack.has(item.key); const next = new Set(stack); next.add(item.key);
      const parent = parentItem && !cycle && !stack.has(parentItem.key) ? locate(parentItem, next) : null;
      const siblings = visible.filter(other => other.job.id === item.job.id && other.sub.parentSubId === item.sub.parentSubId);
      const spread = (siblings.findIndex(other => other.key === item.key) - (siblings.length - 1) / 2) * 20;
      const distance = parent ? 33 : 66;
      const node = { id: item.key, parent: parent?.id ?? id, x: (parent?.x ?? x) - Math.cos(angle) * distance - Math.sin(angle) * spread,
        y: (parent?.y ?? y) - Math.sin(angle) * distance + Math.cos(angle) * spread, name: item.sub.name, job: item.job, status: item.sub.status, working: isWorking(item), text: isWorking(item) ? 'Agenten arbejder. Løbende output findes i opgavedetaljerne.' : item.sub.status === 'running' ? 'Der er ingen bekræftet liveaktivitet for denne underagent. Se opgavens seneste hændelser.' : item.sub.text };
      placed.set(item.key, node); return node;
    };
    visible.forEach(item => locate(item));
    return { id, name, color, x, y, jobs, current, working, role: calls[0]?.role, nodes: [...placed.values()], omitted: candidates.filter(item => !placed.has(item.key)).length,
      available: Object.values(services ?? {}).some(service => family(service.id) === id && service.available) };
  }), [run?.jobs, run?.serviceCalls, services, live, showInactive, historical]);
  const displayed = groups.filter(group => showInactive || historical || group.working);
  const selected = groups.find(group => group.jobs.some(job => job.id === selectedId)) ?? groups.find(group => group.id === selectedService);
  const child = groups.flatMap(group => group.nodes).find(node => node.id === selectedSub);
  return <div className="orbit-universe" data-animated={active && live ? 'true' : 'false'}>
    <div className="px-4 pt-3 text-xs flex flex-wrap gap-3 items-center">
      <label className="flex items-center gap-2"><input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)} />Vis også inaktive tjenester</label>
      <span className="opacity-60">{historical ? 'Historik · ingen liveaktivitet' : live ? 'Lys viser et igangværende tjenestekald' : run?.status === 'running' ? 'Aktivitet kan ikke bekræftes · afventer frisk status' : 'Ingen aktive tjenester'}</span>
    </div>
    {!displayed.length && <p className="px-4 pt-3 text-xs opacity-60">{live ? 'Ingen AI-tjeneste kaldes lige nu. Orbit kan stadig udføre kontroller eller klargøre næste trin.' : 'Aktive tjenester vises her, når Orbit modtager deres aktivitet.'}</p>}
    <div className="overflow-x-auto" role="region" aria-label="Servicekugler og underagenter" tabIndex={0}>
      <div className="orbit-space">
        <svg viewBox="0 0 900 560" preserveAspectRatio="none" className="orbit-connections" aria-hidden="true">
          <ellipse cx="450" cy="265" rx="330" ry="185" fill="none" stroke="currentColor" strokeOpacity=".06" strokeDasharray="2 8" />
          {displayed.map(group => <g key={group.id} stroke={group.color}>
            <path d={`M450 265 Q${group.x} 265 ${group.x} ${group.y}`} fill="none" strokeOpacity={group.working ? '.45' : '.1'} strokeDasharray="3 7" />
            {group.nodes.map(node => { const parent = group.nodes.find(other => other.id === node.parent) ?? group; return <line key={node.id} data-agent-edge={node.id} data-parent={node.parent} x1={parent.x} y1={parent.y} x2={node.x} y2={node.y} strokeOpacity={node.working ? ".5" : ".12"} />; })}
          </g>)}
        </svg>
        <div className="orbit-hub"><span>O</span><strong>ORBIT</strong><small>{run ? runLabels[run.status] : 'Klar til dit projekt'}</small></div>
        {displayed.map(group => <div key={group.id}>
          <button type="button" data-service-orb={group.id} data-upper={group.y < 265} aria-label={`Service: ${group.name}`} aria-pressed={selected?.id === group.id} className="orbit-service" style={{ left: `${group.x / 9}%`, top: group.y, '--orb-color': group.color } as React.CSSProperties} onClick={() => { setSelectedService(group.id); setSelectedSub(null); if (group.current) onSelect?.(group.current.id); }}>
            <span className="orbit-sphere" data-working={group.working}><i /><b /></span>
            <strong>{group.name}</strong><small>{group.role === 'planning' ? 'Planlægger næste arbejde' : group.role === 'review' ? `Gennemgår: ${group.current?.title ?? 'leverance'}` : group.current ? group.current.title : group.available ? 'Klar · ingen opgave' : 'Ikke tilsluttet'}</small>
            <em>{group.working ? 'Aktiv' : group.current ? `${historical ? 'Registreret: ' : 'Senest: '}${runLabels[group.current.status]}${group.jobs.length > 1 ? ` · ${group.jobs.length} opgaver` : ''}` : ''}{group.omitted ? ` · +${group.omitted} underagenter i opgavedetaljer` : ''}</em>
          </button>
          {group.nodes.map(node => <button type="button" key={node.id} data-subagent-orb={node.id} aria-label={`Underagent: ${node.name}`} title={`${group.name} → ${node.name} · ${runLabels[node.status]}`} className="orbit-satellite" data-working={node.working} data-selected-active={node.working && selectedSub === node.id} aria-pressed={selectedSub === node.id} style={{ left: `${node.x / 9}%`, top: node.y, '--orb-color': node.status === 'error' ? '#fb7185' : group.color } as React.CSSProperties} onClick={() => { setSelectedSub(node.id); setSelectedService(group.id); onSelect?.(node.job.id); }}><span /></button>)}
        </div>)}
      </div>
    </div>
    {child && <div className="px-4 pb-3 text-xs" role="status"><strong>{child.name}</strong> · {child.working ? 'Aktiv' : `Senest registreret: ${runLabels[child.status]}`}<p className="mt-1 opacity-65 whitespace-pre-wrap">{child.text || 'Afventer registreret output fra underagenten.'}</p></div>}
  </div>;
}

// Text deltas do not change the constellation. Keep the compositor's layers
// stable while the separate task detail renders streaming output.
const visualState = (run: SwarmRun | null) => JSON.stringify([run?.runId, run?.status, run?.serviceCalls, run?.jobs.map(job => [job.id, job.serviceId, job.title, job.status,
  job.subagents?.map(agent => [agent.subId, agent.parentSubId, agent.serviceId, agent.callId, agent.name, agent.status])])]);
export default memo(ServiceConstellation, (before, after) => before.active === after.active && before.live === after.live && before.historical === after.historical && before.selectedId === after.selectedId && before.onSelect === after.onSelect && before.services === after.services && visualState(before.run) === visualState(after.run));

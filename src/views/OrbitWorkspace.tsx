import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Columns2, Rows2, MessageSquare, Activity, RotateCcw } from 'lucide-react';
import { AiChatView } from './AiChatView';
import { AiSwarmView } from './AiSwarmView';
import { useStore } from '../store/useStore';
import './orbit-workspace.css';

type Layout = { direction: 'columns' | 'rows'; split: number };
const initial: Layout = { direction: 'columns', split: 48 };
const clamp = (value: number) => Math.max(25, Math.min(75, value));
function readLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem('orbit-workspace-layout') ?? 'null');
    return saved && ['columns', 'rows'].includes(saved.direction) && Number.isFinite(saved.split)
      ? { direction: saved.direction, split: clamp(saved.split) } : initial;
  } catch { return initial; }
}

export default function OrbitWorkspace() {
  const [layout, setLayout] = useState(readLayout);
  const [focus, setFocus] = useState<'both' | 'chat' | 'live'>('both');
  const [dragging, setDragging] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const [search] = useSearchParams();
  const chats = useStore(s => s.aiChats);
  const activeProject = useStore(s => s.activeProjectId);
  const chatId = search.get('chat') ?? sessionStorage.getItem('orbit-active-chat');
  const projectId = chats.find(chat => chat.id === chatId)?.projectId ?? activeProject;
  useEffect(() => {
    try { localStorage.setItem('orbit-workspace-layout', JSON.stringify(layout)); } catch { /* Storage may be unavailable. */ }
  }, [layout]);
  return <div className="orbit-workspace" data-focus={focus} data-direction={layout.direction}>
    <header className="orbit-workspace-toolbar">
      <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-indigo-400" /><strong className="text-sm">Orbit</strong><span className="text-xs opacity-55 hidden sm:inline">Samtale og arbejde · ét sted</span></div>
      <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Arbejdsfladens layout">
        <button className="btn-ghost text-xs" aria-pressed={focus === 'both'} onClick={() => setFocus('both')}>Begge paneler</button>
        <button className="btn-ghost text-xs" aria-label="Fokusér chat" aria-pressed={focus === 'chat'} onClick={() => setFocus('chat')}><MessageSquare size={15} /></button>
        <button className="btn-ghost text-xs" aria-label="Fokusér Orbit Live" aria-pressed={focus === 'live'} onClick={() => setFocus('live')}><Activity size={15} /></button>
        <span className="mx-1 h-4 border-l border-current opacity-20" />
        <button className="btn-ghost text-xs" aria-label="Paneler ved siden af hinanden" aria-pressed={layout.direction === 'columns'} onClick={() => { setLayout(v => ({ ...v, direction: 'columns' })); setFocus('both'); }}><Columns2 size={15} /></button>
        <button className="btn-ghost text-xs" aria-label="Paneler over hinanden" aria-pressed={layout.direction === 'rows'} onClick={() => { setLayout(v => ({ ...v, direction: 'rows' })); setFocus('both'); }}><Rows2 size={15} /></button>
        <button className="btn-ghost text-xs" aria-label="Nulstil panelstørrelser" onClick={() => { setLayout(initial); setFocus('both'); }}><RotateCcw size={14} /></button>
      </div>
    </header>
    <div ref={surface} className="orbit-workspace-panels" data-dragging={dragging} style={layout.direction === 'columns' ? { gridTemplateColumns: `${layout.split}fr 12px ${100 - layout.split}fr` } : { gridTemplateRows: `${layout.split}fr 12px ${100 - layout.split}fr` }}>
      <section id="orbit-chat-pane" aria-label="Chatpanel" className="orbit-workspace-pane orbit-chat-pane">
        <div className="orbit-pane-heading"><MessageSquare size={14} /> Samtale<span>Planlæg · spørg · følg op</span></div>
        <div className="orbit-pane-content"><AiChatView embedded /></div>
      </section>
      <div role="separator" tabIndex={0} aria-label="Tilpas chat og Orbit Live" aria-controls="orbit-chat-pane orbit-live-pane" aria-orientation={layout.direction === 'columns' ? 'vertical' : 'horizontal'} aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(layout.split)} className="orbit-workspace-divider"
        onDoubleClick={() => setLayout(v => ({ ...v, split: 50 }))}
        onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !surface.current) return;
          const bounds = surface.current.getBoundingClientRect();
          const split = layout.direction === 'columns' ? (event.clientX - bounds.left) / bounds.width * 100 : (event.clientY - bounds.top) / bounds.height * 100;
          setLayout(v => ({ ...v, split: clamp(split) }));
        }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); }}
        onLostPointerCapture={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={event => {
          const decrease = layout.direction === 'columns' ? 'ArrowLeft' : 'ArrowUp';
          const increase = layout.direction === 'columns' ? 'ArrowRight' : 'ArrowDown';
          if (![decrease, increase, 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          setLayout(v => ({ ...v, split: event.key === 'Home' ? 25 : event.key === 'End' ? 75 : clamp(v.split + (event.key === decrease ? -2 : 2)) }));
        }}><span /></div>
      <section id="orbit-live-pane" aria-label="Orbit Live" className="orbit-workspace-pane orbit-live-pane">
        <div className="orbit-pane-heading"><Activity size={14} /> Orbit Live<span>Agenter · kontroller · leverancer</span></div>
        <div className="orbit-pane-content"><AiSwarmView embedded projectId={projectId} /></div>
      </section>
    </div>
  </div>;
}

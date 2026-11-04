import { useState } from 'react';
import { ShieldQuestion } from 'lucide-react';
import { useSwarm, type NativePermission } from '../lib/swarm';

function PermissionCard({ request }: { request: NativePermission }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = request.toolName === 'AskUserQuestion' && Array.isArray(request.input.questions) ? request.input.questions as { question: string; options?: { label: string; description?: string }[]; multiSelect?: boolean }[] : [];
  async function decide(decision: 'allow' | 'deny') {
    setBusy(true); setError('');
    try {
      const response = await fetch(`http://127.0.0.1:4310/api/ai/permissions/${encodeURIComponent(request.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, answers }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.reason ?? 'Beslutningen kunne ikke sendes.');
      useSwarm.setState(state => ({ permissions: state.permissions.filter(p => p.id !== request.id) }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Companion svarer ikke.'); }
    finally { setBusy(false); }
  }
  return <article className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 space-y-3">
    <h3 className="font-semibold text-sm">{request.serviceId} · {request.toolName}</h3>
    <p className="text-xs break-all opacity-70">Arbejdsmappe: {request.cwd}</p>
    {request.reason && <p className="text-xs">{request.reason}</p>}
    {questions.length ? questions.slice(0, 4).map((q, index) => <fieldset key={index} className="space-y-2 text-xs"><legend className="font-medium">{String(q.question ?? 'Spørgsmål')}</legend>
      <div className="flex flex-wrap gap-2">{Array.isArray(q.options) && q.options.slice(0, 8).map((option, i) => <button key={i} type="button" className="btn-ghost text-xs" title={option.description} onClick={() => setAnswers(previous => ({ ...previous, [q.question]: q.multiSelect && previous[q.question] ? `${previous[q.question]}, ${option.label}` : option.label }))}>{String(option.label)}</button>)}</div>
      <label className="block">Dit svar<input className="input w-full mt-1" value={answers[q.question] ?? ''} maxLength={10000} onChange={e => setAnswers(previous => ({ ...previous, [q.question]: e.target.value }))} /></label>
    </fieldset>) : <div><p className="text-xs font-medium mb-1">Den konkrete handling</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/10 p-3 text-xs">{JSON.stringify(request.input, null, 2)}</pre></div>}
    <p className="text-xs opacity-65">{questions.length ? 'Svaret sendes til den ventende agent.' : 'Godkendelsen gælder kun denne handling. Der gemmes ingen regel for fremtidige handlinger.'}</p>
    <div className="flex gap-2"><button disabled={busy || (questions.length > 0 && questions.some(q => !answers[q.question]?.trim()))} onClick={() => void decide('allow')} className="btn-primary text-xs">{questions.length ? 'Send svar' : 'Tillad én gang'}</button><button disabled={busy} onClick={() => void decide('deny')} className="btn-ghost text-xs">Afvis</button></div>
    {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
  </article>;
}

export default function NativePermissionPanel() {
  const permissions = useSwarm(s => s.permissions);
  if (!permissions.length) return null;
  return <section id="orbit-native-permissions" aria-label="Afventer din beslutning" className="space-y-3 scroll-mt-4">
    <h2 className="flex gap-2 items-center text-sm font-semibold"><ShieldQuestion size={17} />Agenten afventer dig · {permissions.length}</h2>
    {permissions.map(request => <PermissionCard key={request.id} request={request} />)}
  </section>;
}

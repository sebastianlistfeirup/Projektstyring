import { useRef, useState } from 'react';
import { Send, Square, Volume2, VolumeX } from 'lucide-react';
import { cancelRun, sendRunMessage } from '../lib/aiApi';
import { swarmSoundOn, toggleSwarmSound, type SwarmRun } from '../lib/swarm';
import { t } from '../lib/i18n';

/** A failed request must preserve the user's clarification for retry. */
export default function RunControls({ run }: { run: SwarmRun }) {
  const [message, setMessage] = useState('');
  const [sound, setSound] = useState(swarmSoundOn);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const inFlight = useRef(false);
  async function send() {
    const text = message.trim();
    if (!text || inFlight.current) return;
    inFlight.current = true; setBusy(true); setFeedback('');
    try {
      if (!await sendRunMessage(run.runId, text)) throw new Error('Beskeden kunne ikke bekræftes. Din tekst er bevaret; kontrollér forbindelsen før du prøver igen.');
      setMessage(''); setFeedback('Beskeden er modtaget af Orbit.');
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Beskeden kunne ikke sendes.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function stop() {
    if (!window.confirm(t('swarm.confirmCancel'))) return;
    if (!await cancelRun(run.runId)) setFeedback('Stop kunne ikke bekræftes. Kontrollér forbindelsen og kørslens status.');
  }
  return <section aria-label="Besked til den aktive kørsel" className="rounded-2xl border border-indigo-400/25 bg-indigo-500/[0.06] p-3">
    <div className="flex flex-col sm:flex-row gap-2">
      <input aria-label="Præcisering til Orbit" value={message} disabled={busy} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={t('swarm.messagePlaceholder')} className="input min-w-0 flex-1 text-xs" />
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setSound(toggleSwarmSound())} aria-label={t('swarm.soundToggle')} aria-pressed={sound} className="btn-ghost p-2">{sound ? <Volume2 size={14} /> : <VolumeX size={14} />}</button>
        <button type="button" onClick={() => void send()} disabled={busy || !message.trim()} className="btn-primary text-xs"><Send size={12} />{busy ? 'Sender…' : t('swarm.sendMessage')}</button>
        <button type="button" onClick={() => void stop()} className="btn-ghost text-xs text-rose-600 dark:text-rose-300"><Square size={12} />{t('swarm.cancelRun')}</button>
      </div>
    </div>
    {feedback && <p role="status" className="mt-2 text-xs">{feedback}</p>}
    {!!run.instructions?.length && <details className="mt-3 text-xs"><summary className="cursor-pointer opacity-70">Modtagne præciseringer · {run.instructions.length}</summary><ul className="mt-2 space-y-2">{run.instructions.map((instruction, index) => <li key={index} className="whitespace-pre-wrap break-words">{instruction}</li>)}</ul></details>}
  </section>;
}

import { useState } from 'react';
import { readMediaFeedback, saveMediaFeedback } from '../lib/mediaFeedback';

// Local review notes are deliberately separate from approval of a run/build.
export default function ArtifactFeedback({ runId, artifactId, sha256, name }: { runId: string; artifactId: string; sha256: string; name: string }) {
  const [saved, setSaved] = useState(() => {
    try { return readMediaFeedback(localStorage, runId, artifactId, sha256); } catch { return null; }
  });
  const [note, setNote] = useState(saved?.note ?? '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const save = () => {
    try {
      const record = saveMediaFeedback(localStorage, runId, artifactId, sha256, note);
      setSaved(record); setNote(record?.note ?? ''); setError(''); setMessage(record ? 'Feedback gemt lokalt til denne version.' : 'Den lokale feedback er fjernet.');
    } catch { setError('Feedback kunne ikke gemmes. Kopiér teksten, før du lukker visningen.'); setMessage(''); }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Feedback til ${name}\nKørsel: ${runId}\nVersion: ${artifactId}\nSHA256: ${sha256}\n\n${note}`);
      setMessage('Feedback og versionsreference er kopieret.'); setError('');
    } catch { setError('Udklipsholderen er utilgængelig. Markér og kopiér teksten manuelt.'); }
  };
  return <details className="text-xs border-t border-zinc-200 dark:border-white/10 pt-3">
    <summary className="cursor-pointer font-medium">{saved ? 'Din feedback til denne version' : 'Tilføj feedback til denne version'}</summary>
    <div className="pt-3 space-y-2">
      <label className="block"><span className="block mb-1 opacity-75">Feedback til {name}</span><textarea value={note} onChange={event => { setNote(event.target.value); setMessage(''); }} maxLength={2000} rows={3} className="input w-full resize-y text-xs" placeholder="Hvad skal bevares, og hvad skal ændres?" /></label>
      <p className="opacity-60">Gemmes kun i denne browser. Feedbacken er ikke en godkendelse og starter ikke en ny opgave.</p>
      <div className="flex flex-wrap items-center gap-2"><button type="button" className="btn-secondary text-xs" onClick={save}>Gem feedback</button><button type="button" className="btn-ghost text-xs" disabled={!note.trim()} onClick={() => void copy()}>Kopiér til næste opgave</button><span className="ml-auto opacity-50">{note.length}/2000</span></div>
      {message && <p role="status" className="text-emerald-600 dark:text-emerald-300">{message}</p>}
      {error && <p role="alert" className="text-rose-600 dark:text-rose-300">{error}</p>}
    </div>
  </details>;
}

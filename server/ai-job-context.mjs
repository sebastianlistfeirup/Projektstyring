import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { createHash } from 'node:crypto';

const MAX_FILES = 20, MAX_FILE_BYTES = 1024 * 1024, MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const outside = (root, path) => { const rel = relative(root, path); return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel); };

/** Context is confined to this run's checkout. Missing/oversized files are
 * reported explicitly, never silently replaced with the first 4,000 chars. */
export function loadJobContext(workDir, paths) {
  if (!Array.isArray(paths) || !paths.length) return { messages: [], documents: [] };
  const root = realpathSync(workDir), messages = [], documents = [];
  let total = 0;
  for (const entry of paths.slice(0, MAX_FILES)) {
    const name = String(entry ?? '').trim();
    try {
      if (!name || isAbsolute(name) || win32.isAbsolute(name)) throw new Error('Angiv en relativ filsti i kørselsmappen.');
      const lexical = resolve(root, name);
      if (outside(root, lexical)) throw new Error('Stien ligger uden for kørselsmappen.');
      const path = realpathSync(lexical);
      if (outside(root, path)) throw new Error('Filens link peger uden for kørselsmappen.');
      const stat = statSync(path);
      if (!stat.isFile()) throw new Error('Stien er ikke en almindelig fil.');
      if (stat.size > MAX_FILE_BYTES || total + stat.size > MAX_TOTAL_BYTES) throw new Error('Filen er ikke indsat i prompten på grund af størrelsen. Undersøg relevante afsnit med agentens egne filværktøjer.');
      const bytes = readFileSync(path);
      if (bytes.includes(0)) throw new Error('Binær fil: brug et passende filværktøj.');
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new Error('Filen er ikke UTF-8. Brug et passende filværktøj.'); }
      total += bytes.length;
      documents.push({ path: name, status: 'included', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      messages.push({ role: 'user', text: `Kontekst fra kørselsfilen "${name}" (hele filen, ${bytes.length} bytes):\n${text}` });
    } catch (error) {
      const reason = error.code === 'ENOENT' ? 'Filen findes ikke i kørselsmappen. Kontrollér planen og filnavnet.' : error.message;
      documents.push({ path: name, status: 'unavailable', reason });
      messages.push({ role: 'user', text: `Den udpegede kontekstfil "${name}" er IKKE indlæst: ${reason} Beskriv en reel blokering, hvis materialet er nødvendigt; påstå ikke at have læst det.` });
    }
  }
  if (paths.length > MAX_FILES) messages.push({ role: 'user', text: `${paths.length - MAX_FILES} yderligere kontekstfiler er ikke indsat (maksimum ${MAX_FILES}). Undersøg nødvendige filer med agentens egne værktøjer.` });
  return { messages, documents };
}

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';

export async function extractDocument(path, mime, name) {
  if (/\.pdf$/i.test(name) || mime === 'application/pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true, isEvalSupported: false });
    const doc = await task.promise;
    try {
      if (doc.numPages > 1000) throw new Error('Dokumentet har over 1.000 sider. Opdel det før import.');
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const text = await page.getTextContent();
        pages.push(`[Side ${i}]\n${text.items.map(item => item.str ?? '').join(' ')}`);
      }
      if (!pages.some(p => p.replace(/\[Side \d+\]/, '').trim())) throw new Error('PDF-filen indeholder ingen læsbar tekst. Den kræver OCR eller en tekstudgave.');
      return pages.join('\n\n');
    } finally { await task.destroy(); }
  }
  if (/\.docx$/i.test(name)) {
    const { default: mammoth } = await import('mammoth');
    return (await mammoth.extractRawText({ path })).value;
  }
  if (/\.(md|txt|csv|json|log|yaml|yml)$/i.test(name) || mime.startsWith('text/')) return readFileSync(path, 'utf8');
  return null;
}

// Rehydrate only files owned by Orbit. Browser-supplied absolute paths are not
// trusted. This also restores images after data URLs were omitted from storage.
export function hydrateAttachment(attachment, dirs) {
  const match = /^\/api\/ai\/file\/([^/\\]+)$/.exec(String(attachment.url ?? ''));
  if (!match || match[1] === '.' || match[1] === '..') return { ...attachment, path: undefined };
  for (const base of [dirs.uploads, dirs.artifacts].filter(Boolean)) {
    const path = join(base, match[1]);
    if (!existsSync(path)) continue;
    const rel = relative(realpathSync(base), realpathSync(path));
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Vedhæftningen peger uden for Orbit.');
    const out = { ...attachment, path };
    if (attachment.kind === 'image') out.dataUrl = `data:${attachment.mime};base64,${readFileSync(path).toString('base64')}`;
    if (existsSync(`${path}.text.txt`)) {
      const textRelative = relative(realpathSync(base), realpathSync(`${path}.text.txt`));
      if (textRelative.startsWith('..') || isAbsolute(textRelative)) throw new Error('Dokumentteksten peger uden for Orbit.');
      out.extractedText = readFileSync(`${path}.text.txt`, 'utf8');
    }
    return out;
  }
  throw new Error(`Vedhæftningen findes ikke længere: ${attachment.name}`);
}


export function validateAttachmentList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 10 || value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('Vedhæft højst 10 filer pr. kørsel. Ingen filer er udeladt automatisk.');
  return value;
}

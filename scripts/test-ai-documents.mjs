import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { extractDocument, hydrateAttachment } from '../server/ai-documents.mjs';

test('DOCX text is extracted without running macros or rendering document HTML', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-docx-'));
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Realmread rule: preserve company identity.</w:t></w:r></w:p></w:body></w:document>');
  const path = join(root, 'bible.docx'); writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
  assert.match(await extractDocument(path, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'bible.docx'), /preserve company identity/);
});

test('PDF text retains page references', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-pdf-'));
  const stream = 'BT /F1 12 Tf 20 100 Td (Realmread save load rule) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  const path = join(root, 'bible.pdf'); writeFileSync(path, pdf);
  const text = await extractDocument(path, 'application/pdf', 'bible.pdf');
  assert.match(text, /\[Side 1\]/); assert.match(text, /Realmread save load rule/);
});

test('stored images and extracted text are rehydrated and client file paths ignored', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-images-')), uploads = join(root, 'uploads'); mkdirSync(uploads);
  writeFileSync(join(uploads, 'shot.png'), Buffer.from([1, 2, 3]));
  const image = hydrateAttachment({ url: '/api/ai/file/shot.png', name: 'shot.png', path: '/not/trusted', kind: 'image', mime: 'image/png' }, { uploads });
  assert.equal(image.path, join(uploads, 'shot.png'));
  assert.equal(image.dataUrl, 'data:image/png;base64,AQID');
  assert.equal(hydrateAttachment({ path: '/private', url: '/api/ai/file/../../private' }, { uploads }).path, undefined);
});

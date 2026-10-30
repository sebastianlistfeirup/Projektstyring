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

test('attachment limits reject the entire oversized request rather than discarding files', async () => {
  const { validateAttachmentList } = await import('../server/ai-documents.mjs');
  assert.equal(validateAttachmentList(Array.from({ length: 10 }, (_, id) => ({ id }))).length, 10);
  assert.throws(() => validateAttachmentList(Array.from({ length: 11 }, (_, id) => ({ id }))), /Ingen filer er udeladt/);
  assert.throws(() => validateAttachmentList([null]), /10 filer/);
});

test('Ollama receives actual images only for a verified vision profile and renamed cloud models remain gated', async t => {
  const { runChat, setSecretsDir } = await import('../server/ai-services.mjs');
  const root = mkdtempSync(join(tmpdir(), 'orbit-vision-')); setSecretsDir(root);
  const nativeFetch = globalThis.fetch; t.after(() => { globalThis.fetch = nativeFetch; });
  const image = { kind: 'image', name: 'shot.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AQID' };
  let profile = { capabilities: ['completion', 'vision'] }, chatCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'qwen-local' }] }));
    if (String(url).endsWith('/api/show')) return new Response(JSON.stringify(profile));
    if (String(url).endsWith('/api/chat')) {
      chatCalls++; const payload = JSON.parse(options.body);
      assert.deepEqual(payload.messages[1].images, ['AQID']); assert.equal(payload.messages[0].role, 'system');
      return new Response('{"message":{"content":"Actual image received"}}\n');
    }
    throw new Error('Unexpected network request');
  };
  const input = { serviceId: 'qwen', cfg: { aiProviders: { qwen: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen-local' } } }, dirs: { cwd: root }, messages: [{ role: 'system', text: 'Inspect actual input' }, { role: 'user', text: 'What failed?', attachments: [image] }] };
  assert.equal(await runChat(input), 'Actual image received'); assert.equal(chatCalls, 1);
  profile = { capabilities: ['completion'] };
  await assert.rejects(runChat(input), /bekræfter ikke billedstøtte/); assert.equal(chatCalls, 1);
  profile = { capabilities: ['completion', 'vision'], remote_host: 'https://cloud.example' };
  await assert.rejects(runChat(input), /abonnement|bekræft|ekstra|forbrug/i); assert.equal(chatCalls, 1);
});

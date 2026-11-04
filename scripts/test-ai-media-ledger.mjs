import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { produceMedia, setSecretsDir } from '../server/ai-services.mjs';
import { archivedArtifactPath } from '../server/ai-artifacts.mjs';

const cfg = { aiProviders: { meshy: { apiKey: 'test-only', billingMode: 'included', noExtraCharges: true } } };
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-media-ledger-'));
  const dirs = { runs: join(root, 'runs'), artifacts: join(root, 'artifacts') };
  mkdirSync(dirs.runs); mkdirSync(dirs.artifacts); setSecretsDir(root);
  return { root, dirs, context: { runId: 'first-run', operationNamespace: join(root, 'original-delivery') } };
};

test('unknown external submission cannot be repeated even after job checkpoint is lost', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const { dirs, context } = setup(); let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('connection lost after submit'); };
  const job = { id: 'mesh', serviceId: 'meshy', description: 'A cube' };
  await assert.rejects(produceMedia(job, '', cfg, dirs, () => {}, undefined, context), /connection lost/);
  await assert.rejects(produceMedia(job, '', cfg, dirs, () => {}, undefined, { ...context, runId: 'resumed-run' }), /genbestiller ikke automatisk/);
  assert.equal(calls, 1);
});

test('durable provider receipt survives failed job checkpoint and completed delivery is reused', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const { dirs, context } = setup(); const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options?.method ?? 'GET']);
    if (options?.method === 'POST') return Response.json({ result: 'remote-ledger' });
    if (url.endsWith('/remote-ledger')) return Response.json({ status: 'SUCCEEDED', model_urls: { glb: 'https://assets.example/model.glb' } });
    return new Response(Buffer.from('glTFfixture-ledger'));
  };
  const job = { id: 'mesh', serviceId: 'meshy', description: 'A cube' };
  await assert.rejects(produceMedia(job, '', cfg, dirs, event => { if (event.media?.remoteId) throw new Error('checkpoint unavailable'); }, undefined, context), /checkpoint unavailable/);
  assert.equal(calls.length, 1);
  const artifacts = await produceMedia(job, '', cfg, dirs, () => {}, undefined, { ...context, runId: 'resumed-run' });
  assert.equal(calls.filter(([, method]) => method === 'POST').length, 1);
  assert.match(artifacts[0].url, /^\/api\/ai\/runs\/resumed-run\/artifacts\/[a-f0-9]{64}$/);
  const archived = await archivedArtifactPath(dirs.artifacts, 'resumed-run', artifacts[0].artifactId);
  assert.equal(readFileSync(archived.path).toString(), 'glTFfixture-ledger');
  assert.equal(archived.metadata.remoteId, 'remote-ledger');
  const previousCount = calls.length;
  const replayed = await produceMedia(job, '', cfg, dirs, () => {}, undefined, { ...context, runId: 'third-run' });
  assert.deepEqual(replayed, artifacts);
  assert.equal(calls.length, previousCount);
  await assert.rejects(produceMedia({ ...job, description: 'A changed order' }, '', cfg, dirs, () => {}, undefined, context), /grundlag er ændret/);
  assert.equal(calls.length, previousCount);
  writeFileSync(archived.path, 'changed bytes');
  await assert.rejects(produceMedia(job, '', cfg, dirs, () => {}, undefined, { ...context, runId: 'fourth-run' }), /ikke verificeres i arkivet/);
  assert.equal(calls.length, previousCount);
});

test('HeyGen checks polling HTTP errors and unknown status without repeating submission or leaking keys', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const { dirs } = setup();
  const heygenCfg = { aiProviders: { heygen: { apiKey: 'private-fixture', avatarId: 'avatar', voiceId: 'voice', billingMode: 'included', noExtraCharges: true } } };
  const job = { id: 'video', serviceId: 'heygen', description: 'Hello', media: { state: 'processing', remoteId: 'saved-video' } };
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('invalid private-fixture', { status: 401 }); };
  await assert.rejects(produceMedia(job, '', heygenCfg, dirs, () => {}), error => { assert.match(error.message, /HeyGen fejl 401/); assert.doesNotMatch(error.message, /private-fixture/); return true; });
  assert.equal(calls, 1);
  globalThis.fetch = async () => { calls++; return Response.json({ data: { status: 'unexpected' } }); };
  await assert.rejects(produceMedia(job, '', heygenCfg, dirs, () => {}), /ukendt jobstatus/);
  assert.equal(calls, 2);
});

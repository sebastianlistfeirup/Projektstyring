import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { produceMedia, setSecretsDir } from '../server/ai-services.mjs';

const root = mkdtempSync(join(tmpdir(), 'orbit-media-'));
setSecretsDir(root);
const cfg = { aiProviders: { meshy: { apiKey: 'test', billingMode: 'included', noExtraCharges: true } } };
const dirs = { artifacts: root };
const nativeFetch = globalThis.fetch;

test('media job uses production endpoint, checkpoints receipt and stores validated file', async t => {
  t.after(() => { globalThis.fetch = nativeFetch; });
  const requests = [], events = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, method: options?.method ?? 'GET' });
    if (url.endsWith('/text-to-3d')) return Response.json({ result: 'remote-123' });
    if (url.endsWith('/remote-123')) return Response.json({ status: 'SUCCEEDED', model_urls: { glb: 'https://assets.example/model.glb' } });
    return new Response(Buffer.from('glTFfakefixture'));
  };
  const artifacts = await produceMedia({ id: 'model', serviceId: 'meshy', description: 'A model' }, '', cfg, dirs, e => events.push(e));
  assert.equal(requests.filter(r => r.method === 'POST').length, 1);
  assert.ok(!requests.some(r => r.url.includes('chat/completions')));
  assert.equal(events[0].media.state, 'submitting');
  assert.equal(events.find(e => e.media?.remoteId)?.media.remoteId, 'remote-123');
  assert.equal(events.at(-1).media.state, 'completed');
  assert.equal(readFileSync(join(root, artifacts[0].url.split('/').at(-1))).subarray(0, 4).toString(), 'glTF');
});

test('resume polls the saved provider job without submitting again', async t => {
  t.after(() => { globalThis.fetch = nativeFetch; });
  let submissions = 0;
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'POST') submissions++;
    return url.endsWith('/remote-123') ? Response.json({ status: 'SUCCEEDED', model_urls: { glb: 'https://assets.example/model.glb' } }) : new Response(Buffer.from('glTFfixture'));
  };
  await produceMedia({ id: 'model', serviceId: 'meshy', description: 'A model', media: { state: 'processing', remoteId: 'remote-123' } }, '', cfg, dirs, () => {});
  assert.equal(submissions, 0);
});

test('unknown submission outcome blocks replay instead of spending credits twice', async t => {
  t.after(() => { globalThis.fetch = nativeFetch; });
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('must not call'); };
  await assert.rejects(produceMedia({ id: 'model', serviceId: 'meshy', media: { state: 'submitting' } }, '', cfg, dirs, () => {}), /genbestiller ikke automatisk/);
  assert.equal(calls, 0);
});

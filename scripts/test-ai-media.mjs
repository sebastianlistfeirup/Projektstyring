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
  assert.deepEqual(requests.slice(0, 2), [
    { url: 'https://api.meshy.ai/openapi/v2/text-to-3d', method: 'POST' },
    { url: 'https://api.meshy.ai/openapi/v2/text-to-3d/remote-123', method: 'GET' },
  ]);
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

test('Meshy status HTTP errors stop immediately and retain the receipt without resubmission', async t => {
  t.after(() => { globalThis.fetch = nativeFetch; });
  const requests = [], events = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, method: options?.method ?? 'GET' });
    if (options?.method === 'POST') return Response.json({ result: 'saved-task' });
    return Response.json({ message: 'quota unavailable' }, { status: 429 });
  };
  await assert.rejects(produceMedia({ id: 'model', serviceId: 'meshy', description: 'A model' }, '', cfg, dirs, e => events.push(e)), /Meshy fejl 429:.*quota unavailable/);
  assert.equal(requests.length, 2);
  assert.equal(events.at(-1).media.remoteId, 'saved-task');
  assert.equal(events.at(-1).media.state, 'processing');
});

test('Meshy canceled and malformed completed jobs do not poll indefinitely or download undefined', async t => {
  t.after(() => { globalThis.fetch = nativeFetch; });
  for (const [status, message] of [['CANCELED', /stoppede \(CANCELED\)/], ['SUCCEEDED', /ingen GLB-downloadadresse/]]) {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ status }); };
    await assert.rejects(produceMedia({ id: 'model', serviceId: 'meshy', media: { state: 'processing', remoteId: 'saved-task' } }, '', cfg, dirs, () => {}), message);
    assert.equal(calls, 1);
  }
});

test('ElevenLabs explains a key ID mistaken for a secret without echoing credentials or retrying', async t => {
  t.after(() => { globalThis.fetch = nativeFetch; });
  let calls = 0;
  const secret = 'private-fixture-value';
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=mp3_44100_128');
    assert.equal(options.headers['xi-api-key'], secret);
    return Response.json({ detail: { code: 'invalid_api_key', message: `API key ID used as API key: ${secret}` } }, { status: 400 });
  };
  await assert.rejects(produceMedia({ id: 'voice', serviceId: 'elevenlabs', description: 'Hello' }, '', { aiProviders: { elevenlabs: { apiKey: secret, billingMode: 'included', noExtraCharges: true } } }, dirs, () => {}), error => {
    assert.match(error.message, /hemmelige API-nøgle/);
    assert.match(error.message, /ikke nøglens ID/);
    assert.ok(!error.message.includes(secret));
    return true;
  });
  assert.equal(calls, 1);
});

test('media HTTP diagnostics redact keys returned by providers', async t => {
  t.after(() => { globalThis.fetch = nativeFetch; });
  globalThis.fetch = async () => new Response('invalid credential: test', { status: 401 });
  await assert.rejects(produceMedia({ id: 'model', serviceId: 'meshy' }, '', cfg, dirs, () => {}), /Meshy fejl 401: invalid credential: \[skjult\]/);
});

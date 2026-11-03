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

test('Meshy preview becomes visible while the job is processing and remains with the GLB', async t => {
  t.after(() => { globalThis.fetch = nativeFetch; });
  const events = [];
  globalThis.fetch = async url => {
    if (url.endsWith('/remote-preview')) return Response.json({ status: 'SUCCEEDED', progress: 100, thumbnail_url: 'https://assets.example/preview.png', model_urls: { glb: 'https://assets.example/model.glb' } });
    if (url.endsWith('/preview.png')) return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
    return new Response(Buffer.from('glTFfixture'));
  };
  const artifacts = await produceMedia({ id: 'model', serviceId: 'meshy', description: 'A model', media: { state: 'processing', remoteId: 'remote-preview' } }, '', cfg, dirs, event => events.push(event));
  assert.deepEqual(artifacts.map(artifact => artifact.mime), ['model/gltf-binary', 'image/png']);
  assert.equal(events.find(event => event.media?.artifacts?.[0]?.mime === 'image/png')?.media.state, 'processing');
  assert.ok(events.some(event => event.status === 'Meshy: SUCCEEDED · 100%'));
  assert.deepEqual(events.at(-1).media.artifacts, artifacts);
  assert.equal(readFileSync(join(root, artifacts[1].url.split('/').at(-1))).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
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

test('ElevenLabs saves an MP3-signature response with progress and rejects a non-MP3 success body', async t => {
  t.after(() => { globalThis.fetch = nativeFetch; });
  const events = [];
  globalThis.fetch = async () => new Response(Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00'));
  const voiceCfg = { aiProviders: { elevenlabs: { apiKey: 'voice-test', billingMode: 'included', noExtraCharges: true } } };
  const artifacts = await produceMedia({ id: 'voice-ok', serviceId: 'elevenlabs', description: 'Hallo' }, '', voiceCfg, dirs, event => events.push(event));
  assert.equal(artifacts[0].mime, 'audio/mpeg');
  assert.equal(readFileSync(join(root, artifacts[0].url.split('/').at(-1))).subarray(0, 3).toString(), 'ID3');
  assert.ok(events.some(event => event.status === 'ElevenLabs: lyd genereres'));
  assert.equal(events.at(-1).media.state, 'completed');
  globalThis.fetch = async () => new Response('<html>temporary gateway error</html>');
  await assert.rejects(produceMedia({ id: 'voice-bad', serviceId: 'elevenlabs', description: 'Hallo' }, '', voiceCfg, dirs, () => {}), /ikke en gyldig MP3-fil/);
});

test('media HTTP diagnostics redact keys returned by providers', async t => {
  t.after(() => { globalThis.fetch = nativeFetch; });
  globalThis.fetch = async () => new Response('invalid credential: test', { status: 401 });
  await assert.rejects(produceMedia({ id: 'model', serviceId: 'meshy' }, '', cfg, dirs, () => {}), /Meshy fejl 401: invalid credential: \[skjult\]/);
});

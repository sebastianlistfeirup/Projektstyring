import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLines, readProviderSse } from '../server/ai-stream.mjs';

function fragmented(text) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
    controller.close();
  } }));
}

test('provider stream retains split UTF-8 and ignores DONE marker', async () => {
  const data = [];
  await readProviderSse(fragmented('data: {"text":"blåbær 🪐"}\r\n\ndata: [DONE]\n'), line => data.push(JSON.parse(line)));
  assert.deepEqual(data, [{ text: 'blåbær 🪐' }]);
});

test('Ollama-style JSON lines retain incomplete chunks and final line', async () => {
  const data = [];
  await readLines(fragmented('{"message":{"content":"første"}}\n{"message":{"content":"sidste"}}'), line => data.push(JSON.parse(line).message.content));
  assert.deepEqual(data, ['første', 'sidste']);
});

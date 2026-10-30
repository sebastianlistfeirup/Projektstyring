export async function readLines(response, onLine) {
  if (!response.body) throw new Error('Tjenesten returnerede ingen datastrøm.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      for (const line of lines) await onLine(line.replace(/\r$/, ''));
      if (done) { if (buffer) await onLine(buffer); break; }
    }
  } finally { reader.releaseLock(); }
}

export async function readProviderSse(response, onData) {
  await readLines(response, line => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (data && data !== '[DONE]') onData(data);
  });
}

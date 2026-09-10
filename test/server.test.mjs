import assert from 'node:assert/strict';
import test from 'node:test';

import { createProxyServer } from '../src/server.mjs';

const completion = {
  id: 'chatcmpl_test',
  object: 'chat.completion',
  created: 1,
  model: 'sonnet',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Hello' } }],
  usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
};

async function startServer(overrides = {}) {
  const service = overrides.service ?? { complete: async () => completion };
  const config = {
    apiKey: '',
    host: '127.0.0.1',
    maxBodyBytes: 1024,
    model: 'sonnet',
    ...overrides.config,
  };
  const server = createProxyServer({ config, service, claudeVersion: '2.1.260' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}` };
}

test('health reports the verified Claude CLI version', async (t) => {
  const { server, url } = await startServer();
  t.after(() => server.close());

  const response = await fetch(`${url}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    model: 'sonnet',
    claude_cli_version: '2.1.260',
    authentication: 'unchecked',
  });
});

test('chat completions returns an OpenAI response', async (t) => {
  const { server, url } = await startServer();
  t.after(() => server.close());

  const response = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sonnet', messages: [{ role: 'user', content: 'Hi' }] }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), completion);
});

test('configured bearer authentication is enforced', async (t) => {
  const { server, url } = await startServer({ config: { apiKey: 'secret' } });
  t.after(() => server.close());

  const response = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.type, 'authentication_error');
});

test('configured bearer authentication also protects model discovery', async (t) => {
  const { server, url } = await startServer({ config: { apiKey: 'secret' } });
  t.after(() => server.close());

  const response = await fetch(`${url}/v1/models`);

  assert.equal(response.status, 401);
});

test('oversized request bodies return an OpenAI error', async (t) => {
  const { server, url } = await startServer({ config: { maxBodyBytes: 10 } });
  t.after(() => server.close());

  const response = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'too large' }] }),
  });

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'request_too_large');
});

test('streaming uses Chat Completions SSE framing', async (t) => {
  const { server, url } = await startServer();
  t.after(() => server.close());

  const response = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stream: true, model: 'sonnet', messages: [{ role: 'user', content: 'Hi' }] }),
  });
  const body = await response.text();

  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.match(body, /"object":"chat.completion.chunk"/);
  assert.match(body, /data: \[DONE\]/);
});

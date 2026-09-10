import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createClaudeRunner, getClaudeVersion } from '../src/claude-cli.mjs';
import { createCompletionService } from '../src/service.mjs';
import { createProxyServer } from '../src/server.mjs';

const claudePath = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const config = {
  apiKey: '',
  claudePath,
  host: '127.0.0.1',
  maxBodyBytes: 100_000,
  maxConcurrent: 2,
  maxSessions: 8,
  model: 'sonnet',
  sessionTtlMs: 60_000,
  timeoutMs: 2_000,
};

async function startIntegrationServer(t) {
  const runner = createClaudeRunner(config);
  const service = createCompletionService({ config, runner });
  const claudeVersion = await getClaudeVersion(claudePath);
  const server = createProxyServer({ claudeVersion, config, service });
  await new Promise((resolve) => server.listen(0, config.host, resolve));
  t.after(() => { runner.close(); server.close(); });
  return `http://${config.host}:${server.address().port}`;
}

test('HTTP request reaches the Claude process and returns text', async (t) => {
  const url = await startIntegrationServer(t);

  const response = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'sonnet', messages: [{ role: 'user', content: 'Say hello' }] }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.choices[0].message.content, 'Hello from Claude');
  assert.deepEqual(body.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
});

test('HTTP request reaches the Claude process and returns a tool call', async (t) => {
  const url = await startIntegrationServer(t);

  const response = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'sonnet',
      messages: [{ role: 'user', content: 'Call a tool' }],
      tools: [{
        type: 'function',
        function: { name: 'get_weather', parameters: { type: 'object' } },
      }],
      tool_choice: 'required',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.choices[0].finish_reason, 'tool_calls');
  assert.equal(body.choices[0].message.tool_calls[0].function.name, 'get_weather');
});

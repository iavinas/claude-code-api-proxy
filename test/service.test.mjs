import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeCliError } from '../src/claude-cli.mjs';
import { OpenAIError } from '../src/errors.mjs';
import { createCompletionService } from '../src/service.mjs';

const config = {
  maxConcurrent: 2,
  maxSessions: 8,
  model: 'sonnet',
  sessionTtlMs: 60_000,
};

const output = { kind: 'message', content: 'Hello', tool_calls: [] };

test('service maps Claude authentication failures to a safe API error', async () => {
  const runner = { run: async () => { throw new ClaudeCliError('private detail', 'authentication_error'); } };
  const service = createCompletionService({ config, runner });

  await assert.rejects(
    service.complete({ messages: [{ role: 'user', content: 'Hello' }] }),
    (error) => error instanceof OpenAIError
      && error.status === 503
      && error.code === 'claude_authentication_required'
      && !error.message.includes('private detail'),
  );
});

test('service retries a stale resumed session once from cold history', async () => {
  const calls = [];
  const runner = {
    async run(request) {
      calls.push(request);
      if (request.session?.resume) throw new ClaudeCliError('stale session', 'session_error');
      return { session_id: request.session?.id, structured_output: output, usage: {} };
    },
  };
  const service = createCompletionService({ config, runner });
  const first = [{ role: 'user', content: 'Hello' }];
  const second = [...first, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Again' }];

  await service.complete({ messages: first }, { sessionKey: 'private-session' });
  const completion = await service.complete({ messages: second }, { sessionKey: 'private-session' });

  assert.equal(completion.choices[0].message.content, 'Hello');
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).session.resume, false);
  assert.match(calls.at(-1).prompt, /Again/);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeCliError } from '../src/claude-cli.mjs';
import { OpenAIError } from '../src/errors.mjs';
import { createCompletionService } from '../src/service.mjs';
import { createSessionStore } from '../src/session-store.mjs';

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

test('service automatically resumes a follow-up with only its delta', async () => {
  const calls = [];
  const runner = {
    async run(request) {
      calls.push(request);
      return { session_id: request.session?.id, structured_output: output, usage: {} };
    },
  };
  const service = createCompletionService({ config, runner });
  const first = [{ role: 'user', content: 'Hello' }];
  const second = [...first, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Again' }];

  await service.complete({ messages: first });
  const completion = await service.complete({ messages: second });

  assert.equal(completion.choices[0].message.content, 'Hello');
  assert.equal(calls.length, 2);
  assert.equal(calls.at(-1).session.resume, true);
  assert.doesNotMatch(calls.at(-1).prompt, /"content": "Hello"/);
  assert.match(calls.at(-1).prompt, /Again/);
});

test('service retries a failed resume cold with a fresh session ID', async () => {
  const ids = ['cold-one', 'cold-two'];
  const calls = [];
  const turns = [];
  const runner = {
    async run(request) {
      calls.push(request);
      if (request.session?.resume) throw new ClaudeCliError('resume crashed', 'cli_error');
      return { session_id: request.session?.id, structured_output: output, usage: {} };
    },
  };
  const sessions = createSessionStore({ createId: () => ids.shift() });
  const service = createCompletionService({ config, onTurn: (turn) => turns.push(turn), runner, sessions });
  const first = [{ role: 'user', content: 'Hello' }];
  const second = [...first, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Again' }];

  await service.complete({ messages: first });
  await service.complete({ messages: second });

  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).session.resume, false);
  assert.equal(calls.at(-1).session.id, 'cold-two');
  assert.notEqual(calls.at(-1).session.id, calls[0].session.id);
  assert.match(calls.at(-1).prompt, /Again/);
  assert.equal(turns.at(-1).mode, 'cold-fallback');
});

test('different models do not share an automatic session', async () => {
  const calls = [];
  const runner = {
    async run(request) {
      calls.push(request);
      return { session_id: request.session.id, structured_output: output, usage: {} };
    },
  };
  const service = createCompletionService({ config, runner });
  const first = [{ role: 'user', content: 'Hello' }];
  const second = [...first, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Again' }];

  await service.complete({ model: 'sonnet', messages: first });
  await service.complete({ model: 'opus', messages: second });

  assert.equal(calls.at(-1).session.resume, false);
});

test('service passes the request system message to Claude Code', async () => {
  const calls = [];
  const runner = {
    async run(request) {
      calls.push(request);
      return { session_id: request.session.id, structured_output: output, usage: {} };
    },
  };
  const service = createCompletionService({ config, runner });

  await service.complete({ messages: [
    { role: 'system', content: 'Always start answers with Weather demo:' },
    { role: 'user', content: 'Hello' },
  ] });

  assert.equal(calls[0].systemPrompt, 'Always start answers with Weather demo:');
});

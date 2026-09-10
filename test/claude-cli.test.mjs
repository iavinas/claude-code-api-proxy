import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildClaudeArgs,
  ClaudeCliError,
  createClaudeRunner,
  parseClaudeEnvelope,
} from '../src/claude-cli.mjs';

const schema = { type: 'object', properties: {}, additionalProperties: false };

test('buildClaudeArgs disables agent capabilities for stateless calls', () => {
  const args = buildClaudeArgs({ model: 'sonnet', schema });

  assert.ok(args.includes('--safe-mode'));
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(args.includes('--no-session-persistence'));
  assert.deepEqual(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2), ['--tools', '']);
});

test('buildClaudeArgs resumes an explicit session', () => {
  const args = buildClaudeArgs({
    model: 'opus',
    schema,
    session: { id: '00000000-0000-4000-8000-000000000001', resume: true },
  });

  assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2), [
    '--resume',
    '00000000-0000-4000-8000-000000000001',
  ]);
  assert.equal(args.includes('--no-session-persistence'), false);
});

test('parseClaudeEnvelope reads structured output', () => {
  const envelope = parseClaudeEnvelope(JSON.stringify({
    is_error: false,
    session_id: 'abc',
    structured_output: { kind: 'message', content: 'Hello', tool_calls: [] },
  }), '', 0);

  assert.equal(envelope.structured_output.content, 'Hello');
});

test('parseClaudeEnvelope classifies missing authentication', () => {
  assert.throws(
    () => parseClaudeEnvelope(JSON.stringify({ is_error: true, result: 'Not logged in · Please run /login' }), '', 1),
    (error) => error instanceof ClaudeCliError && error.code === 'authentication_error',
  );
});

test('parseClaudeEnvelope classifies a rejected output schema', () => {
  assert.throws(
    () => parseClaudeEnvelope('', 'Error: --json-schema is not a valid JSON Schema', 1),
    (error) => error instanceof ClaudeCliError && error.code === 'invalid_schema',
  );
});

test('an already-aborted request does not spawn Claude', async () => {
  const controller = new AbortController();
  controller.abort();
  const runner = createClaudeRunner(
    { claudePath: 'claude', timeoutMs: 100 },
    { spawn: () => { throw new Error('spawn must not be called'); } },
  );

  await assert.rejects(
    runner.run({ model: 'sonnet', prompt: 'Hello', schema, signal: controller.signal }),
    (error) => error instanceof ClaudeCliError && error.code === 'request_aborted',
  );
});

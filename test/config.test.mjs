import assert from 'node:assert/strict';
import test from 'node:test';

import { readConfig } from '../src/config.mjs';

test('readConfig applies defaults', () => {
  const config = readConfig([], {});

  assert.deepEqual(config, {
    apiKey: '',
    claudePath: 'claude',
    host: '127.0.0.1',
    maxBodyBytes: 1_048_576,
    maxConcurrent: 4,
    maxSessions: 64,
    model: 'sonnet',
    port: 8901,
    sessionTtlMs: 10_800_000,
    timeoutMs: 300_000,
  });
});

test('readConfig gives command-line options precedence', () => {
  const config = readConfig(
    ['--port', '9000', '--model', 'opus', '--timeout-ms', '1200'],
    { CLAUDE_PROXY_PORT: '8000', CLAUDE_PROXY_MODEL: 'haiku' },
  );

  assert.equal(config.port, 9000);
  assert.equal(config.model, 'opus');
  assert.equal(config.timeoutMs, 1200);
});

test('readConfig rejects invalid numbers', () => {
  assert.throws(() => readConfig(['--port', 'nope'], {}), /port must be an integer/);
});

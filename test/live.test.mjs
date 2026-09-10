import assert from 'node:assert/strict';
import test from 'node:test';

import { createClaudeRunner } from '../src/claude-cli.mjs';
import { buildClaudeRequest, validateChatRequest } from '../src/protocol.mjs';

const enabled = process.env.CLAUDE_PROXY_LIVE_TEST === '1';

test('Claude Code returns validated structured output', { skip: !enabled }, async () => {
  const runner = createClaudeRunner({ claudePath: 'claude', timeoutMs: 120_000 });
  const request = validateChatRequest({
    model: process.env.CLAUDE_PROXY_MODEL ?? 'haiku',
    messages: [{ role: 'user', content: 'Reply with exactly: hello' }],
  });
  const claudeRequest = buildClaudeRequest(request);

  const envelope = await runner.run({ ...claudeRequest, model: request.model });

  assert.equal(envelope.structured_output.kind, 'message');
  assert.match(envelope.structured_output.content, /hello/i);
});

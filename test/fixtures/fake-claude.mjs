#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('9.9.9 (Claude Code)\n');
  process.exit(0);
}

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ args, prompt })}\n`);

if (prompt.includes('HANG_FOREVER')) {
  setInterval(() => {}, 1_000);
} else {
  const toolCall = prompt.includes('Call a tool');
  const sessionIndex = Math.max(args.indexOf('--session-id'), args.indexOf('--resume'));
  const envelope = {
    is_error: false,
    session_id: sessionIndex >= 0 ? args[sessionIndex + 1] : 'stateless',
    structured_output: toolCall
      ? { kind: 'tool_calls', content: '', tool_calls: [{ name: 'get_weather', arguments: { city: 'Pune' } }] }
      : { kind: 'message', content: 'Hello from Claude', tool_calls: [] },
    usage: { input_tokens: 3, output_tokens: 2 },
  };
  process.stdout.write(JSON.stringify(envelope));
}

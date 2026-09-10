import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildClaudeRequest,
  toChatCompletion,
  validateChatRequest,
} from '../src/protocol.mjs';

const weatherTool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get the weather for a city.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
      additionalProperties: false,
    },
    strict: true,
  },
};

test('buildClaudeRequest preserves roles and supplies tools inline', () => {
  const request = validateChatRequest({
    model: 'sonnet',
    messages: [
      { role: 'developer', content: [{ type: 'text', text: 'Be concise.' }] },
      { role: 'user', content: 'Weather in Pune?' },
    ],
    tools: [weatherTool],
  });

  const result = buildClaudeRequest(request);

  assert.match(result.prompt, /"role": "developer"/);
  assert.match(result.prompt, /"name": "get_weather"/);
  assert.equal(result.schema.properties.kind.enum.length, 2);
});

test('buildClaudeRequest hoists the OpenAI system message out of the transcript', () => {
  const request = validateChatRequest({
    model: 'sonnet',
    messages: [
      { role: 'system', content: 'Always start answers with Weather demo:' },
      { role: 'user', content: 'Hello' },
    ],
  });

  const result = buildClaudeRequest(request);

  assert.equal(result.systemPrompt, 'Always start answers with Weather demo:');
  assert.doesNotMatch(result.prompt, /Always start answers/);
  assert.doesNotMatch(result.prompt, /"role": "system"/);
  assert.match(result.prompt, /"role": "user"/);
});

test('buildClaudeRequest can omit an unchanged tool catalog from a resumed prompt', () => {
  const request = validateChatRequest({
    model: 'sonnet',
    messages: [{ role: 'user', content: 'Continue' }],
    tools: [weatherTool],
  });

  const result = buildClaudeRequest(request, { includeTools: false });

  assert.doesNotMatch(result.prompt, /Get the weather for a city/);
  assert.equal(result.schema.properties.tool_calls.items.properties.name.const, 'get_weather');
});

test('named tool choice constrains structured output', () => {
  const request = validateChatRequest({
    model: 'sonnet',
    messages: [{ role: 'user', content: 'Weather?' }],
    tools: [weatherTool],
    tool_choice: { type: 'function', function: { name: 'get_weather' } },
  });

  const { schema } = buildClaudeRequest(request);

  assert.deepEqual(schema.properties.kind.enum, ['tool_calls']);
  assert.equal(schema.properties.tool_calls.items.properties.name.const, 'get_weather');
});

test('tool_choice none forces a message', () => {
  const request = validateChatRequest({
    model: 'sonnet',
    messages: [{ role: 'user', content: 'Hello' }],
    tools: [weatherTool],
    tool_choice: 'none',
  });

  const { schema } = buildClaudeRequest(request);

  assert.deepEqual(schema.properties.kind.enum, ['message']);
  assert.equal(schema.properties.tool_calls.maxItems, 0);
});

test('allowed_tools limits the functions Claude may call', () => {
  const timeTool = {
    type: 'function',
    function: { name: 'get_time', parameters: { type: 'object' } },
  };
  const request = validateChatRequest({
    model: 'sonnet',
    messages: [{ role: 'user', content: 'Weather?' }],
    tools: [weatherTool, timeTool],
    tool_choice: {
      type: 'allowed_tools',
      allowed_tools: {
        mode: 'required',
        tools: [{ type: 'function', function: { name: 'get_time' } }],
      },
    },
  });

  const { prompt, schema } = buildClaudeRequest(request);

  assert.doesNotMatch(prompt, /get_weather/);
  assert.match(prompt, /get_time/);
  assert.equal(schema.properties.tool_calls.items.properties.name.const, 'get_time');
});

test('validateChatRequest rejects unsupported image input', () => {
  assert.throws(
    () => validateChatRequest({
      model: 'sonnet',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }],
    }),
    /Only text content parts are supported/,
  );
});

test('validateChatRequest rejects options that cannot be honored', () => {
  assert.throws(
    () => validateChatRequest({
      model: 'sonnet',
      messages: [{ role: 'user', content: 'Hello' }],
      top_p: 0.2,
    }),
    /top_p is not supported/,
  );
});

test('validateChatRequest accepts seed and temperature as ignored compatibility hints', () => {
  const request = validateChatRequest({
    model: 'sonnet',
    messages: [{ role: 'user', content: 'Hello' }],
    seed: 42,
    temperature: 0.2,
  });

  assert.equal(request.model, 'sonnet');
});

test('validateChatRequest rejects duplicate tool names', () => {
  assert.throws(
    () => validateChatRequest({
      model: 'sonnet',
      messages: [{ role: 'user', content: 'Weather?' }],
      tools: [weatherTool, weatherTool],
    }),
    /Tool names must be unique/,
  );
});

test('validateChatRequest rejects malformed allowed_tools', () => {
  assert.throws(
    () => validateChatRequest({
      model: 'sonnet',
      messages: [{ role: 'user', content: 'Weather?' }],
      tools: [weatherTool],
      tool_choice: { type: 'allowed_tools', allowed_tools: { mode: 'required', tools: {} } },
    }),
    /allowed_tools must name function tools/,
  );
});

test('toChatCompletion emits OpenAI tool calls and usage', () => {
  const request = validateChatRequest({
    model: 'sonnet',
    messages: [{ role: 'user', content: 'Weather?' }],
    tools: [weatherTool],
  });
  const envelope = {
    session_id: 'session-1',
    usage: { input_tokens: 10, cache_read_input_tokens: 20, output_tokens: 5 },
  };
  const output = {
    kind: 'tool_calls',
    content: '',
    tool_calls: [{ name: 'get_weather', arguments: { city: 'Pune' } }],
  };

  const completion = toChatCompletion({ envelope, output, request, id: 'chatcmpl_test', created: 1 });

  assert.equal(completion.choices[0].finish_reason, 'tool_calls');
  assert.equal(completion.choices[0].message.tool_calls[0].function.arguments, '{"city":"Pune"}');
  assert.deepEqual(completion.usage, { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 });
});

test('toChatCompletion rejects an unoffered tool', () => {
  const request = validateChatRequest({
    model: 'sonnet',
    messages: [{ role: 'user', content: 'Weather?' }],
    tools: [weatherTool],
  });

  assert.throws(() => toChatCompletion({
    envelope: {},
    output: { kind: 'tool_calls', content: '', tool_calls: [{ name: 'delete_all', arguments: {} }] },
    request,
  }), /not offered/);
});

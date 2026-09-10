import { randomUUID } from 'node:crypto';

import { OpenAIError } from './errors.mjs';

const ROLES = new Set(['assistant', 'developer', 'function', 'system', 'tool', 'user']);
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const UNSUPPORTED_OPTIONS = [
  'audio', 'frequency_penalty', 'function_call', 'functions', 'logit_bias',
  'logprobs', 'max_completion_tokens', 'max_tokens', 'modalities', 'prediction',
  'presence_penalty', 'reasoning_effort', 'response_format',
  'service_tier', 'stop', 'top_logprobs', 'top_p',
  'web_search_options',
];

function invalid(message, param) {
  throw new OpenAIError(message, { param });
}

function textContent(content, param) {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  if (!Array.isArray(content)) invalid('Message content must be a string or an array.', param);
  return content.map((part, index) => textPart(part, `${param}.${index}`)).join('');
}

function textPart(part, param) {
  if (part?.type !== 'text' || typeof part.text !== 'string') {
    invalid('Only text content parts are supported.', param);
  }
  return part.text;
}

function normalizeToolCall(call, param) {
  const fn = call?.function;
  if (call?.type !== 'function' || !fn || typeof fn.name !== 'string') {
    invalid('Assistant tool calls must be function calls.', param);
  }
  if (typeof fn.arguments !== 'string') invalid('Tool-call arguments must be a JSON string.', `${param}.function.arguments`);
  return { id: String(call.id ?? ''), type: 'function', function: { name: fn.name, arguments: fn.arguments } };
}

function normalizeMessage(message, index) {
  const param = `messages.${index}`;
  if (!message || !ROLES.has(message.role)) invalid('Unsupported or missing message role.', `${param}.role`);
  const normalized = { role: message.role, content: textContent(message.content, `${param}.content`) };
  if (message.name !== undefined) normalized.name = String(message.name);
  if (message.role === 'tool') normalizeToolMessage(normalized, message, param);
  if (message.role === 'assistant' && message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls)) invalid('tool_calls must be an array.', `${param}.tool_calls`);
    normalized.tool_calls = message.tool_calls.map((call, callIndex) => normalizeToolCall(call, `${param}.tool_calls.${callIndex}`));
  }
  return normalized;
}

function normalizeToolMessage(normalized, message, param) {
  if (typeof message.tool_call_id !== 'string' || !message.tool_call_id) {
    invalid('Tool messages require tool_call_id.', `${param}.tool_call_id`);
  }
  normalized.tool_call_id = message.tool_call_id;
}

function normalizeFunctionTool(tool, index) {
  const param = `tools.${index}`;
  const fn = tool?.function;
  if (tool?.type !== 'function' || !fn || typeof fn.name !== 'string' || !TOOL_NAME.test(fn.name)) {
    invalid('Function tool names must contain 1-64 letters, numbers, underscores, or dashes.', `${param}.function.name`);
  }
  if (fn.parameters !== undefined && !isObject(fn.parameters)) invalid('Tool parameters must be a JSON Schema object.', `${param}.function.parameters`);
  return {
    type: 'function',
    function: {
      name: fn.name,
      description: typeof fn.description === 'string' ? fn.description : '',
      parameters: fn.parameters ?? { type: 'object', properties: {}, additionalProperties: false },
      strict: fn.strict === true,
    },
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function namedToolChoice(choice, tools) {
  const name = choice?.function?.name;
  if (choice?.type !== 'function' || typeof name !== 'string') invalid('Invalid named tool_choice.', 'tool_choice');
  requireTools([name], tools, 'tool_choice');
  return { mode: 'required', names: [name] };
}

function allowedToolChoice(choice, tools) {
  const allowed = choice?.allowed_tools;
  if (choice?.type !== 'allowed_tools' || !['auto', 'required'].includes(allowed?.mode)) {
    invalid('Invalid allowed_tools tool_choice.', 'tool_choice');
  }
  if (!Array.isArray(allowed.tools) || !allowed.tools.length) invalid('allowed_tools must name function tools.', 'tool_choice.allowed_tools.tools');
  const names = allowed.tools.map((tool) => tool?.function?.name);
  if (names.some((name) => typeof name !== 'string')) invalid('allowed_tools must name function tools.', 'tool_choice.allowed_tools.tools');
  requireTools(names, tools, 'tool_choice.allowed_tools.tools');
  return { mode: allowed.mode, names };
}

function requireTools(names, tools, param) {
  const offered = new Set(tools.map((tool) => tool.function.name));
  for (const name of names) if (!offered.has(name)) invalid(`Tool "${name}" was not offered.`, param);
}

function normalizeToolChoice(choice, tools) {
  if (choice === undefined) return { mode: tools.length ? 'auto' : 'none', names: tools.map(toolName) };
  if (typeof choice === 'string') {
    if (!['auto', 'none', 'required'].includes(choice)) invalid('tool_choice must be auto, none, required, or a tool selector.', 'tool_choice');
    if (choice === 'required' && !tools.length) invalid('tool_choice required needs at least one tool.', 'tool_choice');
    return { mode: choice, names: choice === 'none' ? [] : tools.map(toolName) };
  }
  if (choice?.type === 'allowed_tools') return allowedToolChoice(choice, tools);
  return namedToolChoice(choice, tools);
}

const toolName = (tool) => tool.function.name;

export function validateChatRequest(body, defaultModel = 'sonnet') {
  if (!isObject(body)) invalid('Request body must be a JSON object.', null);
  rejectUnsupportedOptions(body);
  if (!Array.isArray(body.messages) || !body.messages.length) invalid('messages must be a non-empty array.', 'messages');
  if (body.n !== undefined && body.n !== 1) invalid('Only n=1 is supported.', 'n');
  if (body.stream !== undefined && typeof body.stream !== 'boolean') invalid('stream must be a boolean.', 'stream');
  if (body.parallel_tool_calls !== undefined && typeof body.parallel_tool_calls !== 'boolean') invalid('parallel_tool_calls must be a boolean.', 'parallel_tool_calls');
  if (body.stream_options !== undefined && !isObject(body.stream_options)) invalid('stream_options must be an object.', 'stream_options');
  const tools = body.tools === undefined ? [] : normalizeTools(body.tools);
  const model = body.model ?? defaultModel;
  if (typeof model !== 'string' || !model.trim()) invalid('model must be a non-empty string.', 'model');
  return {
    messages: body.messages.map(normalizeMessage),
    model: model.trim(),
    parallelToolCalls: body.parallel_tool_calls !== false,
    stream: body.stream === true,
    streamIncludeUsage: body.stream_options?.include_usage === true,
    toolChoice: normalizeToolChoice(body.tool_choice, tools),
    tools,
  };
}

function rejectUnsupportedOptions(body) {
  const name = UNSUPPORTED_OPTIONS.find((field) => body[field] !== undefined);
  if (name) invalid(`${name} is not supported by the Claude Code backend.`, name);
}

function normalizeTools(tools) {
  if (!Array.isArray(tools)) invalid('tools must be an array.', 'tools');
  const normalized = tools.map(normalizeFunctionTool);
  if (new Set(normalized.map(toolName)).size !== normalized.length) invalid('Tool names must be unique.', 'tools');
  return normalized;
}

export function toolCatalog(request) {
  const names = new Set(request.toolChoice.names);
  return request.tools.filter((tool) => names.has(tool.function.name));
}

function callSchema(tool) {
  return {
    type: 'object',
    properties: {
      name: { type: 'string', const: tool.function.name },
      arguments: tool.function.strict ? tool.function.parameters : { type: 'object' },
    },
    required: ['name', 'arguments'],
    additionalProperties: false,
  };
}

function callsSchema(request, tools) {
  if (!tools.length) return { type: 'array', items: {}, maxItems: 0 };
  const schemas = tools.map(callSchema);
  const schema = { type: 'array', items: schemas.length === 1 ? schemas[0] : { anyOf: schemas } };
  if (request.toolChoice.mode === 'required') schema.minItems = 1;
  if (!request.parallelToolCalls) schema.maxItems = 1;
  return schema;
}

function outputSchema(request, tools) {
  const canMessage = request.toolChoice.mode !== 'required';
  const canCall = request.toolChoice.mode !== 'none' && tools.length > 0;
  return {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [canMessage && 'message', canCall && 'tool_calls'].filter(Boolean) },
      content: { type: 'string' },
      tool_calls: callsSchema(request, tools),
    },
    required: ['kind', 'content', 'tool_calls'],
    additionalProperties: false,
  };
}

function promptPayload(request, tools, includeTools) {
  const payload = {
    messages: request.messages,
    tool_choice: request.toolChoice,
    parallel_tool_calls: request.parallelToolCalls,
  };
  if (includeTools) payload.tools = tools;
  return payload;
}

function requestSystemPrompt(messages) {
  const prompts = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content);
  return prompts.length ? prompts.join('\n\n') : undefined;
}

function transcriptMessages(messages) {
  return messages.filter((message) => message.role !== 'system');
}

export function buildClaudeRequest(request, options = {}) {
  const tools = toolCatalog(request);
  const messages = transcriptMessages(options.messages ?? request.messages);
  const instructions = [
    'Process this OpenAI Chat Completions request.',
    'Follow developer messages before user messages.',
    'Return kind="message" with content and an empty tool_calls array for a direct answer.',
    'Return kind="tool_calls" with empty content when calling tools.',
    'Never invent a tool name or argument. Do not execute tools.',
  ].join('\n');
  return {
    prompt: `${instructions}\n\n${JSON.stringify(promptPayload({ ...request, messages }, tools, options.includeTools !== false), null, 2)}`,
    schema: outputSchema(request, tools),
    systemPrompt: requestSystemPrompt(request.messages),
  };
}

function validateOutput(output, request) {
  if (!isObject(output) || !['message', 'tool_calls'].includes(output.kind)) throw new Error('Claude returned an invalid structured output kind.');
  if (typeof output.content !== 'string' || !Array.isArray(output.tool_calls)) throw new Error('Claude returned an invalid structured output shape.');
  if (output.kind === 'message' && request.toolChoice.mode === 'required') throw new Error('Claude returned a message when a tool call was required.');
  if (output.kind === 'message' && output.tool_calls.length) throw new Error('Claude mixed a message with tool calls.');
  if (output.kind === 'tool_calls' && !output.tool_calls.length) throw new Error('Claude returned an empty tool-call batch.');
  if (output.kind === 'tool_calls' && output.content) throw new Error('Claude mixed tool calls with message content.');
  if (!request.parallelToolCalls && output.tool_calls.length > 1) throw new Error('Claude returned parallel tool calls when disabled.');
}

function normalizeOutputCalls(output, request) {
  const offered = new Set(toolCatalog(request).map(toolName));
  return output.tool_calls.map((call) => {
    if (!offered.has(call?.name)) throw new Error(`Claude called "${call?.name}", which was not offered.`);
    if (!isObject(call.arguments)) throw new Error(`Claude returned invalid arguments for "${call.name}".`);
    return {
      id: `call_${randomUUID().replaceAll('-', '')}`,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    };
  });
}

function usageOf(envelope) {
  const usage = envelope.usage ?? {};
  const prompt = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const completion = usage.output_tokens ?? 0;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

export function toChatCompletion(options) {
  const { envelope, output, request } = options;
  validateOutput(output, request);
  const calls = output.kind === 'tool_calls' ? normalizeOutputCalls(output, request) : undefined;
  const message = { role: 'assistant', content: output.kind === 'message' ? output.content : null };
  if (calls) message.tool_calls = calls;
  return {
    id: options.id ?? `chatcmpl_${randomUUID().replaceAll('-', '')}`,
    object: 'chat.completion',
    created: options.created ?? Math.floor(Date.now() / 1000),
    model: request.model,
    choices: [{ index: 0, finish_reason: calls ? 'tool_calls' : 'stop', message }],
    usage: usageOf(envelope),
  };
}

function streamChunk(completion, delta, finishReason = null, usage) {
  const chunk = {
    id: completion.id,
    object: 'chat.completion.chunk',
    created: completion.created,
    model: completion.model,
    choices: usage ? [] : [{ index: 0, delta, finish_reason: finishReason }],
  };
  if (usage) chunk.usage = usage;
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export function toSse(completion, includeUsage = false) {
  const choice = completion.choices[0];
  const frames = [streamChunk(completion, { role: 'assistant', content: '' })];
  if (choice.message.tool_calls) frames.push(streamChunk(completion, { tool_calls: choice.message.tool_calls.map((call, index) => ({ index, ...call })) }));
  else frames.push(streamChunk(completion, { content: choice.message.content }));
  frames.push(streamChunk(completion, {}, choice.finish_reason));
  if (includeUsage) frames.push(streamChunk(completion, {}, null, completion.usage));
  frames.push('data: [DONE]\n\n');
  return frames.join('');
}

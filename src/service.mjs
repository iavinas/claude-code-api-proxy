import { randomUUID } from 'node:crypto';

import { ClaudeCliError } from './claude-cli.mjs';
import { OpenAIError } from './errors.mjs';
import { buildClaudeRequest, toolCatalog, toChatCompletion, validateChatRequest } from './protocol.mjs';
import { createSessionStore, deriveConversationKey } from './session-store.mjs';

function createLimiter(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || !queue.length) return;
    active += 1;
    const { task, resolve, reject } = queue.shift();
    task().then(resolve, reject).finally(() => { active -= 1; next(); });
  };
  return (task) => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); next(); });
}

function mapClaudeError(error) {
  if (!(error instanceof ClaudeCliError)) throw error;
  const mappings = {
    authentication_error: [503, 'claude_authentication_required', 'Claude Code is not authenticated.'],
    invalid_schema: [400, 'invalid_tool_schema', error.message],
    not_found: [503, 'claude_cli_not_found', 'Claude Code CLI is unavailable.'],
    request_aborted: [499, 'request_aborted', 'The client closed the request.'],
    timeout: [504, 'claude_timeout', 'Claude Code timed out.'],
  };
  const [status, code, message] = mappings[error.code] ?? [502, 'claude_cli_error', 'Claude Code failed to produce a completion.'];
  throw new OpenAIError(message, { status, type: 'server_error', code });
}

function sessionOptions(plan) {
  return plan.persist ? { id: plan.id, resume: plan.resume } : undefined;
}

async function invokeClaude(options) {
  const { runner, request, context, plan } = options;
  const claudeRequest = buildClaudeRequest(
    { ...request, messages: plan.messages },
    { includeTools: plan.includeTools },
  );
  return runner.run({
    ...claudeRequest,
    model: request.model,
    session: sessionOptions(plan),
    signal: context.signal,
  });
}

export function createCompletionService(options) {
  const { config, runner } = options;
  const sessions = options.sessions ?? createSessionStore({
    maxSessions: config.maxSessions,
    ttlMs: config.sessionTtlMs,
  });
  const limit = createLimiter(config.maxConcurrent);
  const state = { config, limit, onTurn: options.onTurn, runner, sessions };
  return {
    complete: (body, context = {}) => completeRequest(state, body, context),
    sessions,
  };
}

async function runWithSessionFallback(state, request, context) {
  const input = { messages: request.messages, tools: toolCatalog(request) };
  let plan = state.sessions.plan(context.sessionKey, input);
  try {
    const envelope = await invokeClaude({ ...state, request, context, plan });
    return { envelope, fellBack: false, input, plan };
  } catch (error) {
    if (!shouldRetryCold(error, plan)) mapClaudeError(error);
  }
  state.sessions.drop(context.sessionKey);
  plan = state.sessions.plan(context.sessionKey, input);
  try {
    const envelope = await invokeClaude({ ...state, request, context, plan });
    return { envelope, fellBack: true, input, plan };
  } catch (error) {
    mapClaudeError(error);
  }
}

function shouldRetryCold(error, plan) {
  if (!(error instanceof ClaudeCliError) || !plan.resume) return false;
  return !['authentication_error', 'invalid_schema', 'not_found', 'request_aborted'].includes(error.code);
}

async function completeLocked(state, request, context) {
  const result = await runWithSessionFallback(state, request, context);
  const completion = toChatCompletion({ envelope: result.envelope, output: result.envelope.structured_output, request });
  const sessionId = result.envelope.session_id ?? result.plan.id;
  state.sessions.commit(context.sessionKey, sessionId, result.input);
  state.onTurn?.({ mode: result.fellBack ? 'cold-fallback' : result.plan.resume ? 'resumed' : 'cold', sessionId });
  return completion;
}

async function completeRequest(state, body, context) {
  const request = validateChatRequest(body, state.config.model);
  const conversationKey = context.sessionKey
    ? `explicit:${context.sessionKey}`
    : deriveConversationKey(request.messages);
  const sessionKey = `${request.model}:${conversationKey}`;
  const lockedContext = { ...context, sessionKey };
  const task = () => state.limit(() => completeLocked(state, request, lockedContext));
  return state.sessions.withLock(lockedContext.sessionKey, task);
}

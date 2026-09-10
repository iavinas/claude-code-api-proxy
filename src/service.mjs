import { randomUUID } from 'node:crypto';

import { ClaudeCliError } from './claude-cli.mjs';
import { OpenAIError } from './errors.mjs';
import { buildClaudeRequest, toChatCompletion, validateChatRequest } from './protocol.mjs';
import { createSessionStore } from './session-store.mjs';

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
  const claudeRequest = buildClaudeRequest({ ...request, messages: plan.messages });
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
  const state = { config, limit, runner, sessions };
  return {
    complete: (body, context = {}) => completeRequest(state, body, context),
    sessions,
  };
}

async function runWithSessionFallback(state, request, context) {
  let plan = state.sessions.plan(context.sessionKey, request.messages);
  try {
    const envelope = await invokeClaude({ ...state, request, context, plan });
    return { envelope, plan };
  } catch (error) {
    if (!(error instanceof ClaudeCliError) || error.code !== 'session_error' || !plan.resume) mapClaudeError(error);
  }
  state.sessions.drop(context.sessionKey);
  plan = state.sessions.plan(context.sessionKey, request.messages);
  try {
    const envelope = await invokeClaude({ ...state, request, context, plan });
    return { envelope, plan };
  } catch (error) {
    mapClaudeError(error);
  }
}

async function completeLocked(state, request, context) {
  const { envelope, plan } = await runWithSessionFallback(state, request, context);
  state.sessions.commit(context.sessionKey, envelope.session_id ?? plan.id, request.messages);
  return toChatCompletion({ envelope, output: envelope.structured_output, request });
}

async function completeRequest(state, body, context) {
  const request = validateChatRequest(body, state.config.model);
  const lockedContext = { ...context, sessionKey: context.sessionKey ?? '' };
  const task = () => state.limit(() => completeLocked(state, request, lockedContext));
  return state.sessions.withLock(lockedContext.sessionKey, task);
}

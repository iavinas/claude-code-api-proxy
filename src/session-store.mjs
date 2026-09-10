import { createHash, randomUUID } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function semanticMessage(message) {
  const normalized = { role: message.role, content: message.content, name: message.name };
  if (message.role === 'assistant' && message.tool_calls) {
    normalized.tool_calls = message.tool_calls.map((call) => call.function);
  }
  return normalized;
}

function chainHashes(messages) {
  const hashes = [];
  let chain = '';
  for (const message of messages) {
    chain = digest([chain, semanticMessage(message)]);
    hashes.push(chain);
  }
  return hashes;
}

export function deriveConversationKey(messages) {
  const system = messages.find((message) => message.role === 'system')?.content ?? '';
  const firstUser = messages.find((message) => message.role === 'user')?.content;
  const anchor = firstUser === undefined ? messages[0] : { system, user: firstUser };
  return `auto:${digest(anchor)}`;
}

function createLock(locks, key, task) {
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  locks.set(key, current);
  return current.finally(() => {
    if (locks.get(key) === current) locks.delete(key);
  });
}

function sweepSessions(state) {
  const cutoff = state.now() - state.ttlMs;
  for (const [key, entry] of state.sessions) if (entry.at < cutoff) state.sessions.delete(key);
  while (state.sessions.size > state.maxSessions) state.sessions.delete(state.sessions.keys().next().value);
}

function coldPlan(state, key, input) {
  return {
    id: state.createId(),
    includeTools: true,
    messages: input.messages,
    persist: Boolean(key),
    resume: false,
  };
}

function planSession(state, key, input) {
  sweepSessions(state);
  const entry = key ? state.sessions.get(key) : null;
  if (!entry || entry.consumed >= input.messages.length) return coldPlan(state, key, input);
  const chain = chainHashes(input.messages);
  if (chain[entry.consumed - 1] !== entry.prefix) return coldPlan(state, key, input);
  const delta = input.messages.slice(entry.consumed).filter((message) => message.role !== 'assistant');
  if (!delta.length) return coldPlan(state, key, input);
  return {
    id: entry.id,
    includeTools: entry.toolsHash !== digest(input.tools),
    messages: delta,
    persist: true,
    resume: true,
  };
}

function commitSession(state, key, id, input) {
  if (!key) return;
  const chain = chainHashes(input.messages);
  state.sessions.delete(key);
  state.sessions.set(key, {
    at: state.now(),
    consumed: input.messages.length,
    id,
    prefix: chain.at(-1),
    toolsHash: digest(input.tools),
  });
  sweepSessions(state);
}

export function createSessionStore(options = {}) {
  const state = {
    createId: options.createId ?? randomUUID,
    locks: new Map(),
    maxSessions: options.maxSessions ?? 64,
    now: options.now ?? Date.now,
    sessions: new Map(),
    ttlMs: options.ttlMs ?? 10_800_000,
  };
  return {
    commit: (key, id, input) => commitSession(state, key, id, input),
    drop: (key) => state.sessions.delete(key),
    plan: (key, input) => planSession(state, key, input),
    size: () => state.sessions.size,
    withLock: (key, task) => key ? createLock(state.locks, key, task) : task(),
  };
}

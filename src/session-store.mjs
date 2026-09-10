import { createHash, randomUUID } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function chainHashes(messages) {
  const hashes = [];
  let chain = '';
  for (const message of messages) {
    chain = digest([chain, message]);
    hashes.push(chain);
  }
  return hashes;
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

function coldPlan(state, key, messages) {
  return { id: state.createId(), messages, persist: Boolean(key), resume: false };
}

function planSession(state, key, messages) {
  sweepSessions(state);
  const entry = key ? state.sessions.get(key) : null;
  if (!entry || entry.consumed >= messages.length) return coldPlan(state, key, messages);
  const chain = chainHashes(messages);
  if (chain[entry.consumed - 1] !== entry.prefix) return coldPlan(state, key, messages);
  const delta = messages.slice(entry.consumed).filter((message) => message.role !== 'assistant');
  if (!delta.length) return coldPlan(state, key, messages);
  return { id: entry.id, messages: delta, persist: true, resume: true };
}

function commitSession(state, key, id, messages) {
  if (!key) return;
  const chain = chainHashes(messages);
  state.sessions.delete(key);
  state.sessions.set(key, { at: state.now(), consumed: messages.length, id, prefix: chain.at(-1) });
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
    commit: (key, id, messages) => commitSession(state, key, id, messages),
    drop: (key) => state.sessions.delete(key),
    plan: (key, messages) => planSession(state, key, messages),
    size: () => state.sessions.size,
    withLock: (key, task) => key ? createLock(state.locks, key, task) : task(),
  };
}

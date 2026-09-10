import assert from 'node:assert/strict';
import test from 'node:test';

import { createSessionStore, deriveConversationKey } from '../src/session-store.mjs';

const firstTurn = [{ role: 'user', content: 'Hello' }];
const secondTurn = [
  ...firstTurn,
  { role: 'assistant', content: 'Hi' },
  { role: 'user', content: 'Continue' },
];

test('session reuse sends only the new user-visible delta', () => {
  const store = createSessionStore({ createId: () => 'new-id' });
  const tools = [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }];

  const initial = store.plan('client-session', { messages: firstTurn, tools });
  store.commit('client-session', initial.id, { messages: firstTurn, tools });
  const resumed = store.plan('client-session', { messages: secondTurn, tools });

  assert.equal(resumed.resume, true);
  assert.equal(resumed.includeTools, false);
  assert.deepEqual(resumed.messages, [{ role: 'user', content: 'Continue' }]);
});

test('an identical request does not resume with an empty delta', () => {
  const store = createSessionStore({ createId: () => 'new-id' });
  const input = { messages: firstTurn, tools: [] };
  const initial = store.plan('client-session', input);
  store.commit('client-session', initial.id, input);

  assert.equal(store.plan('client-session', input).resume, false);
});

test('a changed tool catalog is included in the resumed delta', () => {
  const store = createSessionStore({ createId: () => 'new-id' });
  const initial = { messages: firstTurn, tools: [] };
  store.commit('client-session', 'session-id', initial);

  const resumed = store.plan('client-session', {
    messages: secondTurn,
    tools: [{ type: 'function', function: { name: 'finish', parameters: { type: 'object' } } }],
  });

  assert.equal(resumed.resume, true);
  assert.equal(resumed.includeTools, true);
});

test('generated tool-call IDs do not break the semantic prefix', () => {
  const store = createSessionStore({ createId: () => 'new-id' });
  const prior = [
    ...firstTurn,
    { role: 'assistant', content: '', tool_calls: [{ id: 'call-a', type: 'function', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call-a', content: 'page' },
  ];
  store.commit('client-session', 'session-id', { messages: prior, tools: [] });
  const next = [
    ...firstTurn,
    { role: 'assistant', content: '', tool_calls: [{ id: 'call-b', type: 'function', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call-b', content: 'page' },
    { role: 'user', content: 'Continue' },
  ];

  assert.equal(store.plan('client-session', { messages: next, tools: [] }).resume, true);
});

test('rewritten history takes the cold path', () => {
  const ids = ['first-id', 'second-id'];
  const store = createSessionStore({ createId: () => ids.shift() });
  const input = { messages: firstTurn, tools: [] };
  store.commit('client-session', 'stored-id', input);

  const plan = store.plan('client-session', {
    messages: [{ role: 'user', content: 'Rewritten' }, { role: 'user', content: 'Continue' }],
    tools: [],
  });

  assert.equal(plan.resume, false);
  assert.equal(plan.id, 'first-id');
});

test('automatic conversation identity uses the system and first user messages', () => {
  const first = deriveConversationKey([
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'task' },
    { role: 'user', content: 'later' },
  ]);
  const second = deriveConversationKey([
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'task' },
    { role: 'user', content: 'different later turn' },
  ]);

  assert.equal(first, second);
});

test('withLock serializes work for the same client session', async () => {
  const store = createSessionStore();
  const events = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = store.withLock('same', async () => {
    events.push('first-start');
    await gate;
    events.push('first-end');
  });
  const second = store.withLock('same', async () => events.push('second'));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first-start']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second']);
});

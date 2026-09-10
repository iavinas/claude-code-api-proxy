import assert from 'node:assert/strict';
import test from 'node:test';

import { createSessionStore } from '../src/session-store.mjs';

const firstTurn = [{ role: 'user', content: 'Hello' }];
const secondTurn = [
  ...firstTurn,
  { role: 'assistant', content: 'Hi' },
  { role: 'user', content: 'Continue' },
];

test('session reuse is opt-in and sends only the new user-visible delta', () => {
  const store = createSessionStore({ createId: () => 'new-id' });

  const cold = store.plan('', firstTurn);
  assert.equal(cold.persist, false);
  assert.equal(cold.resume, false);

  const initial = store.plan('client-session', firstTurn);
  store.commit('client-session', initial.id, firstTurn);
  const resumed = store.plan('client-session', secondTurn);

  assert.equal(resumed.resume, true);
  assert.deepEqual(resumed.messages, [{ role: 'user', content: 'Continue' }]);
});

test('an identical request does not resume with an empty delta', () => {
  const store = createSessionStore({ createId: () => 'new-id' });
  const initial = store.plan('client-session', firstTurn);
  store.commit('client-session', initial.id, firstTurn);

  assert.equal(store.plan('client-session', firstTurn).resume, false);
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

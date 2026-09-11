// Run: node --test car-charging/test/settle.test.mjs
//
// The settle poll is capped at 45 calls. The cap is a ceiling, not a schedule -- this page
// shares a free-tier request budget with everything else on the account, so the poll has to
// stop the moment the server says the session is done. It reads a nested field, and a field
// path that quietly reads `undefined` turns the ceiling into the floor: every stop press
// spends all 45 invocations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stop, pollSettle } from '../api.js';

// Answers settle calls from a queue -- last body repeats -- and counts only those.
function serveSettle(bodies) {
  const samples = [];
  globalThis.fetch = async (path) => {
    if (!path.startsWith('/api/charge/settle/')) return Response.json({ ok: true });
    samples.push(path);
    return Response.json(bodies[Math.min(samples.length - 1, bodies.length - 1)]);
  };
  return samples;
}

const done = { session: { id: 'x', completed: true } };
const running = { session: { id: 'x', completed: false } };

test('the poll stops on the first completed sample', async () => {
  const samples = serveSettle([done]);
  await stop('x');
  // Throwing from the callback is how this fails in a second rather than in 45 of them.
  const last = await pollSettle('x', (_sample, attempt) =>
    assert.equal(attempt, 1, 'poll sampled again after the session was reported complete')
  );

  assert.ok(last.ok);
  assert.equal(samples.length, 1);
});

test('the poll keeps sampling while the session is still running', async () => {
  const samples = serveSettle([running, done]);
  await stop('x');
  await pollSettle('x');

  assert.equal(samples.length, 2);
});

test('a flat completed flag is honoured too', async () => {
  const samples = serveSettle([{ completed: true }]);
  await stop('x');
  await pollSettle('x');

  assert.equal(samples.length, 1);
});

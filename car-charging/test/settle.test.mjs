// Run: node --test car-charging/test/settle.test.mjs
//
// The settle poll is capped at 45 calls. The cap is a ceiling, not a schedule -- this page
// shares a free-tier request budget with everything else on the account, so the poll has to
// stop the moment the server says the session is done. It reads a nested field, and a field
// path that quietly reads `undefined` turns the ceiling into the floor: every stop press
// spends all 45 invocations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// ── The absence test ──
//
// A page left open all day must make zero upstream calls, and the cheapest way to prove an
// absence is to read the shipped source rather than to sit and watch a page. The settle poll
// above is the one permitted timer; everything else that could make the page fetch on its own
// -- a timer, a retry loop, a tab-visibility or network listener, a background worker -- must
// not appear at all. Browser storage and markup-injection sinks ride along in the same pattern
// because they are checked by the same eye and fail the same reviews.
//
// The pattern lives here rather than in a comment in the files it checks, because a comment
// quoting it would match itself.

const source = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

const hits = (text, pattern) => text.split('\n').filter((line) => pattern.test(line)).length;

// `visibilitychange` as a bare string caught one of the four revalidation events §1.3 forbids
// and none of the other three: a view could bind focus, online or pageshow, promote itself to
// self-fetching, and pass. The listener form is matched as well as the bare word so that a
// module that reaches for any of the four is caught by the event name it binds, not by the one
// name somebody happened to type here first. `addEventListener` on its own is deliberately not
// in the pattern -- the views legitimately bind click, input and change.
const SELF_MOVING =
  /setTimeout|setInterval|requestAnimationFrame|serviceWorker|visibilitychange|addEventListener\(\s*['"](focus|online|visibilitychange|pageshow)|localStorage|sessionStorage|document\.cookie|innerHTML|console\./;

test('nothing in the page can fetch on its own', () => {
  // Listed one by one, not globbed: a readdir that matched nothing would pass silently,
  // which is the exact failure this test exists to catch. A sixth view fails here until
  // someone adds it to this list, which is the reminder.
  for (const name of [
    'app.js',
    'index.html',
    'views/account.js',
    'views/auth.js',
    'views/he.js',
    'views/comments.js',
    'views/controls.js',
    'views/history.js',
    'views/tariff.js',
  ]) {
    assert.equal(hits(source(name), SELF_MOVING), 0, `${name} grew something self-moving`);
  }
});

// api.js is held to the stricter pattern -- it touches no DOM, so it has no business owning a
// listener either. Exactly one line comes back: the wait() inside the settle poll.
const WIDER = new RegExp('addEventListener|navigator\\.|' + SELF_MOVING.source);

test('the settle poll is the only timer in the client', () => {
  assert.equal(hits(source('api.js'), WIDER), 1);
});

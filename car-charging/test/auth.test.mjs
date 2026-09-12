// Run: node --test car-charging/test/auth.test.mjs
//
// The sign-in card, driven through every state it has, plus the one thing in api.js that
// decides whether the card is up at all.
//
// What this file exists to catch is states collapsing into each other. The page now has three
// things that all look like "it will not load", and each has a different and mutually useless
// instruction: renew the credential in the station's phone app (הרשאה), ask for a sign-in link
// (התחברות), press refresh (a transport failure). Send the viewer to the wrong one and they do
// work that cannot possibly help, then conclude the dashboard is broken.
//
// The two failure states of the request itself are the same problem one level down: "press
// again" and "pressing again will not help" are opposite instructions, and a page that guesses
// wrong either strands the viewer or has them pressing a button forever.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDocument, node, all, text, button } from './fake-dom.mjs';

installDocument();

const { render } = await import('../views/auth.js');

// ── the stub transport ──

let answer = () => Response.json({ ok: true });
const calls = [];

globalThis.fetch = async (path, init) => {
  calls.push({ path, init });
  return answer();
};

const SIGNED_OUT = { authRequired: true };

/** A fresh mount with the card painted into it. The module's phase is per-module, not per-el. */
function mount() {
  const el = node('div');
  render(el, SIGNED_OUT);
  return el;
}

/** Press the card's only button and wait for the request it makes to land. */
async function press(el, label) {
  const target = button(el, label);
  assert.ok(target, `no "${label}" button on the card`);
  await target.handlers.click();
  return el;
}

// Every test starts from `idle`, and the only reset the module has is the one a reload gives
// it: report a session, which takes the card down and puts the phase back.
function reset(el) {
  render(el, { authRequired: false });
  calls.length = 0;
}

// ── The signed-out card ──

test('the signed-out card is a message and a button, with no field of any kind', () => {
  const el = mount();

  assert.match(text(el), /צריך להתחבר/);
  assert.ok(button(el, 'שלחו לי קישור כניסה'));

  // The owner's design. A field would be somewhere to type an address that is never sent, and
  // -- if it ever were sent -- somewhere for a visitor to aim the mail.
  assert.equal(
    all(el).some((n) => n.tagName === 'input' || n.tagName === 'textarea' || n.tagName === 'form'),
    false,
    'the card grew a field'
  );

  reset(el);
});

test('the card never borrows the other two states’ words', () => {
  const el = mount();
  const painted = text(el);

  // הרשאה is the credential the dashboard holds against the charging station. It is renewed in
  // the vendor's phone app -- a viewer sent there for a sign-out does unrelated work and is no
  // closer to a session.
  assert.doesNotMatch(painted, /הרשאה/);
  // Refresh re-reads data. It is provably the one control that cannot mend this state.
  assert.doesNotMatch(painted, /רענון/);

  reset(el);
});

// ── Asking for the link ──

test('the request carries no body, and the card then claims only what it knows', async () => {
  const el = mount();
  answer = () => Response.json({ ok: true });
  await press(el, 'שלחו לי קישור כניסה');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/auth/request');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, undefined, 'the sign-in request carried a body');

  const painted = text(el);
  assert.match(painted, /הבקשה נשלחה/);
  // Nothing on this page can see a mailbox. "We asked the server to send" is the whole of what
  // it knows; "it was sent to you" and "it arrived" are claims it cannot make.
  assert.doesNotMatch(painted, /ההודעה נשלחה|הקישור נשלח|הגיע אליכם|נשלח אליכם/);
  // And it was never given an address to reveal.
  assert.doesNotMatch(painted, /@/);
  // Nothing presses again on the viewer's behalf.
  assert.equal(all(el).some((n) => n.tagName === 'button'), false, 'the sent card kept a button');

  reset(el);
});

test('a 204 with no body is a link that went out, not a failure', async () => {
  const el = mount();
  answer = () => new Response(null, { status: 204 });
  await press(el, 'שלחו לי קישור כניסה');

  // request() reports an unparseable body as `bad_response` whatever the status said. Painting
  // a failure over a link that really did go out sends the owner back to a button whose work is
  // already done -- and, with a one-time link, invalidates the one they are about to receive.
  assert.match(text(el), /הבקשה נשלחה/, 'an empty 2xx was painted as a failure');

  reset(el);
});

// ── The two failures, which must stay two ──

test('a request that never left says try again, and leaves a button to try with', async () => {
  const el = mount();
  answer = () => {
    throw new TypeError('offline');
  };
  await press(el, 'שלחו לי קישור כניסה');

  assert.match(text(el), /הבקשה לא יצאה/);
  assert.ok(button(el, 'נסו שוב'), 'a retryable failure left no way to retry');

  reset(el);
});

test('a rate limit is retryable; a server that cannot send is not', async () => {
  const el = mount();
  answer = () => Response.json({ error: 'rate_limited' }, { status: 429 });
  await press(el, 'שלחו לי קישור כניסה');
  assert.ok(button(el, 'נסו שוב'), '429 was painted as permanent');
  reset(el);

  const stuck = mount();
  answer = () => Response.json({ error: 'not_configured' }, { status: 500 });
  await press(stuck, 'שלחו לי קישור כניסה');

  const painted = text(stuck);
  assert.doesNotMatch(painted, /נסו שוב/, 'a viewer was told to keep pressing a button that cannot work');
  assert.equal(all(stuck).some((n) => n.tagName === 'button'), false, 'a permanent failure left a button');
  assert.match(painted, /לחיצה נוספת/, 'the card did not say that pressing again is pointless');

  // It says WHETHER to press again and never WHY not: the server's own error name, and the
  // status, are facts a caller who cannot get in does not get for free.
  assert.doesNotMatch(painted, /not_configured|500/);

  reset(stuck);
});

// ── No marker, anywhere ──

test('a session ends the card and leaves nothing of it behind', () => {
  const el = mount();
  assert.ok(text(el).length > 0);

  render(el, { authRequired: false });
  assert.equal(el.children.length, 0, 'the card was hidden rather than removed');

  // And the next signed-out round starts from the beginning rather than from wherever the last
  // one stopped -- the module holds no memory a stale phase could be resurrected from.
  render(el, SIGNED_OUT);
  assert.match(text(el), /צריך להתחבר/);

  reset(el);
});

// ── api.js: how the page learns it is signed out ──
//
// It is the STATUS, not the body. The route names the reason too, but that name is the
// backend's and this page must not have to know it -- and the body may not be JSON at all.

test('a 401 is a sign-out on every route, whatever its body says or fails to say', async () => {
  const { getState } = await import('../api.js');

  for (const [what, response] of [
    ['a named JSON body', () => Response.json({ error: 'no_session' }, { status: 401 })],
    ['an unnamed JSON body', () => Response.json({}, { status: 401 })],
    // The one that would otherwise land in `bad_response` and read as a transport failure,
    // which offers a retry in the exact state where only a sign-in link can help.
    ['no body at all', () => new Response('', { status: 401 })],
  ]) {
    answer = response;
    const result = await getState();
    assert.equal(result.error, 'auth_required', `a 401 with ${what} was not read as a sign-out`);
    assert.equal(result.ok, false);
    assert.equal(result.data, null, `a 401 with ${what} carried a body into the page`);
  }
});

test('a 403 is not a sign-out — the edge refusing a caller is a different thing', async () => {
  const { getState } = await import('../api.js');
  answer = () => Response.json({ error: 'forbidden' }, { status: 403 });

  const result = await getState();
  assert.equal(result.error, 'http_error', 'a 403 raised the sign-in card');
});

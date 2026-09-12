// Run: node --test car-charging/test/controls.test.mjs
//
// The panel under test closes and opens a contactor on real hardware, so the properties here
// are about what it refuses to do, not about what it draws.
//
// ONE DEFINITION OF LIVE. The projection puts a stop timestamp, a stop reason and a completed
// flag on every row it emits into `state.sessions`: a session that has just ended stays in that
// list for a few seconds, which is why the settle poll exists at all. Three modules needed to
// judge liveness and each had written its own test for it — and the one holding the contactor
// had written none, so any row carrying an id was "the live session". One ended row was enough
// to disable Start, leave Stop enabled, and send a dead id to the charger.
//
// The gating tests below RENDER the real module against a stub DOM and, for the stop path,
// click the real button and read the request body. A grep could not have caught any of it: the
// old code and the new both mention `sessionId`, and what changed is which row is picked.
//
// The spelling scan at the bottom is the only grep here, and it is one because its needles
// could not be written by someone who did not reintroduce a private spelling. Comments are
// stripped before it runs, so a comment quoting a field name can neither pass nor fail it.
// This file's own fixtures carry those names on purpose — the scan reads the view modules,
// never itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDocument, node, button, byClass, text } from './fake-dom.mjs';
import { isLiveSession } from '../api.js';

// The stub DOM is shared with test/app.test.mjs: small enough to read in one sitting, and the
// reason these are renders rather than greps.
installDocument();

const { render } = await import('../views/controls.js');

const notes = (el) =>
  byClass(el, 'btn-note')
    .map((n) => n.textContent)
    .join(' ');

const ctx = { reload: async () => {} };

function paint(view) {
  const el = node('div');
  render(el, view, ctx);
  return el;
}

// The row shapes the Worker actually emits. `ended` is what lingers in the list for a few
// seconds after a stop; it carries an id, which is exactly why an id was never enough.
const ended = {
  sessionId: 'ended-1',
  startedAt: '2026-09-11T08:00:00Z',
  stoppedAt: '2026-09-11T09:00:00Z',
  stopReason: 'Remote',
  completed: true,
  status: 'Available',
  stoppable: true,
};
const running = {
  sessionId: 'running-1',
  startedAt: '2026-09-11T10:00:00Z',
  stoppedAt: null,
  stoppedLocal: null,
  completed: false,
  status: 'Charging',
  stoppable: true,
};

// ── The predicate itself ──

test('a row is live only while it carries no stop mark in any spelling', () => {
  assert.equal(isLiveSession(running), true);
  assert.equal(isLiveSession(ended), false);
  assert.equal(isLiveSession(null), false);
  assert.equal(isLiveSession(undefined), false);
  // History rows carry no `completed` at all — the timestamp is the whole signal there.
  assert.equal(isLiveSession({ sessionId: 'h1', stoppedAt: '2026-09-11T09:00:00Z' }), false);
  assert.equal(isLiveSession({ sessionId: 'h2', stoppedLocal: '2026-09-11T12:00:00' }), false);
  assert.equal(isLiveSession({ sessionId: 'h3', deviceStopDate: '2026-09-11T09:00:00Z' }), false);
  assert.equal(isLiveSession({ sessionId: 'h4', deviceLocalStopDate: '2026-09-11T12:00' }), false);
  assert.equal(isLiveSession({ sessionId: 'h5' }), true);
  // completed is a flag, not a truthiness test: `false` is live, `true` is not.
  assert.equal(isLiveSession({ sessionId: 'h6', completed: false }), true);
});

// ── What the panel does with it ──

test('an ended session leaves Stop disabled, not enabled against a dead id', () => {
  const el = paint({ state: { sessions: [ended] } });

  assert.equal(button(el, 'עצירה').disabled, true, 'Stop was live against a session that had ended');
  assert.equal(button(el, 'התחלת טעינה').disabled, false, 'Start was held by an ended session');
  assert.match(notes(el), /אין טעינה שרצה/);
});

test('a running session enables Stop and holds Start', () => {
  const el = paint({ state: { sessions: [running] } });

  assert.equal(button(el, 'עצירה').disabled, false);
  assert.equal(button(el, 'התחלת טעינה').disabled, true);
});

test('the id sent to the charger is the live row, not the first row with an id', async () => {
  // Ended first: the list arrives in the order upstream gives it, and the old code took the
  // first row carrying an id. Clicking Stop here is what proves which one the caller picked.
  const el = paint({ state: { sessions: [ended, running] } });
  const sent = [];
  globalThis.fetch = async (path, init) => {
    sent.push({ path, body: init?.body ? JSON.parse(init.body) : null });
    if (path.startsWith('/api/charge/settle/')) return Response.json({ session: { completed: true } });
    return Response.json({ session: { sessionId: 'running-1', completed: false } });
  };

  await button(el, 'עצירה').handlers.click();

  const stopCall = sent.find((call) => call.path === '/api/charge/stop');
  assert.ok(stopCall, 'the stop press sent no stop command');
  assert.equal(stopCall.body.sessionId, 'running-1', 'the stop command named a session that had already ended');
});

// ── The sign-in that has ended ──
//
// The worse path is the mounted one. A viewer whose session ends mid-visit has every panel
// painted already, so app.js's error block -- the one that carries the "sign in again" wording
// -- is never reached: a failed round deliberately leaves a mounted subtree untouched. The only
// thing that changes on screen is the amber stale rule, which is also what an unplugged cable
// looks like. So the panel has to read the flag itself, and it has to read it on a re-render
// over a snapshot it has already painted, which is what these two renders are.

test('a sign-in that ends mid-visit disables both controls on the mounted panel', () => {
  const healthy = paint({ state: { sessions: [running] } });
  assert.equal(button(healthy, 'עצירה').disabled, false, 'precondition: the panel mounted live');

  // Same snapshot, one flag later: app.js keeps the last good bodies on purpose.
  const el = paint({ state: { sessions: [running] }, authRequired: true, stale: true });

  assert.equal(button(el, 'עצירה').disabled, true, 'Stop stayed live for a signed-out viewer');
  assert.equal(button(el, 'התחלת טעינה').disabled, true, 'Start stayed live for a signed-out viewer');
});

test('the reason names the one action that can work, and never the one that cannot', () => {
  const el = paint({ state: { sessions: [running] }, authRequired: true });

  assert.match(notes(el), /ההתחברות לדף הסתיימה/);
  // Reload AND sign in, both halves. A reload of a signed-out page lands on the sign-in card,
  // which is the thing that actually ends this state, so the note names the card as well --
  // app.js paints it from the same flag, above these panels, before this panel is painted.
  assert.match(notes(el), /טענו את הדף מחדש/);
  assert.match(notes(el), /בכרטיס שלמעלה/);
  // The one control that provably cannot mend a sign-out is the one it must never send them to.
  assert.doesNotMatch(notes(el), /לחצו רענון/);
});

// The refresh button is not how this state is usually met. Nothing here polls, so between the
// round that painted the snapshot and the moment the session ends the page looks identical --
// and the press itself is the first thing to touch the server. The 401 it comes back with is
// the page's first news of its own sign-out, and a button that has just been told it cannot act
// must not go straight back to looking live.
test('a command that bounces runs the round that locks the panel', async () => {
  // app.js is the only writer of the flag and load() is the only thing that raises the sign-in
  // card, marks the data stale and re-gates the other panels. So what this module owes a 401 is
  // that round, never a private copy of the flag -- a copy would lock these two buttons and
  // leave the rest of the page still claiming to be signed in. The view object here is the
  // shared one, exactly as app.js hands it over, so writing the flag inside reload() is what a
  // real round does to it.
  const view = { state: { sessions: [running] } };
  let reloads = 0;
  const signsOutOnReload = {
    reload: async () => {
      reloads++;
      view.authRequired = true;
    },
  };

  const el = node('div');
  render(el, view, signsOutOnReload);
  assert.equal(button(el, 'עצירה').disabled, false, 'precondition: the panel mounted live');

  globalThis.fetch = async () => Response.json({ error: 'no_session' }, { status: 401 });
  await button(el, 'עצירה').handlers.click();

  assert.equal(reloads, 1, 'a bounced command never told the shell its session had ended');
  assert.equal(button(el, 'עצירה').disabled, true, 'Stop went back to looking live after a 401');
  assert.equal(button(el, 'התחלת טעינה').disabled, true, 'Start went back to looking live after a 401');
  // Nothing was commanded and nothing stopped: the reload is about the session, not the charger.
  assert.match(notes(el) + ' ' + text(el), /שום דבר לא נעצר/);
});

test('a sign-in that has ended outranks an expired credential', () => {
  // Both flags can be true at once, and only one of the two instructions is reachable: the
  // credential field posts to the same gate that just bounced this round.
  const el = paint({ state: { sessions: [running] }, authRequired: true, expired: true });

  assert.match(notes(el), /ההתחברות לדף הסתיימה/);
  assert.doesNotMatch(notes(el), /התקינו הרשאה חלופית/);
});

test('an expired credential still disables both controls', () => {
  const el = paint({ state: { sessions: [running] }, expired: true });

  assert.equal(button(el, 'עצירה').disabled, true);
  assert.equal(button(el, 'התחלת טעינה').disabled, true);
  assert.match(notes(el), /התקינו הרשאה חלופית/);
});

// ── No module may grow a second definition ──

const source = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

// Comments are not code. A file explaining why it must not spell this itself would otherwise
// fail for containing the explanation — the mistake this suite has made before.
const nocomments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

// Every spelling of "this session has stopped" that has been in this tree. A view has no other
// use for them today: the table renders start times, and the stop column reads `stopReason`.
// If one ever needs to *display* a stop time, that goes through a helper next to the predicate
// and this list gains the reason, not an exception.
const STOP_MARKS = /stoppedAt|stoppedLocal|deviceStopDate|deviceLocalStopDate/;

// ponytail: the scan catches the four stop-field spellings and a dropped import, not every
// predicate someone could invent (`status !== 'charging'` would walk past it). The rendering
// tests above are what actually hold the contactor; this is the cheap net over drift.
test('no view spells liveness for itself', () => {
  for (const name of ['views/tariff.js', 'views/history.js', 'views/controls.js']) {
    const code = nocomments(source(name));
    assert.ok(
      /import\s*\{[^}]*\bisLiveSession\b[^}]*\}\s*from\s*'\.\.\/api\.js'/.test(code),
      `${name} stopped importing the shared predicate`
    );
    assert.equal(
      STOP_MARKS.test(code),
      false,
      `${name} grew its own spelling of a stopped session`
    );
  }
});

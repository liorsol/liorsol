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
import { isLiveSession } from '../api.js';

// ── A DOM small enough to read in one sitting ──
//
// Everything views/controls.js touches and nothing else. A real headless browser would test
// the same property here; this runs in `node --test` with no dependency, which is what makes
// it cheap enough to keep.

function node(tag) {
  const self = {
    tagName: tag,
    children: [],
    className: '',
    textContent: '',
    disabled: false,
    handlers: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    matches: () => false,
    addEventListener(type, fn) {
      self.handlers[type] = fn;
    },
    append(...kids) {
      // A fragment is flattened into its parent, the way the real one is.
      for (const kid of kids) {
        if (kid.tagName === '#fragment') self.children.push(...kid.children);
        else self.children.push(kid);
      }
    },
    replaceChildren(...kids) {
      self.children = [];
      self.append(...kids);
    },
  };
  return self;
}

globalThis.document = {
  createElement: node,
  createDocumentFragment: () => node('#fragment'),
};

const { render } = await import('../views/controls.js');

const all = (el) => el.children.flatMap((child) => [child, ...all(child)]);
const button = (el, label) =>
  all(el).find((n) => n.tagName === 'button' && n.textContent === label);
const notes = (el) =>
  all(el)
    .filter((n) => n.className === 'btn-note')
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

  assert.equal(button(el, 'Stop').disabled, true, 'Stop was live against a session that had ended');
  assert.equal(button(el, 'Start charging').disabled, false, 'Start was held by an ended session');
  assert.match(notes(el), /no session is running/i);
});

test('a running session enables Stop and holds Start', () => {
  const el = paint({ state: { sessions: [running] } });

  assert.equal(button(el, 'Stop').disabled, false);
  assert.equal(button(el, 'Start charging').disabled, true);
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

  await button(el, 'Stop').handlers.click();

  const stopCall = sent.find((call) => call.path === '/api/charge/stop');
  assert.ok(stopCall, 'the stop press sent no stop command');
  assert.equal(stopCall.body.sessionId, 'running-1', 'the stop command named a session that had already ended');
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

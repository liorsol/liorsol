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
import { installDocument, node, button, byClass, text, all } from './fake-dom.mjs';
import { isLiveSession } from '../api.js';

// The stub DOM is shared with test/app.test.mjs: small enough to read in one sitting, and the
// reason these are renders rather than greps.
installDocument();

const module = await import('../views/controls.js');
const { render, renderExpiry, release, setBody } = module;

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

// ── A sign-in that ends in the middle of the settle poll ──
//
// The worst version of the pairing this file forbids. The stop press succeeds, the poll starts,
// and the session ends while it runs: every remaining sample is bounced by the same gate, so
// the poll can only ever run out. The wording for running out says press refresh -- and this
// suite already asserts, twice above, that refresh is the one thing a dead sign-in must never
// be sent to. pollStart has had a branch for exactly this since it was written; pollSettle did
// not, and this is the only place in the product where the rule leaked.
//
// Slow under the defect and instant once fixed: the broken version spends 45 samples a second
// apart before it reaches the assertions.
test('a settle that bounces names the sign-in card, and never refresh', async () => {
  const view = { state: { sessions: [running] } };
  const el = node('div');
  // A real round is what raises the sign-in card, so the reload writes the flag the same way
  // app.js's load() does -- the note's own instruction is only true because of it.
  render(el, view, { reload: async () => { view.authRequired = true; } });
  assert.equal(button(el, 'עצירה').disabled, false, 'precondition: the panel mounted live');

  let settleCalls = 0;
  globalThis.fetch = async (path) => {
    if (path.startsWith('/api/charge/settle/')) {
      settleCalls++;
      return Response.json({ error: 'auth_required' }, { status: 401 });
    }
    return Response.json({ session: { sessionId: 'running-1', completed: false } });
  };

  await button(el, 'עצירה').handlers.click();

  assert.equal(settleCalls, 1, 'the poll kept sampling a session whose sign-in had already ended');
  const said = notes(el) + ' ' + text(el);
  assert.match(said, /ההתחברות לדף הסתיימה/, 'a stop whose sign-in ended never said so');
  assert.doesNotMatch(said, /לחצו רענון/, 'a dead sign-in was sent to press refresh');
});

// ── Three upstream conditions, and only one of them is a credential ──
//
// The banner slot is one <div> and the states share a stylesheet, so what separates them is the
// text and the presence of the field. A configuration fault wearing the expiry banner is the
// defect these exist for: it told the owner to go and renew a credential that was healthy, in
// an app on their phone, and the renewal could not have helped.

const banner = (state) => {
  const el = node('div');
  renderExpiry(el, state, ctx);
  return el;
};
const fields = (el) => all(el).filter((n) => n.tagName === 'input');

test('a genuinely expired credential still gets the banner and the field', () => {
  const el = banner({ expired: true });
  assert.match(text(el), /פג תוקף ההרשאה/);
  assert.equal(fields(el).length, 1, 'the one state a pasted credential can mend lost its field');
});

test('an unreachable charger is not painted as an expired credential', () => {
  const el = banner({ chargerFault: 'charger_unreachable' });
  const said = text(el);

  assert.notEqual(said, '', 'an upstream fault painted no banner at all');
  assert.doesNotMatch(said, /פג תוקף/, 'a configuration fault was painted as an expired credential');
  assert.match(said, /אינה בעיית הרשאה/, 'the banner never said this is not a credential problem');
  assert.equal(fields(el).length, 0, 'a configuration fault offered a credential field to paste into');
});

test('a malformed answer is its own state, distinct from both of the others', () => {
  const el = banner({ chargerFault: 'charger_bad_reply' });
  const said = text(el);

  assert.notEqual(said, '', 'a malformed upstream answer painted no banner at all');
  assert.notEqual(said, text(banner({ chargerFault: 'charger_unreachable' })), 'two different faults painted the same words');
  assert.doesNotMatch(said, /פג תוקף/, 'a malformed answer was painted as an expired credential');
  assert.equal(fields(el).length, 0, 'a malformed answer offered a credential field to paste into');
});

test('an upstream fault locks the controls, and says which kind of fault it is not', () => {
  const el = paint({ state: { sessions: [running] }, chargerFault: 'charger_unreachable' });

  assert.equal(button(el, 'עצירה').disabled, true, 'Stop stayed live with no link to the charger');
  assert.equal(button(el, 'התחלת טעינה').disabled, true, 'Start stayed live with no link to the charger');
  assert.match(notes(el), /אינה בעיית הרשאה/);
  assert.doesNotMatch(notes(el), /התקינו הרשאה חלופית/, 'a configuration fault sent the owner to paste a credential');
});

// ── The theme seam, and the one rule about the command path ──
//
// Five themes are being written in parallel against THEMES.md, and one of them puts a lever you
// drag to the end of its slot where the stop button is. A theme may do that. What it may not do
// is own the command behind it: there is one stop(), one busy flag, one settle poll and one
// release(ctx, reload, force), and five code paths to a contactor is how this project gets hurt
// -- it has already shipped two bugs inside this exact window.
//
// So the seam hands a builder the gate and two doors and nothing else, and these tests are what
// says so. They RENDER a theme body, fire its affordance, and read the request that left.

test('a theme body replaces the panel and is handed the gate, the ui state and the two doors', () => {
  const seen = [];
  setBody((gateIn, uiIn, pressIn) => {
    seen.push({ gateIn, uiIn, pressIn });
    return node('div');
  });
  paint({ state: { sessions: [running] } });
  setBody(null);

  assert.equal(seen.length, 1, 'the theme body was not used');
  const { gateIn, uiIn, pressIn } = seen[0];
  assert.equal(gateIn.startOff, true, 'the gate did not travel with the body');
  assert.equal(gateIn.stopOff, false);
  assert.equal(gateIn.session.sessionId, 'running-1', 'the body was not told which row is live');
  assert.match(gateIn.reasons.join(' '), /טעינה כבר רצה/, 'the reason a control is locked did not travel');
  assert.deepEqual(Object.keys(uiIn).sort(), ['busy', 'busyLabel', 'note', 'settle']);
  assert.deepEqual(Object.keys(pressIn).sort(), ['start', 'stop'], 'the seam grew a third door');
});

test('a theme affordance stops the charge through the one command path', async () => {
  const sent = [];
  globalThis.fetch = async (path, init) => {
    sent.push({ path, body: init?.body ? JSON.parse(init.body) : null });
    if (path.startsWith('/api/charge/settle/')) return Response.json({ session: { completed: true } });
    return Response.json({ session: { sessionId: 'running-1', completed: false } });
  };

  let door = null;
  setBody((_gate, _ui, pressIn) => {
    door = pressIn;
    return node('div');
  });
  paint({ state: { sessions: [ended, running] } });

  await door.stop();
  setBody(null);

  const stopCall = sent.find((call) => call.path === '/api/charge/stop');
  assert.ok(stopCall, 'a theme affordance sent no stop command');
  assert.equal(stopCall.body.sessionId, 'running-1', 'the theme path picked a different row from the button path');
  assert.ok(
    sent.some((call) => call.path.startsWith('/api/charge/settle/')),
    'the theme path skipped the settle poll -- it must reuse it, never reimplement it'
  );
});

test('a theme affordance cannot fire a command the gate has already locked', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({});
  };

  let door = null;
  setBody((_gate, _ui, pressIn) => {
    door = pressIn;
    return node('div');
  });
  // No session: Stop is locked. A default button would be `disabled` and could not be clicked;
  // a lever is a <div> with a listener and has no such protection, so the guard is on the door.
  paint({ state: { sessions: [] } });
  await door.stop();
  // And the mirror: a charge is running, so Start is locked.
  paint({ state: { sessions: [running] } });
  await door.start();
  setBody(null);

  assert.equal(calls, 0, 'a locked control reached the charger');
});

// ── A REFUSAL THAT CAN NAME ITS REASON, AND STILL REFUSES ──
//
// `press` re-reads the gate at the moment of the call, and that read is the only CURRENT one:
// app.js mutates the shared view object in place, so the gate a custom affordance was BUILT with
// can already be out of date by the time a gesture completes -- which is exactly the case a
// refusal has to explain. Both halves matter: the door must still refuse, and it must come back
// with something a caller can put on screen. One theme had to split its refusal into two vaguer
// messages because `undefined` carried no reason at all.
test('a refused press comes back with the reason, read at the moment of the press', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({});
  };

  let door = null;
  setBody((_gate, _ui, pressIn) => {
    door = pressIn;
    return node('div');
  });

  // Built against a page with a charge running: Start is locked.
  paint({ state: { sessions: [running] } });
  const held = door.start();
  assert.equal(held.ok, false, 'a locked door did not report itself refused');
  assert.match(held.reasons.join(' '), /טעינה כבר רצה/, 'the refusal carried no reason');

  // The page moves under the affordance -- the sign-in ends -- and the SAME door is pressed.
  // The reason has to be the one that is true now, not the one the builder was handed.
  paint({ state: { sessions: [running] }, authRequired: true });
  const bounced = door.stop();
  assert.equal(bounced.ok, false, 'an ended sign-in did not shut the door');
  assert.match(
    bounced.reasons.join(' '),
    /ההתחברות לדף הסתיימה/,
    'the refusal quoted a stale reason instead of the one that is true at the moment of the press'
  );
  assert.doesNotMatch(bounced.reasons.join(' '), /טעינה כבר רצה/, 'the refusal was read off a stale gate');
  setBody(null);

  // And the whole point: naming the reason did not open the door.
  assert.equal(calls, 0, 'a refused press reached the charger');
});

test('the gate carries staleness, so a body does not have to reach for a CSS ancestor', () => {
  // It does NOT lock anything: stale data is still the only data there is, and a control that
  // refused to work whenever the network hiccuped would be its own defect. It is exposed because
  // a theme that animates a figure while energy flows has to stop moving a number the page can
  // no longer vouch for, and it used to read that off `.stale`, app.js's wrapper element.
  const fresh = module.gate({ state: { sessions: [running] }, stale: false });
  assert.equal(fresh.stale, false);
  assert.equal(fresh.stopOff, false, 'freshness was made a precondition of stopping');

  const old = module.gate({ state: { sessions: [running] }, stale: true });
  assert.equal(old.stale, true, 'the gate cannot see staleness at all');
  assert.equal(old.stopOff, false, 'stale data locked a control it has no business locking');
  assert.deepEqual(old.reasons, fresh.reasons, 'staleness grew a reason and changed what the panel says');
});

test('setBody(null) gives the panel its own body back', () => {
  setBody(() => node('div'));
  paint({ state: { sessions: [running] } });
  setBody(null);
  const el = paint({ state: { sessions: [running] } });
  assert.ok(button(el, 'עצירה'), 'the default buttons did not come back');
});

// The surface a theme can reach, pinned. Widening it is how "a theme may change how the stop
// control looks" becomes "a theme owns the stop command": export onStart, or the settle poll,
// or the ui object itself, and a theme body can drive the contactor without the gate.
test('the module exports the seam and nothing that reaches past it', () => {
  assert.deepEqual(
    Object.keys(module).sort(),
    // STANDING_NOTE is a string, not a door: it is the sentence saying there is no charge-now
    // control and no off-peak scheduler, and it is exported so the five themes that replace this
    // body render the module's copy instead of each keeping their own.
    ['STANDING_NOTE', 'gate', 'press', 'release', 'render', 'renderExpiry', 'setBody'],
    'views/controls.js changed what a theme can reach. The command itself -- onStart, onStop, ' +
      'the busy flag, both polls -- is module-private on purpose; a theme gets the gate, a ' +
      'snapshot of the ui state and the two guarded doors, and nothing else.'
  );
});

// ── The parameter that has no default, and must not grow one ──
//
// release(ctx, reload, force) is the shared exit of start, stop AND the credential install. A
// reload that does not force re-reads the D1 row -- correctly served back untouched while it is
// under an hour old -- and repaints the charger as it was BEFORE the command. That is the bug
// the owner met standing at the charger watching a button do nothing, and it is invisible from
// the call site.
//
// `force` therefore has no default ON PURPOSE, so that a future call site which forgets it is a
// bug at the moment it is written rather than a silent cache read. The danger is that the
// missing default reads as an oversight: adding `force = false` keeps every call site working
// and every other test green, and hands the defect back to all three paths.
//
// Function.prototype.length stops counting at the first defaulted parameter, so this is a
// runtime property of the real function -- not a grep over its source text. `release` is
// exported for no other reason than to be reachable here.
test('release() takes force with no default, so a caller cannot omit it', () => {
  assert.equal(
    release.length,
    3,
    'release() grew a default for a parameter whose whole job is to be impossible to forget: ' +
      'a defaulted `force` makes a post-command reload read the hour-old cache and repaint the ' +
      'charger as it was before the command, on start, stop and the credential install alike'
  );
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

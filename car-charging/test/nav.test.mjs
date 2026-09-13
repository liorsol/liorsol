// Run: node --test car-charging/test/nav.test.mjs
//
// The menu, driven end to end against a stub DOM and a stub transport.
//
// The owner's requirement was a shape, not a feature: "one page with menu ... most of the time
// we should see just current status. History, invoice and commenting should be in menu. The
// same way it was implemented in the travel webpages (either history and routing)." So what is
// worth pinning here is (a) that the default really is the status view alone, (b) that the hash
// really is the router, so Back and a deep link both land somewhere, and (c) the one that is a
// budget requirement rather than a taste:
//
//   A VIEW SWITCH MAKES NO REQUEST.
//
// All six views are mounted and repainted by one `load()` round, so a menu press moves a class
// over DOM that already holds its data. Put a fetch behind a menu press and an idle page stops
// being idle -- someone thumbing through six menu items spends six upstream calls, which is
// the invocation budget the whole one-hour cache rule exists to protect. That is asserted here
// by counting, not by reading the source.
//
// The two newest views are the ones this matters most for: their data does NOT come out of the
// server's hour-old cached row, so a fetch on entry would look harmless and cost a round trip
// every single time the menu item is pressed.
//
// The item count is fixed at six, always. `#/contact` used to be taken away together with its
// menu item on `{"contact": null}` -- an unfillable blank card behind a permanent menu item was
// a defect, so the fix was to hide both. It is not a defect any more: the card is editable from
// the page itself now, so a blank card is the ENTRY POINT for filling it in, and it has to stay
// reachable exactly as much as a full one does. This file asserts that directly: `#/contact`
// routes the same way whether `/api/contact` answers a card or `{"contact": null}`.
//
// Ordered and sharing one module instance, like app.test.mjs: app.js bootstraps on import and a
// page session is one load followed by presses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDocument, all, text } from './fake-dom.mjs';

const dom = installDocument();

// ── the stub transport ──

const AT = Date.now() - 5 * 60000;

const BODIES = {
  '/api/state': {
    fetchedAt: AT,
    stale: false,
    charger: { offPeakState: 'Off', connectors: [{ connectorId: 1, status: 'Available' }] },
    pricingSlices: [
      { name: 'cheap', price: 0.45, vat: 18, from: '2026-09-11T00:00:00Z', to: '2026-09-11T17:00:00Z' },
      { name: 'peak', price: 1.26, vat: 18, from: '2026-09-11T17:00:00Z', to: '2026-09-11T22:00:00Z' },
    ],
    sessions: [],
  },
  '/api/history': { fetchedAt: AT, stale: false, sessions: [], totals: { count: 0 } },
  '/api/invoices': { fetchedAt: AT, stale: false, invoices: [] },
  '/api/comments': { comments: [] },
  // The two live routes. Neither carries a fetchedAt or a stale flag -- they are read on the
  // far side every time -- and both are answered in the same round as the three above, which
  // is the whole reason the menu can stay fetch-free with six items on it.
  '/api/sessions': {
    sessions: [
      { jti: 'a', createdAt: AT, lastSeen: AT, userAgent: 'Mozilla/5.0 (iPhone)', location: 'IL', current: true },
    ],
  },
  // Mutable: this file exercises BOTH shapes of the menu. `configured` is the six-item page;
  // `{"contact": null}` is the five-item one, and the round that flips it is a test below.
  // The value is a placeholder -- nothing real is written into a fixture in this repository.
  '/api/contact': { contact: { name: 'PLACEHOLDER' } },
};

/** Put the contact route into one of its two states for the next round. */
const configureContact = (on) => {
  BODIES['/api/contact'] = { contact: on ? { name: 'PLACEHOLDER' } : null };
};

let signedIn = false;
let calls = 0;

globalThis.fetch = async (path) => {
  calls += 1;
  if (!signedIn) return Response.json({ error: 'no_session' }, { status: 401 });
  return Response.json(BODIES[String(path).split('?')[0]] ?? { ok: true });
};

async function until(predicate, what) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('timed out waiting for ' + what);
}

await import('../app.js');

const VIEWS = ['status', 'history', 'invoices', 'comments', 'sessions', 'contact'];
const view = (name) => dom.get('#view-' + name);
const link = (name) => dom.get('#nav-' + name);
const nav = () => dom.get('#nav');
const toggle = () => dom.get('#navtoggle');
const refresh = () => dom.get('#refresh');

/** The one invariant of the whole file: exactly one view on screen, and it is this one. */
function onlyShown(name) {
  for (const other of VIEWS) {
    assert.equal(
      view(other).classes.has('is-active'),
      other === name,
      `expected only #view-${name} on screen, but #view-${other} disagreed`
    );
    assert.equal(
      link(other).getAttribute('aria-current'),
      other === name ? 'page' : null,
      `the menu item for ${other} announced the wrong thing`
    );
  }
}

// ── Round 1: the cold load, signed out ──

test('a signed-out page has no menu at all', async () => {
  await until(() => text(dom.get('.shell__main').children[0]).length > 0, 'the first round to paint');

  // The sign-in card is the page in this state. A rail offering six destinations that are all
  // detached from the document would put the one card that matters below six empty screens.
  assert.equal(nav().hidden, true, 'the menu stayed up on a page with nothing behind it');
  assert.equal(toggle().hidden, true, 'the drawer handle stayed up on a signed-out page');
});

// ── The hash change that used to take the page down, and it was live ──
//
// Signed out cold, `paintAuthRequired()` detaches every `.view` section from <main>: the sign-in
// card IS the page. A detached element is not findable by `document.getElementById`, and route()
// reached straight into `getElementById('view-' + id).classList` for all six of them -- so ANY
// hash change in this state threw an uncaught TypeError. It is not a contrived state either: a
// bookmarked `#/history`, a Back press onto one, or a link the owner sent themselves all land
// here, on the one screen where the only thing that matters is being able to ask for a sign-in
// link. The card is still rendered, so the page LOOKS fine and the console is where the failure
// went.
//
// Driven rather than read: the stub's getElementById now returns null for a detached node, the
// way a browser does, so this test can only pass if route() does not depend on the lookup.
test('a hash change on a signed-out page does not throw, and leaves the card alone', () => {
  for (const name of VIEWS) assert.equal(inMain(name), false, `#view-${name} was still in <main>`);
  const card = () => text(main().children[0]);
  const before = card();
  assert.match(before, /\S/, 'the sign-in card was not up on a cold signed-out page');

  // A bookmark, a Back press, a typed hash, and the way back to the default.
  for (const hash of ['#/history', '#/contact', '#history', '#/nonsense', '#/status', '']) {
    dom.navigate(hash);
  }

  assert.equal(card(), before, 'a hash change disturbed the sign-in card');
  // And no section quietly came back wearing `.is-active` while it was out of the document.
  for (const name of VIEWS) {
    assert.equal(inMain(name), false, `#view-${name} was reattached by a hash change`);
  }
});

// ── Round 2: signed in ──

test('the default view is the current status and nothing else', async () => {
  signedIn = true;
  await refresh().handlers.click();
  await until(
    () => all(dom.get('#comments')).some((n) => n.className === 'empty__hint' || n.className === 'comment'),
    'the notes board to finish its own round'
  );

  assert.equal(nav().hidden, false, 'the menu did not come back with the data');
  onlyShown('status');

  // The point of the whole change: the tariff and the controls are on screen, the other five
  // panels are mounted but behind a menu item.
  assert.match(text(view('status')), /\S/, 'the status view came up empty');
  assert.match(text(view('history')), /\S/, 'the history view was never filled');
  assert.match(text(view('invoices')), /\S/, 'the invoices view was never filled');
  assert.match(text(view('sessions')), /\S/, 'the sessions view was never filled');
  assert.match(text(view('contact')), /\S/, 'the contact view was never filled');
});

// ── The budget assertion ──

test('walking the whole menu makes no request', () => {
  const before = calls;
  for (const name of ['history', 'invoices', 'comments', 'sessions', 'contact', 'status', 'history']) {
    dom.navigate('#/' + name);
  }
  assert.equal(calls, before, 'a menu press reached upstream');
  onlyShown('history');
});

// ── Routing ──

test('the hash is the router, and every view is deep-linkable', () => {
  for (const name of VIEWS) {
    dom.navigate('#/' + name);
    onlyShown(name);
  }
  // Back out of a deep link: the browser restores the hash and fires the same event, which is
  // exactly what dom.navigate() is. Nothing in app.js writes location.hash, so there is no
  // second writer to fight the history entry.
  dom.navigate('#/status');
  onlyShown('status');
});

// Two panel BODIES are id="history" and id="comments", so a bare `#history` is a fragment that
// really resolves and the browser scrolls that panel into view before the router runs. The
// routes carry a leading slash so the hash can never name an element -- but the slash is
// optional on the way in, or every bookmark made before this shape existed breaks.
test('a slashless hash still routes, so an old bookmark lands', () => {
  dom.navigate('#comments');
  onlyShown('comments');
  dom.navigate('#status');
  onlyShown('status');
});

test('a hash that names nothing lands on the status view, not on a blank page', () => {
  dom.navigate('#/invoices');
  onlyShown('invoices');
  dom.navigate('#/a-view-that-was-renamed');
  onlyShown('status');
  dom.navigate('');
  onlyShown('status');
});

// ── The drawer ──

test('the drawer opens on the handle and closes on the press that navigates', () => {
  dom.navigate('#/status');

  toggle().handlers.click();
  assert.equal(nav().classes.has('is-open'), true, 'the handle did not open the drawer');
  assert.equal(toggle().getAttribute('aria-expanded'), 'true');

  dom.navigate('#/history');
  assert.equal(nav().classes.has('is-open'), false, 'the drawer stayed open over the view it opened');
  assert.equal(toggle().getAttribute('aria-expanded'), 'false');

  // Pressing the item that is ALREADY open fires no hashchange, so the router never runs and
  // cannot be what closes the drawer. The nav's own click handler is.
  toggle().handlers.click();
  nav().handlers.click();
  assert.equal(nav().classes.has('is-open'), false, 're-pressing the open view left the drawer up');

  // And the scrim, which is the only way out for a press that misses the menu entirely.
  toggle().handlers.click();
  dom.get('#navscrim').handlers.click();
  assert.equal(nav().classes.has('is-open'), false, 'the scrim did not dismiss the drawer');
});

// ── #/contact stays reachable whether the card is full or empty ──
//
// This used to be "the destination the data can take away": `{"contact": null}` took the menu
// item and the section away together, on the theory that an unfillable blank card behind a
// permanent menu item was a defect. It is not a defect any more — the card is editable from the
// page itself now (views/contact.js), so an empty card is the ENTRY POINT for filling it in, and
// hiding it was reported back as "the contacts section doesn't work". These tests are the
// replacement promise: `#/contact` is a plain sixth destination, full or empty, exactly like the
// other five, with no on/off behaviour left to prove.

const main = () => dom.get('.shell__main');
const inMain = (name) => main().children.includes(view(name));

/** Let the round finish, including the notes board's own fetch, before counting anything. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

test('a configured card is a menu item and a routable view', async () => {
  await settled();
  assert.equal(link('contact').hidden, false, 'the item was missing while there was a card to show');
  assert.equal(inMain('contact'), true, 'the section was not in <main> while there was a card to show');

  dom.navigate('#/contact');
  onlyShown('contact');
});

test('{"contact": null} does not take the item or the section away — it is now the way to fill it in', async () => {
  // Standing ON the view when the data goes empty: the worst moment for a hiding rule to fire,
  // and exactly the state a viewer is in the first time they open this card to fill it in.
  onlyShown('contact');

  configureContact(false);
  await refresh().handlers.click();
  await settled();

  assert.equal(link('contact').hidden, false, 'the empty card lost its menu item');
  assert.equal(inMain('contact'), true, 'the empty card was detached from <main>');
  // The other five are untouched either way — this was never about them.
  for (const name of ['status', 'history', 'invoices', 'comments', 'sessions']) {
    assert.equal(link(name).hidden, false, `the ${name} item was disturbed by the contact card's own data`);
    assert.equal(inMain(name), true, `the ${name} section was disturbed by the contact card's own data`);
  }

  // Still standing on it: an empty card is not a reason to be moved off the view.
  onlyShown('contact');

  // The deep link still lands there too, same as any other view.
  dom.navigate('#/status');
  dom.navigate('#/contact');
  onlyShown('contact');

  // Six items throughout, and walking them still costs nothing.
  const before = calls;
  for (const name of ['history', 'invoices', 'comments', 'sessions', 'contact', 'status']) {
    dom.navigate('#/' + name);
  }
  assert.equal(calls, before, 'a menu press reached upstream');
});

test('the values coming back changes nothing about reachability, only what the card shows', async () => {
  configureContact(true);
  await refresh().handlers.click();
  await settled();

  assert.equal(link('contact').hidden, false);
  assert.equal(inMain('contact'), true);

  dom.navigate('#/contact');
  onlyShown('contact');
});

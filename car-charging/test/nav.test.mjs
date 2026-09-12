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
// All four views are mounted and repainted by one `load()` round, so a menu press moves a class
// over DOM that already holds its data. Put a fetch behind a menu press and an idle page stops
// being idle -- someone thumbing through four menu items spends four upstream calls, which is
// the invocation budget the whole one-hour cache rule exists to protect. That is asserted here
// by counting, not by reading the source.
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

const VIEWS = ['status', 'history', 'invoices', 'comments'];
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

  // The sign-in card is the page in this state. A rail offering four destinations that are all
  // detached from the document would put the one card that matters below four empty screens.
  assert.equal(nav().hidden, true, 'the menu stayed up on a page with nothing behind it');
  assert.equal(toggle().hidden, true, 'the drawer handle stayed up on a signed-out page');
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

  // The point of the whole change: the tariff and the controls are on screen, the other three
  // panels are mounted but behind a menu item.
  assert.match(text(view('status')), /\S/, 'the status view came up empty');
  assert.match(text(view('history')), /\S/, 'the history view was never filled');
  assert.match(text(view('invoices')), /\S/, 'the invoices view was never filled');
});

// ── The budget assertion ──

test('walking the whole menu makes no request', () => {
  const before = calls;
  for (const name of ['history', 'invoices', 'comments', 'status', 'history']) {
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

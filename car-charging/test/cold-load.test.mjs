// Run: node --test car-charging/test/cold-load.test.mjs
//
// The load nobody watched: the page opened, or reloaded, while the credential is expired.
// It is the LIKELY path into that state -- the owner opens the dashboard because they were
// told the credential expired -- and it is the one an already-loaded session can never show,
// because browser storage is forbidden and a reload starts from nothing.
//
// What the owner asked for, in their words: cached data stays visible underneath the banner,
// clearly marked stale with its age. Explicitly not an empty chart, a spinner, a zero, or a
// generic something went wrong. The server now answers 503 with its own last cached row
// attached; this file is about the page keeping it instead of throwing it away.
//
// Two rounds, in the order that separates the fix from a fabrication: an EMPTY cache first,
// which must still render the banner and must not invent a charger to draw; then the row
// present, which must paint it. One process per bootstrap -- app.js starts its first round on
// import -- which is why this is its own file rather than more tests in app.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDocument, all, text, button } from './fake-dom.mjs';

const dom = installDocument();

// Three hours old: stale, and old enough that the header must print the row's own age rather
// than the age of the round that failed to refresh it.
const ROW_AT = Date.now() - 3 * 3600000;

// What the server sends back on a read route once the credential has expired: the cached
// payload, `stale: true`, the row's original stamp, and the error last so nothing shadows it.
const CACHED = {
  '/api/state': {
    fetchedAt: ROW_AT,
    stale: true,
    charger: { offPeakState: 'Off', connectors: [{ connectorId: 1, status: 'Available' }] },
    pricingSlices: [
      { name: 'cheap', price: 0.45, vat: 18, from: '2026-09-11T00:00:00Z', to: '2026-09-11T17:00:00Z' },
      { name: 'peak', price: 1.26, vat: 18, from: '2026-09-11T17:00:00Z', to: '2026-09-11T22:00:00Z' },
    ],
    sessions: [],
    error: 'token_expired',
  },
  '/api/history': {
    fetchedAt: ROW_AT,
    stale: true,
    sessions: [
      {
        sessionId: 'past-1',
        startedAt: '2026-09-10T20:00:00Z',
        stoppedAt: '2026-09-11T04:00:00Z',
        durationInSeconds: 28800,
        totalEnergy: 31.4,
        totalPaymentCostIncVat: 15.09,
        vatRate: 18,
        levels: [],
      },
    ],
    totals: { count: 1, totalEnergy: 31.4 },
    error: 'token_expired',
  },
  '/api/invoices': { fetchedAt: ROW_AT, stale: true, invoices: [], error: 'token_expired' },
};

// An empty cache: the error and nothing else. No zeroes, no empty arrays, nothing to draw.
const EMPTY = { error: 'token_expired' };

let cacheWarm = false;

globalThis.fetch = async (path) => {
  const route = String(path).split('?')[0];
  if (route === '/api/comments') return Response.json({ comments: [] });
  if (!CACHED[route]) return Response.json(EMPTY, { status: 503 }); // refresh, and anything else
  return Response.json(cacheWarm ? CACHED[route] : EMPTY, { status: 503 });
};

async function until(predicate, what) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('timed out waiting for ' + what);
}

await import('../app.js');

const panel = (id) => dom.get('#' + id);
const DATA = ['tariff', 'history', 'account'];
const expiryBanner = () => dom.get('#expiry');
// The sign-in card's mount: always <main>'s first child, empty while there is a session.
const signInCard = () => dom.get('.shell__main').children[0];
const refresh = () => dom.get('#refresh');
const hasClass = (el, className) => all(el).some((n) => n.className === className);

// ── Round 1: expired, and the server has nothing cached either ──

test('an empty cache renders the banner and invents nothing to put under it', async () => {
  // The notes board is the slowest thing in a round -- its own fetch lands after the shell's --
  // so its verdict is the signal that the round is over. Waiting on anything this test asserts
  // would be waiting for the answer.
  await until(
    () => all(panel('comments')).some((n) => n.className === 'empty__hint'),
    'the first round to finish'
  );

  assert.match(text(expiryBanner()), /פג תוקף ההרשאה/, 'no expiry banner on a cold load');
  assert.ok(
    all(expiryBanner()).some((n) => n.tagName === 'input'),
    'the banner came up without the field that fixes it'
  );

  for (const id of DATA) {
    // The honest empty state: nothing has ever arrived. What must NOT appear is a charger, a
    // price or a session assembled out of a body that carried none.
    assert.ok(hasClass(panel(id), 'empty empty--error'), `#${id} painted something other than its empty state`);
    assert.doesNotMatch(text(panel(id)), /kWh|₪/, `#${id} invented data from an empty payload`);
  }
});

// ── Round 2: the same expiry, with the row attached ──

test('the cached row rides out with the 503 and is painted under the banner', async () => {
  cacheWarm = true;
  await refresh().handlers.click();

  assert.match(text(expiryBanner()), /פג תוקף ההרשאה/, 'the banner went down while still expired');
  assert.equal(signInCard().children.length, 0, 'an expired credential was reported as a sign-out');

  for (const id of DATA) {
    assert.equal(
      hasClass(panel(id), 'empty empty--error'),
      false,
      `#${id} still shows a generic error card with cached data available`
    );
    assert.ok(hasClass(panel(id), 'stale__flag'), `#${id} shows cached data without marking it stale`);
  }

  // The data itself, not merely "something painted".
  assert.match(text(panel('tariff')), /0\.4500/, 'the cached tariff did not reach the panel');
  assert.match(text(panel('history')), /31\.4/, 'the cached session list did not reach the panel');

  // The age is the ROW's, not the round's: a page that printed "now" here would claim data is
  // fresh because the request that failed to refresh it was recent.
  const age = all(dom.get('.updated')).find((n) => n.className === 'updated__age');
  assert.match(age.textContent, /לפני 3 שעות/, 'the header aged the failed round, not the data on screen');

  // Distinct from the other two states, and it has to stay that way: the controls are held
  // because the credential is expired, and the reason says which of the three this is.
  assert.equal(button(panel('controls'), 'עצירה').disabled, true);
  assert.match(text(panel('controls')), /פג תוקף ההרשאה מול העמדה/);
  assert.doesNotMatch(text(panel('controls')), /ההתחברות לדף הסתיימה/);
});

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

// Round 3 answers the SAME rows under a different fault. `fault` is the whole difference: the
// server's error name and its status. Everything else about the round is identical, which is
// what makes the assertions about wording assertions about the name and nothing else.
let fault = { error: 'token_expired', status: 503 };

const withFault = (body) => ({ ...body, error: fault.error });

globalThis.fetch = async (path) => {
  const route = String(path).split('?')[0];
  if (route === '/api/comments') return Response.json({ comments: [] });
  const body = cacheWarm && CACHED[route] ? CACHED[route] : EMPTY;
  return Response.json(withFault(body), { status: fault.status });
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


// ── Round 3: the credential is fine, and the link to the charger is not ──
//
// The round the whole error split exists for, and the one that used to be indistinguishable
// from round 2. A wrong base URL -- which is what actually happened -- drew a 404 upstream, the
// server called it `token_expired`, and this page put up the credential banner: it told the
// owner to open the vendor's app and renew a credential that was healthy, and offered a box to
// paste the new one into. Every instruction on that banner was false and none of them could
// have worked.
//
// This is the round the view-level tests cannot stand in for. They hand `chargerFault` in by
// hand; only a real response proves app.js ever sets it, and sets it instead of `expired`.

test('an unreachable charger is not reported to the owner as a dead credential', async () => {
  fault = { error: 'charger_unreachable', status: 502 };
  await refresh().handlers.click();

  const said = text(expiryBanner());
  assert.notEqual(said, '', 'a link fault said nothing at all');
  assert.doesNotMatch(said, /פג תוקף/, 'a link fault was reported as an expired credential');
  assert.match(said, /אינה בעיית הרשאה/, 'the banner never denied being a credential problem');
  assert.equal(
    all(expiryBanner()).some((n) => n.tagName === 'input'),
    false,
    'a link fault offered a field to paste a credential into -- nothing pasted there can help'
  );
  assert.equal(signInCard().children.length, 0, 'a link fault was reported as a sign-out');

  // The wave-3 property, under the new name: what already arrived stays on screen and stays
  // marked stale. An outage blanks a first load exactly as an expiry did.
  for (const id of DATA) {
    assert.equal(hasClass(panel(id), 'empty empty--error'), false, `#${id} threw away the cached row`);
    assert.ok(hasClass(panel(id), 'stale__flag'), `#${id} shows cached data without marking it stale`);
  }
  assert.match(text(panel('tariff')), /0\.4500/, 'the cached tariff did not survive a link fault');

  // Locked, for a reason that names this state and neither of the other two.
  assert.equal(button(panel('controls'), 'עצירה').disabled, true);
  assert.match(text(panel('controls')), /אינה בעיית הרשאה/);
  assert.doesNotMatch(text(panel('controls')), /פג תוקף ההרשאה מול העמדה/);
  assert.doesNotMatch(text(panel('controls')), /ההתחברות לדף הסתיימה/);
});

test('a charger that answers something unreadable is a third state, not either of the others', async () => {
  fault = { error: 'charger_bad_reply', status: 502 };
  await refresh().handlers.click();

  const said = text(expiryBanner());
  assert.doesNotMatch(said, /פג תוקף/, 'an unreadable answer was reported as an expired credential');
  assert.doesNotMatch(said, /אין כרגע קשר לעמדה/, 'an unreadable answer was reported as an outage');
  assert.match(said, /אינה בעיית הרשאה/);
  assert.equal(all(expiryBanner()).some((n) => n.tagName === 'input'), false);
});

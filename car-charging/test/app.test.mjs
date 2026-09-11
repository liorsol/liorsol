// Run: node --test car-charging/test/app.test.mjs
//
// The shell, driven end to end against a stub DOM and a stub transport: three rounds in one
// page session, in the order a real one would meet them.
//
// What this exists to catch is a state the panels cannot show on their own. A sign-in that ends
// MID-VISIT leaves every panel mounted, and a failed round deliberately leaves a mounted subtree
// untouched -- that is the rule that makes "never blank a view on failure" structurally true.
// So nothing on screen changes except the amber stale rule, which is also what an unplugged
// cable looks like. Signed out and offline render the same picture unless something says
// otherwise, and the thing that says otherwise has to be read by the panel that holds the
// contactor, not just by the panel that draws an error card.
//
// Ordered, and sharing one module instance on purpose: app.js bootstraps itself on import and
// a page session is exactly this -- one load, then rounds driven by the refresh button. The
// rounds are cold-signed-out, healthy, signed-out-again, which is the sequence the fix is about.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDocument, all, text, button } from './fake-dom.mjs';

const dom = installDocument();

// ── the stub transport ──

const AT = Date.now() - 5 * 60000; // five minutes old, so the header renders an age, not a year

const running = {
  sessionId: 'running-1',
  startedAt: '2026-09-11T10:00:00Z',
  stoppedAt: null,
  completed: false,
  status: 'Charging',
  stoppable: true,
};

const BODIES = {
  '/api/state': {
    fetchedAt: AT,
    stale: false,
    charger: { offPeakState: 'Off', connectors: [{ connectorId: 1, status: 'Charging' }] },
    pricingSlices: [
      { name: 'cheap', price: 0.45, vat: 18, from: '2026-09-11T00:00:00Z', to: '2026-09-11T17:00:00Z' },
      { name: 'peak', price: 1.26, vat: 18, from: '2026-09-11T17:00:00Z', to: '2026-09-11T22:00:00Z' },
    ],
    sessions: [running],
  },
  '/api/history': { fetchedAt: AT, stale: false, sessions: [], totals: { count: 0 } },
  '/api/invoices': { fetchedAt: AT, stale: false, invoices: [] },
  '/api/comments': { comments: [] },
};

// What the edge answers once the session is gone: an opaque redirect. Status 0, no headers and
// no body to read -- api.js reads `type` and nothing else, which is the whole point of it.
const bounced = {
  type: 'opaqueredirect',
  status: 0,
  ok: false,
  json: async () => {
    throw new Error('an opaque redirect has no body');
  },
};

let signedIn = false;

globalThis.fetch = async (path) => {
  if (!signedIn) return bounced;
  const body = BODIES[String(path).split('?')[0]];
  return Response.json(body ?? { ok: true });
};

async function until(predicate, what) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('timed out waiting for ' + what);
}

// Importing the shell is what starts its first round.
await import('../app.js');

const panel = (id) => dom.get('#' + id);
const PANELS = ['tariff', 'controls', 'history', 'account'];
// app.js inserts the signed-out banner before the credential banner's mount, which is a node it
// does not own and blanks on every pass. The stub records the insertion.
const authBanner = () => dom.get('#expiry').inserted;
const refresh = () => dom.get('#refresh');

// ── Round 1: the cold load, signed out ──
//
// The likely first contact with this state: the page is opened, or reloaded, after the session
// has already ended. Nothing has ever arrived, so every panel paints the shell's own block --
// and the instruction on it is the only one the user gets.

test('a cold load while signed out says sign in, on every panel and the banner', async () => {
  await until(() => text(panel('tariff')).length > 0, 'the first round to paint');
  // The notes board fetches its own rows, so its verdict lands after the shell's. Waiting for
  // the block to exist, not for what it says — the wording is what the assertion is for.
  await until(
    () => all(panel('comments')).some((n) => n.className === 'empty__hint'),
    'the notes board to finish its own round'
  );

  assert.match(text(authBanner()), /Session expired/i, 'no signed-out banner on a cold load');
  assert.match(text(authBanner()), /sign in again/i);

  for (const id of [...PANELS, 'comments']) {
    const painted = text(panel(id));
    assert.match(painted, /sign in again/i, `#${id} did not name the one action that can work`);
    assert.doesNotMatch(
      painted,
      /press refresh/i,
      `#${id} told a signed-out viewer to press refresh, which cannot reach anything`
    );
  }
});

// ── Round 2: signed back in ──

test('signing back in clears the banner and mounts the panels', async () => {
  signedIn = true;
  await refresh().handlers.click();

  assert.equal(authBanner().children.length, 0, 'the banner outlived the state it reports');
  assert.equal(button(panel('controls'), 'Stop').disabled, false, 'a running session did not reach the controls');
  assert.match(text(panel('history')), /\S/);
});

// ── Round 3: the session ends mid-visit ──
//
// The worse path, and the one no error block can cover: every panel is mounted, so the shell's
// own card is never painted again. What the panels hold is a memory; what the buttons would
// send is a command to a contactor.

test('a session that ends mid-visit is announced, and the controls stop being live', async () => {
  // The view's own subtree, without the shell's stale chrome wrapped around it: the marker is
  // app.js's to add and it appears on this round by design. What must not change is the data.
  const viewText = (id) =>
    all(panel(id))
      .filter((n) => !String(n.className).startsWith('stale'))
      .map((n) => n.textContent)
      .filter(Boolean)
      .join(' ');
  // The controls panel is the one that must change — it is the fix. The data panels must not:
  // what they hold is the last good round and there is nothing fresher to replace it with.
  const DATA = PANELS.filter((id) => id !== 'controls');
  const before = DATA.map(viewText);

  signedIn = false;
  await refresh().handlers.click();

  assert.deepEqual(
    DATA.map(viewText),
    before,
    'a failed round rewrote a mounted panel instead of leaving it alone'
  );
  assert.match(text(authBanner()), /sign in again/i, 'a mid-visit sign-out rendered no banner at all');

  assert.equal(button(panel('controls'), 'Stop').disabled, true, 'Stop stayed live for a signed-out viewer');
  assert.equal(button(panel('controls'), 'Start charging').disabled, true, 'Start stayed live for a signed-out viewer');

  // The stale rule is present too -- but it is what an unplugged cable looks like, which is why
  // it is not evidence of anything on its own.
  assert.ok(all(dom.get('#tariff')).some((n) => n.className === 'stale__flag'), 'the stale marker went missing');
});

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

// What every /api/* route answers to a browser with no session: 401 and a machine-readable
// name. The name is the route's and this page does not branch on it -- the status is the
// contract -- so the stub sends one to prove the page ignores it.
const noSession = () => Response.json({ error: 'no_session' }, { status: 401 });

let signedIn = false;

globalThis.fetch = async (path) => {
  if (!signedIn) return noSession();
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
const main = () => dom.get('.shell__main');
// The sign-in card's mount: always <main>'s first child, in both shapes of the signed-out page.
const card = () => main().children[0];
const refresh = () => dom.get('#refresh');

// ── Round 1: the cold load, signed out ──
//
// The likely first contact with this state: the page is opened in a browser that has never had
// a session, or after one ended. Nothing has ever arrived, so five panels would paint five
// copies of one message. What the owner asked for is a message and a button.

test('a cold load while signed out is the sign-in card and nothing else', async () => {
  await until(() => text(card()).length > 0, 'the first round to paint');

  assert.equal(main().children.length, 1, '<main> kept its panels behind the sign-in card');
  assert.equal(card().children.length, 1, 'the card never came up');

  assert.match(text(card()), /צריך להתחבר/, 'the card did not say the viewer needs a session');
  assert.ok(button(card(), 'שלחו לי קישור כניסה'), 'the card came up with no way to ask for a link');

  // The owner's design, and the rule that keeps an address off this page: no field, anywhere.
  assert.equal(
    all(card()).some((n) => n.tagName === 'input' || n.tagName === 'textarea'),
    false,
    'the sign-in card grew a field to type an address into'
  );

  // The two other states' vocabulary must not leak into this one. "הרשאה" is the charging
  // station's credential and sends the viewer to a phone app they do not need; "רענון" is a
  // button that cannot create a session.
  assert.doesNotMatch(text(card()), /הרשאה/, 'the sign-in card borrowed the credential banner’s noun');
  assert.doesNotMatch(text(card()), /רענון/, 'the sign-in card sent a signed-out viewer to the refresh button');
});

// ── Round 2: signed back in ──
//
// Reachable for real: the link was opened in another tab, so this one is a signed-out page in
// front of a browser that now has a session. The panels have to come back with their subtrees,
// not as five fresh empty sections.

test('signing back in takes the card down and brings the panels back', async () => {
  signedIn = true;
  await refresh().handlers.click();
  await until(
    () => all(panel('comments')).some((n) => n.className === 'empty__hint' || n.className === 'comment'),
    'the notes board to finish its own round'
  );

  // The card plus the four views -- not the five panels: the panels are nested inside the
  // views now, and it is the views that are detached and reattached as a set.
  assert.equal(main().children.length, 5, 'the views did not come back under the card');
  assert.equal(card().children.length, 0, 'the sign-in card outlived the state it reports');
  assert.equal(button(panel('controls'), 'עצירה').disabled, false, 'a running session did not reach the controls');
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
  assert.equal(main().children.length, 5, 'a mid-visit sign-out threw away the data on screen');
  assert.match(text(card()), /צריך להתחבר/, 'a mid-visit sign-out rendered no card at all');
  assert.ok(button(card(), 'שלחו לי קישור כניסה'), 'the card offered no way back in');

  assert.equal(button(panel('controls'), 'עצירה').disabled, true, 'Stop stayed live for a signed-out viewer');
  assert.equal(button(panel('controls'), 'התחלת טעינה').disabled, true, 'Start stayed live for a signed-out viewer');

  // The stale rule is present too -- but it is what an unplugged cable looks like, which is why
  // it is not evidence of anything on its own.
  assert.ok(all(dom.get('#tariff')).some((n) => n.className === 'stale__flag'), 'the stale marker went missing');
});

// ── Round 4: the page learns it is signed out FROM the press ──
//
// The refresh button is not how this state is usually met. There is no auto-refresh, so between
// the round that painted the page and the moment the session ends, nothing looks any different:
// the snapshot is on screen, the controls are live, and the first thing that touches the server
// is the press itself. The 401 that comes back is the page's first news of its own sign-out --
// and a control that has just been told it cannot act must not go straight back to looking live.

test('a command that bounces locks the control it just failed through', async () => {
  signedIn = true;
  await refresh().handlers.click();
  await until(() => button(panel('controls'), 'עצירה').disabled === false, 'the controls to come back live');

  signedIn = false;
  await button(panel('controls'), 'עצירה').handlers.click();

  assert.equal(button(panel('controls'), 'עצירה').disabled, true, 'Stop went back to looking live after a 401');
  assert.equal(button(panel('controls'), 'התחלת טעינה').disabled, true, 'Start went back to looking live after a 401');
  assert.match(text(card()), /צריך להתחבר/, 'a bounced command raised no sign-in card');
});

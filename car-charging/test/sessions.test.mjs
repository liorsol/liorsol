// Run: node --test car-charging/test/sessions.test.mjs
//
// The sign-in session list and its revoke control, rendered against the stub DOM, plus the two
// things about the routes that are properties of this repository rather than of the private
// half: they are gated, and the Function forwards them without learning what they are.
//
// What this file exists to catch is a control that destroys something on one press, and a page
// that keeps talking after the viewer has signed themselves out.
//
//   - Revoking deletes a row. The comment board's ✕ archives, and an archived comment is still
//     in the table and still readable; this has no archive, no undo and no restore. So a bare
//     click must not be able to fire it.
//   - The CURRENT row is the one most likely to be pressed by accident, and it is the only one
//     whose consequence is "you are now signed out". It has to read as a different action
//     everywhere it appears, and its confirmation has to say what it does.
//   - On {"self": true} every later call is a 401. Repainting the list would put a set of dead
//     buttons in front of the viewer over data that can never be loaded again; the page has to
//     go to the sign-in state instead, which is the round app.js runs.
//   - The user-agent is displayed and NEVER parsed. A derived "iPhone" is a guess about a
//     string upstream never promised, printed on the row somebody is about to delete.
//
// ORDERED, and sharing one module instance, like app.test.mjs and nav.test.mjs. The view keeps
// its armed row and its signed-off flag in module memory on purpose -- a repaint from the shell
// must not wipe a question the viewer is looking at, and a reload of the page is the only way
// back from a self-revoke. So a test that arms a row puts it back with `clear()`, and the
// self-revoke test is the LAST one that renders: after it the module is signed off for good,
// which is exactly the behaviour under test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDocument, node, all, text, button, byClass } from './fake-dom.mjs';

installDocument();

const { render } = await import('../views/sessions.js');

// ── the stub transport ──

const calls = [];
let answer = () => Response.json({ ok: true, self: false });

globalThis.fetch = async (path, init) => {
  calls.push({ path, method: init?.method ?? 'GET' });
  return answer();
};

const NOW = Date.now();

// A deliberately long, punctuation-heavy user-agent. Asserted by EXACT equality below, so a
// slice, a trim or a "friendly name" derived from it fails rather than reading plausibly.
const UA_PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';
const UA_DESK = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

const FIXTURE = () => ({
  signIns: {
    sessions: [
      { jti: 'here', createdAt: NOW - 7200000, lastSeen: NOW - 60000, userAgent: UA_PHONE, location: 'IL', current: true },
      { jti: 'there', createdAt: NOW - 86400000 * 3, lastSeen: NOW - 10800000, userAgent: UA_DESK, location: 'IL', current: false },
    ],
  },
});

// The shell's third argument. `reload()` is what app.js runs, and it is the ONLY thing that
// raises the sign-in card -- this module must reach it rather than set a flag of its own.
let reloads = 0;
const ctx = { reload: () => { reloads += 1; } };

function mount(state) {
  const el = node('div');
  render(el, state ?? FIXTURE(), ctx);
  return el;
}

const rows = (el) => all(el).filter((n) => String(n.className).startsWith('session ') || n.className === 'session');

/** Put an armed row back, so the next test starts from a list rather than from a question. */
const clear = (el) => {
  const no = button(el, 'ביטול');
  if (no) no.handlers.click();
};

/** Arm a row and press its confirm button. Both presses, because one is never enough. */
async function revoke(el, action, confirmLabel) {
  await button(el, action).handlers.click();
  const yes = button(el, confirmLabel);
  assert.ok(yes, `no "${confirmLabel}" button after arming the row`);
  await yes.handlers.click();
}

// ── The list ──

test('every row says when it signed in, when it was last seen, where, and what it is', () => {
  const el = mount();
  assert.equal(rows(el).length, 2, 'the list did not render one row per session');

  const painted = text(el);
  assert.match(painted, /נכנס:/, 'no sign-in time on the row');
  assert.match(painted, /נראה לאחרונה:/, 'no last-seen time on the row');
  assert.match(painted, /IL/, 'the location went missing');
  // Through he.js and nothing else: "לפני דקה" for one minute, "לפני 3 שעות" for three hours.
  // A second formatter in this view would reintroduce the CLDR bracketed gloss that module
  // was written to strip.
  assert.match(painted, /לפני/, 'the last-seen time was not rendered as a Hebrew relative phrase');
  assert.doesNotMatch(painted, /\(\d+\)/, 'a relative phrase arrived with the CLDR numeral gloss on it');
});

test('the user-agent is shown exactly as it arrived, whole', () => {
  const el = mount();
  const shown = byClass(el, 'session__ua').map((n) => n.textContent);
  assert.deepEqual(shown, [UA_PHONE, UA_DESK], 'a user-agent string was cut, trimmed or rewritten');
});

// The companion to the assertion above: exact equality catches a slice, and this catches a
// label DERIVED from the string while the string itself is still printed in full.
test('nothing in this view parses a user-agent', () => {
  const source = readFileSync(new URL('../views/sessions.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  assert.doesNotMatch(
    source,
    /userAgent\s*\)?\s*\.\s*(match|test|includes|indexOf|search|split|slice|substring|toLowerCase|replace)/,
    'the view started reading meaning out of the user-agent string'
  );
  // The vocabulary a parse would produce. None of it may be written into this file.
  assert.doesNotMatch(source, /iPhone|Android|Chrome|Safari|Firefox|Windows|Macintosh/i, 'a device name was hardcoded');
});

test('the current row is marked, and its control is a different action from the others', () => {
  const el = mount();

  assert.equal(byClass(el, 'chip chip--info').length, 1, 'the current device was not marked, or was marked twice');
  assert.match(text(el), /המכשיר הזה/, 'nothing on the page said which row is this browser');

  // Colour is never the only difference: the two labels are different words.
  const here = button(el, 'יציאה מהמכשיר הזה');
  const there = button(el, 'ניתוק');
  assert.ok(here, 'the current row offered the same control as every other row');
  assert.ok(there, 'another device had no revoke control');
  assert.match(here.className, /btn--danger/, 'the sign-yourself-out control was styled as an ordinary button');
});

// ── Two steps, because there is no undo ──

test('one press asks; it does not revoke', async () => {
  calls.length = 0;
  const el = mount();

  await button(el, 'ניתוק').handlers.click();

  assert.equal(calls.length, 0, 'a single click deleted a session');
  assert.match(text(el), /אי אפשר לבטל/, 'the question did not say the action is irreversible');
  assert.ok(button(el, 'כן, נתקו'), 'no confirm button after the first press');
  assert.ok(button(el, 'ביטול'), 'the question could not be abandoned');

  clear(el);
});

test('the question can be abandoned, and nothing is sent', async () => {
  calls.length = 0;
  const el = mount();

  await button(el, 'ניתוק').handlers.click();
  await button(el, 'ביטול').handlers.click();

  assert.equal(calls.length, 0, 'cancelling sent the request anyway');
  assert.equal(button(el, 'כן, נתקו'), undefined, 'the question stayed up after being cancelled');
  assert.ok(button(el, 'ניתוק'), 'the row lost its control after a cancel');
});

test('the current row’s confirmation says that it signs you out', async () => {
  const el = mount();
  await button(el, 'יציאה מהמכשיר הזה').handlers.click();

  const asked = text(el);
  assert.match(asked, /המכשיר שאתם משתמשים בו עכשיו/, 'the confirmation did not say this is the current device');
  assert.match(asked, /קישור כניסה חדש/, 'the confirmation did not say a new sign-in link would be needed');
  assert.ok(button(el, 'כן, הוציאו אותי'), 'the current row reused another device’s confirm wording');

  clear(el);
});

test('the second press sends one DELETE, for that row and no other', async () => {
  calls.length = 0;
  answer = () => Response.json({ ok: true, self: false });
  reloads = 0;
  const el = mount();

  await revoke(el, 'ניתוק', 'כן, נתקו');

  assert.deepEqual(calls, [{ path: '/api/sessions/there', method: 'DELETE' }]);
  assert.equal(rows(el).length, 1, 'the revoked row stayed on screen');
  assert.equal(reloads, 1, 'the list was never reconciled with the server');
});

// ── The two answers that are not a plain success ──

test('a row that was already gone is reported as done, not as a failure', async () => {
  calls.length = 0;
  answer = () => Response.json({ error: 'not_found' }, { status: 404 });
  const el = mount();

  await revoke(el, 'ניתוק', 'כן, נתקו');

  assert.equal(rows(el).length, 1, 'a 404 left a row on screen that no longer exists');
  assert.equal(byClass(el, 'empty empty--error').length, 0, 'an already-revoked session was painted as an error');
  assert.match(text(el), /כבר לא היה קיים/, 'the viewer was not told why the row went');
});

test('a revoke that failed leaves the row and says nothing changed', async () => {
  calls.length = 0;
  answer = () => Response.json({ error: 'nope' }, { status: 500 });
  const el = mount();

  await revoke(el, 'ניתוק', 'כן, נתקו');

  assert.equal(rows(el).length, 2, 'a failed revoke dropped the row anyway');
  assert.match(text(el), /לא נותק/, 'a failed revoke was silent');

  clear(el);
});

// ── The empty case ──

test('no rows is a quiet empty state, not an error', () => {
  const el = mount({ signIns: { sessions: [] } });
  assert.equal(byClass(el, 'empty empty--error').length, 0, 'an empty list was painted as a failure');
  assert.match(text(el), /אין חיבורים פעילים/);
});

// ── The one that signs the viewer out ──

test('{"self": true} reaches the sign-in state and does not repaint the list', async () => {
  calls.length = 0;
  answer = () => Response.json({ ok: true, self: true });
  reloads = 0;
  const el = mount();

  await revoke(el, 'יציאה מהמכשיר הזה', 'כן, הוציאו אותי');

  // Every call after this answer is a 401. A repainted list is a set of buttons that cannot
  // work, over rows that can never be read again.
  assert.equal(rows(el).length, 0, 'the list was repainted after the viewer signed themselves out');
  assert.equal(byClass(el, 'session-list').length, 0, 'the list element survived the sign-out');
  assert.match(text(el), /החיבור הזה נותק/, 'nothing told the viewer what had just happened');
  // The way back is a new link, from the card app.js raises -- not a refresh, which is provably
  // the one action that cannot mend an ended sign-in.
  assert.match(text(el), /קישור כניסה/, 'the viewer was not pointed at the way back in');
  assert.doesNotMatch(text(el), /רענון/, 'a signed-out viewer was sent to the refresh button');
  // app.js is the only writer of `authRequired` and load() is the only thing that raises the
  // card, so reaching the sign-in state means running the round, not setting a flag here.
  assert.equal(reloads, 1, 'the round that raises the sign-in card was never run');

  // And it stays gone: a later repaint from the shell must not bring the list back.
  render(el, FIXTURE(), ctx);
  assert.equal(rows(el).length, 0, 'a repaint restored a list the viewer can no longer load');
});

// ── The routes, on this side of the binding ──
//
// The Function owns none of this. It authorises, then forwards -- so what is worth pinning here
// is that the three new paths are gated like everything else and that the Function did not
// learn what they are on the way past.

const { onRequest } = await import('../functions/api/[[path]].js');

const upstream = () => {
  const seen = [];
  return {
    seen,
    PROXY: {
      fetch(request) {
        seen.push(request);
        return new URL(request.url).pathname === '/api/auth/verify'
          ? new Response(null, { status: 204 })
          : new Response('{}');
      },
    },
  };
};

const NEW_ROUTES = [
  ['/api/sessions', 'GET'],
  ['/api/sessions/some-jti', 'DELETE'],
  ['/api/contact', 'GET'],
];

test('the three new routes are refused without a session, upstream untouched', async () => {
  for (const [path, method] of NEW_ROUTES) {
    const up = upstream();
    const response = await onRequest({ request: new Request('https://example.invalid' + path, { method }), env: up });
    assert.equal(response.status, 401, `${method} ${path} was not refused`);
    assert.deepEqual(await response.json(), { error: 'auth_required' });
    assert.equal(up.seen.length, 0, `${method} ${path} cost an upstream call to refuse a stranger`);
  }
});

test('a session reaches them, and they cross the binding unchanged', async () => {
  for (const [path, method] of NEW_ROUTES) {
    const up = upstream();
    await onRequest({
      request: new Request('https://example.invalid' + path, {
        method,
        headers: { cookie: '__Host-session=a.b.c' },
      }),
      env: up,
    });
    const forwarded = up.seen.at(-1);
    assert.equal(new URL(forwarded.url).pathname, path, `${path} was rewritten on the way through`);
    assert.equal(forwarded.method, method, `${method} ${path} changed method on the way through`);
  }
});

test('the Function did not learn what a session list or a contact card is', () => {
  const source = readFileSync(new URL('../functions/api/[[path]].js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([ \t])\/\/[^\n]*$/gm, '$1');
  // The existing catch-all already forwards these. A branch on either noun would be this file
  // starting to hold product knowledge it has no business holding, and the first step towards
  // reshaping a body it is only supposed to carry.
  for (const noun of ['contact', 'sessions', 'whatsapp', 'revoke']) {
    assert.ok(!source.includes(noun), `the Function grew a branch on "${noun}"`);
  }
});

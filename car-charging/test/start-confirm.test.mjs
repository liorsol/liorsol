// Run: node --test car-charging/test/start-confirm.test.mjs
//
// The press the owner made at the charger: Start went to its wait label, came back, and painted
// the charger exactly as it had been. Only the sync button showed the charge.
//
// Both halves of why are modelled here, in the stub, rather than asserted about:
//
//   1. `GET /api/state` is SERVED FROM THE D1 ROW while the row is under an hour old. A reload
//      after a command therefore re-reads the pre-command payload and repaints it faithfully.
//      `POST /api/refresh` is the only call that goes upstream regardless of age, and it is what
//      rewrites the row -- which is why the sync button worked and the command's own reload did
//      not. The stub below has a row and an upstream, and only refresh crosses between them.
//   2. The charger does not report a new session the instant it accepts the command. The stub's
//      upstream keeps saying `Available` for the first `flipAfter` forced fetches, so a single
//      forced fetch is not enough either: the command has to be CONFIRMED, bounded, or the page
//      is back to repainting a charger that has not caught up.
//
// The cache rule is not weakened to fix this and the first test is the proof: an ordinary page
// load forces nothing. That rule is a free-tier invocation budget requirement, not an
// optimisation -- see the absence test in settle.test.mjs for the other half of it.
//
// Nothing here touches the real charger. The transport is a stub; there is a live vehicle on the
// other end of the real one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDocument, all, text, button } from './fake-dom.mjs';
import { START_MAX_ATTEMPTS } from '../api.js';

const dom = installDocument();

// ── the stub: a D1 row, an upstream, and only one call that crosses between them ──

const AT = Date.now() - 5 * 60000; // under the hour: the row is servable, which is the defect

const running = {
  sessionId: 'running-1',
  startedAt: '2026-09-12T10:00:00Z',
  stoppedAt: null,
  completed: false,
  status: 'Charging',
  stoppable: true,
};

const slices = [
  { name: 'cheap', price: 0.45, vat: 18, from: '2026-09-12T00:00:00Z', to: '2026-09-12T17:00:00Z' },
  { name: 'peak', price: 1.26, vat: 18, from: '2026-09-12T17:00:00Z', to: '2026-09-12T22:00:00Z' },
];

const idle = () => ({
  charger: { offPeakState: 'Off', connectors: [{ connectorId: 1, status: 'Available' }] },
  pricingSlices: slices,
  sessions: [],
});

const charging = () => ({
  charger: { offPeakState: 'Off', connectors: [{ connectorId: 1, status: 'Charging' }] },
  pricingSlices: slices,
  sessions: [running],
});

const calls = {};
let upstreamFetches = 0; // how many times the server was made to go upstream
let flipAfter = Infinity; // the charger reports the session only from this forced fetch onward
let row = { fetchedAt: AT, stale: false, ...idle() }; // the D1 row

const count = (route) => (calls[route] = (calls[route] || 0) + 1);

globalThis.fetch = async (path) => {
  const route = String(path).split('?')[0];
  count(route);

  if (route === '/api/comments') return Response.json({ comments: [] });
  // Read routes: the row, untouched, because the server judges it young enough.
  if (route === '/api/state') return Response.json(row);
  if (route === '/api/history') return Response.json({ fetchedAt: AT, stale: false, sessions: [], totals: { count: 0 } });
  if (route === '/api/invoices') return Response.json({ fetchedAt: AT, stale: false, invoices: [] });

  // The forcing call: upstream regardless of age, and it rewrites the row.
  if (route === '/api/refresh') {
    upstreamFetches++;
    row = { fetchedAt: Date.now(), stale: false, ...(upstreamFetches >= flipAfter ? charging() : idle()) };
    return Response.json({ fetchedAt: row.fetchedAt, stale: false, state: row, history: { sessions: [] }, invoices: { invoices: [] } });
  }

  // The command is accepted; nothing about the charger's own state changes with it.
  if (route === '/api/charge/start') return Response.json({ ok: true });
  return Response.json({ ok: true });
};

async function until(predicate, what) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('timed out waiting for ' + what);
}

// The confirmation poll sleeps between samples. Driving those sleeps with node's own timer mock
// keeps a run to the cap instant instead of half a minute of real waiting, and it needs no seam
// in the shipped code: `wait()` calls the global setTimeout like anything else.
async function press(t, btn) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let done = false;
    const pressed = btn.handlers.click().then(() => {
      done = true;
    });
    for (let i = 0; i < 500 && !done; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      t.mock.timers.tick(60000);
    }
    await pressed;
  } finally {
    t.mock.timers.reset();
  }
}

await import('../app.js');

const panel = (id) => dom.get('#' + id);
const controls = () => panel('controls');
const startBtn = () => button(controls(), 'התחלת טעינה');
const stopBtn = () => button(controls(), 'עצירה');
const notes = () =>
  all(controls())
    .filter((n) => n.className === 'btn-note')
    .map((n) => n.textContent)
    .join(' ');

// ── The rule that must survive the fix ──

test('an ordinary page load forces nothing upstream', async () => {
  await until(() => all(panel('comments')).some((n) => n.className === 'empty__hint'), 'the first round');

  assert.equal(calls['/api/refresh'] || 0, 0, 'a page load forced an upstream fetch');
  assert.equal(upstreamFetches, 0, 'a page load went upstream');
  assert.equal(calls['/api/state'], 1, 'a page load read the state route more than once');
  assert.equal(startBtn().disabled, false, 'precondition: nothing is charging and Start is live');
});

// ── The defect ──

test('a start that the charger takes a few samples to report still repaints as charging', async (t) => {
  // Three forced fetches before the charger admits the session: one forced fetch is not enough,
  // so this fails a fix that only swaps the cache read for a single refresh.
  flipAfter = upstreamFetches + 3;

  await press(t, startBtn());

  assert.equal(calls['/api/charge/start'], 1, 'the press sent no start command, or sent two');
  assert.ok((calls['/api/refresh'] || 0) >= 3, 'the command reload read the cache instead of forcing');

  assert.match(text(controls()), /בטעינה/, 'the panel repainted the pre-command state');
  assert.equal(stopBtn().disabled, false, 'Stop stayed dead against a charge that had started');
  assert.equal(startBtn().disabled, true, 'Start stayed live over a running charge');
  assert.doesNotMatch(notes(), /אין טעינה שרצה/, 'the panel said nothing was charging while it was');
  // The busy hold is released only once fresh state is on screen -- and it IS released.
  assert.equal(startBtn().className.includes('is-busy'), false, 'the control was left held');
});

// ── The cap ──

test('a charger that never reports says so, claiming neither success nor failure', async (t) => {
  flipAfter = Infinity;
  await stopBtn(); // no-op read; keeps the panel reference honest below
  // Back to an idle charger, through the one button that is allowed to force on its own.
  await dom.get('#refresh').handlers.click();
  await until(() => startBtn() && startBtn().disabled === false, 'the controls to come back live');

  const before = calls['/api/refresh'];
  await press(t, startBtn());

  assert.equal(
    calls['/api/refresh'] - before,
    START_MAX_ATTEMPTS,
    'the confirmation poll is not capped at its stated number of samples'
  );

  const said = notes();
  // Accepted, unconfirmed, and it says which: not a success, not a failure, and it says how far
  // it looked before it stopped looking. The confirmed note is the sentence 'הטעינה התחילה.' and
  // nothing here may read as that one.
  assert.match(said, /ההתחלה התקבלה/, 'the page did not say the command was accepted');
  assert.match(said, /עדיין לא דיווחה/, 'the page did not say the charger has yet to confirm');
  assert.match(said, new RegExp(String(START_MAX_ATTEMPTS)), 'the note never says how far it looked');
  assert.doesNotMatch(said, /הטעינה התחילה/, 'the page claimed a charge the charger never reported');
  assert.doesNotMatch(said, /נכשלה/, 'the page called an accepted command a failure');
  // Released, and clickable again: a capped poll is the end of the command, not a stuck control.
  assert.equal(startBtn().disabled, false, 'the control stayed held after the cap');
});

// ── And the rule again, after all of it ──

test('nothing kept forcing once the command was over', async () => {
  const settled = calls['/api/refresh'];
  await until(() => true, 'a tick');
  assert.equal(calls['/api/refresh'], settled, 'something went on forcing upstream after the press');
});

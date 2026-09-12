// Run: node --test car-charging/test/connector.test.mjs
//
// "IS A CAR CONNECTED?" IS A QUESTION ABOUT THE CONNECTOR, NOT ABOUT THE SESSION LIST.
//
// The fixture below is the one the owner was standing in front of: the cable is in the car, the
// charge has not been started, and so the payload carries a connector in `Preparing` and ZERO
// sessions. Every view that answered the question by filtering `state.sessions` reported that
// nothing was plugged in — which is exactly wrong, and wrong in the direction that reads as
// safe.
//
// This is a near relative of the defect review comment T1 found, and it is NOT the same bug.
// T1 was three modules disagreeing about what a live session is, and `isLiveSession()` settled
// it. That predicate answers "is a charge RUNNING". The question here is "is a car CONNECTED",
// and no amount of agreeing about sessions answers it: the correct live-session answer for this
// fixture is "none", and the correct connection answer is "yes". Conflating the two is what
// prints the lie.
//
// A RENDER, not a grep. The assertions drive views/tariff.js and views/controls.js against the
// fixture and read what a person would read off the panel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDocument, node, all, text } from './fake-dom.mjs';

installDocument();
const { render } = await import('../views/tariff.js');
const { render: renderControls } = await import('../views/controls.js');

const H = 3600000;
const iso = (ms) => new Date(ms).toISOString();

// The published calendar at the moment of the report: שפל, one cheap slice, running now.
const slices = () => {
  const now = Date.now();
  return [
    { name: 'שפל', price: 0.5773, from: iso(now - H), to: iso(now + 4 * H), type: 'Energy', vat: 18 },
    { name: 'פסגה', price: 1.6096, from: iso(now + 4 * H + 1000), to: iso(now + 9 * H), type: 'Energy', vat: 18 },
  ];
};

// The shape upstream really sends for a plugged-in, idle car: a connector with a status, and an
// EMPTY sessions array. Not a missing one — an empty one, which is what makes the old code look
// like it is handling the case.
const plugged = (status) => ({
  state: {
    charger: {
      ocppConnected: true,
      offPeakState: 'OffPeakPlanDisabled',
      connectors: [{ connectorId: 1, status, canCharge: true, meterValue: 114.652, updated: iso(Date.now() - 60000) }],
    },
    sessions: [],
    pricingSlices: slices(),
  },
  history: null,
  invoices: null,
  expired: false,
  authRequired: false,
  fetchedAt: Date.now(),
  stale: false,
});

const paint = (status) => {
  const el = node('div');
  render(el, plugged(status), {});
  return { el, read: text(el) };
};

// "Nothing is connected" — the exact sentence the panel prints for an empty bay. It may appear
// for `Available` and for nothing else.
const NOT_CONNECTED = /שום דבר לא מחובר/;

test('Preparing with zero sessions: the page says the car IS connected', () => {
  const { el, read } = paint('Preparing');

  assert.doesNotMatch(read, NOT_CONNECTED,
    'a car plugged in and idle (Preparing, no session) was reported as nothing connected — ' +
    `the panel is reading the session list instead of the connector: "${read}"`);
  assert.match(read, /הרכב מחובר/, `the panel never says the car is connected: "${read}"`);
  assert.match(read, /בהכנה/, `the Hebrew label for Preparing is missing: "${read}"`);

  // The raw protocol spelling stays reachable: on the badge's title, the way every other view
  // on this page does it, AND in the prose, because a title is not reachable on a phone.
  const badge = all(el).find((n) => n.className === 'status status--preparing');
  assert.ok(badge, 'no .status--preparing badge was painted for a Preparing connector');
  assert.equal(badge.title, 'Preparing');
  assert.match(read, /Preparing/, `the raw upstream value is not readable in the prose: "${read}"`);
});

test('Available: this, and only this, is nothing connected', () => {
  const { read } = paint('Available');
  assert.match(read, NOT_CONNECTED, `an empty bay was not reported as empty: "${read}"`);
  assert.doesNotMatch(read, /הרכב מחובר/, `an empty bay claimed a car was connected: "${read}"`);
});

test('Charging: connected and delivering', () => {
  const { el, read } = paint('Charging');
  assert.doesNotMatch(read, NOT_CONNECTED, `a charging connector was reported as empty: "${read}"`);
  assert.match(read, /הרכב מחובר/, `a charging connector did not read as connected: "${read}"`);
  assert.ok(all(el).find((n) => n.className === 'status status--charging'));
});

test('SuspendedEVSE and SuspendedEV are two different states, never merged', () => {
  const evse = paint('SuspendedEVSE');
  const ev = paint('SuspendedEV');

  for (const [name, painted] of [['SuspendedEVSE', evse], ['SuspendedEV', ev]]) {
    assert.doesNotMatch(painted.read, NOT_CONNECTED,
      `${name} was reported as nothing connected: "${painted.read}"`);
    assert.match(painted.read, /הרכב מחובר/, `${name} did not read as connected: "${painted.read}"`);
    assert.match(painted.read, new RegExp(name), `${name} is not quotable off the panel: "${painted.read}"`);
  }

  assert.notEqual(evse.read, ev.read,
    'the charger withholding and the car refusing painted the same words — they are different ' +
    'facts with different remedies and the owner cannot act on the merged one');
  // Each names its own culprit. Colour alone must never be the difference.
  assert.match(evse.read, /העמדה/, `SuspendedEVSE does not name the charger: "${evse.read}"`);
  assert.match(ev.read, /הרכב הוא שמסרב|הרכב מסרב/, `SuspendedEV does not name the car: "${ev.read}"`);
  assert.ok(all(evse.el).find((n) => n.className === 'status status--suspendedevse'));
  assert.ok(all(ev.el).find((n) => n.className === 'status status--suspendedev'));
});

test('Finishing and Faulted render as themselves, not as an empty bay', () => {
  for (const status of ['Finishing', 'Faulted']) {
    const { read } = paint(status);
    assert.doesNotMatch(read, NOT_CONNECTED, `${status} fell through to "nothing connected": "${read}"`);
    assert.match(read, new RegExp(status), `${status} is not readable on the panel: "${read}"`);
  }
});

// Upstream has already handed this project an undocumented enum value once. The safest-looking
// fallback is the one that lies, so the requirement is the opposite of a default: an unknown
// status is shown as itself and claims nothing about the cable either way.
test('an unrecognised status is shown as itself and never becomes "nothing connected"', () => {
  const { el, read } = paint('SuspendedEVSE_v2');

  assert.doesNotMatch(read, NOT_CONNECTED,
    `an unrecognised status fell through to "nothing connected": "${read}"`);
  assert.match(read, /SuspendedEVSE_v2/, `the unrecognised value is not shown at all: "${read}"`);

  // A bare .status, never a class invented from a string the stylesheet has no rule for.
  const badge = all(el).find((n) => typeof n.className === 'string' && n.className.startsWith('status'));
  assert.ok(badge, 'no badge was painted for an unrecognised status');
  assert.equal(badge.className, 'status',
    `a class was invented from an unrecognised upstream value: "${badge.className}"`);
  assert.equal(badge.title, 'SuspendedEVSE_v2');
});

test('no connector status at all: the page says it does not know, not that the bay is empty', () => {
  const el = node('div');
  const view = plugged('Preparing');
  view.state.charger.connectors = [];
  render(el, view, {});
  const read = text(el);
  assert.doesNotMatch(read, NOT_CONNECTED,
    `a payload with no connector was reported as an empty bay: "${read}"`);
});

// The control panel already reads the connector as its fallback. It is asserted here rather than
// only in controls.test.mjs so that one file holds the whole answer to one question: every panel
// that speaks about the cable agrees with the connector.
test('the control panel badges the connector state, not the session list', () => {
  const el = node('div');
  renderControls(el, plugged('Preparing'), { reload: async () => {} });
  const badge = all(el).find((n) => n.className === 'status status--preparing');
  assert.ok(badge, `the controls panel did not badge Preparing: "${text(el)}"`);
  assert.equal(badge.title, 'Preparing');
});

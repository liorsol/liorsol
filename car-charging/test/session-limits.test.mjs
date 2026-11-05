// Which limit each charging session ran under, rebuilt from the action log's rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDocument, all, text } from './fake-dom.mjs';

installDocument();

const { sessionLimits } = await import('../views/session-limits.js');
const history = await import('../views/history.js');

const T0 = Date.parse('2026-10-01T08:00:00Z');
const at = (min) => T0 + min * 60000;
// A stamp with no zone is UTC, so the fixtures carry none on purpose.
const naked = (min) => new Date(at(min)).toISOString().replace(/\.\d+Z$/, '');
const session = (from, to, kwh) => ({
  sessionId: 's' + from,
  startedAt: naked(from),
  stoppedAt: to == null ? null : naked(to),
  durationInSeconds: to == null ? null : (to - from) * 60,
  totalEnergy: kwh,
  stopReason: to == null ? null : 'Remote',
});
// Written oldest first to read like the story; the service sends newest first.
const log = (...rows) =>
  rows.map(([min, type, detail, ok = 1], id) => ({ id, ts: at(min), type, ok, detail })).reverse();

test('the real sample: three auto stops, then two limits that ended on their own', () => {
  const rows = [
    session(0, 120, 15.4),
    session(1000, 1160, 20.2),
    session(2000, 2200, 25),
    session(3000, 3100, 12),
    session(4000, 4100, 9),
  ];
  const limits = sessionLimits(log(
    [-5, 'limit_set', '15'], [120, 'auto_stop', '15.406/15'],
    [995, 'limit_set', '20'], [1160, 'auto_stop', '20.231/20'],
    [1995, 'limit_set', '25'], [2200, 'auto_stop', '25.052/25'],
    [2995, 'limit_set', '20'], [3107, 'limit_clear', 'ended'],
    [3995, 'limit_set', '20'], [4108, 'limit_clear', 'ended'],
  ), rows);
  assert.deepEqual(rows.map((row) => limits.get(row)), [
    { kwh: 15, reached: true },
    { kwh: 20, reached: true },
    { kwh: 25, reached: true },
    { kwh: 20, reached: false },
    { kwh: 20, reached: false },
  ]);
});

test('an auto stop logged just after the stop stamp still lands on that session', () => {
  const row = session(0, 60, 10);
  const limits = sessionLimits(log([-1, 'limit_set', '10'], [61, 'auto_stop', '10.1/10']), [row]);
  assert.deepEqual(limits.get(row), { kwh: 10, reached: true });
});

test('writing again overwrites: the last limit is the one that applied', () => {
  const row = session(0, 60, 10);
  const limits = sessionLimits(log(
    [5, 'limit_set', '30'], [10, 'limit_set', '20'], [68, 'limit_clear', 'ended'],
  ), [row]);
  assert.deepEqual(limits.get(row), { kwh: 20, reached: false });
});

test('an owner cancel applies to no session, and nothing later inherits it', () => {
  const first = session(0, 60, 10);
  const next = session(100, 160, 10);
  const limits = sessionLimits(log(
    [5, 'limit_set', '8'], [10, 'limit_clear', 'owner'], [168, 'limit_clear', 'ended'],
  ), [first, next]);
  assert.equal(limits.size, 0);
});

test('a failed auto stop keeps the limit armed and the retry attributes it', () => {
  const row = session(0, 70, 10.9);
  const limits = sessionLimits(log(
    [-1, 'limit_set', '10'], [60, 'auto_stop', 'upstream_down', 0], [70, 'auto_stop', '10.9/10'],
  ), [row]);
  assert.deepEqual(limits.get(row), { kwh: 10, reached: true });
});

test('a limit set while idle binds to the next session, not the one before it', () => {
  const before = session(0, 60, 10);
  const next = session(200, 260, 7);
  const limits = sessionLimits(log([100, 'limit_set', '20'], [267, 'limit_clear', 'ended']), [before, next]);
  assert.equal(limits.has(before), false);
  assert.deepEqual(limits.get(next), { kwh: 20, reached: false });
});

test('the car stopping past the target before a tick still counts as reached', () => {
  const row = session(0, 60, 20.1);
  const limits = sessionLimits(log([-1, 'limit_set', '20'], [66, 'limit_clear', 'ended']), [row]);
  assert.deepEqual(limits.get(row), { kwh: 20, reached: true });
});

test('a session started before the tick noticed the end does not take the old limit', () => {
  const ended = session(0, 60, 5);
  const restarted = session(64, null, 1);
  const limits = sessionLimits(log([-1, 'limit_set', '20'], [68, 'limit_clear', 'ended']), [ended, restarted]);
  assert.deepEqual(limits.get(ended), { kwh: 20, reached: false });
  assert.equal(limits.has(restarted), false);
});

test('a close nothing fits attributes nothing, and the slot does not leak onward', () => {
  const earlier = session(0, 60, 10);
  const later = session(500, 560, 10);
  const limits = sessionLimits(log(
    [100, 'limit_set', '20'], [200, 'auto_stop', '20.1/20'],
    [300, 'limit_set', '20'], [310, 'limit_clear', 'ended'],
    [568, 'limit_clear', 'ended'],
  ), [earlier, later]);
  assert.equal(limits.size, 0);
});

test('a close whose limit_set fell off the capped log attributes nothing', () => {
  const row = session(0, 60, 10);
  assert.equal(sessionLimits(log([60, 'auto_stop', '10.1/10']), [row]).size, 0);
});

test('empty and null input', () => {
  assert.equal(sessionLimits(null, null).size, 0);
  assert.equal(sessionLimits([], []).size, 0);
  assert.equal(sessionLimits(undefined, [session(0, 60, 1)], null).size, 0);
  assert.equal(sessionLimits(log([0, 'limit_set', '5']), null, { kwh: 5, sessionId: null }).size, 0);
});

test('an armed limit shows on the live session, bound or waiting for the next tick', () => {
  const ended = session(0, 60, 10);
  const live = session(100, null, 4);
  for (const sessionId of [live.sessionId, null]) {
    const limits = sessionLimits([], [ended, live], { kwh: 20, sessionId, setAt: at(90) });
    assert.deepEqual(limits.get(live), { kwh: 20, reached: false, live: true });
    assert.equal(limits.has(ended), false);
  }
});

test('an armed limit with nothing charging belongs to no row yet', () => {
  const limits = sessionLimits([], [session(0, 60, 10)], { kwh: 20, sessionId: null, setAt: at(90) });
  assert.equal(limits.size, 0);
});

test('a bound session that ended before the tick logged it is finished, not live', () => {
  const row = session(0, 60, 21);
  const limits = sessionLimits([], [row], { kwh: 20, sessionId: row.sessionId, setAt: at(-1) });
  assert.deepEqual(limits.get(row), { kwh: 20, reached: true, live: false });
});

test('history: the column reads the limit and its outcome, and no limit stays empty', () => {
  const now = Date.now();
  const stamp = (ms) => new Date(ms).toISOString();
  const row = (from, to, kwh) => ({
    startedAt: stamp(from), stoppedAt: to && stamp(to), totalEnergy: kwh, durationInSeconds: 3600, stopReason: to && 'Remote',
  });
  const hour = 3600000;
  const rows = [
    row(now - hour, null, 2),
    row(now - 3 * hour, now - 2 * hour, 5),
    row(now - 6 * hour, now - 5 * hour, 20),
    row(now - 9 * hour, now - 8 * hour, 3),
  ];
  const events = [
    { id: 4, ts: now - 2 * hour + 300000, type: 'limit_clear', ok: 1, detail: 'ended' },
    { id: 3, ts: now - 3 * hour, type: 'limit_set', ok: 1, detail: '12.5' },
    { id: 2, ts: now - 5 * hour, type: 'auto_stop', ok: 1, detail: '20.1/20' },
    { id: 1, ts: now - 6 * hour, type: 'limit_set', ok: 1, detail: '20' },
  ];
  const el = document.createElement('div');
  history.render(el, {
    history: { sessions: rows }, events: { events }, limit: { limit: { kwh: 8, sessionId: null, setAt: now } },
  }, {});
  const cells = all(el).filter((node) => node.tagName === 'td' && node.dataset.label === 'הגבלה');
  const read = (td) => text(td).replace(/\s+/g, ' '); // the fake joins nodes with its own space
  assert.deepEqual(cells.map(read), ['8 kWh פעילה', '12.5 kWh לא הושגה', '20 kWh הושגה', '']);
  assert.ok(all(el).some((node) => node.tagName === 'th' && node.textContent === 'הגבלה'));
  assert.ok(all(cells[2]).some((node) => /chip--ok/.test(node.className)));
});

test('history: no events and no limit on the state still paints the table', () => {
  const el = document.createElement('div');
  history.render(el, { history: { sessions: [{ startedAt: '2026-10-01T08:00:00Z', stopReason: 'Remote' }] } }, {});
  const cells = all(el).filter((node) => node.tagName === 'td' && node.dataset.label === 'הגבלה');
  assert.deepEqual(cells.map(text), ['']);
});

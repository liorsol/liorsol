// The three things the 2026-10-03 board asked for on the page side: the history period filter
// and its month/total rows, the charge-limit panel, and the action log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDocument, all, text, button } from './fake-dom.mjs';

installDocument();

const history = await import('../views/history.js');
const limit = await import('../views/limit.js');
const log = await import('../views/log.js');

const now = new Date();
const iso = (d) => d.toISOString();
const row = (d, kwh) => ({ startedAt: iso(d), durationInSeconds: 3600, totalEnergy: kwh, totalPaymentCostIncVat: kwh, stopReason: 'Remote' });
const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12);
const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 2, 12);
const tenMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 10, 2, 12);
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);
const ROWS = [row(thisMonth, 2), row(lastMonth, 4), row(threeMonthsAgo, 3), row(tenMonthsAgo, 5)];

const bodyRows = (el) => all(el).filter((n) => n.tagName === 'tr').length - 1; // minus the header

test('periodStart: "month" is the 1st of this month, not thirty days back', () => {
  const d = new Date(2026, 9, 20, 15);
  assert.equal(history.periodStart('month', d), new Date(2026, 9, 1).getTime());
  assert.equal(history.periodStart('prev', d), new Date(2026, 8, 1).getTime());
  assert.equal(history.periodEnd('prev', d), new Date(2026, 9, 1).getTime(), 'prev must stop at this month');
  assert.equal(history.periodEnd('month', d), Infinity);
  // January's previous month is last December, not month -1 of this year.
  assert.equal(history.periodStart('prev', new Date(2027, 0, 5)), new Date(2026, 11, 1).getTime());
  assert.equal(history.periodStart('half', d), new Date(2026, 3, 20).getTime());
  assert.equal(history.periodStart('year', d), new Date(2025, 9, 20).getTime());
  assert.equal(history.periodStart('all', d), -Infinity);
});

test('history: one sum row for the filter, and the filter narrows the table without a fetch', () => {
  const el = document.createElement('div');
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return Response.json({}); };
  history.render(el, { history: { sessions: ROWS } }, {});

  const sums = () => all(el).filter((n) => n.className === 'stat-grid stat-grid--period');
  assert.equal(sums().length, 1, 'one sum, for the current filter -- no fixed month row');
  assert.match(text(sums()[0]), /סה״כ.*4 טעינות/);
  assert.equal(bodyRows(el), 4);

  button(el, 'חצי שנה').handlers.click();
  assert.equal(bodyRows(el), 3, 'half a year drops the ten-month-old charge');
  assert.match(text(sums()[0]), /חצי שנה.*3 טעינות/);

  button(el, 'חודש קודם').handlers.click();
  assert.equal(bodyRows(el), 1, 'previous month is that month alone, not this one too');
  assert.match(text(sums()[0]), /חודש קודם.*1 טעינות.*4\.0/);

  button(el, 'החודש').handlers.click();
  assert.equal(bodyRows(el), 1);
  button(el, 'הכל').handlers.click();
  assert.equal(bodyRows(el), 4);
  assert.equal(fetched, 0, 'a filter press fetched');
});

test('the sum row holds one line on a phone, and the filter buttons wrap instead of scrolling', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.btn-row\.period-filter\s*\{[^}]*flex-wrap:\s*wrap/, 'a nowrap filter row scrolls the panel sideways');
  assert.match(css, /\.stat-grid\.stat-grid--period\s*\{[^}]*grid-template-columns:\s*minmax\(0, \.8fr\) minmax\(0, 1fr\) minmax\(0, 1fr\)/);
});

test('limit: unarmed is a field and a save; armed says the target and offers cancel', async () => {
  const el = document.createElement('div');
  limit.render(el, { limit: { limit: null }, state: { sessions: [] } }, {});
  assert.ok(all(el).some((n) => n.tagName === 'input'), 'no field to type a target into');
  assert.ok(button(el, 'הגדרה'));

  limit.render(el, { limit: { limit: { kwh: 12, sessionId: null } }, state: { sessions: [] } }, {});
  assert.match(text(el), /12/);
  assert.match(text(el), /הטעינה הבאה/, 'with nothing charging it must say it waits for the next charge');
  assert.ok(button(el, 'ביטול ההגבלה'));

  const live = { sessionId: 1, totalEnergy: 4.5 };
  limit.render(el, { limit: { limit: { kwh: 12, sessionId: '1' } }, state: { sessions: [live] } }, {});
  assert.match(text(el), /4\.5/, 'progress against the target is not shown');
});

test('limit: the panel can write a number and nothing else -- no command is reachable from it', () => {
  const src = readFileSync(new URL('../views/limit.js', import.meta.url), 'utf8');
  const imports = src.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/api\.js'/)[1].split(',').map((s) => s.trim());
  assert.deepEqual(imports.sort(), ['clearLimit', 'isLiveSession', 'setLimit']);
});

test('log: every row rendered, filtered by type client-side, unknown types shown as themselves', () => {
  const el = document.createElement('div');
  const events = [
    { id: 3, ts: Date.now(), type: 'auto_stop', ok: true, detail: '12.1/12' },
    { id: 2, ts: Date.now(), type: 'start', ok: false, detail: 'token_expired' },
    { id: 1, ts: Date.now(), type: 'mystery', ok: true, detail: null },
  ];
  log.render(el, { events: { events } }, {});
  assert.equal(bodyRows(el), 3);
  assert.match(text(el), /12\.1 מתוך 12 kWh/);
  assert.match(text(el), /mystery/);

  const select = all(el).find((n) => n.tagName === 'select');
  select.value = 'start';
  select.handlers.change();
  assert.equal(bodyRows(el), 1);
  assert.match(text(el), /נכשל/);
  const reset = all(el).find((n) => n.tagName === 'select');
  reset.value = '';
  reset.handlers.change();
  assert.equal(bodyRows(el), 3);
});

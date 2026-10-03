// views/history.js — S4: the session table and the period totals above it.
//
// Mount contract (PLAN §7.10): render(el, state, ctx), where `state` is
//   { state, history, invoices, expired, fetchedAt, stale }
// and any of the three payloads may be null. app.js calls a view only on success,
// so there is no error argument and nothing here ever blanks a painted panel.
// app.js owns the stale marker and the last-updated line; this module does not.
//
// effectiveKw() is pure — no DOM, no clock, no module state — so it can be asserted in node
// without a browser. themes/native.js imports it; it is the only export here that is not render().
//
// THE "SAVED BY DEFERRING" COLUMN AND TILE ARE GONE, and so is the arithmetic behind them
// (shekelAvoided, the level breakdown, the VAT re-basing): the owner asked for the whole idea
// off this screen. If it ever comes back it comes back from the tariff calendar, not from a
// helper kept alive here with no caller.

// The one definition of a live session, shared with views/tariff.js and views/controls.js —
// this table used to carry its own, a third spelling of the same judgement. See the comment on
// the predicate in api.js for why a row that has ended is a normal thing to find.
import { isLiveSession } from '../api.js';
import { duration, n, numeric, numericUtc, stopReasonKey, stopReasonLabel } from './he.js';

// ── pure metrics ────────────────────────────────────────────────────────────

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * kWh ÷ hours. A zero or missing duration returns 0 — never Infinity, never NaN.
 * @param {object} row a session row (stripped or raw)
 * @returns {number} kW
 */
export function effectiveKw(row) {
  const kwh = num(row && row.totalEnergy);
  const secs = num(row && row.durationInSeconds);
  if (kwh === null || secs === null || secs <= 0) return 0;
  return kwh / (secs / 3600);
}

// ── stop reason → chip severity ─────────────────────────────────────────────
// The stylesheet deliberately does not encode the upstream vocabulary (the repo is
// public), so the mapping lives here. Anything unrecognised gets a bare .chip
// rather than a guessed severity.

const STOP_CHIP = {
  remote: 'chip--ok',            // stopped on purpose, by the app or this dashboard
  local: 'chip--ok',             // stopped at the unit
  unlockcommand: 'chip--ok',
  evdisconnected: 'chip--info',  // cable pulled — the normal end of a session
  other: '',
  softreset: 'chip--warn',
  hardreset: 'chip--warn',
  reboot: 'chip--warn',
  powerloss: 'chip--warn',
  deauthorized: 'chip--bad',
  emergencystop: 'chip--bad',
};

// The same normaliser the Hebrew labels are keyed on, so a reason cannot pick up a colour here
// and a label there — or worse, a colour and no label.
function stopChip(reason) {
  const mod = STOP_CHIP[stopReasonKey(reason)];
  return mod === undefined ? 'chip' : ('chip ' + mod).trim();
}

// ── small DOM helpers: textContent and classList only, no markup strings ────

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

// ponytail: style.css owns every visual token but has no vertical-rhythm utility, and
// it is frozen this wave. Sections are spaced from the CSSOM with the designer's own
// spacing token — a style="" attribute would be blocked by the page CSP. Upgrade path:
// a .stack class in style.css the next time its owner opens it.
function spaced(node, step) {
  node.style.setProperty('margin-block-start', 'var(--sp-' + (step || 4) + ')');
  return node;
}

// app.js mounts this view inside a .panel__body--flush so a wide table can run edge to edge.
// Everything that is not a table therefore has to carry the panel's own inset itself. Read
// from the DOM rather than assumed, so it still looks right if the shell drops the modifier.
function inset(root, node, top) {
  const flush = typeof root.closest === 'function' && root.closest('.panel__body--flush');
  if (flush) node.style.setProperty('padding', (top ? 'var(--sp-4) ' : '0 ') + 'var(--sp-4) 0');
  return node;
}

// Some upstream stamps carry no zone designator at all. Every one of them is UTC, but
// JS parses a naked date-time as *viewer-local*, which silently shifts it by the whole
// UTC offset. Pin the zone before parsing.
function toMs(iso) {
  if (typeof iso !== 'string' || !iso) return NaN;
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + 'Z');
}

// The payload's *local* stamps are wall-clock stamped as if UTC (API-NOTES §5), so they
// are formatted in UTC to read back as the charger's local time. A true-UTC stamp falls
// back to the viewer's own zone.
function whenText(row) {
  const local = row.startedLocal || row.deviceLocalStartDate;
  if (local) {
    const ms = toMs(local);
    if (Number.isFinite(ms)) return numericUtc(ms);
  }
  return numeric(toMs(row.startedAt || row.deviceStartDate));
}

const cell = (tag, text, isNum) => h(tag, isNum ? 'num' : null, text);

// The columns, once. The header row is built from this and so is every body row's `data-label`,
// which is what the phone layout prints beside a value when the table becomes a stack of cards —
// style.css used to hold a hand-kept second copy of these six strings and could only go stale.
// Every mixed header opens in Hebrew and carries its Latin unit in brackets at the end: `.num`
// gives these cells their own bidi paragraph taking direction from the first strong character,
// so a header starting "kWh" would lay itself out left to right mid-table.
const COLUMNS = [
  ['התחלה', false],
  ['משך', false],
  ['אנרגיה (kWh)', true],
  ['עלות ₪', true],
  ['הספק ממוצע (kW)', true],
  ['סיבת עצירה', false],
];

function emptyBlock(title, hint, isError) {
  const box = h('div', isError ? 'empty empty--error' : 'empty');
  box.appendChild(h('div', 'empty__icon', isError ? '⚠' : '🗒'));
  box.appendChild(h('p', 'empty__title', title));
  box.appendChild(h('p', 'empty__hint', hint));
  return box;
}

function tile(value, unit, label) {
  const t = h('div', 'stat');
  const v = h('div', 'stat__value', value);
  if (unit) v.appendChild(h('span', 'stat__unit', unit));
  t.appendChild(v);
  t.appendChild(h('div', 'stat__label', label));
  return t;
}

// ── period filter ───────────────────────────────────────────────────────────
// Client-side over the rows the load round already holds (the private service sends a year), so
// a filter press fetches nothing -- the same rule as a menu press. Module memory: survives a
// repaint, resets on a reload.

const PERIODS = [
  ['all', 'הכל'],
  ['month', 'החודש'],
  ['half', 'חצי שנה'],
  ['year', 'שנה'],
];
let period = 'all';

/**
 * Epoch ms a period starts at, or -Infinity for "all". "month" is the 1st of the current month,
 * not thirty days back -- the owner's words.
 * @param {string} p a PERIODS key
 * @param {Date} now
 */
export function periodStart(p, now) {
  const y = now.getFullYear(), m = now.getMonth();
  if (p === 'month') return new Date(y, m, 1).getTime();
  if (p === 'half') return new Date(y, m - 6, now.getDate()).getTime();
  if (p === 'year') return new Date(y - 1, m, now.getDate()).getTime();
  return -Infinity;
}

// A row with no readable start is in "all" and in no bounded period.
const inPeriod = (row, from) => from === -Infinity || startMs(row) >= from;

// True UTC first: the period edges are the viewer's own clock.
const startMs = (row) => {
  const ms = toMs(row.startedAt || row.deviceStartDate);
  return Number.isFinite(ms) ? ms : toMs(row.startedLocal || row.deviceLocalStartDate);
};

function totals(rows) {
  let kwh = 0, paidInc = 0, paidEx = 0;
  for (const row of rows) {
    kwh += num(row.totalEnergy) || 0;
    paidInc += num(row.totalPaymentCostIncVat) || 0;
    paidEx += num(row.totalPaymentCostExcVat) || 0;
  }
  return { count: rows.length, kwh, paid: paidInc || paidEx, inc: !!paidInc || !paidEx };
}

// One line per period, on a phone too: the label carries the count small, and the two tiles that
// matter sit beside it. `.stat-grid--period` (style.css) fixes the three columns.
function periodRow(label, t) {
  const grid = h('div', 'stat-grid stat-grid--period');
  const head = h('div', 'stat-grid__head');
  head.appendChild(h('div', 'stat__label', label));
  head.appendChild(h('div', 'stat__label', n(t.count, 0) + ' טעינות'));
  grid.appendChild(head);
  grid.appendChild(tile(n(t.kwh, 1), 'kWh', 'אנרגיה'));
  grid.appendChild(tile(n(t.paid), '₪', t.inc ? 'כולל מע״מ' : 'לפני מע״מ'));
  return grid;
}

// ── render ──────────────────────────────────────────────────────────────────

export function render(el, state, ctx) {   // eslint-disable-line no-unused-vars
  const app = state || {};
  const hist = app.history;
  el.replaceChildren();

  if (!hist) {
    el.appendChild(emptyBlock('לא ניתן לטעון את הטעינות',
      'עדיין לא הגיעה רשימת טעינות. לחצו רענון כדי לנסות שוב.', true));
    return;
  }

  const all = (Array.isArray(hist.sessions) && hist.sessions)
    || (Array.isArray(hist.rows) && hist.rows) || [];
  if (!all.length) {
    el.appendChild(emptyBlock('אין עדיין טעינות', 'לא נרשם דבר בתקופה הזו.'));
    return;
  }

  const now = new Date();
  const from = periodStart(period, now);
  const rows = all.filter((row) => inPeriod(row, from));
  const monthFrom = periodStart('month', now);

  const filter = h('div', 'btn-row period-filter');
  filter.setAttribute('role', 'group');
  filter.setAttribute('aria-label', 'תקופה');
  for (const [key, label] of PERIODS) {
    const b = h('button', key === period ? 'btn btn--primary' : 'btn', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(key === period));
    b.addEventListener('click', () => {
      period = key;
      render(el, state, ctx);
    });
    filter.appendChild(b);
  }
  el.appendChild(inset(el, filter, true));

  // Current month always; the total follows the filter, and says which period it is.
  const stats = spaced(h('div'), 3);
  stats.appendChild(periodRow('החודש', totals(all.filter((row) => inPeriod(row, monthFrom)))));
  const periodName = PERIODS.find(([k]) => k === period)[1];
  stats.appendChild(spaced(periodRow(period === 'all' ? 'סה״כ' : 'סה״כ · ' + periodName, totals(rows)), 2));
  el.appendChild(inset(el, stats, false));

  if (!rows.length) {
    el.appendChild(inset(el, spaced(emptyBlock('אין טעינות בתקופה הזו', 'בחרו תקופה ארוכה יותר.')), false));
    return;
  }

  const wrap = spaced(h('div', 'table-wrap'));
  const table = h('table', 'table');
  const thead = h('thead');
  const hrow = h('tr');
  for (const [label, isNum] of COLUMNS) hrow.appendChild(cell('th', label, isNum));
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = h('tbody');
  for (const row of rows) {
    const tr = h('tr');
    if (isLiveSession(row)) tr.className = 'is-live';
    tr.appendChild(cell('td', whenText(row)));
    tr.appendChild(cell('td', duration(num(row.durationInSeconds))));
    tr.appendChild(cell('td', n(num(row.totalEnergy) || 0), true));
    tr.appendChild(cell('td', n(num(row.totalPaymentCostIncVat)), true));
    tr.appendChild(cell('td', n(effectiveKw(row)), true));

    const td = h('td');
    const reason = row.stopReason;
    // Hebrew in the chip, the protocol's own spelling on the title. The chip is nowrap and a
    // table cell wide, so the raw value rides along rather than sitting beside it.
    const chip = h('span', reason ? stopChip(reason) : 'chip',
      reason ? stopReasonLabel(reason) : 'בעיצומה');
    if (reason) chip.title = String(reason);
    td.appendChild(chip);
    tr.appendChild(td);
    // The card layout's labels, from the same list the header came from. One loop after the
    // row is built beats threading a label through six append calls.
    for (let i = 0; i < tr.children.length; i++) tr.children[i].dataset.label = COLUMNS[i][0];
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  el.appendChild(wrap);
}

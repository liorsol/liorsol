// views/history.js — S4: session table, period totals, ₪ avoided by deferring.
//
// Mount contract (PLAN §7.10): render(el, state, ctx), where `state` is
//   { state, history, invoices, expired, fetchedAt, stale }
// and any of the three payloads may be null. app.js calls a view only on success,
// so there is no error argument and nothing here ever blanks a painted panel.
// app.js owns the stale marker and the last-updated line; this module does not.
//
// effectiveKw() and shekelAvoided() are pure — no DOM, no clock, no module state —
// so the metric can be asserted in node without a browser.

// The one definition of a live session, shared with views/tariff.js and views/controls.js —
// this table used to carry its own, a third spelling of the same judgement. See the comment on
// the predicate in api.js for why a row that has ended is a normal thing to find.
import { isLiveSession } from '../api.js';
import { dayTime, dayTimeUtc, duration, n, stopReasonKey, stopReasonLabel } from './he.js';

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

// The Worker hands back `levels: [{level, unitCost, energy, cost}]`; the raw session
// row carries the same numbers as flat l1..l9 fields. Accept either.
function levelsOf(row) {
  if (!row) return [];
  if (Array.isArray(row.levels)) return row.levels;
  const out = [];
  for (let n = 1; n <= 9; n++) {
    const energy = row['l' + n + 'Energy'];
    const cost = row['l' + n + 'Cost'];
    if (energy === undefined && cost === undefined) continue;
    out.push({ level: n, unitCost: row['l' + n + 'UnitCost'], energy, cost });
  }
  return out;
}

/** The dearest price in the calendar we were handed. 0 for an empty calendar. */
function dearestPrice(slices) {
  let top = 0;
  for (const s of slices || []) {
    const p = num(s && s.price);
    if (p !== null && p > top) top = p;
  }
  return top;
}

/**
 * ₪ the session avoided by buying its energy in a cheaper slice than the dearest
 * one the calendar offers:  Σ energy × (dearest − unitCost), floored at 0.
 *
 * Returns the EX-VAT figure, because that is the basis the level breakdown is in
 * (unitCost and l{n}Cost are both ex-VAT) and because a row does not always carry
 * a VAT rate. The inc-VAT figure is this × (1 + rate/100) with the rate read from
 * the payload — see vatRateOf(). Never negative; 0 for a one-slice or empty calendar.
 *
 * @param {object} row
 * @param {Array<{price:number}>} slices the live tariff calendar
 * @returns {number} ₪ excluding VAT, >= 0
 */
export function shekelAvoided(row, slices) {
  const dearest = dearestPrice(slices);
  let avoided = 0;
  for (const lv of levelsOf(row)) {
    const energy = num(lv && lv.energy);
    const unit = num(lv && lv.unitCost);
    if (energy === null || energy <= 0 || unit === null || unit <= 0) continue;
    if (dearest > unit) avoided += energy * (dearest - unit);
  }
  return avoided > 0 ? avoided : 0;
}

// VAT is data, never a constant: the session row carries it as vatRate, the tariff
// slice as vat. If neither is present we show the ex-VAT figure and say so.
function vatRateOf(row, slices) {
  const fromRow = num(row && row.vatRate);
  if (fromRow !== null && fromRow >= 0) return fromRow;
  for (const s of slices || []) {
    const v = num(s && s.vat);
    if (v !== null && v >= 0) return v;
  }
  return null;
}

const withVat = (amount, rate) => (rate === null ? null : amount * (1 + rate / 100));

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
    if (Number.isFinite(ms)) return dayTimeUtc(ms);
  }
  return dayTime(toMs(row.startedAt || row.deviceStartDate));
}

const cell = (tag, text, numeric) => h(tag, numeric ? 'num' : null, text);

function emptyBlock(title, hint, isError) {
  const box = h('div', isError ? 'empty empty--error' : 'empty');
  box.appendChild(h('div', 'empty__icon', isError ? '⚠' : '🗒'));
  box.appendChild(h('p', 'empty__title', title));
  box.appendChild(h('p', 'empty__hint', hint));
  return box;
}

function tile(value, unit, label, good) {
  const t = h('div', good ? 'stat stat--good' : 'stat');
  const v = h('div', 'stat__value', value);
  if (unit) v.appendChild(h('span', 'stat__unit', unit));
  t.appendChild(v);
  t.appendChild(h('div', 'stat__label', label));
  return t;
}

// ── render ──────────────────────────────────────────────────────────────────

export function render(el, state, ctx) {   // eslint-disable-line no-unused-vars
  const app = state || {};
  const hist = app.history;
  const slices = (app.state && app.state.pricingSlices) || [];
  el.replaceChildren();

  if (!hist) {
    el.appendChild(emptyBlock('לא ניתן לטעון את הטעינות',
      'עדיין לא הגיעה רשימת טעינות. לחצו רענון כדי לנסות שוב.', true));
    return;
  }

  const rows = (Array.isArray(hist.sessions) && hist.sessions)
    || (Array.isArray(hist.rows) && hist.rows) || [];
  if (!rows.length) {
    el.appendChild(emptyBlock('אין עדיין טעינות', 'לא נרשם דבר בתקופה הזו.'));
    return;
  }

  // Period totals, computed from exactly the rows shown below.
  let kwh = 0, paidInc = 0, paidEx = 0, avoidedEx = 0, rate = null;
  for (const row of rows) {
    kwh += num(row.totalEnergy) || 0;
    paidInc += num(row.totalPaymentCostIncVat) || 0;
    paidEx += num(row.totalPaymentCostExcVat) || 0;
    avoidedEx += shekelAvoided(row, slices);
    if (rate === null) rate = vatRateOf(row, slices);
  }
  const avoidedInc = withVat(avoidedEx, rate);

  const grid = h('div', 'stat-grid');
  grid.appendChild(tile(n(rows.length, 0), null, 'טעינות'));
  grid.appendChild(tile(n(kwh, 1), 'kWh', 'אנרגיה שנמסרה'));
  grid.appendChild(tile(
    n(paidInc || paidEx), '₪',
    paidInc ? 'שולם — כולל מע״מ' : 'שולם — לפני מע״מ'));
  // Both bases, always, and the basis of each in words: the inc-VAT figure is the one
  // that shows up on a bill, the ex-VAT one is what the arithmetic is done in.
  grid.appendChild(tile(
    n(avoidedInc === null ? avoidedEx : avoidedInc), '₪',
    avoidedInc === null
      ? 'נחסך בזכות דחייה — לפני מע״מ (אין שיעור מע״מ בנתונים)'
      : 'נחסך בזכות דחייה — כולל מע״מ (' + n(avoidedEx) + ' ₪ לפני מע״מ)',
    true));
  el.appendChild(inset(el, grid, true));

  const wrap = spaced(h('div', 'table-wrap'));
  const table = h('table', 'table');
  const thead = h('thead');
  const hrow = h('tr');
  // Every mixed header opens in Hebrew and carries its Latin unit in brackets at the end.
  // .num gives these cells their own bidi paragraph taking direction from the first strong
  // character, so a header starting "kWh" would lay itself out left to right mid-table.
  hrow.appendChild(cell('th', 'התחלה'));
  hrow.appendChild(cell('th', 'משך'));
  hrow.appendChild(cell('th', 'אנרגיה (kWh)', true));
  hrow.appendChild(cell('th', 'עלות (₪ כולל מע״מ)', true));
  hrow.appendChild(cell('th', 'הספק ממוצע (kW)', true));
  hrow.appendChild(cell('th', 'נחסך (₪ ' + (rate === null ? 'לפני מע״מ' : 'כולל מע״מ') + ')', true));
  hrow.appendChild(cell('th', 'סיבת עצירה'));
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
    // Same basis as the header and the tile — mixing the two inside one panel is how a
    // saving quietly reads 18% low.
    const avoidedEx = shekelAvoided(row, slices);
    const avoided = rate === null ? avoidedEx : withVat(avoidedEx, rate);
    tr.appendChild(cell('td', n(avoided), true));

    const td = h('td');
    const reason = row.stopReason;
    // Hebrew in the chip, the protocol's own spelling on the title. The chip is nowrap and a
    // table cell wide, so the raw value rides along rather than sitting beside it.
    const chip = h('span', reason ? stopChip(reason) : 'chip',
      reason ? stopReasonLabel(reason) : 'בעיצומה');
    if (reason) chip.title = String(reason);
    td.appendChild(chip);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  el.appendChild(wrap);
}

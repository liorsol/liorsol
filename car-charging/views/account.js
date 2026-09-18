// views/account.js — S4: charger status and billed periods.
//
// There is no account object to render, by design (PLAN §7.12): the Worker's PII
// whitelist strips every personal field before anything reaches the cache, so the
// payload carries `charger`, `pricingSlices` and `sessions` and nothing else. This module
// renders exactly what exists and invents no field -- see the block above invoiceBlock() for
// what it cost the one time it rendered a shape nobody had seen.
//
// Mount contract (PLAN §7.10): render(el, state, ctx) with
//   { state, history, invoices, expired, fetchedAt, stale }; any payload may be null.

import { date, dayTime, n, statusClass, statusLabel } from './he.js';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Naked upstream stamps are UTC, but JS parses a zone-less date-time as viewer-local.
function toMs(iso) {
  if (typeof iso !== 'string' || !iso) return NaN;
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + 'Z');
}

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

// ponytail: style.css has no vertical-rhythm utility and is frozen this wave, so the
// gap between sections is set from the CSSOM with the designer's own spacing token —
// a style="" attribute is blocked by the page CSP. Upgrade path: a .stack class.
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

// Both stamps on this screen are moments rather than days -- when a connector last reported,
// when a period was billed -- so both carry the clock. An unparseable value is shown verbatim
// rather than as an em dash: it is still the truest thing upstream said.
function stamp(iso) {
  const ms = toMs(iso);
  return Number.isFinite(ms) ? dayTime(ms) : (iso ? String(iso) : '—');
}

function emptyBlock(title, hint, isError) {
  const box = h('div', isError ? 'empty empty--error' : 'empty');
  box.appendChild(h('div', 'empty__icon', isError ? '⚠' : '🧾'));
  box.appendChild(h('p', 'empty__title', title));
  box.appendChild(h('p', 'empty__hint', hint));
  return box;
}

// Not a stat tile and not a chip: the off-peak state is an upstream string of unknown
// length. A tile puts it in the big-number slot and it wraps into a wall; .chip is
// white-space: nowrap, so a long one pushes the whole page sideways. Plain text wraps.

function cell(tag, text, numeric) {
  return h(tag, numeric ? 'num' : null, text);
}

// `headings` is [[label, numeric], …] and it is also what labels a body cell once the phone
// layout turns each row into a card: `finish()` stamps `data-label` from the same list the
// header came from, so a column cannot lose its meaning by being renamed in one place only.
function table(headings) {
  const wrap = h('div', 'table-wrap');
  const t = h('table', 'table');
  const thead = h('thead');
  const row = h('tr');
  for (const [label, numeric] of headings) row.appendChild(cell('th', label, numeric));
  thead.appendChild(row);
  t.appendChild(thead);
  const tbody = h('tbody');
  t.appendChild(tbody);
  wrap.appendChild(t);
  const finish = (tr) => {
    for (let i = 0; i < tr.children.length; i++) tr.children[i].dataset.label = headings[i][0];
    tbody.appendChild(tr);
  };
  return { wrap, finish };
}

// ── charger ─────────────────────────────────────────────────────────────────

function chargerBlock(charger, root) {
  const box = h('div');
  const head = h('div');
  head.appendChild(charger.ocppConnected === true
    ? h('span', 'chip chip--ok', 'החיבור פעיל')
    : charger.ocppConnected === false
      ? h('span', 'chip chip--bad', 'החיבור מנותק')
      : h('span', 'chip', 'מצב החיבור לא ידוע'));
  // The value itself is an upstream string of unknown length and is NOT translated: it is what
  // the charger says its own schedule is, and a guess at the Hebrew for a word this page has
  // never seen is worse than the word.
  head.appendChild(spaced(h('p', null, 'תוכנית שעות השפל, כפי שהעמדה מדווחת אותה: '
    + (charger.offPeakState === null || charger.offPeakState === undefined
      ? 'לא מדווח' : String(charger.offPeakState))), 2));
  box.appendChild(inset(root || box, head, true));

  const connectors = Array.isArray(charger.connectors) ? charger.connectors : [];
  if (!connectors.length) {
    box.appendChild(spaced(emptyBlock('לא דווחו מחברים',
      'מצב העמדה לא כלל רשימת מחברים.')));
    return box;
  }

  const { wrap, finish } = table([['מחבר', true], ['מצב', false], ['מוכן', false], ['עודכן', false]]);
  for (const c of connectors) {
    const tr = h('tr');
    tr.appendChild(cell('td', c.connectorId === undefined || c.connectorId === null ? '—' : String(c.connectorId), true));
    const stateCell = h('td');
    const status = c.status ? String(c.status) : null;
    if (status) {
      // Hebrew label, protocol spelling on the title — the same split the controls panel and the
      // session table make, so one state never reads as two different things on one page.
      const badge = h('span', statusClass(status), statusLabel(status));
      badge.title = status;
      stateCell.appendChild(badge);
    } else {
      stateCell.appendChild(h('span', 'chip', 'לא ידוע'));
    }
    tr.appendChild(stateCell);
    const readyCell = h('td');
    readyCell.appendChild(c.canCharge === true
      ? h('span', 'chip chip--ok', 'כן')
      : c.canCharge === false ? h('span', 'chip chip--warn', 'לא') : h('span', 'chip', '—'));
    tr.appendChild(readyCell);
    tr.appendChild(cell('td', stamp(c.updated)));
    finish(tr);
  }
  box.appendChild(spaced(wrap, 3));
  return box;
}

// ── invoices ────────────────────────────────────────────────────────────────
//
// A CARD PER BILLED PERIOD, NOT A TABLE. There is one closed period today and there will be one
// more a month; a table with one row spends a header row and five columns saying what a card
// says in its own words, and the thing the owner actually wants off this screen — the invoice
// document — is a button, which is not a table cell.
//
// EVERY FIGURE HERE IS THE OPERATOR'S, AND NONE OF IT IS COMPUTED. That is the whole history of
// this panel: it was first written before any period had closed, against a *guessed* row
// (`fromDate`, `toDate`, `totalEnergy`, `totalCostExcVat`, `totalCostIncVat`) and the private
// half's whitelist was guessing the same names, so when the first real bill arrived every field
// was dropped on the way through and every cell rendered "—". The owner reported the bill as
// missing. It had been there for nine days. The whitelist now maps captured names to the ones
// below, and the names below are a contract with it rather than a hope.
//
// The rule that came out of that: nothing on this card may be arithmetic of ours. The tempting
// one is the total — sum the sessions in the window — and it is exactly wrong, because it would
// print a number this dashboard computed beside a status the operator issued, in the one place
// the owner goes to find out what they were actually charged. `energy + fees + VAT` is not
// re-added here either; the operator's own `totalIncVat` is what a card shows.
//
// THE DOCUMENT IS THE OPERATOR'S TOO. `receiptUrl` is a link to a PDF they issued, and the page
// links to it rather than rendering an invoice of its own — a generated one would be a document
// that looks official and answers to nobody. It opens in a new tab: `download` is ignored on a
// cross-origin URL, so forcing a save is not on offer, and losing the dashboard to a PDF
// navigation on a phone is worse than a second tab. The URL arrives at runtime and is never
// written down here — its path names the operator, which is the repo rule.

// The billed window, as two dates and no clock -- a period boundary is a midnight and printing
// "00:00" beside it twice says nothing. Both stamps are TRUE UTC INSTANTS of a local midnight
// (`2026-07-31T21:00:00` is 1 August in Asia/Jerusalem), so they are formatted in the VIEWER's
// zone, which is the opposite of the session table's rule for the payload's wall-clock "local"
// stamps. The row carries both spellings of the same two boundaries; this prefers the instants
// and falls back to the wall-clock pair, and either way `toMs` pins the zone before parsing.
//
// The end is the EXCLUSIVE boundary, printed as it arrived. Subtracting a day to show "31 באוג׳"
// would read better and would be this page doing arithmetic on the operator's dates, which is
// the one thing this panel is now written not to do.
const periodDate = (iso) => {
  const ms = toMs(iso);
  return Number.isFinite(ms) ? date(ms) : null;
};

const period = (from, to) => {
  const a = periodDate(from);
  const b = periodDate(to);
  if (!a && !b) return 'תקופת חיוב';
  return a && b ? a + ' – ' + b : (a || b);
};

function tile(value, unit, label) {
  const t = h('div', 'stat');
  const v = h('div', 'stat__value', value);
  if (unit) v.appendChild(h('span', 'stat__unit', unit));
  t.appendChild(v);
  t.appendChild(h('div', 'stat__label', label));
  return t;
}

// A tile is rendered only when its figure arrived. A grid of em dashes is what this panel looked
// like for nine days and is the one shape it must not be able to take again.
function figures(r) {
  const grid = h('div', 'stat-grid');
  const total = num(r.totalIncVat);
  const kwh = num(r.energyKwh);
  const fees = num(r.feesExcVat);
  const energy = num(r.energyExcVat);

  if (total !== null) grid.appendChild(tile(n(total), '₪', 'סה״כ חויב — כולל מע״מ'));
  if (kwh !== null) grid.appendChild(tile(n(kwh, 1), 'kWh', 'אנרגיה בתקופה'));
  if (energy !== null) grid.appendChild(tile(n(energy), '₪', 'עלות אנרגיה — לפני מע״מ'));
  // The standing charge is why the total is not the energy cost, and it is the figure most
  // likely to be the surprise on the bill, so it is a tile rather than a footnote.
  if (fees !== null) grid.appendChild(tile(n(fees), '₪', 'דמי מנוי — לפני מע״מ'));
  return grid.children.length ? grid : null;
}

// The line under the tiles: VAT as charged, and the operator's own document number. Both are
// what a support conversation is about, and neither deserves a tile.
function footnote(r) {
  const parts = [];
  const vat = num(r.vat);
  const rate = num(r.vatRate);
  if (vat !== null) parts.push('מע״מ ' + n(vat) + ' ₪' + (rate === null ? '' : ' (' + n(rate, 0) + '%)'));
  const excl = num(r.totalExcVat);
  if (excl !== null) parts.push('לפני מע״מ ' + n(excl) + ' ₪');
  if (r.receiptNumber) parts.push('חשבונית ' + String(r.receiptNumber));
  return parts.length ? h('p', 'btn-note', parts.join(' · ')) : null;
}

function invoiceCard(r, root) {
  const card = h('div');

  const head = h('div', 'btn-row');
  head.appendChild(h('h4', 'panel__title',
    period(r.fromDate ?? r.accountFromDate, r.toDate ?? r.accountToDate)));
  const state = r.status || r.periodStatus;
  if (state) {
    // The operator's own word, untranslated: this page has never seen the full set of values and
    // a guess at the Hebrew for one it has not met is worse than the word.
    const chip = h('span', String(state).toLowerCase() === 'success' ? 'chip chip--ok' : 'chip', String(state));
    chip.title = String(state);
    head.appendChild(chip);
  }
  card.appendChild(inset(root, head, true));

  const grid = figures(r);
  if (grid) card.appendChild(inset(root, spaced(grid, 3)));

  const note = footnote(r);
  if (note) card.appendChild(inset(root, spaced(note, 3)));

  // The document. Absent when the operator issued none — no disabled button, no "not available
  // yet": a control that cannot work is worse than no control on a screen read one-handed.
  if (typeof r.receiptUrl === 'string' && /^https:\/\//.test(r.receiptUrl)) {
    const row = h('div', 'btn-row');
    const link = h('a', 'btn btn--primary', '⬇ הורדת החשבונית (PDF)');
    link.href = r.receiptUrl;
    link.target = '_blank';
    // The response headers already send no referrer; this attribute is the half that still
    // holds when somebody edits that file. Same reasoning as the contact card's two links.
    link.rel = 'noopener noreferrer';
    row.appendChild(link);
    card.appendChild(inset(root, spaced(row, 3)));
  } else {
    card.appendChild(inset(root, spaced(h('p', 'btn-note',
      'לתקופה הזו לא צורפה חשבונית להורדה.'), 3)));
  }
  return card;
}

function invoiceBlock(invoices, root) {
  if (!invoices) {
    return emptyBlock('לא ניתן לטעון את תקופות החיוב',
      'עדיין לא הגיעו נתוני חיוב. לחצו רענון כדי לנסות שוב.', true);
  }
  const rows = (Array.isArray(invoices.invoices) && invoices.invoices)
    || (Array.isArray(invoices.rows) && invoices.rows) || [];
  if (!rows.length) {
    return emptyBlock('עדיין לא חויב דבר',
      'אף תקופה חודשית לא נסגרה, ולכן אין חשבון להציג. זה המצב הצפוי '
      + 'עד שתיסגר הראשונה.');
  }

  const box = h('div');
  for (const r of rows) box.appendChild(spaced(invoiceCard(r, root || box), 5));
  return box;
}

// ── render ──────────────────────────────────────────────────────────────────

export function render(el, state, ctx) {   // eslint-disable-line no-unused-vars
  const app = state || {};
  const payload = app.state;
  el.replaceChildren();

  if (!payload || !payload.charger) {
    el.appendChild(emptyBlock('לא ניתן לטעון את מצב העמדה',
      'עדיין לא הגיע מצב עמדה. לחצו רענון כדי לנסות שוב.', true));
  } else {
    el.appendChild(chargerBlock(payload.charger, el));
  }

  el.appendChild(inset(el, spaced(h('h3', 'panel__title', 'תקופות חיוב'), 5)));
  el.appendChild(spaced(invoiceBlock(app.invoices, el), 3));
}

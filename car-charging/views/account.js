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

import { dayTime, n, statusClass, statusLabel } from './he.js';

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
// THE COLUMNS ARE THE FIELDS A CLOSED PERIOD ACTUALLY CARRIES, and getting that wrong is what
// made the owner report the last bill as missing when it was sitting right there. This table was
// written before any period had closed, against a *guessed* row — `fromDate`, `toDate`,
// `totalEnergy`, `totalCostExcVat`, `totalCostIncVat`. The first real closed period carries none
// of those five. Every cell therefore rendered "—" and the one row on the screen read as an
// empty one. The fields it does carry are `periodId`, `status`, `created`, `paymentDate` and
// `vatRate`, and those are the four columns below.
//
// There is no amount and no energy to show, and inventing one is the thing not to do here: the
// obvious reconstruction — sum the sessions in the window — would print a figure this dashboard
// computed beside a status the operator issued, which is a number the owner would reasonably
// take for the bill. If the real totals exist they are behind a call nobody has captured, and
// that capture is the owner's to run. Same discipline as the two uncaptured calls in CLAUDE.md.
//
// Anything added back here comes from a real body, not from a plausible field name. That is the
// whole lesson of the paragraph above, and it has now cost two rounds.

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

  const { wrap, finish } = table([
    ['מספר תקופה', true], ['מצב', false], ['תאריך חיוב', false], ['מע״מ (%)', true],
  ]);
  for (const r of rows) {
    const tr = h('tr');
    tr.appendChild(cell('td', r.periodId === undefined || r.periodId === null ? '—' : String(r.periodId), true));
    const state = r.periodStatus || r.status;
    const stateCell = h('td');
    stateCell.appendChild(h('span', 'chip', state ? String(state) : '—'));
    tr.appendChild(stateCell);
    tr.appendChild(cell('td', stamp(r.paymentDate || r.created)));
    tr.appendChild(cell('td', n(num(r.vatRate), 0), true));
    finish(tr);
  }

  const box = h('div');
  box.appendChild(wrap);
  // Said once, in the panel, rather than left as four "—" cells for the owner to interpret.
  // See the block comment above invoiceBlock for why there is no money here to print. It is
  // prose rather than a table, so it carries the panel's own inset the way everything else
  // that is not a table in this flush body does.
  box.appendChild(inset(root || box, spaced(h('p', 'btn-note',
    'החיוב מופיע כאן ברגע שהתקופה נסגרת. הסכום והאנרגיה אינם חלק ממה שהעמדה מחזירה על תקופה '
    + 'שנסגרה — הפירוט הכספי לכל טעינה נמצא במסך “טעינות”.'), 3)));
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

// views/account.js — S4: charger status and billed periods.
//
// There is no account object to render, by design (PLAN §7.12): the Worker's PII
// whitelist strips every personal field before anything reaches the cache, so the
// payload carries `charger`, `pricingSlices` and `sessions` and nothing else. The
// invoice shape has never been captured and stays empty until the first monthly bill
// closes. This module therefore renders exactly what exists and invents no field.
//
// Mount contract (PLAN §7.10): render(el, state, ctx) with
//   { state, history, invoices, expired, fetchedAt, stale }; any payload may be null.

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

function stamp(iso, withTime) {
  const ms = toMs(iso);
  if (!Number.isFinite(ms)) return iso ? String(iso) : '—';
  const opts = withTime
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' };
  return new Date(ms).toLocaleString(undefined, opts);
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
  return { wrap, tbody };
}

// ── charger ─────────────────────────────────────────────────────────────────

function chargerBlock(charger, root) {
  const box = h('div');
  const head = h('div');
  head.appendChild(charger.ocppConnected === true
    ? h('span', 'chip chip--ok', 'Link online')
    : charger.ocppConnected === false
      ? h('span', 'chip chip--bad', 'Link offline')
      : h('span', 'chip', 'Link state unknown'));
  head.appendChild(spaced(h('p', null, 'Off-peak plan, as the charger reports it: '
    + (charger.offPeakState === null || charger.offPeakState === undefined
      ? 'not reported' : String(charger.offPeakState))), 2));
  box.appendChild(inset(root || box, head, true));

  const connectors = Array.isArray(charger.connectors) ? charger.connectors : [];
  if (!connectors.length) {
    box.appendChild(spaced(emptyBlock('No connectors reported',
      'The charger state carried no connector list.')));
    return box;
  }

  const { wrap, tbody } = table([['Connector', true], ['State', false], ['Ready', false], ['Reported', false]]);
  for (const c of connectors) {
    const tr = h('tr');
    tr.appendChild(cell('td', c.connectorId === undefined || c.connectorId === null ? '—' : String(c.connectorId), true));
    const stateCell = h('td');
    const status = c.status ? String(c.status) : null;
    stateCell.appendChild(status
      ? h('span', 'status status--' + status.toLowerCase(), status)
      : h('span', 'chip', 'Unknown'));
    tr.appendChild(stateCell);
    const readyCell = h('td');
    readyCell.appendChild(c.canCharge === true
      ? h('span', 'chip chip--ok', 'Yes')
      : c.canCharge === false ? h('span', 'chip chip--warn', 'No') : h('span', 'chip', '—'));
    tr.appendChild(readyCell);
    tr.appendChild(cell('td', stamp(c.updated, true)));
    tbody.appendChild(tr);
  }
  box.appendChild(spaced(wrap, 3));
  return box;
}

// ── invoices ────────────────────────────────────────────────────────────────

function invoiceBlock(invoices) {
  if (!invoices) {
    return emptyBlock('Could not load billed periods',
      'No billing data has arrived yet. Press refresh to try again.', true);
  }
  const rows = (Array.isArray(invoices.invoices) && invoices.invoices)
    || (Array.isArray(invoices.rows) && invoices.rows) || [];
  if (!rows.length) {
    return emptyBlock('Nothing billed yet',
      'No monthly period has closed, so there is no bill to show. This is the expected '
      + 'state until the first one does.');
  }

  const { wrap, tbody } = table([
    ['Period', false], ['State', false], ['kWh', true],
    ['₪ excl. VAT', true], ['₪ incl. VAT', true],
  ]);
  for (const r of rows) {
    const tr = h('tr');
    tr.appendChild(cell('td', stamp(r.fromDate) + ' – ' + stamp(r.toDate)));
    const state = r.periodStatus || r.status;
    const stateCell = h('td');
    stateCell.appendChild(h('span', 'chip', state ? String(state) : '—'));
    tr.appendChild(stateCell);
    for (const key of ['totalEnergy', 'totalCostExcVat', 'totalCostIncVat']) {
      const v = num(r[key]);
      tr.appendChild(cell('td', v === null ? '—' : v.toFixed(2), true));
    }
    tbody.appendChild(tr);
  }
  return wrap;
}

// ── render ──────────────────────────────────────────────────────────────────

export function render(el, state, ctx) {   // eslint-disable-line no-unused-vars
  const app = state || {};
  const payload = app.state;
  el.replaceChildren();

  if (!payload || !payload.charger) {
    el.appendChild(emptyBlock('Could not load charger status',
      'No charger state has arrived yet. Press refresh to try again.', true));
  } else {
    el.appendChild(chargerBlock(payload.charger, el));
  }

  el.appendChild(inset(el, spaced(h('h3', 'panel__title', 'Billed periods'), 5)));
  el.appendChild(spaced(invoiceBlock(app.invoices), 3));
}

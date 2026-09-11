// views/tariff.js — S5: the live tariff window, when it flips, and the one judgement
// the dashboard exists to make — held for price vs throttled by the building panel.
//
// Mount contract (PLAN §7.10): render(el, state, ctx) with
//   { state, history, invoices, expired, fetchedAt, stale }; any payload may be null.
//
// Nothing here hardcodes a window, a price or a VAT rate: the calendar arrives in
// state.pricingSlices and carries its own prices, boundaries and vat (PLAN §8/D5).
// There is no timer in this module — the "now" marker moves when the page re-renders.
//
// liveSlice(), nextSlice() and classifySuspension() are pure: no DOM, no module state.

const DAY_MS = 86400000;
const DAY_MIN = 1440;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Slice boundaries are UTC. Some upstream stamps (a live session's statusDate, a
// connector's updated) carry no zone designator at all, and JS parses a naked date-time
// as *viewer-local* — a silent whole-offset shift. Pin the zone before parsing.
function toMs(iso) {
  if (typeof iso !== 'string' || !iso) return NaN;
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + 'Z');
}

// ── pure: the calendar ──────────────────────────────────────────────────────

/**
 * The slice covering nowMs, or null. Absolute time only — the published calendar is
 * a rolling ~24 h horizon and nothing is known beyond its end, so past the last slice
 * this returns null rather than inventing one.
 * @param {Array<object>} slices
 * @param {number} nowMs
 */
export function liveSlice(slices, nowMs) {
  const now = num(nowMs);
  if (now === null) return null;
  for (const s of slices || []) {
    const from = toMs(s && s.from);
    const to = toMs(s && s.to);
    if (Number.isFinite(from) && Number.isFinite(to) && now >= from && now <= to) return s;
  }
  return null;
}

/** The earliest slice starting after nowMs, or null if the calendar ends first. */
export function nextSlice(slices, nowMs) {
  const now = num(nowMs);
  if (now === null) return null;
  let best = null;
  let bestFrom = Infinity;
  for (const s of slices || []) {
    const from = toMs(s && s.from);
    if (Number.isFinite(from) && from > now && from < bestFrom) { best = s; bestFrom = from; }
  }
  return best;
}

/** The dearest price in the calendar, and every slice priced at it. */
function dearest(slices) {
  let price = 0;
  for (const s of slices || []) {
    const p = num(s && s.price);
    if (p !== null && p > price) price = p;
  }
  return price;
}

function cheapest(slices) {
  let price = null;
  for (const s of slices || []) {
    const p = num(s && s.price);
    if (p !== null && (price === null || p < price)) price = p;
  }
  return price;
}

// ── pure: price vs panel ────────────────────────────────────────────────────
//
// A suspension window is compared against the dearest slices by TIME OF DAY, not by
// absolute time: TAOZ is a daily schedule and the published calendar only covers a
// rolling ~24 h, so a session from last week can only be judged against the pattern.
// Both sides are reduced to minutes-of-day in UTC, which is a constant shift for both
// and therefore leaves the overlap unchanged.

function daySpans(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return [];
  const end = Math.max(toMs, fromMs + 60000);          // an instant counts as a minute
  if (end - fromMs >= DAY_MS) return [[0, DAY_MIN]];
  const start = (fromMs % DAY_MS + DAY_MS) % DAY_MS / 60000;
  const stop = start + (end - fromMs) / 60000;
  return stop <= DAY_MIN ? [[start, stop]] : [[start, DAY_MIN], [0, stop - DAY_MIN]];
}

const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];

/** How many distinct prices the calendar offers. */
function priceLevels(slices) {
  const seen = new Set();
  for (const s of slices || []) {
    const p = num(s && s.price);
    if (p !== null) seen.add(p);
  }
  return seen.size;
}

// The window the session was (or is) withholding over: a settled row carries it
// explicitly, a live one is "since the status last changed, until now".
function suspensionWindow(session, nowMs) {
  const from = toMs(session.suspendedFrom || session.statusDate);
  if (!Number.isFinite(from)) return null;
  const explicit = toMs(session.suspendedTo);
  const to = Number.isFinite(explicit) ? explicit : num(nowMs);
  return to === null ? null : { from, to };
}

const statusOf = (session) =>
  String((session && (session.status || session.connectorStatusDuringSuspension)) || '')
    .toLowerCase();

/**
 * Which of the two identical-looking suspensions this is.
 *
 *   'held-for-price'  the charger is withholding across a dearest-priced window —
 *                     deliberate deferral, worth real money
 *   'panel-throttled' it is withholding inside the cheapest window — the building's
 *                     load management. Pure delay, no money saved
 *   'ev-refused'      SuspendedEV: the car is refusing. Neither of the above
 *   'not-suspended'   any other state
 *   'unknown'         withholding, but the calendar cannot establish which. Never
 *                     report this as the panel
 *
 * @param {{session:object, slices:Array<object>, nowMs:number}} args
 * @returns {string}
 */
export function classifySuspension(args) {
  const a = args || {};
  const session = a.session || {};
  const slices = a.slices || [];
  const now = num(a.nowMs);
  const status = statusOf(session);

  if (status === 'suspendedev') return 'ev-refused';
  if (status !== 'suspendedevse') return 'not-suspended';

  const window = suspensionWindow(session, now === null ? Date.now() : now);
  if (!window) return 'unknown';
  // One flat price (or none) means there is no cheap window to wait for, so the
  // calendar cannot tell price from panel. Saying so beats guessing "panel".
  if (priceLevels(slices) < 2) return 'unknown';

  const top = dearest(slices);
  const windows = daySpans(window.from, window.to);
  for (const s of slices) {
    if (num(s.price) !== top) continue;
    for (const peak of daySpans(toMs(s.from), toMs(s.to))) {
      for (const w of windows) if (overlaps(w, peak)) return 'held-for-price';
    }
  }
  return 'panel-throttled';
}

// ── DOM helpers: textContent and classList only, no markup strings ─────────

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

const clock = (ms) => (Number.isFinite(ms)
  ? new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  : '—');

function inWords(deltaMs) {
  const mins = Math.max(0, Math.round(deltaMs / 60000));
  if (mins < 90) return 'in ' + mins + ' min';
  return 'in ' + Math.floor(mins / 60) + ' h ' + String(mins % 60).padStart(2, '0') + ' m';
}

function emptyBlock(title, hint, isError) {
  const box = h('div', isError ? 'empty empty--error' : 'empty');
  box.appendChild(h('div', 'empty__icon', isError ? '⚠' : '🔌'));
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

// ── the tariff strip ────────────────────────────────────────────────────────

function tariffStrip(slices, nowMs) {
  const box = h('div', 'tariff');
  const scroller = h('div', 'scroll-x');
  const band = h('div', 'tariff__band');
  // With a single price in the calendar nothing is "the dearest" — marking the whole
  // day --peak would invent a peak window the charger never published.
  const top = priceLevels(slices) >= 2 ? dearest(slices) : null;

  // Percentages are of the viewer's local 24 h day, clipped to it.
  const dayStart = new Date(nowMs);
  dayStart.setHours(0, 0, 0, 0);
  const base = dayStart.getTime();
  const pct = (ms) => ((ms - base) / DAY_MS) * 100;
  const clamp = (n) => Math.min(100, Math.max(0, n));

  for (const s of slices) {
    const from = toMs(s.from);
    const to = toMs(s.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const start = clamp(pct(from));
    const end = clamp(pct(to));
    if (end <= start) continue;
    const isTop = top !== null && num(s.price) === top;
    const slice = h('div', 'tariff__slice tariff__slice--' + (isTop ? 'peak' : 'offpeak'));
    // CSP blocks style="…"; --start/--end are percentage strings WITH the unit.
    slice.style.setProperty('--start', start.toFixed(1) + '%');
    slice.style.setProperty('--end', end.toFixed(1) + '%');
    band.appendChild(slice);
  }

  const marker = h('div', 'tariff__now');
  marker.style.setProperty('--at', clamp(pct(nowMs)).toFixed(1) + '%');
  band.appendChild(marker);
  scroller.appendChild(band);

  const scale = h('div', 'tariff__scale');
  for (const hour of ['00', '06', '12', '18', '24']) scale.appendChild(h('span', null, hour));
  scroller.appendChild(scale);
  box.appendChild(scroller);

  // Legend: one key per distinct price, with the real number and its VAT basis.
  const legend = h('div', 'tariff__legend');
  const seen = new Set();
  for (const s of slices) {
    const p = num(s.price);
    if (p === null || seen.has(p)) continue;
    seen.add(p);
    const name = s.name ? ' — ' + String(s.name) : '';
    legend.appendChild(h('span', 'tariff__key tariff__key--' + (top !== null && p === top ? 'peak' : 'offpeak'),
      '₪ ' + p.toFixed(4) + ' / kWh excl. VAT' + name));
  }
  if (legend.childNodes.length) box.appendChild(legend);

  box.appendChild(flipLine(slices, nowMs, top));
  return box;
}

// Always rendered — the band is decoration, this sentence is the answer.
function flipLine(slices, nowMs, top) {
  const line = h('p', 'tariff__flip');
  if (!slices.length) {
    line.textContent = 'No tariff calendar in the last response, so the next flip time is unknown.';
    return line;
  }
  const live = liveSlice(slices, nowMs);
  const next = nextSlice(slices, nowMs);
  if (!live) {
    line.textContent = 'No slice covers right now — the published calendar has run out, '
      + 'so the next flip is not known yet.';
    return line;
  }
  const price = num(live.price);
  line.appendChild(document.createTextNode(
    (top === null ? 'One price in the calendar now'
      : price !== null && price === top ? 'Dearest slice now' : 'Cheapest slice now')
    + (live.name ? ' (' + String(live.name) + ')' : '')
    + (price === null ? '' : ' at ₪ ' + price.toFixed(4) + ' / kWh excl. VAT')
    + ' — '));
  if (next) {
    const at = toMs(next.from);
    line.appendChild(document.createTextNode(
      'flips to ' + (next.name ? String(next.name) + ' ' : '') + 'at '));
    line.appendChild(h('strong', null, clock(at)));
    line.appendChild(document.createTextNode(', ' + inWords(at - nowMs) + '.'));
  } else {
    line.appendChild(document.createTextNode('no next slice has been published; this one ends at '));
    line.appendChild(h('strong', null, clock(toMs(live.to))));
    line.appendChild(document.createTextNode('.'));
  }
  return line;
}

// ── the live session ────────────────────────────────────────────────────────

function explainer(session, slices, nowMs) {
  const verdict = classifySuspension({ session, slices, nowMs });

  if (verdict === 'ev-refused') {
    // Established, and neither of the two SuspendedEVSE cases. It gets its own words.
    return h('p', 'suspend__detail',
      'The car is not drawing power — that is the car\'s decision, not the charger\'s. '
      + 'The charger reports itself ready and is withholding nothing for price.');
  }
  if (verdict === 'not-suspended') return null;

  const box = h('div', 'suspend suspend--'
    + (verdict === 'held-for-price' ? 'price' : verdict === 'panel-throttled' ? 'panel' : 'unknown'));
  const body = h('div', 'suspend__body');
  box.appendChild(body);

  if (verdict === 'held-for-price') {
    const top = dearest(slices);
    const low = cheapest(slices);
    const next = nextSlice(slices, nowMs);
    const vat = vatOf(slices);
    const gapEx = top - (low === null ? top : low);
    const gapInc = vat === null ? null : gapEx * (1 + vat / 100);

    body.appendChild(h('p', 'suspend__title', 'Held for price'));
    const detail = h('p', 'suspend__detail');
    detail.appendChild(document.createTextNode(
      'The charger is deliberately withholding across the dearest window'
      + (next ? ', until ' + (next.name ? String(next.name) + ' at ' : '') + clock(toMs(next.from)) : '')
      + '. Every kWh it waits for is '));
    detail.appendChild(h('span', 'suspend__amount',
      '₪ ' + (gapInc === null ? gapEx : gapInc).toFixed(2) + ' / kWh'));
    detail.appendChild(document.createTextNode(
      gapInc === null
        ? ' cheaper, excl. VAT — no VAT rate in the payload.'
        : ' cheaper, incl. VAT (₪ ' + gapEx.toFixed(2) + ' excl. VAT). That is the money this wait is worth.'));
    body.appendChild(detail);
    return box;
  }

  if (verdict === 'panel-throttled') {
    body.appendChild(h('p', 'suspend__title', 'Throttled by the building panel'));
    body.appendChild(h('p', 'suspend__detail',
      'Not a price decision — pure delay, and no money saved. The cheapest slice is already '
      + 'running, so waiting buys nothing but time.'));
    return box;
  }

  body.appendChild(h('p', 'suspend__title', 'Withholding — cause not established'));
  body.appendChild(h('p', 'suspend__detail',
    'The charger is withholding, but the published calendar does not cover this window or '
    + 'offers a single flat price, so price and panel cannot be told apart. Not enough to '
    + 'call it either one.'));
  return box;
}

function vatOf(slices) {
  for (const s of slices || []) {
    const v = num(s && s.vat);
    if (v !== null && v >= 0) return v;
  }
  return null;
}

function sessionBlock(session, slices, nowMs) {
  const box = h('div');
  const status = session.status ? String(session.status) : null;
  if (status) {
    box.appendChild(h('span', 'status status--' + status.toLowerCase(), status));
  }

  const grid = spaced(h('div', 'stat-grid'), 3);
  const energy = num(session.totalEnergy);
  grid.appendChild(tile(energy === null ? '—' : energy.toFixed(2), 'kWh', 'Delivered this session'));
  const secs = num(session.durationInSeconds);
  grid.appendChild(tile(
    secs === null ? '—' : Math.floor(secs / 3600) + ' h ' + String(Math.floor((secs % 3600) / 60)).padStart(2, '0') + ' m',
    null, 'Plugged in for'));
  const inc = num(session.totalCost);
  const ex = num(session.cost);
  grid.appendChild(tile(
    inc === null ? (ex === null ? '—' : ex.toFixed(2)) : inc.toFixed(2),
    inc === null ? '₪ excl. VAT' : '₪ incl. VAT',
    inc === null || ex === null ? 'Cost so far' : 'Cost so far — ' + ex.toFixed(2) + ' ₪ excl. VAT'));
  box.appendChild(grid);

  const note = explainer(session, slices, nowMs);
  if (note) box.appendChild(spaced(note, 3));
  return box;
}

// ── render ──────────────────────────────────────────────────────────────────

export function render(el, state, ctx) {   // eslint-disable-line no-unused-vars
  const app = state || {};
  const payload = app.state;
  const slices = (payload && Array.isArray(payload.pricingSlices) && payload.pricingSlices) || [];
  const nowMs = Date.now();
  el.replaceChildren();

  if (!payload) {
    el.appendChild(emptyBlock('Could not load the tariff',
      'No charger state has arrived yet. Press refresh to try again.', true));
    return;
  }

  el.appendChild(tariffStrip(slices, nowMs));

  const sessions = (Array.isArray(payload.sessions) && payload.sessions) || [];
  const live = sessions.filter((s) => s && !s.stoppedAt && !s.completed);
  const heading = spaced(h('h3', 'panel__title', 'Live session'), 5);
  el.appendChild(heading);

  if (!live.length) {
    el.appendChild(emptyBlock('Nothing plugged in',
      'No session is in progress. The tariff strip above still applies when one starts.'));
    return;
  }
  for (const session of live) el.appendChild(spaced(sessionBlock(session, slices, nowMs), 3));
}

// views/tariff.js — S5: the live tariff window, when it flips, and the one judgement
// the dashboard exists to make — held for price vs throttled by the building panel.
//
// Mount contract (PLAN §7.10): render(el, state, ctx) with
//   { state, history, invoices, expired, fetchedAt, stale }; any payload may be null.
//
// Nothing here hardcodes a window, a price, a VAT rate or a slice name: the calendar
// arrives in state.pricingSlices and carries its own prices, boundaries, vat and names
// (PLAN §8/D5). That includes the two Hebrew names the owner reads off the legend,
// פסגה and שפל — they are values that came down the wire, not copy this file owns, and
// a tariff reform that renames or re-times them changes nothing here.
// There is no timer in this module — the "now" marker moves when the page re-renders.
//
// liveSlice(), nextSlice() and classifySuspension() are pure: no DOM, no module state.

// The one definition of a live session, shared with views/history.js and views/controls.js.
// A row that has ended stays in state.sessions for a few seconds after it stops, so "there is
// a row" is not the question — see the comment on the predicate in api.js.
import { isLiveSession } from '../api.js';
import { connection, duration, ils, n, relative, statusClass, statusLabel, time } from './he.js';

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

// The charger's own word for what it is doing. Kept raw here and lower-cased only where a
// comparison needs it: the raw spelling is what gets shown beside the Hebrew label, because
// "SuspendedEVSE" is the thing the owner quotes when they ask why nothing is charging.
const rawStatusOf = (session) =>
  String((session && (session.status || session.connectorStatusDuringSuspension)) || '');

const statusOf = (session) => rawStatusOf(session).toLowerCase();

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
    // ils() is Intl's he-IL currency output, which carries its own directional marks, so the
    // figure survives sitting in front of Hebrew without a wrapper of its own. "kWh" stays the
    // Latin SI symbol here and in every table header and tile: one spelling of the unit across
    // the page beats a second Hebrew one that has to be kept in step with it.
    legend.appendChild(h('span', 'tariff__key tariff__key--' + (top !== null && p === top ? 'peak' : 'offpeak'),
      ils(p, 4) + ' ל־kWh, לפני מע״מ' + name));
  }
  if (legend.childNodes.length) box.appendChild(legend);

  box.appendChild(flipLine(slices, nowMs, top));
  return box;
}

// Always rendered — the band is decoration, this sentence is the answer.
function flipLine(slices, nowMs, top) {
  const line = h('p', 'tariff__flip');
  if (!slices.length) {
    line.textContent = 'התשובה האחרונה לא כללה לוח תעריפים, ולכן מועד ההחלפה הבא אינו ידוע.';
    return line;
  }
  const live = liveSlice(slices, nowMs);
  const next = nextSlice(slices, nowMs);
  if (!live) {
    line.textContent = 'אף פרוסה אינה מכסה את הרגע הזה — הלוח שפורסם נגמר, '
      + 'ולכן מועד ההחלפה הבא עדיין לא ידוע.';
    return line;
  }
  const price = num(live.price);
  line.appendChild(document.createTextNode(
    (top === null ? 'כרגע יש מחיר אחד בלוח'
      : price !== null && price === top ? 'כרגע הפרוסה היקרה' : 'כרגע הפרוסה הזולה')
    + (live.name ? ' (' + String(live.name) + ')' : '')
    + (price === null ? '' : ', ' + ils(price, 4) + ' ל־kWh לפני מע״מ')
    + ' — '));
  if (next) {
    const at = toMs(next.from);
    line.appendChild(document.createTextNode(
      'מתחלף' + (next.name ? ' ל' + String(next.name) : '') + ' בשעה '));
    // The clock goes in a <strong>, which the stylesheet gives its own bidi paragraph, so
    // "23:00" cannot be pulled apart by the Hebrew on either side of it.
    line.appendChild(h('strong', null, time(at)));
    line.appendChild(document.createTextNode(', ' + relative(at - nowMs) + '.'));
  } else {
    line.appendChild(document.createTextNode('לא פורסמה פרוסה הבאה; הנוכחית מסתיימת בשעה '));
    line.appendChild(h('strong', null, time(toMs(live.to))));
    line.appendChild(document.createTextNode('.'));
  }
  return line;
}

// ── the live session ────────────────────────────────────────────────────────

// The raw upstream state, in the prose rather than only in a title. The Hebrew label is what the
// badge says, but the owner asking "why is nothing charging" needs the charger's own word for it,
// and a title attribute is not reachable on a phone — which is where this panel is read.
function reported(raw) {
  return raw ? ' (המצב המדווח: ' + String(raw) + ')' : '';
}

// Hebrew on the badge, the protocol's own spelling on the title: the colour and the label are for
// reading at a glance, the raw value is for saying out loud to whoever can fix it. The class comes
// from he.js so an unrecognised value cannot invent one the stylesheet has no rule for.
function badge(raw) {
  const el = h('span', statusClass(raw), statusLabel(raw));
  el.title = String(raw);
  return el;
}

function explainer(session, slices, nowMs) {
  const verdict = classifySuspension({ session, slices, nowMs });

  if (verdict === 'ev-refused') {
    // Established, and neither of the two charger-side cases. It gets its own words.
    return h('p', 'suspend__detail',
      'הרכב אינו מושך חשמל — זו החלטה של הרכב, לא של העמדה. '
      + 'העמדה מדווחת שהיא מוכנה ואינה מעכבת דבר בגלל מחיר.' + reported(rawStatusOf(session)));
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

    body.appendChild(h('p', 'suspend__title', 'מעוכב בגלל המחיר'));
    const detail = h('p', 'suspend__detail');
    detail.appendChild(document.createTextNode(
      'העמדה מעכבת במכוון לאורך החלון היקר'
      + (next ? ', עד ' + (next.name ? String(next.name) + ' בשעה ' : 'השעה ') + time(toMs(next.from)) : '')
      + '. כל kWh שהיא ממתינה לו זול ב־'));
    // .suspend__amount is one of the boxes the sheet gives its own bidi paragraph, so the
    // figure and its unit stay together and in order inside the Hebrew sentence.
    detail.appendChild(h('span', 'suspend__amount',
      ils(gapInc === null ? gapEx : gapInc) + ' ל־kWh'));
    detail.appendChild(document.createTextNode(
      gapInc === null
        ? ', לפני מע״מ — אין שיעור מע״מ בנתונים.' + reported(rawStatusOf(session))
        : ', כולל מע״מ (' + ils(gapEx) + ' לפני מע״מ). זה הכסף ששווה ההמתנה הזו.' + reported(rawStatusOf(session))));
    body.appendChild(detail);
    return box;
  }

  if (verdict === 'panel-throttled') {
    body.appendChild(h('p', 'suspend__title', 'מרוסן על ידי לוח החשמל בבניין'));
    body.appendChild(h('p', 'suspend__detail',
      'זו אינה החלטת מחיר — זה עיכוב בלבד, ולא נחסך כסף. הפרוסה הזולה כבר רצה, '
      + 'ולכן ההמתנה קונה זמן ותו לא.' + reported(rawStatusOf(session))));
    return box;
  }

  body.appendChild(h('p', 'suspend__title', 'מעכב — הסיבה לא הוכחה'));
  body.appendChild(h('p', 'suspend__detail',
    'העמדה מעכבת, אבל הלוח שפורסם אינו מכסה את החלון הזה או שיש בו מחיר אחיד יחיד, '
    + 'ולכן אי אפשר להבחין בין מחיר לבין לוח החשמל. זה לא מספיק כדי לקבוע אחד מהם.'
    + reported(rawStatusOf(session))));
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
  if (status) box.appendChild(badge(status));

  const grid = spaced(h('div', 'stat-grid'), 3);
  const energy = num(session.totalEnergy);
  grid.appendChild(tile(n(energy, 1), 'kWh', 'נמסר בטעינה הזו'));
  const secs = num(session.durationInSeconds);
  grid.appendChild(tile(duration(secs), null, 'מחובר כבר'));
  const inc = num(session.totalCost);
  const ex = num(session.cost);
  // The tile keeps the bare figure and lets .stat__unit carry the ₪, so a column of tiles
  // lines up; ils() is for prose, where the symbol has to travel with the number.
  grid.appendChild(tile(
    inc === null ? n(ex) : n(inc), '₪',
    inc === null ? 'עלות עד כה — לפני מע״מ'
      : ex === null ? 'עלות עד כה — כולל מע״מ'
        : 'עלות עד כה — כולל מע״מ (' + n(ex) + ' ₪ לפני מע״מ)'));
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
    el.appendChild(emptyBlock('לא ניתן לטעון את המחיר',
      'עדיין לא הגיע מצב עמדה. לחצו רענון כדי לנסות שוב.', true));
    return;
  }

  el.appendChild(tariffStrip(slices, nowMs));

  const sessions = (Array.isArray(payload.sessions) && payload.sessions) || [];
  const live = sessions.filter(isLiveSession);
  // Two headings for two questions. With a charge running this section is about that charge;
  // with none running it is about the CABLE, and calling it "active charging" over a sentence
  // that says the car is plugged in and idle would put the contradiction in the owner's face.
  el.appendChild(spaced(h('h3', 'panel__title', live.length ? 'טעינה פעילה' : 'מצב החיבור'), 5));

  if (!live.length) {
    el.appendChild(connectorBlock(payload));
    return;
  }
  for (const session of live) el.appendChild(spaced(sessionBlock(session, slices, nowMs), 3));
}

// ── no live session: what the CONNECTOR says ────────────────────────────────
//
// This is the fix for the bug the owner reported standing at the charger. "No live session"
// used to print "nothing is connected", which is a statement about the cable derived from the
// session list — and a car plugged in and idle is `Preparing` with zero sessions. The two facts
// are both true at once and only one of them was being read.
//
// `connection()` in he.js owns the judgement and every word of it; this function only decides
// which shape the panel paints it in.
function connectorBlock(payload) {
  const raw = payload && payload.charger && Array.isArray(payload.charger.connectors)
    ? payload.charger.connectors[0]?.status ?? null
    : null;
  const verdict = connection(raw);

  // No status reported, or an empty bay: there is no badge worth painting, so it stays the
  // panel's own empty state. Note the two say different things — "nothing is plugged in" and
  // "the charger did not tell us" are not the same fact.
  if (!raw || verdict.connected === false) return emptyBlock(verdict.title, verdict.note);

  // Connected, faulted, or a value this page has never met: all three have a real status to
  // show, so all three get the badge and the raw spelling. The unknown one claims nothing about
  // the cable — it just says what arrived.
  const box = h('div');
  box.appendChild(badge(raw));
  box.appendChild(spaced(h('p', 'suspend__detail', verdict.note + reported(raw)), 3));
  return box;
}

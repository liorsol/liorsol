// ── themes/editorial.js — עיתון ──
//
// Two replacements, both presentational, neither anywhere near the command path.
//
//   views.tariff    the status panel's body. The base renderer runs FIRST and keeps every word
//                   it writes; this module adds the lead sentence above it and swaps the 24 h
//                   band for a printed timetable. Nothing the base decides is re-decided here.
//   views.controls  the body builder views/controls.js hands a theme. It draws a different
//                   affordance for stop -- two presses, the second on an inverted button -- and
//                   fires it through `press.stop()`, which is the same guarded door the default
//                   button uses. onStart, onStop, the busy flag, both polls and release() stay
//                   inside that module and are not reachable from here.
//
// THE SENTENCE IS COMPOSED, NEVER RE-DERIVED. `connection()` in views/he.js is the single
// judgement about what the cable is doing and it owns every word of its answer; `isLiveSession`
// in api.js is the separate judgement about whether a charge is running. They are two questions
// and this module asks both, in that order, and then arranges their answers. Where a state has
// no sentence that can honestly be written -- nothing has ever loaded, the credential is dead,
// the link is faulted -- this module writes none and the panel falls back to the base rendering,
// with the banner above it saying the thing that is actually true.
//
// BIDI. Every figure that lands inside Hebrew prose goes in a <bdi>: that element is
// `unicode-bidi: isolate` with automatic direction in every UA sheet, so a digits-only run
// resolves LTR and cannot be pulled apart by the Hebrew on either side of it. `unicode-bidi:
// isolate` set on an element that INHERITS direction: rtl would do the opposite -- it would lay
// "00:00 - 07:00" out right to left and show the two clock times in the wrong order -- which is
// why every isolate in the sheet sits on a <bdi> and never on a table cell. The cells themselves
// are left to the base sheet's `plaintext` set, which resolves them from their own content.
//
// No innerHTML, no DOM from a string, no timer, no fetch, no inline style beyond the one custom
// property the settle bar reads.

import { isLiveSession } from '../api.js';
import { connection, ils, n, relative, statusClass, statusKey, statusLabel, time } from '../views/he.js';
import { liveSlice, nextSlice, priceTier, render as renderTariff } from '../views/tariff.js';
import { STANDING_NOTE } from '../views/controls.js';

// ── DOM helpers: textContent and classList only ──

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

const bdi = (cls, text) => h('bdi', cls, text);

/** parts are strings (text) or nodes, in reading order. */
function put(parent, parts) {
  for (const part of parts) {
    if (part === null || part === undefined || part === '') continue;
    parent.append(typeof part === 'string' ? document.createTextNode(part) : part);
  }
  return parent;
}

const number = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// Slice boundaries are UTC and some upstream stamps carry no zone designator at all, which JS
// parses as VIEWER-LOCAL -- a silent whole-offset shift. Same rule as views/tariff.js, which
// does not export its copy; see the report.
const toMs = (iso) =>
  (typeof iso === 'string' && iso ? Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + 'Z') : NaN);

const hasClass = (node, name) => String(node?.className || '').split(/\s+/).includes(name);

// ── the lead sentence ───────────────────────────────────────────────────────

const money = (value) => bdi('ed-money', ils(value, 4));
const clock = (ms) => bdi('ed-clock', time(ms));
const unit = (text) => bdi('ed-unit', text);
const vat = () => h('span', 'ed-lead__vat', ' לפני מע״מ');

// "kWh", not a second Hebrew spelling of the unit: views/he.js keeps one spelling of it across
// the page -- every table header and every tile -- and a prose-only variant here would be a
// second thing to keep in step. It is also the correct symbol: the price is per kilowatt HOUR.
const perKwh = (price) => [' ב־', money(price), ' ל־', unit('kWh'), vat()];

/** The cable, in he.js's own words. `Available` uses the title: its note points at the tariff
 *  strip "above", which is true where the base renders it and would not be true up here. */
const cable = (conn) => [conn.connected === false ? conn.title + '.' : conn.note];

/** How this slice's price stands against the rest of the published calendar.
 *  `priceTier` in views/tariff.js is the one classification on the page — the same one the base
 *  strip paints `--peak / --mid / --offpeak` from — so this is an alias, not a second opinion.
 *  Returns 'peak' | 'mid' | 'offpeak' | 'flat' | 'unknown'. */
const rankOf = (slices, price) => priceTier(price, slices);

/** When the price changes, or null when the calendar cannot say. */
function flip(slices, live, price, nowMs) {
  if (!live) return null;
  const next = nextSlice(slices, nowMs);
  if (next) {
    const at = toMs(next.from);
    if (!Number.isFinite(at)) return null;
    const rank = rankOf(slices, price);
    // Three windows, not two. A middle-tier window is neither the cheap one nor the dear one and
    // must not be announced as either: on a three-rate TAOZ day this line used to end a גבע
    // window with "the cheap window ends at…", which is the defect views/tariff.js's `priceTier`
    // exists to make impossible.
    const opening = rank === 'offpeak' ? 'החלון הזול מסתיים בשעה '
      : rank === 'peak' ? 'החלון היקר מסתיים בשעה '
        : rank === 'mid' ? 'חלון הביניים מסתיים בשעה '
          : 'המחיר מתחלף בשעה ';
    return [opening, clock(at), ', ', relative(at - nowMs), '.'];
  }
  const ends = toMs(live.to);
  if (!Number.isFinite(ends)) return null;
  return ['הפרוסה הנוכחית מסתיימת בשעה ', clock(ends), '.'];
}

/**
 * The headline and its standfirst, or null when no sentence can be honestly written.
 * @returns {{node: Node, saidFlip: boolean}|null}
 */
function leadOf(view, slices, nowMs) {
  const payload = view && view.state;
  if (!payload) return null;
  // The banner above is the sentence in both of these states, and it says the numbers on screen
  // are a memory. A headline built from that snapshot would read as the present tense.
  if (view.expired === true || view.chargerFault) return null;

  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const running = sessions.some(isLiveSession);
  const connectors = payload.charger && payload.charger.connectors;
  const raw = Array.isArray(connectors) ? (connectors[0] && connectors[0].status) ?? null : null;
  const conn = connection(raw);
  const charging = statusKey(raw) === 'charging';

  const live = liveSlice(slices, nowMs);
  const price = live ? number(live.price) : null;

  const head = [];
  const deck = [];

  if (running && charging) {
    // The one sentence this whole design was drawn around.
    head.push('הרכב נטען כרגע', ...(price === null ? [] : perKwh(price)), '.');
  } else if (running) {
    // A charge is open but the connector is not reporting `Charging`: it may be withholding, or
    // it may not have said. Both facts get said, in that order, neither standing in for the other.
    head.push('טעינה רצה כרגע.');
    deck.push(cable(conn));
  } else {
    head.push(...cable(conn));
  }

  if (!(running && charging) && price !== null) {
    deck.push(['החשמל עכשיו ', money(price), ' ל־', unit('kWh'), ' לפני מע״מ.']);
  }

  const when = flip(slices, live, price, nowMs);
  if (when) deck.push(when);

  const node = put(h('p', 'ed-lead'), head);
  if (deck.length) {
    const stand = h('span', 'ed-lead__deck');
    for (const parts of deck) stand.append(put(h('span'), parts));
    node.append(stand);
  }
  return { node, saidFlip: when !== null };
}

// ── the timetable ───────────────────────────────────────────────────────────
//
// The base sheet's ruling that the 24 h band does not mirror is a ruling about a positional
// AXIS: a coordinate at 30% of the width means nothing until you know which edge is midnight.
// A timetable has no axis. Each row carries its own hours in words, so the rows read in the page
// direction like every other table here, and only the clock strings inside them stay LTR.

const vatRate = (slices) => {
  for (const s of slices) {
    const v = number(s && s.vat);
    if (v !== null && v >= 0) return v;
  }
  return null;
};

function headCell(text, cls) {
  const node = h('th', cls, text);
  node.setAttribute('scope', 'col');
  return node;
}

function timetable(strip, slices, nowMs, dropFlip) {
  const box = h('div', 'ed-sched');

  const rows = slices
    .filter((s) => Number.isFinite(toMs(s && s.from)) && Number.isFinite(toMs(s && s.to)))
    .slice()
    .sort((a, b) => toMs(a.from) - toMs(b.from));

  if (rows.length) {
    const rate = vatRate(rows);
    box.append(put(h('p', 'ed-sched__kicker'), [
      'מדרגות התעריף. המחירים לפני מע״מ',
      ...(rate === null ? [] : [' בשיעור ', bdi(null, n(rate, 0) + '%')]),
      '.',
    ]));

    // With no names on the wire the hours become the row's own heading rather than leaving an
    // empty column standing where a name would have been.
    const named = rows.some((s) => s.name);
    const table = h('table', 'table ed-table--slim');
    const thead = h('thead');
    const headRow = h('tr');
    if (named) headRow.append(headCell('חלון'));
    headRow.append(headCell('שעות'), headCell('מחיר (₪ ל־kWh)', 'num'));
    thead.append(headRow);

    const current = liveSlice(rows, nowMs);
    const body = h('tbody');
    for (const slice of rows) {
      const row = h('tr');
      if (slice === current) row.setAttribute('aria-current', 'true');

      const hours = bdi('ed-hours', time(toMs(slice.from)) + ' - ' + time(toMs(slice.to)));
      const first = h('th');
      first.setAttribute('scope', 'row');
      if (named) first.textContent = slice.name ? String(slice.name) : '';
      else first.append(hours);
      // Never colour alone: the running window is said in words as well as marked.
      if (slice === current) first.append(h('span', 'ed-now', 'עכשיו'));
      row.append(first);
      if (named) row.append(put(h('td'), [hours]));

      const price = number(slice.price);
      // The tier, in this theme's own language: a weight ladder on the rate itself rather than
      // a coloured band. The base strip's third modifier (`--mid`) has no timetable to live in,
      // but the third rate is real and this table is where this theme shows it — and the figure
      // beside it is the non-colour half of the difference, permanently.
      row.append(h('td', 'num ed-rate ed-rate--' + rankOf(rows, price), price === null ? '' : n(price, 4)));
      body.append(row);
    }

    table.append(thead, body);
    const wrap = h('div', 'table-wrap');
    wrap.append(table);
    box.append(wrap);
  }

  // The base's own flip sentence, kept verbatim in exactly the states the lead could not speak
  // for: no calendar at all, or a calendar that has run out. Those two sentences live in
  // views/tariff.js and are not this theme's to re-write.
  const line = strip && strip.querySelector ? strip.querySelector('.tariff__flip') : null;
  if (line && !dropFlip) box.append(line);

  return box;
}

// ── views.tariff ────────────────────────────────────────────────────────────

function tariff(el, state, ctx) {           // eslint-disable-line no-unused-vars
  // The base first, and it keeps everything it paints: the badge, the tiles, the suspension
  // explainer -- which is the judgement this product exists to make -- and the connector block.
  renderTariff(el, state, ctx);

  const payload = state && state.state;
  const slices = (payload && Array.isArray(payload.pricingSlices) && payload.pricingSlices) || [];
  const nowMs = Date.now();
  const lead = leadOf(state, slices, nowMs);

  const out = [];
  if (lead) out.push(lead.node);
  for (const kid of Array.from(el.children)) {
    out.push(hasClass(kid, 'tariff') ? timetable(kid, slices, nowMs, !!(lead && lead.saidFlip)) : kid);
  }
  el.replaceChildren(...out);
}

// ── views.controls — the body builder ───────────────────────────────────────
//
// `press.start` and `press.stop` are the only two doors and each is already behind the gate the
// default buttons are disabled by, so an affordance here cannot fire a command the panel has
// locked. Everything drawn below comes out of `gate` and `ui`; nothing is re-derived and no
// state survives a repaint except what the gesture itself needs, which is one boolean living in
// the closure of a node that is thrown away on the next paint.

const STOP_IDLE = 'עצירה';
const STOP_ARMED = 'לאשר עצירה';
const ARM_PROMPT = 'לחיצה נוספת עוצרת את הטעינה עכשיו. יציאה מהכפתור מבטלת.';

// views/controls.js owns this sentence and exports it. It is the one place the page says why a
// control the owner keeps asking for is deliberately absent, so it is imported rather than
// respelled — a second copy is a second thing to drift.
const STANDING = STANDING_NOTE;

function pressable(cls, label) {
  const button = h('button', cls, label);
  button.type = 'button';
  return button;
}

// Busy is four things at once, exactly as the default body sets them: the class the spinner
// hangs off, the real attribute so a second click cannot land, the ARIA state for anyone not
// looking at the spinner, and a label that says what is happening.
function busy(button, label) {
  button.classList.add('is-busy');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  if (label) button.textContent = label;
}

function settleBar(settle) {
  const bar = h('div', 'settle');
  bar.append(h('span', null, settle.done ? settle.doneText : settle.text));
  const track = h('div', 'settle__bar');
  const fill = h('div', 'settle__fill');
  const pct = settle.done ? 100 : Math.min(100, Math.round((settle.attempt / settle.max) * 100));
  // A bare number, set through the style object: the CSP refuses a style attribute, silently.
  fill.style.setProperty('--pct', String(pct));
  track.append(fill);
  // Hebrew first inside a .num box, so `plaintext` resolves the box right to left and the unit
  // stays on the correct side of the figure.
  bar.append(track, h('span', 'num', settle.attempt * settle.step + ' שנ׳'));
  return bar;
}

function controls(gate, ui, press) {
  const deck = h('div', 'ed-deck');

  // While there is a charge to stop, the panel pins itself to the bottom of the viewport. This
  // theme puts a large sentence at the top of the status screen, and the owner opens this page
  // to press stop -- so the control that stops it is never a scroll away. The class comes off
  // the gate, so a deck with nothing to stop can never pin.
  if (!gate.stopOff || ui.busy !== null) deck.classList.add('ed-deck--pinned');

  const act = h('div', 'ed-deck__act');

  if (gate.status) {
    // Hebrew on the badge; the protocol's own spelling on the title, so the owner can read
    // "SuspendedEVSE" off the thing that is misbehaving.
    const badge = h('span', statusClass(gate.status) + ' ed-deck__state', statusLabel(gate.status));
    badge.title = String(gate.status);
    act.append(badge);
  }

  const start = pressable('btn btn--primary', 'התחלת טעינה');
  const stop = pressable('btn btn--danger', STOP_IDLE);
  start.disabled = gate.startOff || ui.busy !== null;
  stop.disabled = gate.stopOff || ui.busy !== null;
  if (ui.busy === 'start') busy(start, ui.busyLabel);
  if (ui.busy === 'stop') busy(stop, ui.busyLabel);

  const prompt = h('p', 'btn-note ed-deck__arm');
  prompt.setAttribute('role', 'status');
  prompt.setAttribute('aria-live', 'polite');

  start.addEventListener('click', press.start);

  // Stop opens a contactor on a car that is charging, so it takes two presses: the first arms
  // it and inverts it, the second commits. Leaving the button disarms it, and so does any
  // repaint -- this builder is called again and the armed node is gone. No timer is involved;
  // an idle page on this dashboard sets none.
  let armed = false;
  const disarm = () => {
    if (!armed) return;
    armed = false;
    stop.removeAttribute('data-armed');
    stop.textContent = STOP_IDLE;
    prompt.textContent = '';
  };
  stop.addEventListener('click', () => {
    if (stop.disabled) return;
    if (armed) {
      disarm();
      press.stop();          // the guarded door, and the only one
      return;
    }
    armed = true;
    stop.setAttribute('data-armed', '');
    stop.textContent = STOP_ARMED;
    prompt.textContent = ARM_PROMPT;
  });
  stop.addEventListener('blur', disarm);

  act.append(start, stop, prompt);
  deck.append(act);

  // A disabled control always carries its reason, and `gate.reasons` always holds at least one.
  for (const reason of gate.reasons) deck.append(h('p', 'btn-note', reason));

  if (ui.settle) deck.append(settleBar(ui.settle));
  if (ui.note) deck.append(h('p', 'btn-note', ui.note.text));
  deck.append(h('p', 'btn-note ed-deck__standing', STANDING));

  return deck;
}

export const views = { tariff, controls };

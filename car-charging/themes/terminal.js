// ── themes/terminal.js — the two renderers the `terminal` look replaces ──
//
// Both are PRESENTATIONAL. Nothing in this file fetches, nothing sets a timer, nothing calls
// ctx.reload(), and nothing reimplements a command:
//
//   views.tariff    a full renderer for `#tariff` — the same signature views/tariff.js has.
//                   It draws a 24 h STEP PROFILE (bar height = price, fill = severity) with the
//                   session hung off the baseline, instead of a flat band of slices.
//   views.controls  a BODY BUILDER for `#controls`, which is what views/controls.js hands a
//                   theme. It draws the affordance and renders the gate's reasons. The command,
//                   the busy flag, the settle poll and the start-confirmation poll stay in
//                   views/controls.js, where there is exactly one path to the contactor.
//
// THE SHARED JUDGEMENTS ARE IMPORTED, NEVER RESPELLED. `liveSlice`, `nextSlice` and
// `classifySuspension` come from views/tariff.js and `isLiveSession` from api.js: a session that
// has just ended lingers in the list for a few seconds, so "there is a row" never means "a charge
// is running", and the price-vs-panel verdict is the one judgement this product exists to make.
// What IS respelled here is the DOM those judgements are painted into, and the Hebrew copy that
// goes with each outcome — carried over word for word, because a second wording of "nothing was
// saved" is a second chance for one of them to drift.
//
// textContent and classList only. No innerHTML, no DOM built from a string: this page closes a
// contactor. Custom properties go in through the style object because the shipped CSP refuses a
// style="…" attribute, silently — the same way the base views set --start/--end/--at/--pct.

import { isLiveSession } from '../api.js';
import { classifySuspension, liveSlice, nextSlice, priceTier, tierLead } from '../views/tariff.js';
import { STANDING_NOTE } from '../views/controls.js';
import { connection, duration, ils, n, relative, statusClass, statusLabel, time } from '../views/he.js';

const DAY_MS = 86400000;

// ── tiny DOM helpers ──

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

// style.css has no vertical-rhythm utility, so section spacing comes from the CSSOM with the
// designer's own token — exactly as views/tariff.js does it, and for the same CSP reason.
function spaced(node, step) {
  node.style.setProperty('margin-block-start', 'var(--sp-' + (step || 4) + ')');
  return node;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
}

// Slice boundaries are UTC, and some upstream stamps carry no zone designator at all — JS parses
// a naked date-time as viewer-local, which is a silent whole-offset shift. Pin the zone first.
function toMs(iso) {
  if (typeof iso !== 'string' || !iso) return NaN;
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + 'Z');
}

// ── the calendar, in the small ──
// Not judgements — a maximum, a minimum and a count. The judgement (price vs panel) is imported.

function dearest(slices) {
  let price = null;
  for (const s of slices) {
    const p = num(s && s.price);
    if (p !== null && (price === null || p > price)) price = p;
  }
  return price;
}

function cheapest(slices) {
  let price = null;
  for (const s of slices) {
    const p = num(s && s.price);
    if (p !== null && (price === null || p < price)) price = p;
  }
  return price;
}

function priceLevels(slices) {
  const seen = new Set();
  for (const s of slices) {
    const p = num(s && s.price);
    if (p !== null) seen.add(p);
  }
  return seen.size;
}

function vatOf(slices) {
  for (const s of slices) {
    const v = num(s && s.vat);
    if (v !== null && v >= 0) return v;
  }
  return null;
}

// Three tiers of ink. The CLASSIFICATION is views/tariff.js's `priceTier` — the same one the
// base strip paints `.tariff__slice--peak / --mid / --offpeak` from, so this theme draws the
// product's judgement rather than a second private copy of it, and the two cannot drift.
// Only the mapping is local: with a single flat rate there is no dearest (marking the whole day
// as peak would invent a window the charger never published) so everything is the quietest fill,
// and a slice with no price at all claims nothing — it is hatched, at full height, and says so
// by looking unresolved.
function tier(price, slices) {
  const t = priceTier(price, slices);
  return t === 'flat' ? 'offpeak' : t;
}

// ── shared blocks ──

function emptyBlock(title, hint, isError) {
  const box = h('div', isError ? 'empty empty--error' : 'empty');
  box.appendChild(h('div', 'empty__icon', isError ? '⚠' : '🔌'));
  box.appendChild(h('p', 'empty__title', title));
  box.appendChild(h('p', 'empty__hint', hint));
  return box;
}

// Hebrew on the badge, the protocol's own spelling on the title. statusClass() comes from he.js
// so an unrecognised value cannot invent a class the stylesheet has no rule for.
function badge(raw) {
  const el = h('span', statusClass(raw), statusLabel(raw));
  el.title = String(raw);
  return el;
}

function tile(value, unit, label) {
  const box = h('div', 'stat');
  const figure = h('div', 'stat__value', value);
  if (unit) figure.appendChild(h('span', 'stat__unit', unit));
  box.appendChild(figure);
  box.appendChild(h('div', 'stat__label', label));
  return box;
}

// The raw upstream state in the prose rather than only in a title: a title attribute is not
// reachable on a phone, which is where this panel is read.
function reported(raw) {
  return raw ? ' (המצב המדווח: ' + String(raw) + ')' : '';
}

const rawStatusOf = (session) =>
  String((session && (session.status || session.connectorStatusDuringSuspension)) || '');

// ── the 24 h step profile ──

function stepProfile(slices, nowMs, top, session) {
  // Percentages are of the viewer's local 24 h day, clipped to it — the same frame the base
  // renderer uses, so --start/--end/--at keep meaning "percent of the day from midnight".
  const dayStart = new Date(nowMs);
  dayStart.setHours(0, 0, 0, 0);
  const base = dayStart.getTime();
  const pct = (ms) => ((ms - base) / DAY_MS) * 100;
  const clamp = (v) => Math.min(100, Math.max(0, v));
  const at = clamp(pct(nowMs));

  const box = h('div', 'tariff__prof');

  const cap = h('div', 'tariff__cap');
  cap.appendChild(h('span', 'tariff__lbl', '24H RATE PROFILE'));
  cap.appendChild(h('span', 'tariff__lbl', 'גובה העמודה = המחיר'));
  box.appendChild(cap);

  // style.css pins `direction: ltr` on `.tariff .scroll-x`, on the band and on the scale. The
  // ruling is inherited rather than re-argued: this is still a time axis with labelled
  // coordinates, midnight at the left edge, the day running rightwards, like the clock face the
  // owner reads. Only the shape of the marks changed.
  const scroller = h('div', 'scroll-x');

  // The now label lives above the band because the band clips; it is anchored by class so it
  // cannot be cut off at either end of the axis.
  const tags = h('div', 'tariff__tags');
  const tag = h('span', 'tariff__nowtag tariff__nowtag--' + (at < 12 ? 'start' : at > 88 ? 'end' : 'mid'));
  tag.style.setProperty('--at', at.toFixed(1) + '%');
  tag.appendChild(h('span', 'num', time(nowMs)));
  tag.appendChild(document.createTextNode(' עכשיו'));
  tags.appendChild(tag);
  scroller.appendChild(tags);

  const band = h('div', 'tariff__band');
  for (const s of slices) {
    const from = toMs(s.from);
    const to = toMs(s.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const start = clamp(pct(from));
    const end = clamp(pct(to));
    if (end <= start) continue;
    const price = num(s.price);
    const kind = tier(price, slices);
    const step = h('div', 'tariff__slice tariff__slice--' + kind);
    step.style.setProperty('--start', start.toFixed(2) + '%');
    step.style.setProperty('--end', end.toFixed(2) + '%');
    // Height IS the price. Against the dearest slice in the calendar, with a floor so the
    // cheapest window is still a bar rather than a line. Nothing to compare against (one flat
    // rate, or no price) means no claim: full height, and the fill says it is unresolved.
    const height = top === null || price === null ? 100 : Math.max(8, (price / top) * 100);
    step.style.setProperty('--h', height.toFixed(1) + '%');
    // Only a step wide enough to hold its own name gets one. Measured at 375px: a 4% slice —
    // the 23:00–24:00 tail of a TAOZ day — clipped "שפל" to "שפ", which is a different word.
    // The legend below names every price in full, so nothing is lost by leaving it off.
    if (s.name && end - start >= 10) step.textContent = String(s.name);
    band.appendChild(step);
  }

  // The drafting section line. style.css positions it from --at.
  const marker = h('div', 'tariff__now');
  marker.style.setProperty('--at', at.toFixed(2) + '%');
  band.appendChild(marker);
  scroller.appendChild(band);

  // The session, on the same axis, terminating exactly at the section line. This is the fact a
  // rate table cannot state: where the charge sat relative to the price of the day.
  const lane = h('div', 'tariff__lane');
  lane.appendChild(h('i', 'tariff__lane-track'));
  const began = sessionStart(session, nowMs);
  if (began !== null) {
    const from = clamp(pct(began));
    if (at > from) {
      const span = h('div', 'tariff__slice tariff__lane-span');
      span.style.setProperty('--start', from.toFixed(2) + '%');
      span.style.setProperty('--end', at.toFixed(2) + '%');
      lane.appendChild(span);
    }
  }
  scroller.appendChild(lane);

  const scale = h('div', 'tariff__scale');
  for (const hour of ['00', '06', '12', '18', '24']) scale.appendChild(h('span', null, hour));
  scroller.appendChild(scale);
  box.appendChild(scroller);

  if (began !== null) {
    const note = h('div', 'tariff__note');
    note.appendChild(h('span', null, 'הטעינה הנוכחית, על ציר היום'));
    const range = h('span', 'num');
    range.textContent = time(began) + ' → ' + time(nowMs);
    note.appendChild(range);
    box.appendChild(note);
  }
  return box;
}

// When the charge began. The explicit stamps first; the duration is the fallback, and a session
// carrying neither gets no lane rather than a guessed one.
function sessionStart(session, nowMs) {
  if (!session) return null;
  const stamped = toMs(session.startedAt || session.deviceStartDate);
  if (Number.isFinite(stamped)) return stamped;
  const secs = num(session.durationInSeconds);
  return secs === null ? null : nowMs - secs * 1000;
}

// ── the hero: what a kWh costs this minute ──

function hero(slice, top, low, vat) {
  const box = h('div', 'tariff__hero');

  const window = h('div', 'tariff__window');
  if (slice.name) window.appendChild(h('span', 'tariff__window-name', String(slice.name)));
  box.appendChild(window);
  box.appendChild(h('span', 'tariff__lbl', 'לפני מע״מ'));

  const price = num(slice.price);
  const figure = h('div', 'tariff__figure');
  figure.appendChild(h('span', 'tariff__figure-n', price === null ? '—' : n(price, 4)));
  figure.appendChild(h('span', 'tariff__figure-u', '₪ / kWh'));
  box.appendChild(figure);

  const cells = h('div', 'tariff__vat');
  const cell = (label, value) => {
    const c = h('div', 'tariff__vat-cell');
    c.appendChild(h('span', 'tariff__lbl', label));
    c.appendChild(h('span', 'tariff__vat-val', value));
    cells.appendChild(c);
  };

  // Every figure below is derived from the payload and nothing is assumed: no VAT rate in the
  // data means the cell says so rather than quietly showing the pre-VAT price twice.
  if (price !== null && vat !== null) {
    cell('כולל מע״מ (' + n(vat, 0) + '%)', n(price * (1 + vat / 100), 4) + ' ₪/kWh');
  } else {
    cell('כולל מע״מ', 'אין שיעור מע״מ בנתונים');
  }
  // Nothing to compare against with a single flat rate, so the comparison is simply absent
  // rather than a ×1.00 that implies a spread the calendar never published.
  if (price !== null && top !== null && top > 0) {
    cell('יחסית לפרוסה היקרה', '×' + n(price / top, 2));
  } else if (price !== null && low !== null) {
    cell('הזולה בלוח', n(low, 4) + ' ₪/kWh');
  }
  if (cells.childNodes.length) box.appendChild(cells);
  return box;
}

// ── the flip sentence: always rendered, and it is the answer ──
// The wording is views/tariff.js's. The two degrade sentences are carried over verbatim; the
// clause that says WHICH tier is running is imported from that module as `tierLead`, because
// this copy used to classify binarily — `price === top ? היקרה : הזולה` — and a three-rate TAOZ
// day therefore read "the cheap slice" here while the owner sat on the middle one.

function flipLine(slices, nowMs) {
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
    tierLead(price, slices)
    + (live.name ? ' (' + String(live.name) + ')' : '')
    + (price === null ? '' : ', ' + ils(price, 4) + ' ל־kWh לפני מע״מ')
    + ' — '));
  if (next) {
    const at = toMs(next.from);
    line.appendChild(document.createTextNode(
      'מתחלף' + (next.name ? ' ל' + String(next.name) : '') + ' בשעה '));
    // The clock goes in a <strong>, which style.css gives its own bidi paragraph, so "23:00"
    // cannot be pulled apart by the Hebrew on either side of it.
    line.appendChild(h('strong', null, time(at)));
    line.appendChild(document.createTextNode(', ' + relative(at - nowMs) + '.'));
  } else {
    line.appendChild(document.createTextNode('לא פורסמה פרוסה הבאה; הנוכחית מסתיימת בשעה '));
    line.appendChild(h('strong', null, time(toMs(live.to))));
    line.appendChild(document.createTextNode('.'));
  }
  return line;
}

// ── the strip as a whole ──

function strip(slices, nowMs, session) {
  const box = h('div', 'tariff');
  const top = priceLevels(slices) >= 2 ? dearest(slices) : null;
  const low = cheapest(slices);
  const live = liveSlice(slices, nowMs);

  // No slice covers this minute — the published calendar is a rolling horizon and it has run
  // out. There is no current price to put in the hero, so there is no hero: inventing one is the
  // single thing this panel must never do. The plot still shows what WAS published, and the
  // sentence at the foot says the rest.
  if (live) box.appendChild(hero(live, top, low, vatOf(slices)));
  if (slices.length) box.appendChild(stepProfile(slices, nowMs, top, session));

  // One key per distinct price, with the real number and its VAT basis.
  const legend = h('div', 'tariff__legend');
  const seen = new Set();
  for (const s of slices) {
    const p = num(s.price);
    if (p === null || seen.has(p)) continue;
    seen.add(p);
    const name = s.name ? ' — ' + String(s.name) : '';
    // ils() is Intl's he-IL currency output, which carries its own directional marks, so the
    // figure survives sitting in front of Hebrew. "kWh" stays the Latin SI symbol, here and in
    // every table header and tile.
    legend.appendChild(h('span', 'tariff__key tariff__key--' + tier(p, slices),
      ils(p, 4) + ' ל־kWh, לפני מע״מ' + name));
  }
  if (legend.childNodes.length) box.appendChild(legend);

  box.appendChild(flipLine(slices, nowMs));
  return box;
}

// ── the live charge ──

function explainer(session, slices, nowMs) {
  const verdict = classifySuspension({ session, slices, nowMs });

  if (verdict === 'ev-refused') {
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
    const gapEx = (top === null ? 0 : top) - (low === null ? (top === null ? 0 : top) : low);
    const gapInc = vat === null ? null : gapEx * (1 + vat / 100);

    body.appendChild(h('p', 'suspend__title', 'מעוכב בגלל המחיר'));
    const detail = h('p', 'suspend__detail');
    detail.appendChild(document.createTextNode(
      'העמדה מעכבת במכוון לאורך החלון היקר'
      + (next ? ', עד ' + (next.name ? String(next.name) + ' בשעה ' : 'השעה ') + time(toMs(next.from)) : '')
      + '. כל kWh שהיא ממתינה לו זול ב־'));
    detail.appendChild(h('span', 'suspend__amount',
      ils(gapInc === null ? gapEx : gapInc) + ' ל־kWh'));
    detail.appendChild(document.createTextNode(
      gapInc === null
        ? ', לפני מע״מ — אין שיעור מע״מ בנתונים.' + reported(rawStatusOf(session))
        : ', כולל מע״מ (' + ils(gapEx) + ' לפני מע״מ). זה הכסף ששווה ההמתנה הזו.' + reported(rawStatusOf(session))));
    body.appendChild(detail);
    return box;
  }

  // Looks identical upstream and means the opposite: the building's panel is limiting us, this
  // is not a price decision, and NOTHING is being saved. The sheet carries that with hazard
  // hatching rather than with the accent — red on this page means a kWh is expensive.
  if (verdict === 'panel-throttled') {
    // "The cheap slice is already running" is only true when it IS. On a three-rate day this
    // branch is also reached sitting in the MIDDLE window, and the base view stopped claiming
    // otherwise; this copy of the sentence follows it rather than drifting.
    const running = liveSlice(slices, nowMs);
    const onCheapest = !!running && priceTier(running.price, slices) === 'offpeak';
    body.appendChild(h('p', 'suspend__title', 'מרוסן על ידי לוח החשמל בבניין'));
    body.appendChild(h('p', 'suspend__detail',
      'זו אינה החלטת מחיר — זה עיכוב בלבד, ולא נחסך כסף. '
      + (onCheapest
        ? 'הפרוסה הזולה כבר רצה, ולכן ההמתנה קונה זמן ותו לא.'
        : 'ההמתנה אינה חוצה את החלון היקר, ולכן היא קונה זמן ותו לא.')
      + reported(rawStatusOf(session))));
    return box;
  }

  body.appendChild(h('p', 'suspend__title', 'מעכב — הסיבה לא הוכחה'));
  body.appendChild(h('p', 'suspend__detail',
    'העמדה מעכבת, אבל הלוח שפורסם אינו מכסה את החלון הזה או שיש בו מחיר אחיד יחיד, '
    + 'ולכן אי אפשר להבחין בין מחיר לבין לוח החשמל. זה לא מספיק כדי לקבוע אחד מהם.'
    + reported(rawStatusOf(session))));
  return box;
}

function sessionBlock(session, slices, nowMs) {
  const box = h('div');
  const status = session.status ? String(session.status) : null;
  if (status) box.appendChild(badge(status));

  const grid = spaced(h('div', 'stat-grid'), 3);
  grid.appendChild(tile(n(num(session.totalEnergy), 1), 'kWh', 'נמסר בטעינה הזו'));
  grid.appendChild(tile(duration(num(session.durationInSeconds)), null, 'מחובר כבר'));
  const inc = num(session.totalCost);
  const ex = num(session.cost);
  // The tile keeps the bare figure and lets .stat__unit carry the ₪, so a column of tiles lines
  // up; ils() is for prose, where the symbol has to travel with the number.
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

// ── no live charge: what the CONNECTOR says ──
//
// Two questions, never one predicate. The connector answers "is a car connected"; the session
// list answers "is a charge running". A car plugged in and idle is `Preparing` with zero
// sessions, and connection() in he.js owns the judgement and every word of the answer.

function connectorBlock(payload) {
  const raw = payload && payload.charger && Array.isArray(payload.charger.connectors)
    ? payload.charger.connectors[0]?.status ?? null
    : null;
  const verdict = connection(raw);

  if (!raw || verdict.connected === false) return emptyBlock(verdict.title, verdict.note);

  const box = h('div');
  box.appendChild(badge(raw));
  box.appendChild(spaced(h('p', 'suspend__detail', verdict.note + reported(raw)), 3));
  return box;
}

// ── views.tariff ──

function tariffView(el, state, ctx) {   // eslint-disable-line no-unused-vars
  const app = state || {};
  const payload = app.state;
  const slices = (payload && Array.isArray(payload.pricingSlices) && payload.pricingSlices) || [];
  const nowMs = Date.now();
  el.replaceChildren();

  // Any payload may be null, on a page that has been running for an hour. Render an empty state
  // rather than throwing.
  if (!payload) {
    el.appendChild(emptyBlock('לא ניתן לטעון את המחיר',
      'עדיין לא הגיע מצב עמדה. לחצו רענון כדי לנסות שוב.', true));
    return;
  }

  const sessions = (Array.isArray(payload.sessions) && payload.sessions) || [];
  const live = sessions.filter(isLiveSession);

  el.appendChild(strip(slices, nowMs, live[0] || null));

  // Two headings for two questions. With a charge running this section is about that charge;
  // with none running it is about the CABLE.
  el.appendChild(spaced(h('h3', 'panel__title', live.length ? 'טעינה פעילה' : 'מצב החיבור'), 5));

  if (!live.length) {
    el.appendChild(connectorBlock(payload));
    return;
  }
  for (const session of live) el.appendChild(spaced(sessionBlock(session, slices, nowMs), 3));
}

// ── views.controls — a BODY, not a renderer ──
//
// views/controls.js keeps onStart, onStop, the busy flag, both bounded polls, failureText and
// release(ctx, reload, force). This builder reads `gate` and `ui` and reaches the charger only
// through `press`, whose two doors sit behind the same gate the default buttons are disabled by:
// an affordance here CANNOT fire a command the panel has already locked.
//
// THE STOP CONFIRM. Stop opens a contactor on a car that is charging, so it takes two presses:
// the first opens a question inside its own compartment, the second sends the command. The
// builder is called again on every repaint — including every sample of a bounded poll — so the
// armed flag is the one piece of module memory here, and it is only what the gesture needs.
// It is dropped the moment the gate closes or a command goes in flight, so a poll cannot repaint
// an armed confirm over a control that is no longer pressable.

let stopArmed = false;

const CONFIRM_ID = 'terminal-stop-confirm';

function cmdBlock(label, button) {
  const box = h('div', 'cmd');
  box.appendChild(h('span', 'cmd__lbl', label));
  box.appendChild(button);
  return box;
}

function commandButton(cls, label, key, busy, busyLabel) {
  const button = h('button', 'btn ' + cls, busy ? busyLabel : label);
  button.type = 'button';
  if (busy) {
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
  }
  if (key) button.appendChild(h('span', 'cmd__key', key));
  return button;
}

function settleBar(settle) {
  const bar = h('div', 'settle');
  bar.appendChild(h('span', null, settle.done ? settle.doneText : settle.text));
  const track = h('div', 'settle__bar');
  const fill = h('div', 'settle__fill');
  // --pct is a bare number and must go in through the style object: a style="…" attribute is
  // refused by the shipped CSP, silently, and reads as a layout bug.
  fill.style.setProperty('--pct', String(
    settle.done ? 100 : Math.min(100, Math.round((settle.attempt / settle.max) * 100))
  ));
  track.appendChild(fill);
  // Hebrew first inside a .num box: the sheet gives it its own bidi paragraph taking its
  // direction from the first strong character, and "45 שנ׳" opening with a digit would resolve
  // left to right and land the unit on the wrong side of the figure.
  bar.appendChild(track);
  bar.appendChild(h('span', 'num', settle.attempt * settle.step + ' שנ׳'));
  return bar;
}

function controlsBody(gate, ui, press) {
  const box = h('div', 'controls');

  const startLocked = gate.startOff || ui.busy !== null;
  const stopLocked = gate.stopOff || ui.busy !== null;
  // The gate closed, or a command went in flight, while the question was open. Disarm: a
  // confirm standing over a control that can no longer be pressed is a lie about what the next
  // press would do.
  if (stopLocked) stopArmed = false;

  if (gate.status) box.appendChild(badge(gate.status));

  // The two markers are `++` and `!!` rather than the prototype's `[ >> ]`: brackets and the
  // angle brackets are bidi-MIRRORED, so a `>` inside an RTL button renders as a `<` and the
  // affordance points the wrong way. `+` and `!` are not mirrored and read the same both ways.
  const start = commandButton('btn--primary', 'התחלת טעינה', '++',
    ui.busy === 'start', ui.busyLabel);
  start.disabled = startLocked;
  start.addEventListener('click', press.start);
  box.appendChild(spaced(cmdBlock(
    'CMD 01 · ' + (ui.busy === 'start' ? 'SENDING' : gate.startOff ? 'LOCKED' : 'READY'),
    start
  ), 4));

  const stop = commandButton('btn--danger', 'עצירה', '!!', ui.busy === 'stop', ui.busyLabel);
  stop.disabled = stopLocked;
  stop.setAttribute('aria-expanded', String(stopArmed));
  stop.setAttribute('aria-controls', CONFIRM_ID);
  const stopCmd = cmdBlock(
    'CMD 02 · ' + (ui.busy === 'stop' ? 'SENDING' : gate.stopOff ? 'LOCKED' : 'DESTRUCTIVE'),
    stop
  );

  const confirm = h('div', 'cmd__confirm');
  confirm.id = CONFIRM_ID;
  confirm.hidden = !stopArmed;
  const question = h('p', 'cmd__question');
  question.appendChild(h('span', 'cmd__warn', 'שים לב — '));
  question.appendChild(document.createTextNode(
    'עצירה מנתקת את החשמל מהרכב באמצע הטעינה. להמשיך?'));
  confirm.appendChild(question);
  const row = h('div', 'btn-row');
  const yes = h('button', 'btn btn--danger', 'כן, לעצור');
  yes.type = 'button';
  const no = h('button', 'btn', 'ביטול');
  no.type = 'button';
  row.appendChild(yes);
  row.appendChild(no);
  confirm.appendChild(row);
  stopCmd.appendChild(confirm);
  box.appendChild(stopCmd);

  const arm = (on) => {
    stopArmed = on;
    confirm.hidden = !on;
    stop.setAttribute('aria-expanded', String(on));
  };

  stop.addEventListener('click', () => {
    // Belt to the brace: the button is already disabled when the gate says so, and press.stop()
    // refuses behind the same gate. This only keeps the question from opening over a dead control.
    if (stopLocked) return;
    arm(!stopArmed);
    if (stopArmed) yes.focus?.();
  });
  no.addEventListener('click', () => {
    arm(false);
    stop.focus?.();
  });
  // THE ONLY DOOR. press.stop() is views/controls.js's own handler behind its own gate; this
  // file does not know what a stop command is and must not learn.
  yes.addEventListener('click', () => {
    arm(false);
    press.stop();
  });

  // A disabled control always carries its reason, and there is always at least one. Rendering
  // them is not optional: a locked control with no stated reason is the bug this project keeps
  // fixing.
  for (const reason of gate.reasons) box.appendChild(h('p', 'btn-note', reason));

  if (ui.settle) box.appendChild(settleBar(ui.settle));
  if (ui.note) box.appendChild(h('p', 'btn-note', ui.note.text));

  // The standing note. There is no charge-now control and no off-peak toggle, the absence is a
  // decision, and saying so is how a reader tells "not built" from "broken". One spelling, owned
  // by views/controls.js.
  box.appendChild(h('p', 'btn-note', STANDING_NOTE));

  return box;
}

export const views = {
  tariff: tariffView,
  controls: controlsBody,
};

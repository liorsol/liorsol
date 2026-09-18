// ── THEME: gauge (מד) — the day is a dial, and a stop you have to mean ──
//
// Axis: information architecture. This screen is an instrument, and its face is a 24-hour
// radial dial. 00:00 at the top, time clockwise, radial THICKNESS is price: the expensive part
// of the day is physically fatter on the ring. The charge that is running is drawn as an arc on
// the same circle, so "the whole charge sat inside the cheap window" is a SHAPE rather than a
// number you have to compare against two other numbers.
//
// THE DIAL DOES NOT MIRROR, and its reason is its own rather than the band's. The horizontal
// band it replaces used to be pinned `direction: ltr` on the argument that a time axis has one
// reading order; the owner overruled that and the band now mirrors with the page (style.css).
// None of it reaches here. A dial is not an axis — it is an instrument face, and every clock,
// speedometer and pressure gauge the owner has ever read runs clockwise from the top in every
// locale, Hebrew included. Mirroring it would put 06:00 where the hand of every other dial in
// their life points at 18:00. So the dial is built in absolute geometry (angles from the top,
// clockwise) and inherits no direction at all; only the prose around it mirrors, which is
// correct because prose is the thing that mirrors in Hebrew.
//
// ── WHY THIS RENDERER COMPOSES RATHER THAN REPLACES ──
//
// It calls `views/tariff.js`'s own render first and then swaps ONE node: the horizontal band
// (`.tariff .scroll-x`, the tree THEMES.md §4.5 documents) for the dial. Everything else the
// panel says — the legend, the flip sentence, the live-session tiles, the connector's answer and
// the suspension explainer — is the product's own wording, unchanged and unduplicated.
//
// That is deliberate. The three degrade states this dial has to survive (no calendar at all, a
// calendar that does not cover now, one flat price) are all already worded by that module, and
// they are worded carefully: "no slice covers this moment" is not the same fact as "no calendar
// arrived", and `classifySuspension` is the judgement the product exists to make. Respelling any
// of it here would put a second copy of the most safety-critical Hebrew on the page, in a file
// nobody reads when the first copy changes. The dial adds a picture; it does not re-answer the
// question. If the base view's tree ever changes shape, the `querySelector` below finds nothing
// and the panel keeps its band — degraded, never broken.
//
// Nothing here fetches, nothing here sets a timer, nothing here touches `ctx`.

import { render as baseTariff, liveSlice, priceTier } from '../views/tariff.js';
import { STANDING_NOTE } from '../views/controls.js';
import { isLiveSession } from '../api.js';
import { n, statusClass, statusLabel } from '../views/he.js';

// ── the face, in viewBox units ──
// One coordinate system, stated once. Every radius below is measured from the centre and every
// angle is degrees clockwise from the top, so nothing on this face is eyeballed.
const VB = 480;
const C = VB / 2;
const R_BEZEL = 221;
const R_FACE = 214;
const R_TICK_OUT = 205;
const R_TICK_MIN = 197;
const R_TICK_MAJ = 189;
const R_NUM = 174;
const R_RING = 118; // the ring's INNER edge: every tariff arc grows outwards from here
const TH_MIN = 9;
const TH_MAX = 34;
const TH_FLAT = 15; // one price in the calendar: no tier to express, so no thickness to vary
const R_SESSION = 106;
const R_HUB = 92;
const R_HUB_FACE = 85;

const DAY_MS = 86400000;
const SVG = 'http://www.w3.org/2000/svg';

// ── tiny builders ── textContent and setAttribute only; no markup string anywhere ──

function svg(tag, attrs, cls) {
  const node = document.createElementNS(SVG, tag);
  // An SVG element's `className` is a read-only SVGAnimatedString — the attribute is the way in.
  if (cls) node.setAttribute('class', cls);
  for (const name of Object.keys(attrs || {})) node.setAttribute(name, String(attrs[name]));
  return node;
}

function svgText(cls, x, y, value, anchor) {
  const node = svg('text', { x, y, 'text-anchor': anchor || 'middle' }, cls);
  node.textContent = String(value);
  return node;
}

function h(tag, cls, value) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
}

// ── geometry ──

const rad = (deg) => ((deg - 90) * Math.PI) / 180;
const px = (deg, r) => (C + r * Math.cos(rad(deg))).toFixed(2);
const py = (deg, r) => (C + r * Math.sin(rad(deg))).toFixed(2);

/**
 * An arc on radius `r` from `a0` to `a1` degrees, clockwise. A full turn cannot be one arc —
 * its endpoints coincide and the renderer draws nothing — so a 24-hour slice becomes two halves.
 */
function arc(r, a0, a1) {
  const span = a1 - a0;
  if (span >= 359.9) return arc(r, a0, a0 + 180) + ' ' + arc(r, a0 + 180, a0 + 359.999);
  return `M ${px(a0, r)} ${py(a0, r)} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${px(a1, r)} ${py(a1, r)}`;
}

function line(cls, deg, rFrom, rTo) {
  return svg('line', { x1: px(deg, rFrom), y1: py(deg, rFrom), x2: px(deg, rTo), y2: py(deg, rTo) }, cls);
}

// ── the calendar, read the way the band reads it ──
//
// Same parsing and the same clipping as views/tariff.js: boundaries are UTC (a stamp with no
// zone designator is parsed as UTC, not as viewer-local, or the whole face shifts by an offset),
// and the face covers the viewer's own local 24 hours. A slice running past midnight is clipped
// at the top of the dial rather than wrapped, which is exactly what the band does with 100%.

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toMs(iso) {
  if (typeof iso !== 'string' || !iso) return NaN;
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + 'Z');
}

/** Every distinct finite price in the calendar, ascending. Length < 2 means "no tiers". */
function priceLadder(slices) {
  const seen = new Set();
  for (const slice of slices) {
    const price = num(slice && slice.price);
    if (price !== null) seen.add(price);
  }
  return [...seen].sort((a, b) => a - b);
}

// Which ink an arc is drawn in. `priceTier` in views/tariff.js is the one classification on the
// page — the same one the legend printed directly under this face is keyed on — so the dial
// reads it rather than deriving a second opinion. `flat` and `unknown` both mean "this slice
// claims no tier", which on a dial is one neutral stroke.
const arcTier = (price, slices) => {
  const tier = priceTier(price, slices);
  return tier === 'flat' || tier === 'unknown' ? 'flat' : tier === 'peak' ? 'high' : tier === 'offpeak' ? 'low' : 'mid';
};

function dayBase(nowMs) {
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

// ── the dial ──

function dial(slices, sessions, nowMs) {
  const base = dayBase(nowMs);
  const deg = (ms) => Math.min(360, Math.max(0, ((ms - base) / DAY_MS) * 360));
  const ladder = priceLadder(slices);
  const tiered = ladder.length >= 2;
  const lo = ladder[0];
  const hi = ladder[ladder.length - 1];

  const face = svg('svg', {
    viewBox: `0 0 ${VB} ${VB}`,
    role: 'img',
    'aria-labelledby': 'gauge-dial-title',
    xmlns: SVG,
  }, 'gauge');
  // The values this picture shows are all stated in words directly below it, by the view module
  // that owns them — the legend carries every price, the flip sentence carries the live tier and
  // when it changes, the tiles carry the charge. So the face needs a name, not a transcript.
  const title = svg('title', { id: 'gauge-dial-title' });
  title.textContent = 'מד היממה: התעריף לפי שעות, והטעינה שרצה כעת';
  face.append(title);

  // plate
  face.append(
    svg('circle', { cx: C, cy: C, r: R_FACE }, 'gauge__face'),
    svg('circle', { cx: C, cy: C, r: R_BEZEL }, 'gauge__bezel'),
    svg('circle', { cx: C, cy: C, r: R_FACE }, 'gauge__hair')
  );

  // 24 hour ticks; the quarter hours of the day are the long ones.
  const ticks = svg('g', {}, 'gauge__ticks');
  for (let hour = 0; hour < 24; hour++) {
    const major = hour % 6 === 0;
    ticks.append(line(major ? 'gauge__tick gauge__tick--maj' : 'gauge__tick', hour * 15, R_TICK_OUT,
      major ? R_TICK_MAJ : R_TICK_MIN));
  }
  face.append(ticks);

  // Four numerals and no more. Boundary hours are NOT numbered: two slices can start eleven
  // minutes apart and their numerals would collide into an unreadable smear — the legend and the
  // flip sentence below name every boundary in words, which is where a time belongs anyway.
  const numerals = svg('g', {}, 'gauge__numerals');
  for (const hour of [0, 6, 12, 18]) {
    // +5 on y is the optical baseline nudge for a centred numeral; dominant-baseline is not
    // reliable across every engine this page runs in.
    numerals.append(svgText('gauge__numeral', px(hour * 15, R_NUM), Number(py(hour * 15, R_NUM)) + 5,
      String(hour).padStart(2, '0')));
  }
  face.append(numerals);

  // ── the tariff ring: radial thickness IS price ──
  const ring = svg('g', {}, 'gauge__ring');
  const ledges = svg('g', {}, 'gauge__ledges');
  for (const slice of slices) {
    const from = toMs(slice && slice.from);
    const to = toMs(slice && slice.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const a0 = deg(from);
    const a1 = deg(to);
    if (a1 <= a0) continue;

    const price = num(slice && slice.price);
    // One flat price, or a slice that carries none, expresses no tier: a constant thickness and
    // a neutral stroke, because a fat arc on a single-price day would invent a peak window the
    // charger never published.
    const thickness = !tiered || price === null
      ? TH_FLAT
      : TH_MIN + ((price - lo) / (hi - lo)) * (TH_MAX - TH_MIN);
    // COLOUR IS THE TIER AND THICKNESS IS THE LADDER. The two were once split differently —
    // colour was binary, on the argument that a third hue would invent a category the legend
    // below the face did not have. The legend HAS it now: views/tariff.js classifies
    // peak / mid / off-peak because an Israeli TAOZ day has three rates, and a face that drew
    // two would contradict the key printed directly under it. So the classification is imported
    // rather than re-derived, and the full price ordering is still in the radius, where nothing
    // has to be named to be seen.
    const tier = arcTier(price, slices);

    ring.append(svg('path', {
      d: arc(R_RING + thickness / 2, a0, a1),
      'stroke-width': thickness.toFixed(2),
    }, 'gauge__arc gauge__arc--' + tier));
    // A hairline in the face's own colour at each boundary, so the step between two thicknesses
    // reads as a machined ledge rather than as a smear.
    ledges.append(line('gauge__ledge', a0, R_RING - 2, R_RING + TH_MAX + 4));
  }
  face.append(ring, ledges);

  // ── the charge that is running, on the same circle ──
  for (const session of sessions) {
    const startedAt = toMs(session.startedAt || session.deviceStartDate);
    const secs = num(session.durationInSeconds);
    // The upstream row spells its start two ways and sometimes neither; the duration is the
    // third way of knowing the same fact and it is the one the tiles already show.
    const from = Number.isFinite(startedAt) ? startedAt : secs === null ? NaN : nowMs - secs * 1000;
    if (!Number.isFinite(from)) continue;
    const a0 = deg(from);
    const a1 = deg(nowMs);
    if (a1 <= a0) continue;
    const path = arc(R_SESSION, a0, a1);
    face.append(
      svg('path', { d: path }, 'gauge__flow-glow'),
      svg('path', { d: path }, 'gauge__flow'),
      line('gauge__flow-cap', a0, R_SESSION - 7, R_SESSION + 7)
    );
  }

  // ── the hand ── it points at the time, which is a fact the calendar cannot take away ──
  const now = deg(nowMs);
  face.append(
    line('gauge__hand', now, R_HUB + 6, R_TICK_OUT),
    svg('circle', { cx: px(now, R_TICK_OUT), cy: py(now, R_TICK_OUT), r: 4 }, 'gauge__hand-dot')
  );

  // ── the hub: one figure, or an honest refusal to print one ──
  face.append(
    svg('circle', { cx: C, cy: C, r: R_HUB }, 'gauge__hub'),
    svg('circle', { cx: C, cy: C, r: R_HUB_FACE }, 'gauge__hub-face')
  );

  const live = liveSlice(slices, nowMs);
  const price = live ? num(live.price) : null;
  if (!slices.length) {
    // Nothing to read. The sentence below the dial says why; the hub must not show a figure.
    face.append(svgText('gauge__hub-none', C, C + 4, 'אין לוח תעריפים'));
  } else if (!live) {
    // The published calendar ran out before now. The hand is still true; the price is not known,
    // and a hub that showed the last slice's figure would be a lie with a decimal point in it.
    face.append(svgText('gauge__hub-none', C, C + 4, 'אין פרוסה שמכסה את'));
    face.append(svgText('gauge__hub-none', C, C + 26, 'הרגע הזה'));
  } else {
    // No eyebrow: the panel's own head already says "המחיר כרגע" two lines above the face, and
    // a dial that labels its one reading twice is a dial that does not trust its own head.
    // The tier's name is a value that came down the wire, not a word this theme owns — a
    // calendar that stops naming its slices simply loses the line and the figure moves up.
    const drop = live.name ? 0 : 18;
    if (live.name) face.append(svgText('gauge__hub-tier', C, C - 36, String(live.name)));
    if (price === null) {
      face.append(svgText('gauge__hub-none', C, C + 4 + drop, 'הפרוסה הזו לא נקבה במחיר'));
    } else {
      face.append(
        svgText('gauge__hub-fig', C, C + 4 + drop, n(price, 4)),
        svgText('gauge__hub-unit', C, C + 28 + drop, '₪ ל־kWh'),
        svgText('gauge__hub-vat', C, C + 48 + drop, 'לפני מע״מ')
      );
    }
  }

  const plate = h('div', 'gauge__plate');
  plate.append(face);
  return plate;
}

// ── the tariff panel ──

function tariff(el, state, ctx) {
  baseTariff(el, state, ctx); // every Hebrew word on this panel, from the module that owns it

  const strip = el.querySelector('.scroll-x');
  if (!strip || typeof strip.replaceWith !== 'function') return; // keep the band rather than break

  const payload = state && state.state;
  const slices = (payload && Array.isArray(payload.pricingSlices) && payload.pricingSlices) || [];
  const sessions = (payload && Array.isArray(payload.sessions) && payload.sessions) || [];
  strip.replaceWith(dial(slices, sessions.filter(isLiveSession), Date.now()));
}

// ── the control panel ──
//
// This is a BODY BUILDER, not a renderer (THEMES.md §6). It draws; it never commands. `press` is
// the only way out of this function and both of its doors are the same gate the default buttons
// are disabled by, so an affordance here CANNOT fire a command the panel has already locked.
// onStart, onStop, the busy flag, the settle poll, the start-confirmation poll and release() all
// stay inside views/controls.js and are not reachable from this file.

const HOLD_MS = 1600;

function stopControl(gate, ui, press) {
  const button = h('button', 'btn btn--danger gauge-stop');
  button.type = 'button';
  const label = h('b', null, ui.busy === 'stop' ? ui.busyLabel : 'עצירה');
  const hint = h('span', 'gauge-stop__hint', 'החזיקו כדי לעצור');
  button.append(label, hint);
  button.disabled = gate.stopOff || ui.busy !== null;
  if (ui.busy === 'stop') {
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
  }
  if (button.disabled) return button;

  // A hold, measured on release. There is no timer anywhere in this gesture: the fill is a CSS
  // clip-path transition and the decision is `Date.now()` minus the moment of the press, so an
  // idle page still holds nothing that could fire. The fill IS the clock the owner reads.
  let pressedAt = 0;
  let viaPointer = false;

  const abandon = () => {
    pressedAt = 0;
    button.classList.remove('is-holding');
  };

  button.addEventListener('pointerdown', () => {
    viaPointer = true;
    pressedAt = Date.now();
    hint.textContent = 'המשיכו להחזיק…';
    button.classList.add('is-holding');
  });

  button.addEventListener('pointerup', () => {
    const held = pressedAt ? Date.now() - pressedAt : 0;
    abandon();
    hint.textContent = held >= HOLD_MS ? 'נשלח' : 'החזיקו כדי לעצור';
    if (held >= HOLD_MS) press.stop();
  });

  button.addEventListener('pointercancel', abandon);
  button.addEventListener('pointerleave', abandon);

  // Keyboard. A hold is not a thing Enter can express, so the keyboard path is the same
  // deliberateness spent differently: two presses, the first of which only arms the second. A
  // repaint resets it, which errs in the safe direction.
  let armed = false;
  button.addEventListener('click', () => {
    if (viaPointer) { viaPointer = false; return; } // the pointer gesture above already ruled
    if (!armed) {
      armed = true;
      hint.textContent = 'לחצו שוב לאישור';
      button.classList.add('is-armed');
      return;
    }
    armed = false;
    button.classList.remove('is-armed');
    press.stop();
  });

  return button;
}

function controls(gate, ui, press) {
  const box = h('div', 'gauge-panel');

  if (gate.status) {
    const badge = h('span', statusClass(gate.status), statusLabel(gate.status));
    badge.title = String(gate.status);
    box.append(badge);
  }

  const row = h('div', 'btn-row');
  const startBtn = h('button', 'btn btn--primary', ui.busy === 'start' ? ui.busyLabel : 'התחלת טעינה');
  startBtn.type = 'button';
  startBtn.disabled = gate.startOff || ui.busy !== null;
  if (ui.busy === 'start') {
    startBtn.classList.add('is-busy');
    startBtn.setAttribute('aria-busy', 'true');
  }
  startBtn.addEventListener('click', press.start);
  row.append(startBtn, stopControl(gate, ui, press));
  box.append(row);

  // Always at least one, always rendered. A disabled control with no stated reason is the bug
  // this project keeps fixing.
  for (const reason of gate.reasons) box.append(h('p', 'btn-note', reason));

  if (ui.settle) {
    const bar = h('div', 'settle');
    bar.append(h('span', null, ui.settle.done ? ui.settle.doneText : ui.settle.text));
    const track = h('div', 'settle__bar');
    const fill = h('div', 'settle__fill');
    // --pct is a BARE number and the width is style.css's. A style="…" attribute is refused by
    // the page CSP, silently, so it goes through the style object like every other one.
    fill.style.setProperty('--pct', String(ui.settle.done
      ? 100
      : Math.min(100, Math.round((ui.settle.attempt / ui.settle.max) * 100))));
    track.append(fill);
    // Hebrew first inside a .num box: it gets its own bidi paragraph from the first strong
    // character, and "45 שנ׳" opening with a digit would land the unit on the wrong side.
    bar.append(track, h('span', 'num', ui.settle.attempt * ui.settle.step + ' שנ׳'));
    box.append(bar);
  }

  if (ui.note) box.append(h('p', 'btn-note', ui.note.text));

  // The standing note about the control this product deliberately does not have, imported from
  // the module that owns it rather than respelled here.
  box.append(h('p', 'btn-note', STANDING_NOTE));

  return box;
}

export const views = { tariff, controls };

// themes/native.js — the one view this theme replaces, and it replaces a BODY, not a command.
//
// `views/controls.js` hands a theme `build(gate, ui, press) -> Node`. Everything the command is
// made of stays on the far side of that seam: onStart, onStop, the busy flag, the settle poll,
// the start-confirmation poll, failureText and release(ctx, reload, force) are module-private
// and nothing here can reach them. `press.start` / `press.stop` are the only two doors, and each
// is the real handler behind the same gate the default buttons are disabled by — so an
// affordance cannot fire a command the panel has already locked.
//
// This file exists for one reason: a slide-to-stop lever. Stop opens a contactor on a car that
// is charging, at five in the morning, part of the way through the cheapest electricity of the
// day. A tap is the wrong shape for that, and iOS already has the right one — "slide to power
// off" — which is literally what this does.
//
// FOUR THINGS THIS FILE IS CAREFUL ABOUT, each of which has cost this project a bug somewhere:
//
//   1. THE LEVER NEVER DECIDES. Completing the slide calls press.stop() and stops. It writes no
//      local "stopped" state, shows no local success, and paints nothing the module has not
//      said. A control that snaps to "stopped" the instant it is released is the bug this
//      project has already shipped once; the prototype this design came from had exactly that
//      ("נשלחה בקשת עצירה", written by the gesture) and it is deliberately gone.
//   2. IN FLIGHT IS NEITHER SUCCESS NOR FAILURE. While ui.busy is set the lever is replaced by
//      a sending state whose words are ui.busyLabel and ui.note — both written by the module.
//   3. LOCKED REFUSES STRUCTURALLY. When the gate says stop is unavailable, or any command is
//      in flight, no pointer or key handler is attached at all. The gate behind press.stop() is
//      the second guard, not the first.
//   4. NO TIMER, NO POLL, NO FETCH. The only rAF in this file runs for a few hundred
//      milliseconds after a finger lets go of the lever and cannot start any other way. An idle
//      page makes zero upstream calls, and a theme change makes none either.
//
// The builder is called again on EVERY repaint, including every sample of a bounded poll, so it
// holds no state of its own beyond what the gesture in progress needs.

import { effectiveKw } from '../views/history.js';
import { n, statusClass, statusKey, statusLabel } from '../views/he.js';
import { STANDING_NOTE } from '../views/controls.js';

// ── DOM ──
// createElement + textContent only. There is no HTML-parsing sink in this module and the icons
// are text rather than SVG: this page may load no remote asset, and inline SVG would need
// createElementNS, which the suite's DOM does not have.

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

// ── the flow readout ────────────────────────────────────────────────────────
//
// THE ONLY CONTINUOUS ANIMATION ON THE PAGE, AND IT IS A READOUT.
//
// The dashes travel one cable period per --flow-dur, and --flow-dur is computed from the
// charge's own kW. A slow cable is a slow charge. It is off — the dashes stay drawn and simply
// stop — in every state where no energy is moving, and "no energy is moving" includes every
// state where the page cannot vouch for the figure it would be animating.
//
// THE FIGURE IS AN AVERAGE, AND IT SAYS SO. There is no instantaneous power anywhere in this
// page's data: `power` is null upstream, and `effectiveKw()` — kWh ÷ hours, the same function
// the history table's "הספק ממוצע" column uses — is the only power reading that exists. Calling
// it "הספק כרגע" would be a number the product does not have.
const FLOW_PX_PER_KW = 9;     // px/s of cable travel per kW — 1.1 kW reads ~2.2 s per period
const FLOW_PERIOD_PX = 22;    // must match --flow-period in themes/native.css
const FLOW_MIN_KW = 0.05;     // below this nothing is meaningfully flowing

/** Seconds per cable period for a given kW, clamped to a speed an eye can still read. */
function flowDuration(kw) {
  return Math.min(10, Math.max(0.3, FLOW_PERIOD_PX / (FLOW_PX_PER_KW * kw)));
}

function liveCard(gate) {
  const session = gate.session;
  const key = statusKey(gate.status);
  // A snapshot the page cannot re-check is not a live reading, whatever it says. An expired
  // charger credential, a link fault, an ended sign-in and data app.js has marked stale all mean
  // the numbers below are a memory, and a memory must not be animated as if it were arriving.
  // `gate.stale` is the last of those and it used to be invisible from here: the sheet had to
  // stop the animation through `.stale .nflow…`, an ancestor app.js happens to wrap the panel
  // body in. It is on the gate now, so the decision is made once, in the builder, beside the
  // other three — and the caption below can tell the truth about which of them applied.
  const vouched = gate.loaded && !gate.expired && !gate.authRequired && !gate.fault && !gate.stale;
  const kw = effectiveKw(session);
  const flowing = vouched && key === 'charging' && kw >= FLOW_MIN_KW;
  const held = key === 'suspendedevse' || key === 'suspendedev';

  const card = el('section', 'nla' + (flowing ? '' : held ? ' nla--held' : ' nla--idle'));

  const head = el('div', 'nla__head');
  // The kicker is about the CABLE, not about the session: #tariff already carries "טעינה פעילה"
  // and the same badge a screen-height above, and two copies of one sentence on one screen is
  // how a reader stops reading either.
  head.append(el('span', 'nla__kicker',
    flowing ? 'החשמל זורם'
      : !vouched ? 'לא נבדק כרגע'
        : 'החשמל אינו זורם'));
  if (gate.status) {
    // Hebrew on the badge, the protocol's own spelling on the title — the same split the base
    // views make, and the label is what carries the meaning.
    const badge = el('span', statusClass(gate.status), statusLabel(gate.status));
    badge.title = String(gate.status);
    head.append(badge);
  }
  card.append(head);

  // The cable. Decorative as a picture and informative only as a speed, so the whole row is
  // hidden from assistive technology and the figure below it is the accessible readout.
  const flow = el('div', 'nflow' + (flowing ? ' is-flowing' : ''));
  flow.setAttribute('aria-hidden', 'true');
  if (flowing) flow.style.setProperty('--flow-dur', flowDuration(kw).toFixed(2) + 's');
  // The station is at the inline start, where reading begins on this page, and the car at the
  // inline end. The CSS sends the dashes from one to the other along the same axis.
  flow.append(el('span', 'nflow__end', '🔌'));
  const cable = el('div', 'nflow__cable');
  cable.append(el('div', 'nflow__dash'));
  flow.append(cable, el('span', 'nflow__end', '🚗'));
  card.append(flow);

  // ONE figure, and it is the one nothing else on this screen shows. The energy, the cost and
  // the elapsed time are already stat tiles in #tariff; repeating them here would be two copies
  // of the same number on one screen. The Hebrew leads the label because this box takes its
  // bidi direction from its first strong character, and "kW · ..." would lay itself out the
  // wrong way round.
  const figures = el('div', 'nla__figures');
  const fig = el('div', 'nfig');
  fig.append(
    el('span', 'nfig__value', n(kw, 2)),
    el('span', 'nfig__label', 'הספק ממוצע מתחילת הטעינה (kW)')
  );
  figures.append(fig);
  card.append(figures);

  card.append(el('p', 'nflow__caption',
    flowing
      ? 'מהירות הנקודות היא ההספק. זו התנועה היחידה בדף, והיא נעצרת כשהנתונים אינם עדכניים.'
      : !vouched
        ? 'הכבל עומד: הלוח אינו יכול לאמת כרגע את המספר הזה, והוא מה שהתקבל אחרון.'
        : held
          ? 'הכבל עומד מפני שאין חשמל שזורם — זו אינה אנימציה שנעצרה, זה המצב.'
          : 'הכבל עומד: העמדה מדווחת שהיא אינה מוסרת חשמל כרגע.'));

  return card;
}

// ── slide to stop ───────────────────────────────────────────────────────────

const HINT = 'החליקו כדי לעצור';
const THUMB_LABEL = 'עצירת טעינה — החליקו עד הסוף כדי לנתק את החשמל מהרכב';
const COMMIT = 0.86;          // how far along the track the FINGER must actually arrive

/** The page's inline axis as a sign: on this RTL page the lever travels leftwards. */
function inlineDir() {
  try {
    return getComputedStyle(document.documentElement).direction === 'rtl' ? -1 : 1;
  } catch {
    // No layout engine (the test DOM). The gesture cannot run there either.
    return document.documentElement?.dir === 'rtl' ? -1 : 1;
  }
}

/** Progressive resistance past the end, so a boundary reads as resistance and not as frozen. */
const rubberband = (overshoot, dimension, constant = 0.55) =>
  (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));

/**
 * A critically damped spring seeded with the release velocity, so there is no seam between the
 * finger and the animation. Used ONLY to send a cancelled lever home: a committed one snaps and
 * hands over to the command immediately, because a command must not wait on an animation.
 */
function springHome(from, velocity, paint, done) {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || typeof requestAnimationFrame !== 'function') {
    paint(0);
    if (done) done();
    return () => {};
  }
  const omega = (2 * Math.PI) / 0.34;   // response 0.34 s, damping 1.0
  // `x` is the distance still to travel and the target is 0, so the finger's velocity along the
  // travel axis IS the spring's initial velocity — no conversion, and no seam between the
  // gesture and the animation that replaces it.
  let x = from;
  let v = velocity || 0;
  let last = performance.now();
  let raf = requestAnimationFrame(function step(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    v += (-omega * omega * x - 2 * omega * v) * dt;
    x += v * dt;
    if (Math.abs(x) < 0.4 && Math.abs(v) < 4) {
      paint(0);
      if (done) done();
      return;
    }
    paint(x);
    raf = requestAnimationFrame(step);
  });
  return () => cancelAnimationFrame(raf);
}

/**
 * The live lever. Reached only when the gate says stop is available and nothing is in flight;
 * every other state is built by `lockedLever` / `sendingLever` below, which attach no handlers.
 */
function liveLever(press) {
  const box = el('div', 'nstop');
  const track = el('div', 'nstop__track');
  const hint = el('div', 'nstop__hint', HINT);
  const thumb = el('div', 'nstop__thumb');
  thumb.append(el('span', 'nstop__chev'), el('span', null, 'עצירה'));
  thumb.setAttribute('role', 'slider');
  thumb.setAttribute('tabindex', '0');
  thumb.setAttribute('aria-label', THUMB_LABEL);
  thumb.setAttribute('aria-valuemin', '0');
  thumb.setAttribute('aria-valuemax', '100');
  thumb.setAttribute('aria-valuenow', '0');
  thumb.setAttribute('aria-valuetext', 'לא הוחלק');
  track.append(hint, thumb);
  box.append(track);

  let pos = 0;
  let dragging = false;
  let fired = false;
  let dir = 1;
  let startX = 0;
  let startPos = 0;
  let samples = [];
  let cancelSpring = null;

  // 6px of inset at each end, matching --slide's rest position in the sheet.
  const maxTravel = () => Math.max(1, (track.clientWidth || 0) - (thumb.offsetWidth || 0) - 12);

  // Custom properties, never an inline style declaration: the shipped CSP refuses a style="…"
  // attribute and the house rule is to hand CSS a value and let CSS own the transform.
  function paint(p) {
    const max = maxTravel();
    pos = p;
    thumb.style.setProperty('--slide', p + 'px');
    const frac = Math.min(1, Math.max(0, p / max));
    hint.style.setProperty('--hint-fade', String(1 - Math.min(1, frac * 1.6)));
    const pct = Math.round(frac * 100);
    thumb.setAttribute('aria-valuenow', String(pct));
    thumb.setAttribute('aria-valuetext', pct === 0 ? 'לא הוחלק' : pct + ' אחוז מהדרך לעצירה');
  }

  // The end of this lever's involvement. It opens the one guarded door and writes nothing about
  // what happened: the module sets busy, runs the settle poll and reloads, and the next repaint
  // replaces this whole node with the sending state. No local success, ever.
  function commit() {
    if (fired) return;
    fired = true;
    if (cancelSpring) cancelSpring();
    paint(maxTravel());
    thumb.setAttribute('aria-valuetext', 'הבקשה נשלחה');
    press.stop();
  }

  thumb.addEventListener('pointerdown', (e) => {
    if (fired) return;
    if (cancelSpring) { cancelSpring(); cancelSpring = null; }
    dir = inlineDir();
    dragging = true;
    startX = e.clientX;
    startPos = pos;                 // respect where they grabbed it
    samples = [{ t: e.timeStamp, x: e.clientX }];
    try { thumb.setPointerCapture(e.pointerId); } catch { /* no capture: tracking still works */ }
    e.preventDefault();
  });

  thumb.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const max = maxTravel();
    const raw = startPos + dir * (e.clientX - startX);
    paint(raw < 0 ? -rubberband(-raw, max) : raw > max ? max + rubberband(raw - max, max) : raw);
    samples.push({ t: e.timeStamp, x: e.clientX });
    if (samples.length > 6) samples.shift();
  });

  function letGo(e) {
    if (!dragging) return;
    dragging = false;
    try { thumb.releasePointerCapture(e.pointerId); } catch { /* pointer already gone */ }

    const max = maxTravel();
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = first && last ? last.t - first.t : 0;
    const velocity = dt > 8 ? dir * ((last.x - first.x) / dt) * 1000 : 0;

    // POSITION ONLY. No momentum projection, and that is the one place this gesture
    // deliberately departs from the iOS scroll-and-sheet physics the rest of it copies.
    // Projection exists to make a FLICK throw something — and a flick is precisely the
    // accidental input a slide-to-confirm exists to refuse. MEASURED: a 69px drag of a 223px
    // track, released fast, projected ~2000px and committed; that press would have opened a
    // contactor on a charging car. The finger has to arrive at the end.
    //
    // The release velocity is still used — for the way BACK, which commands nothing.
    if (pos >= max * COMMIT) commit();
    else cancelSpring = springHome(pos, velocity, paint, () => { cancelSpring = null; });
  }
  thumb.addEventListener('pointerup', letGo);
  thumb.addEventListener('pointercancel', letGo);

  // Four deliberate presses, and no End key. A single keystroke must not cut power to a car.
  thumb.addEventListener('keydown', (e) => {
    if (fired) return;
    const max = maxTravel();
    const step = max / 4;
    let next = null;
    const away = inlineDir();       // ArrowLeft moves the lever forward on an RTL page
    if (e.key === 'ArrowLeft') next = pos + (away < 0 ? step : -step);
    else if (e.key === 'ArrowRight') next = pos + (away < 0 ? -step : step);
    else if (e.key === 'ArrowUp') next = pos + step;
    else if (e.key === 'ArrowDown') next = pos - step;
    else if (e.key === 'Home') next = 0;
    else return;
    e.preventDefault();
    next = Math.min(max, Math.max(0, next));
    if (next >= max - 0.5) commit();
    else paint(next);
  });

  paint(0);
  return box;
}

/**
 * Stop is not available. No pointer handler, no key handler, no tabindex — the refusal is the
 * absence of the gesture rather than a check inside it. `gate.reasons` is already on screen
 * above saying why, which is the rule a disabled control on this page never gets to break.
 */
function lockedLever() {
  const box = el('div', 'nstop nstop--locked');
  const track = el('div', 'nstop__track');
  const thumb = el('div', 'nstop__thumb');
  thumb.setAttribute('aria-hidden', 'true');
  thumb.append(el('span', 'nstop__chev'));
  track.append(el('div', 'nstop__hint', 'העצירה אינה זמינה כרגע'), thumb);
  box.append(track);
  return box;
}

/**
 * A command has been accepted and the charger has not confirmed it. Neither success nor failure,
 * and worded as neither: every string here comes from the module's own in-flight state.
 */
function sendingLever(ui) {
  const box = el('div', 'nstop nstop--sending');
  const line = el('div', 'nsending');
  line.append(el('span', 'nsending__spin'), el('span', null, ui.busyLabel || 'בדרך…'));
  line.setAttribute('aria-busy', 'true');
  box.append(line);
  return box;
}

// ── the settle / confirmation bar ───────────────────────────────────────────
// Both bounded polls paint the same bar; only the words differ. --pct is a bare number and the
// width comes from style.css, which reads it.

function settleBar(settle) {
  const bar = el('div', 'settle');
  bar.append(el('span', null, settle.done ? settle.doneText : settle.text));
  const track = el('div', 'settle__bar');
  const fill = el('div', 'settle__fill');
  fill.style.setProperty('--pct', String(
    settle.done ? 100 : Math.min(100, Math.round((settle.attempt / settle.max) * 100))
  ));
  track.append(fill);
  // Hebrew first inside a .num box: the sheet gives it its own bidi paragraph taking its
  // direction from the first strong character, and a figure-first string would land the unit on
  // the wrong side.
  bar.append(track, el('span', 'num', settle.attempt * settle.step + ' שנ׳'));
  return bar;
}

// ── the body ────────────────────────────────────────────────────────────────

function controls(gate, ui, press) {
  const box = el('div', 'nctl');

  // The live activity: only when there is a charge to be live about. A car plugged in and idle
  // is the connector's business and #tariff already answers it; drawing a cable here for a
  // session that does not exist would be a picture of a fact the page does not have.
  if (gate.session) box.append(liveCard(gate));
  else if (gate.status) {
    const badge = el('span', statusClass(gate.status), statusLabel(gate.status));
    badge.title = String(gate.status);
    box.append(badge);
  }

  // Every reason, in the order the panel decided them. A locked control with no stated reason is
  // the bug this project keeps fixing, so this is not conditional on anything.
  for (const reason of gate.reasons) box.append(el('p', 'btn-note', reason));

  const startBtn = el('button', 'btn btn--primary', 'התחלת טעינה');
  startBtn.type = 'button';
  startBtn.disabled = gate.startOff || ui.busy !== null;
  if (ui.busy === 'start') {
    // Busy is four things at once: the class, the real attribute so a second press cannot land,
    // the ARIA state for anyone not watching the spinner, and a label that says what is going on.
    startBtn.classList.add('is-busy');
    startBtn.setAttribute('aria-busy', 'true');
    startBtn.textContent = ui.busyLabel;
  }
  startBtn.addEventListener('click', press.start);
  box.append(startBtn);

  // The three stop states, in the order that decides them. In flight outranks locked, because a
  // command already sent is a more specific truth than a control being unavailable.
  box.append(
    ui.busy === 'stop' ? sendingLever(ui)
      : (gate.stopOff || ui.busy !== null) ? lockedLever()
        : liveLever(press)
  );

  if (ui.settle) box.append(settleBar(ui.settle));
  if (ui.note) box.append(el('p', 'btn-note', ui.note.text));

  // The standing note about the control this product deliberately does not have, imported from
  // the module that owns it rather than respelled here.
  box.append(el('p', 'btn-note', STANDING_NOTE));

  return box;
}

export const views = { controls };

// ── themes/switch.js — מתג: the page IS the control ──
//
// Every other look treats this screen as a display with two buttons appended. This one inverts
// it: charging is a verb, the owner walked up to the car to DO something, so the primary object
// on the status screen is a physical throw-switch and the readings are printed around it the way
// markings are printed on real equipment.
//
// WHAT THIS FILE IS AND IS NOT.
//
// It is a BODY BUILDER for one panel — `views/controls.js` hands it `(gate, ui, press)` and takes
// back one node. It is NOT a second command path, and the difference matters more here than in
// any other theme, because a lever that "sends a stop" is exactly the shape of the bug this
// project has already shipped twice inside this window.
//
//   · the command             — `press.stop()` / `press.start()`, and nothing else. Those are the
//                               SAME guarded doors the default buttons use, so an affordance here
//                               cannot fire a command the panel has already locked.
//   · the busy flag           — read off `ui.busy`. Never set.
//   · the settle poll and the start-confirmation poll — read off `ui.settle`. Never entered,
//                               never counted, never re-implemented. The four states this lever
//                               draws ARE those polls' states; there is no parallel state machine.
//   · the reload and `release(ctx, reload, force)` — not reachable from here and not wanted.
//
// So this file owns exactly one thing the module does not: the GESTURE. A throw, not a tap.
//
// THE FOUR STATES, AND WHY THE THIRD ONE IS THE WHOLE POINT.
//
//   armed        no command in flight. The lever rests where the charger is: up if a charge is
//                running, down if none is. A throw is available in the one direction the gate
//                has left open — and only one is ever open, because `gate()` never leaves both.
//   sent         the command was accepted and NOBODY HAS CONFIRMED IT. `ui.busy` is held and
//                `ui.settle` is counting. The lever is latched at the far end and locked.
//   confirmed    the poll saw it take effect. The gate has flipped under us, so the lever simply
//                rests at the other end — its position is the charger's state, not a claim of ours.
//   unconfirmed  the poll ran its cap out (or the credential died, or the sign-in ended) without
//                an answer. THIS IS NEITHER SUCCESS NOR FAILURE and it is not drawn as either:
//                the lever parks HALF WAY DOWN THE SLOT, unlatched, because a switch stuck between
//                its two positions is the only honest picture of "the command was accepted and the
//                charger has not answered". Latching it would invent a charge that may not exist;
//                springing it back would send the owner to press again at a contactor that may
//                already have closed. The wording beside it is `ui.note`, verbatim, because
//                views/controls.js already writes all four of those sentences and a second set
//                would drift.
//
// ONE CONTROL. There is no charge-now toggle and no off-peak scheduler anywhere in this product,
// their absence is a decision (the request has never been captured and guessing it buys energy at
// ~2.79x the low tariff), and a direction built around a satisfying switch is exactly the one that
// would be tempted to draw a second one. There is one lever. The standing note that says so is
// reproduced below — see the comment on STANDING.
//
// THREE WAYS DOWN THE SLOT, ALL OF THEM DELIBERATE. A drag with a detent at 55% and a fire point
// at the very bottom; the space bar held for a second; and five discrete steps — an arrow key or
// five assistive activations. None of them can be done by accident and every one of them can be
// abandoned, which is the property that matters: this is not an affordance a finger can operate
// and a screen reader cannot, and it is not one a stray tap can fire.
//
// No `innerHTML`, no markup from a string, no inline style beyond the custom properties the sheet
// reads (a `style="…"` attribute is refused by the shipped CSP, silently). No timer, no poll, no
// fetch: an idle page with this theme on makes zero upstream calls, exactly as with every other.
// The one frame loop is `requestAnimationFrame`, it exists only while a key is physically held,
// it cannot be entered without a keydown, and it is what DETECTS starved frames rather than
// causing them — see holdStep().

import { statusClass, statusLabel } from '../views/he.js';
import { STANDING_NOTE } from '../views/controls.js';

// ── the physics of the throw ──
//
// Numbers, not feelings: a detent at 55% of travel where the lever gets heavy (1.7px of hand for
// 1px of lever past it), a fire point at the very bottom, and a tap window short enough that a
// stab at the lever is told apart from a slow deliberate pull.
const DETENT = 0.55;
const RESIST = 1.7;
const FIRE = 0.98;
const PARK = 0.5; // where an unconfirmed command leaves it: between the two positions
const TAP_MS = 320;
const TAP_T = 0.05;
const HOLD_MS = 1100; // keyboard: hold to throw
const STEP = 0.2; // keyboard: five steps down the slot
const STALL_MS = 260; // frames starved this long: let go rather than jump to fired

// ── the standing note ──
//
// Imported, not copied. views/controls.js owns the sentence and exports it as STANDING_NOTE;
// every body that paints this panel renders that one constant, so there is one place for it to
// be edited and no way for a theme to drift from the guarantee it states.
const STANDING = STANDING_NOTE;

const HOW =
  'משכו את הידית לאורך כל המסילה. באמצע יש נעצר והיא נעשית כבדה. שחרור לפני הסוף מחזיר אותה ולא שולח כלום.';
const KEYS =
  'במקלדת: החזקת רווח מושכת אותה עד הסוף, חץ בכיוון המשיכה מזיז צעד, וחץ נגדי או Esc מבטלים. '
  + 'בהפעלה מסייעת: כל הפעלה מזיזה צעד, וחמש משלימות את המשיכה.';

// ── module memory: the gesture, and nothing else ──
//
// Everything that describes the CHARGER is read from `gate` and `ui` on every build. What lives
// here is the hand on the lever — where it is in the slot, whether a drag or a key-hold is in
// progress — plus the one node this builder reuses.

let node = null;
const el = {};
let cur = null; // the latest { gate, ui, press }

let t = 0; // how far through the throw, 0 = rest, 1 = fired
let action = null; // 'start' | 'stop' | null (nothing is available)
let busy = false;
let wasBusy = false;
let parked = false; // an unconfirmed command is still standing and has not been touched
let unparked = false;

let dragging = false;
let grabY = 0;
let grabT = 0;
let grabAt = 0;
let travel = 160;

let holding = false;
let frame = 0;
let holdFrom = 0;
let holdAt = 0;
let holdSeen = 0;

let said = ''; // the last thing announced, so a repaint cannot re-announce it

// ── tiny DOM helpers. Text always goes in as text. ──

function make(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

// Assign only on a real change: this builder runs on every sample of a bounded poll, and an
// accessible name or a live region rewritten with the same string a second apart is a screen
// reader repeating itself at the one moment the owner is listening hardest.
function say(n, text) {
  if (n.textContent !== text) n.textContent = text;
}

function attr(n, name, value) {
  if (value == null) {
    if (n.getAttribute(name) !== null) n.removeAttribute(name);
  } else if (n.getAttribute(name) !== String(value)) {
    n.setAttribute(name, String(value));
  }
}

function announce(text) {
  if (!el.live || text === said) return;
  said = text;
  el.live.textContent = text;
}

// ── the lock icon on the bolted cover plate ──
//
// Inline SVG only, no remote asset, built with `createElementNS` exactly as `gauge` builds its
// dial — `test/fake-dom.mjs` carries that call for precisely this reason, so there is no excuse
// left to fall back to a glyph for a padlock this simple.
const SVG_NS = 'http://www.w3.org/2000/svg';

function lockIcon() {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.5');
  s.setAttribute('stroke-linejoin', 'round');
  const arc = document.createElementNS(SVG_NS, 'path');
  arc.setAttribute('d', 'M4 7V5a4 4 0 0 1 8 0v2');
  const body = document.createElementNS(SVG_NS, 'rect');
  body.setAttribute('x', '2.8');
  body.setAttribute('y', '7');
  body.setAttribute('width', '10.4');
  body.setAttribute('height', '7');
  body.setAttribute('rx', '1.6');
  s.append(arc, body);
  return s;
}

// ── build ──

function create() {
  node = make('div', 'sw');

  el.badge = make('span', 'status');
  node.append(el.badge);

  const deck = make('div', 'sw__deck');

  // The parts of the slot that are pure paint: the conductor rail, the hazard ground the lever
  // uncovers, the detent, and the two positions printed at the ends. None of them is read again
  // — every one of them is driven from --t and the data-* attributes on the slot — so none of
  // them is kept in `el`.
  el.slot = make('div', 'sw__slot');
  const flow = make('span', 'sw__flow');
  const trail = make('span', 'sw__trail');
  const detent = make('span', 'sw__detent');
  const markOn = make('span', 'sw__mark sw__mark--on', 'טוענת');
  const markOff = make('span', 'sw__mark sw__mark--off', 'לא טוענת');
  for (const paint of [flow, trail, detent, markOn, markOff]) paint.setAttribute('aria-hidden', 'true');

  el.lever = make('div', 'sw__lever');
  el.lever.setAttribute('role', 'button');
  el.lever.setAttribute('tabindex', '0');
  el.lever.setAttribute('aria-describedby', 'switch-how switch-why');
  el.face = make('b', 'sw__state');
  el.sub = make('i', 'sw__sub');
  const face = make('span', 'sw__face');
  face.append(el.face, el.sub);
  const gripA = make('span', 'sw__grip');
  const gripB = make('span', 'sw__grip');
  gripA.setAttribute('aria-hidden', 'true');
  gripB.setAttribute('aria-hidden', 'true');
  el.lever.append(gripA, face, gripB);

  // The bolted cover plate. The prototype's illustration for "every control on this page is
  // dead" is not a greyed-out lever — it is a physical plate bolted over the slot, because that
  // state is not "this button is disabled", it is "this switch cannot be reached at all". Shown
  // only while `action` is null and nothing is in flight (build() below), which is exactly the
  // gate.reasons case this panel already renders in words underneath — the plate says the same
  // thing the way the equipment idiom says it.
  el.cover = make('div', 'sw__cover');
  el.cover.hidden = true;
  const coverIcon = lockIcon();
  el.coverTitle = make('b', 'sw__cover-title', 'המתג מכוסה');
  el.coverBody = make('span', 'sw__cover-body', 'הסיבה כתובה מתחת למתג.');
  el.cover.append(coverIcon, el.coverTitle, el.coverBody);

  el.slot.append(flow, trail, detent, markOn, markOff, el.lever, el.cover);

  // The arming readout. Visual only: the lever's own position is the same fact, and a screen
  // reader being read a percentage on every frame of a pull is noise, not information.
  el.gauge = make('div', 'sw__gauge');
  el.gauge.setAttribute('aria-hidden', 'true');
  el.gaugeFill = make('span', 'sw__gaugefill');
  const track = make('span', 'sw__gaugebar');
  track.append(el.gaugeFill);
  el.gaugePct = make('span', 'sw__gaugepct');
  el.gauge.append(track, el.gaugePct);

  deck.append(el.slot, el.gauge);
  node.append(deck);

  const how = make('div', 'sw__how');
  how.id = 'switch-how';
  el.hint = make('p', 'sw__hint');
  how.append(el.hint, make('p', 'sw__keys', KEYS));
  node.append(how);

  // Every reason the gate gives, always at least one. A dead control with no stated reason is the
  // bug this project keeps fixing, and a lever is a worse place for it than a greyed button:
  // a thing that looks grabbable and does not move needs its reason more, not less.
  el.why = make('div', 'sw__why');
  el.why.id = 'switch-why';
  node.append(el.why);

  el.settle = make('div', 'settle');
  el.settleText = make('span', null, '');
  el.settleFill = make('div', 'settle__fill');
  const bar = make('div', 'settle__bar');
  bar.append(el.settleFill);
  el.settleSecs = make('span', 'num', '');
  el.settle.append(el.settleText, bar, el.settleSecs);
  el.settle.hidden = true;
  node.append(el.settle);

  node.append(make('p', 'btn-note sw__standing', STANDING));

  el.live = make('p', 'sr-only');
  el.live.setAttribute('role', 'status');
  node.append(el.live);

  el.lever.addEventListener('pointerdown', onDown);
  el.lever.addEventListener('pointermove', onMove);
  el.lever.addEventListener('pointerup', onUp);
  el.lever.addEventListener('pointercancel', onUp);
  el.lever.addEventListener('keydown', onKeyDown);
  el.lever.addEventListener('keyup', onKeyUp);
  el.lever.addEventListener('blur', onBlur);
  el.lever.addEventListener('click', onClick);
}

// ── activation without a hand and without a key ──
//
// Voice control, switch access and a screen reader's own "activate" all reach a control the same
// way: a synthetic click. A lever that swallowed those would be a `role="button"` that no
// assistive technology can operate — a control only a finger and a keyboard can work, which is
// the thing this theme was told not to ship.
//
// `detail === 0` is what separates them from a mouse click (a real press reports at least 1),
// and a mouse click is already accounted for by the pointer path above — letting it through here
// too would make a tap both refuse AND advance.
//
// It advances ONE STEP, exactly as an arrow press does, so an activation is never a command: five
// of them complete the throw and each one says how many are left. That is the same deliberate
// multi-step commit a drag is, reachable by whatever the viewer actually uses.
function onClick(e) {
  e.preventDefault?.();
  if (e.detail !== 0) return; // a real press; the pointer handlers own it
  if (parked) {
    unpark();
    return;
  }
  if (!grabbable()) {
    refuse();
    return;
  }
  stopGesture();
  t = Math.min(1, t + STEP);
  apply();
  if (t >= FIRE) {
    fire();
    return;
  }
  const left = Math.ceil((1 - t) / STEP);
  announce('הידית זזה צעד. עוד ' + left + ' הפעלות כדי להשלים את המשיכה, או Esc לביטול.');
}

/** Where the lever sits: 0 is the ON end (a charge is running), 1 is the OFF end. */
function place() {
  const gate = cur.gate;
  if (parked) return PARK;
  if (busy) return action === 'stop' ? 1 : 0;
  // Nothing has loaded: the charger's position is genuinely unknown, and a lever resting at
  // either end would be a claim. It sits between them, like an unconfirmed command.
  if (!gate.loaded) return PARK;
  if (!action) return gate.session ? 0 : 1;
  return action === 'stop' ? t : 1 - t;
}

function apply() {
  el.slot.style.setProperty('--t', String(place()));
  const pct = Math.round(t * 100);
  el.gaugeFill.style.setProperty('--p', String(t));
  say(el.gaugePct, pct + '%');
  el.gauge.dataset.on = !busy && !parked && t > 0.001 ? '1' : '0';
  el.slot.dataset.armed = t >= FIRE ? 'end' : t > 0.001 ? 'part' : 'rest';
  hint();
}

function hint() {
  if (busy) {
    say(el.hint, cur.ui.settle
      ? 'הפקודה התקבלה ועדיין לא אושרה. הידית נעולה עד שתהיה תשובה.'
      : 'הפקודה בדרך לעמדה. הידית נעולה עד שתהיה תשובה.');
    return;
  }
  if (parked) {
    say(el.hint, 'הידית עצרה באמצע המסילה כי לא הגיע אישור. געו בה כדי להחזיר אותה למצב הידוע האחרון.');
    return;
  }
  if (!action) {
    say(el.hint, 'הידית נעולה. הסיבה כתובה מתחתיה.');
    return;
  }
  if (t >= FIRE) {
    say(el.hint, action === 'stop'
      ? 'הידית בסוף המסילה. שחרור עכשיו שולח את פקודת העצירה.'
      : 'הידית בסוף המסילה. שחרור עכשיו שולח את פקודת ההתחלה.');
    return;
  }
  if (t > 0.001) {
    say(el.hint, 'עוד לא נשלח כלום. שחרור, חץ נגדי או Esc מחזירים את הידית ומבטלים.');
    return;
  }
  say(el.hint, HOW);
}

function build(gate, ui, press) {
  cur = { gate, ui, press };
  if (!node) create();

  busy = ui.busy != null;
  // The command ended (or a new one began): the hand is off the lever either way, and the throw
  // starts again from whichever end the gate now says the charger is at.
  if (busy !== wasBusy) {
    stopGesture();
    t = busy ? 1 : 0;
    unparked = false;
    wasBusy = busy;
  }

  // An accepted command that was never confirmed. `ui.settle` survives past `release()` — the
  // module clears it only when the next command starts — so this state persists until the owner
  // touches the lever, which is right: the question it is standing for is still open.
  parked = !busy && !!ui.settle && !ui.settle.done && !unparked;

  action = busy ? ui.busy : !gate.startOff ? 'start' : !gate.stopOff ? 'stop' : null;

  // ── the badge: the connector's own word for itself ──
  if (gate.status) {
    el.badge.hidden = false;
    el.badge.className = statusClass(gate.status);
    say(el.badge, statusLabel(gate.status));
    attr(el.badge, 'title', String(gate.status));
  } else {
    el.badge.hidden = true;
  }

  // ── the lever's own face ──
  const running = !!gate.session;
  let state;
  let sub;
  if (busy) {
    state = ui.settle ? 'ממתין' : 'שולח';
    sub = ui.settle ? ui.settle.attempt * ui.settle.step + ' שנ׳' : (ui.busy === 'stop' ? 'עצירה' : 'התחלה');
  } else if (parked) {
    state = 'לא ידוע';
    sub = 'אין אישור';
  } else if (!gate.loaded) {
    state = 'לא ידוע';
    sub = 'לא נטען';
  } else {
    state = running ? 'טוענת' : 'לא טוענת';
    sub = !action ? 'נעול' : action === 'stop' ? 'משכו לעצירה' : 'משכו להתחלה';
  }
  say(el.face, state);
  say(el.sub, sub);

  // Deliberately `role="button"` and not `role="switch"`. A switch's ARIA contract is binary, and
  // this control has a third state that carries the most weight on the whole page: an accepted
  // command nobody has confirmed. `aria-checked="false"` there would announce "off" about a
  // charge that may well be running. A button whose accessible NAME carries the state can say
  // "not known" and is honest in all four.
  attr(el.lever, 'aria-label', 'מתג הטעינה — ' + state + (action && !busy && !parked ? ', ' + sub : ''));
  attr(el.lever, 'aria-disabled', !action || busy || parked ? 'true' : null);
  attr(el.lever, 'aria-busy', busy ? 'true' : null);

  el.slot.dataset.action = action || 'none';
  // The plate bolts on only for the genuinely dead case — neither direction open, nothing in
  // flight, and not the temporary "parked" pause a timed-out poll leaves standing. `unpark()`
  // still needs a bare lever to take hold of; a plate over it would be one more thing to clear
  // before the owner could even ask for the last known position back.
  el.cover.hidden = !(!action && !busy && !parked);
  node.dataset.phase = busy ? (ui.settle ? 'sent' : 'sending') : parked ? 'unconfirmed' : ui.settle?.done ? 'confirmed' : 'armed';
  // The one ambient animation on the page, and it is information rather than decoration: energy
  // is flowing down the rail behind the lever.
  //
  // Three values, not two, and the third is the point. A charge that the page can still CHECK
  // moves. A charge the page can only remember — the credential expired, the link is faulted,
  // the sign-in ended, nothing has loaded — holds still: lit, because that was the last reading
  // and it is the only reading there is, but not moving, because motion is a claim about NOW and
  // this panel has lost the ability to make one. The banner and the stale flag say the same
  // thing in words; a rail that kept running under them would be the one element on screen still
  // insisting.
  const verified = gate.loaded && !gate.expired && !gate.fault && !gate.authRequired;
  node.dataset.live = running && !busy ? (verified ? '1' : 'held') : '0';

  // ── why, in the gate's own words ──
  const why = [];
  for (const reason of gate.reasons) why.push(make('p', 'btn-note', reason));
  if (ui.note) {
    const n = make('p', 'btn-note', ui.note.text);
    n.dataset.kind = ui.note.kind;
    why.push(n);
  }
  el.why.replaceChildren(...why);

  // ── the bounded poll, drawn exactly as the module counts it ──
  if (ui.settle) {
    el.settle.hidden = false;
    say(el.settleText, ui.settle.done ? ui.settle.doneText : ui.settle.text);
    const pct = ui.settle.done ? 100 : Math.min(100, Math.round((ui.settle.attempt / ui.settle.max) * 100));
    el.settleFill.style.setProperty('--pct', String(pct));
    say(el.settleSecs, ui.settle.attempt * ui.settle.step + ' שנ׳');
  } else {
    el.settle.hidden = true;
  }

  apply();
  keepFocus();
  return node;
}

// app.js mounts this body with `el.replaceChildren(node)`, which detaches and re-inserts the node
// — and that blurs whatever inside it had focus. Harmless on a load; not harmless during a poll,
// which repaints once a second and would take the keyboard user off the lever every second. The
// microtask runs after the replaceChildren that is about to happen.
function keepFocus() {
  let focused = false;
  try {
    focused = document.activeElement === el.lever;
  } catch {
    return;
  }
  if (!focused || typeof queueMicrotask !== 'function') return;
  queueMicrotask(() => {
    try {
      el.lever.focus({ preventScroll: true });
    } catch {
      /* no focus() here (a stub DOM, a detached node): nothing to restore, nothing to report */
    }
  });
}

// ── refusals ──
//
// Two different "no", and they must not share a sentence. One is the gate's — the command is
// locked and the reason is already on screen. The other is the gesture's — this is a switch and a
// tap is not a throw.

// One-shot, and re-triggerable: removing the attribute and setting it again inside the same task
// would be coalesced into no change at all, so the layout read between them is what forces the
// style flush that restarts the animation. No timer clears it; it ends where it started.
function nudge() {
  delete node.dataset.nudge;
  void node.offsetWidth;
  node.dataset.nudge = '1';
}

// The gate we were BUILT with says no. Its reasons are current, they are already under the
// lever, and the first of them is the one the panel put first.
function refuse() {
  nudge();
  const reason = cur.gate.reasons[0];
  announce(reason ? 'הידית נעולה. ' + reason : 'הידית נעולה.');
}

// The door said no AFTER a completed throw. Different case from refuse() above, and it must not
// borrow that sentence: the gate re-read itself at the moment of the call and found something
// this builder has not been repainted with yet — app.js mutates the shared view object in place,
// so a credential that expired mid-round shuts the door a few microtasks before the repaint that
// would tell us why. Quoting `cur.gate.reasons[0]` here would state, confidently, the reason that
// has just stopped being true.
//
// The refusal now carries the reason it was refused FOR, read off the gate at the moment of the
// press, so this can be specific instead of pointing under the switch and hoping. `reasons[0]` is
// the one the panel itself puts first.
function refuseLate(refused) {
  nudge();
  const reason = refused && refused.reasons && refused.reasons[0];
  const why = reason ? ' ' + reason : ' הסיבה מופיעה מתחת למתג.';
  announce('הפקודה לא יצאה: הלוח נעל אותה ברגע האחרון ושום דבר לא נשלח לעמדה.' + why);
  say(el.hint, 'הפקודה לא יצאה: הלוח נעל אותה ברגע האחרון. שום דבר לא נשלח לעמדה.' + why);
}

function refuseTap() {
  nudge();
  announce('זה מתג, לא כפתור. משכו את הידית עד סוף המסילה.');
}

// Taking hold of a parked lever is how the owner puts it back where the charger last said it
// was. It is a full rebuild rather than a nudge of the position, because leaving the slot
// hatched and the face reading "not known" under a lever that has been re-seated would be the
// same lie in the other direction. The NOTE stays: what the poll never confirmed is still
// unconfirmed, and only `views/controls.js` may retire that sentence.
function unpark() {
  unparked = true;
  t = 0;
  announce('הידית הוחזרה למצב הידוע האחרון. שום פקודה לא נשלחה ושום דבר לא אושר.');
  build(cur.gate, cur.ui, cur.press);
}

/** True when the lever may be moved at all. */
function grabbable() {
  return !!action && !busy && !parked;
}

// ── firing ──

function fire() {
  if (!action) {
    refuse();
    return;
  }
  stopGesture();
  t = 1;
  apply();

  // The only two doors, and each is the real handler behind the same gate the default buttons are
  // disabled by. An accepted press gives back the command's promise; a refused one gives back
  // `{ ok: false, reasons }` — the panel had already locked it, which is exactly the case this
  // lever must not be able to shout past, and now the case it can explain.
  const sent = action === 'stop' ? cur.press.stop() : cur.press.start();
  if (sent && sent.ok === false) {
    t = 0;
    apply();
    refuseLate(sent);
    return;
  }
  announce(action === 'stop'
    ? 'פקודת העצירה נשלחה. העמדה עדיין לא אישרה.'
    : 'פקודת ההתחלה נשלחה. העמדה עדיין לא אישרה.');
}

/** The hand came off the lever. Only the very bottom of the slot sends anything. */
function letGo() {
  if (t >= FIRE) {
    fire();
    return;
  }
  if (t > 0.001) announce('הידית שוחררה באמצע המסילה. שום פקודה לא נשלחה.');
  t = 0;
  apply();
}

function stopGesture() {
  dragging = false;
  holding = false;
  if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
  frame = 0;
}

// ── pointer: mouse, touch, pen ──

// How far the lever can actually go, in pixels of hand.
//
// Measured at the moment the hand lands, which is the only moment it is needed and the only
// moment the node is certainly laid out: no observer, no resize listener, no cached geometry to
// go stale, and nothing to measure before first paint — the RESTING position is pure CSS, driven
// from --t, so this exists for the drag alone. The padding is read off the slot rather than
// written here twice: --sw-pad is the sheet's, and a second copy of it in this file would drift
// the moment the slot is retuned.
function measure() {
  const pad = parseFloat(typeof getComputedStyle === 'function'
    ? getComputedStyle(el.slot).paddingTop
    : '') || 8;
  const height = el.slot.clientHeight || 0;
  const lever = el.lever.offsetHeight || 0;
  travel = Math.max(40, height - pad * 2 - lever);
}

function onDown(e) {
  if (parked) {
    unpark();
    return;
  }
  if (!grabbable()) {
    refuse();
    e.preventDefault?.();
    return;
  }
  if (dragging) return; // a second finger does not get to move the lever
  if (e.pointerType === 'mouse' && e.button !== undefined && e.button !== 0) return;
  measure();
  dragging = true;
  grabY = e.clientY;
  grabAt = t;
  grabT = Date.now();
  try {
    el.lever.setPointerCapture(e.pointerId);
  } catch {
    /* no capture available: the drag still tracks while the pointer stays on the lever */
  }
  el.slot.dataset.drag = '1';
  e.preventDefault?.();
}

function onMove(e) {
  if (!dragging) return;
  // The throw direction is the direction of the one command the gate has left open: a running
  // charge is stopped by pulling DOWN out of the live position, an idle charger is started by
  // pushing UP into it. One lever, one gesture, two meanings — never two controls.
  const sign = action === 'stop' ? 1 : -1;
  let pulled = (e.clientY - grabY) * sign + grabAt * travel;
  if (pulled < 0) pulled = 0;
  const heavy = DETENT * travel;
  const next = pulled <= heavy ? pulled / travel : (heavy + (pulled - heavy) / RESIST) / travel;
  t = next > 1 ? 1 : next;
  apply();
  e.preventDefault?.();
}

function onUp(e) {
  if (!dragging) return;
  dragging = false;
  delete el.slot.dataset.drag;
  try {
    el.lever.releasePointerCapture(e.pointerId);
  } catch {
    /* nothing was captured */
  }
  // A stab at the lever: it barely moved and it was over in a moment. That is a press, and this
  // is not a button.
  if (t < TAP_T && Date.now() - grabT < TAP_MS) {
    t = 0;
    apply();
    refuseTap();
    return;
  }
  letGo();
}

// ── keyboard ──
//
// A custom lever is not a <button> for free. Two ways down the slot, both of which can be
// abandoned: hold the space bar and the lever ramps to the end over HOLD_MS, or step it with the
// arrow that points the way the throw goes. Escape and the opposite arrow return it.

function holdStep(now) {
  if (!holding) return;
  // Frames starved — the tab went to the background, the main thread was blocked, the device
  // stalled. The hand is no longer demonstrably on the lever, so LET GO. Carrying on from the
  // clock would hand a stalled page a fired command, which is the one outcome that cannot be
  // taken back.
  if (now - holdSeen > STALL_MS) {
    stopGesture();
    letGo();
    return;
  }
  holdSeen = now;
  const next = holdFrom + (now - holdAt) / HOLD_MS;
  if (next >= 1) {
    t = 1;
    apply();
    fire();
    return;
  }
  t = next;
  apply();
  frame = requestAnimationFrame(holdStep);
}

function onKeyDown(e) {
  const key = e.key;
  const down = action === 'stop'; // the throw runs down the slot for a stop, up for a start
  const forward = down ? 'ArrowDown' : 'ArrowUp';
  const back = down ? 'ArrowUp' : 'ArrowDown';
  const mine = key === ' ' || key === 'Spacebar' || key === 'Enter' || key === 'ArrowDown'
    || key === 'ArrowUp' || key === 'Escape' || key === 'Esc';
  if (!mine) return;
  e.preventDefault?.();

  if (parked) {
    unpark();
    return;
  }
  if (!grabbable()) {
    refuse();
    return;
  }

  if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
    if (e.repeat || holding) return;
    if (typeof requestAnimationFrame !== 'function') {
      // No frame clock to measure a hold against, so there is no way to tell a hold from a tap.
      // The stepping path below is the whole keyboard route here; it is never a one-press fire.
      refuseTap();
      return;
    }
    holding = true;
    holdFrom = t;
    holdAt = holdSeen = typeof performance === 'object' ? performance.now() : Date.now();
    frame = requestAnimationFrame(holdStep);
    return;
  }

  if (key === forward) {
    stopGesture();
    const next = Math.min(1, t + STEP);
    t = next;
    apply();
    if (next >= FIRE) fire();
    return;
  }

  if (key === back || key === 'Escape' || key === 'Esc') {
    stopGesture();
    if (t > 0.001) {
      announce('בוטל. הידית חזרה למקומה ושום פקודה לא נשלחה.');
      t = 0;
      apply();
    }
  }
}

function onKeyUp(e) {
  if (e.key !== ' ' && e.key !== 'Spacebar' && e.key !== 'Enter') return;
  if (!holding) return;
  stopGesture();
  letGo();
}

function onBlur() {
  if (!holding && !dragging) return;
  stopGesture();
  letGo();
}

export const views = { controls: build };

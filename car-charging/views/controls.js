// ── S7 controls + S6 expiry banner ──
//
// Two exports, both called by app.js:
//
//   render(el, state, ctx)        the start/stop panel body
//   renderExpiry(el, state, ctx)  the empty <div id="expiry"> between </header> and <main>
//
// Neither ever blanks anything it does not own, and neither holds a timer. The two bounded loops
// in the whole page live in api.js and are entered from the start and stop handlers below, after
// a real click, and from nowhere else.
//
// Three things are deliberately and permanently absent from this panel, and they are named here
// plainly because a reader who cannot tell "not built" from "broken" files the wrong bug:
//
//   1. a force-charge-now button, which would override the cheap-window schedule
//   2. a toggle for the off-peak schedule itself
//   3. a state-of-charge readout — how full the car's battery is
//
// The first two are upstream calls whose request shape has never been captured. Guessing one
// closes a contactor on real hardware and buys energy at 2.79x the cheap rate, so they wait for
// a capture rather than for a confident guess. The third is a figure that never reaches this
// page at all: the payload does not carry it and no route here can ask for it, so a readout
// would be an invention with a number in it. See PLAN.md §8 D1/D2.

import {
  TOKEN_EXPIRED,
  CHARGER_UNREACHABLE,
  CHARGER_BAD_REPLY,
  isChargerError,
  SETTLE_MAX_ATTEMPTS,
  SETTLE_INTERVAL_MS,
  START_MAX_ATTEMPTS,
  START_INTERVAL_MS,
  isLiveSession,
  start,
  stop,
  pollSettle,
  pollStart,
  installToken,
  getState,
} from '../api.js';
import { statusClass, statusKey, statusLabel } from './he.js';

// ── tiny DOM helpers ──
// Text always goes in as text. There is no HTML-parsing sink anywhere in this module.

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Busy is four things at once, never one: the class for the spinner, the real attribute so the
// click cannot land twice, the ARIA state for anyone not looking at the spinner, and a label
// that says what is happening. Dimming alone explains nothing.
function setBusy(button, busyLabel) {
  button.classList.add('is-busy');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = busyLabel;
}

function clearBusy(button, label) {
  button.classList.remove('is-busy');
  button.disabled = false;
  button.removeAttribute('aria-busy');
  button.textContent = label;
}

// ── S7 — the control panel ──
//
// Module memory, not storage: it is gone on reload, which is the point. app.js may re-render
// this view at any time (a refresh press, a completed mutation), so every transient — which
// button is in flight, how far the settle poll got, what the last action said — is held here
// and repainted, rather than being left to survive inside DOM nodes that get replaced.
const ui = {
  busy: null, // null | 'start' | 'stop' — held for the whole command: poll and reload included
  busyLabel: null, // what the in-flight button says while it is held
  // null | { attempt, max, done, step, text, doneText } — the bounded progress of whichever poll
  // is running. Both commands wait on a charger that has not caught up yet and both show the same
  // bar; only the words differ, and `step` is how many seconds a sample costs, so the figure
  // beside the bar is seconds rather than a count wearing a seconds label.
  settle: null,
  note: null, // null | { kind: 'ok' | 'bad', text }
};

// ── The two link faults that are NOT an expired credential ──
//
// The server used to answer every upstream trouble with `token_expired`, so a wrong base URL
// told the owner their charger credential had expired and sent them into their phone to renew a
// credential that was healthy. That is why every string in this table says, in so many words,
// that this is not a credential problem and there is nothing to renew: the failure being fixed
// was not a missing message, it was a confident WRONG one, and only naming the negative undoes
// it. Both states also lose the paste field entirely — see renderExpiry.
//
// The keys are the server's own names, exactly as api.js passes them through. A name that is
// not here renders nothing rather than an invented state (`view?.chargerFault` in paint()).
//
// NOT_A_CREDENTIAL is one sentence with one spelling on purpose: the banner, the lock reason and
// the command note all have to make the same denial, and three hand-written versions of it is
// three chances for one of them to drift back into sounding like an expiry.
const NOT_A_CREDENTIAL = ' זו אינה בעיית הרשאה, ואין מה לחדש באפליקציה של העמדה.';
const FAULT = {
  [CHARGER_UNREACHABLE]: {
    title: 'אין כרגע קשר לעמדה',
    text: 'הלוח לא קיבל תשובה מהעמדה. זו תקלת תקשורת או הגדרה בצד השרת, והעמדה לא דחתה שום הרשאה.',
    hint: NOT_A_CREDENTIAL.trim() + ' מה שמוצג כאן הוא הנתון האחרון שהתקבל. נסו רענון מאוחר יותר.',
    reason: 'השליטה נעולה כי אין כרגע קשר לעמדה.' + NOT_A_CREDENTIAL,
    short: 'אין כרגע קשר לעמדה, וזו אינה בעיית הרשאה.',
  },
  [CHARGER_BAD_REPLY]: {
    title: 'תשובה שהלוח לא מצליח לקרוא',
    text: 'העמדה ענתה, אבל התשובה לא הייתה בתבנית שהלוח מכיר. העמדה לא דחתה שום הרשאה.',
    hint: NOT_A_CREDENTIAL.trim() + ' ייתכן ששירות העמדה השתנה. מה שמוצג כאן הוא הנתון האחרון שהתקבל.',
    reason: 'השליטה נעולה כי התשובה האחרונה מהעמדה לא הייתה בתבנית שהלוח מכיר.' + NOT_A_CREDENTIAL,
    short: 'התשובה מהעמדה לא הייתה בתבנית שהלוח מכיר, וזו אינה בעיית הרשאה.',
  },
};

let mount = null; // { el, view, ctx } — the last thing render() was called with

// The one row this panel may act on: live by the shared definition *and* carrying an id, because
// the only thing this module does with it is name it in a stop command. A row that has ended is
// a normal thing to find here — it is what the list holds for a few seconds after a stop — and
// picking it would disable Start, leave Stop enabled and send a dead id to the contactor.
const liveSession = (view) => {
  const sessions = view?.state?.sessions;
  const session = Array.isArray(sessions)
    ? sessions.find((s) => isLiveSession(s) && s.sessionId)
    : null;
  return session || null;
};

// The connector's own status is the fallback when there is no session to read one from.
const chargerStatus = (view) => {
  const session = liveSession(view);
  if (session?.status) return session.status;
  const connector = view?.state?.charger?.connectors?.[0];
  return connector?.status ?? null;
};

export function render(el, state, ctx) {
  mount = { el, view: state, ctx };
  paint();
}

function paint() {
  if (!mount) return;
  const { el, view } = mount;
  const status = chargerStatus(view);
  const session = liveSession(view);
  const expired = view?.expired === true;
  // The third flag of the mount contract (PLAN §7.10). Without it this panel cannot see the one
  // failure it must not act through: a viewer whose sign-in has ended still has every panel
  // mounted and a full snapshot painted, so nothing else on screen changes and both buttons
  // would stay live against data that is now only a memory. The command would leave anyway and
  // die at the edge -- the user would learn from a failure message, after pressing a control
  // that closes a contactor.
  const authRequired = view?.authRequired === true;
  // Not a credential problem, and never rendered as one. See FAULT below.
  const fault = FAULT[view?.chargerFault] ? view.chargerFault : null;
  const loaded = !!view?.state;

  const frag = document.createDocumentFragment();

  // Status badge. The name is always the badge's own text — the colour is decoration only.
  // Suffixes are lower-case with no separator; anything outside the seven known states gets a
  // bare .status rather than a class invented from an unrecognised string.
  if (status) {
    // Hebrew is the label; the protocol's own spelling rides on the title. The owner needs to
    // be able to read "SuspendedEVSE" off the badge when something is wrong, and the tariff
    // panel names the same raw state in its prose for the phone, where a title is unreachable.
    const badge = make('span', statusClass(status), statusLabel(status));
    badge.title = String(status);
    frag.append(badge);
  }

  // Why each button is or is not available. A disabled control always carries its reason.
  const reasons = [];
  let startOff = false;
  let stopOff = false;

  // Ordered by which instruction is true. Signed out comes first because it outranks the other
  // two: while the session is gone neither pressing refresh nor pasting a credential reaches
  // anything, so a reason naming either of those would send the owner somewhere that cannot work.
  if (authRequired) {
    startOff = true;
    stopOff = true;
    // The card is on screen whenever this note is: app.js paints it from the same flag, before
    // it paints this panel, and the panels are only detached when nothing has ever arrived --
    // which is a page that has no controls on it to lock. So naming the card is a thing this
    // state knows rather than a thing it hopes. Reload stays in the sentence as the other way
    // back, and it is "reload AND sign in": a reload of a signed-out page lands on this same
    // card, one press further from a session. Refresh is named only to be ruled out.
    reasons.push('השליטה נעולה כי ההתחברות לדף הסתיימה. בקשו קישור כניסה בכרטיס שלמעלה, או טענו את הדף מחדש והתחברו — רענון לא יחזיר אותה.');
  } else if (expired) {
    startOff = true;
    stopOff = true;
    reasons.push('השליטה נעולה כל עוד פג תוקף ההרשאה מול העמדה. התקינו הרשאה חלופית בהודעה שלמעלה.');
  } else if (fault) {
    // Locked for the same reason `expired` is -- the panel is painting a snapshot it can no
    // longer check, and offering Start against it is offering to actuate hardware blind. What
    // must differ is the WORDING: this is not a credential problem, so the reason may not send
    // the owner to renew anything. Saying it in the negative is deliberate; the whole cost of
    // this defect was an instruction that sounded actionable and could not work.
    startOff = true;
    stopOff = true;
    reasons.push(FAULT[fault].reason);
  } else if (!loaded) {
    startOff = true;
    stopOff = true;
    reasons.push('מצב העמדה לא נטען, ולכן התחלה ועצירה נעולות. לחצו רענון.');
  } else if (session) {
    startOff = true;
    if (session.stoppable === false) {
      stopOff = true;
      reasons.push('טעינה רצה, ולכן ההתחלה נעולה; העמדה מדווחת שאי אפשר לעצור אותה מרחוק כרגע.');
    } else {
      reasons.push('טעינה כבר רצה, ולכן ההתחלה נעולה.');
    }
  } else {
    stopOff = true;
    reasons.push('העצירה נעולה כי אין טעינה שרצה.');
  }

  const row = make('div', 'btn-row');
  const startBtn = make('button', 'btn btn--primary', 'התחלת טעינה');
  startBtn.type = 'button';
  const stopBtn = make('button', 'btn btn--danger', 'עצירה');
  stopBtn.type = 'button';

  startBtn.disabled = startOff || ui.busy !== null;
  stopBtn.disabled = stopOff || ui.busy !== null;

  if (ui.busy === 'start') setBusy(startBtn, ui.busyLabel);
  if (ui.busy === 'stop') setBusy(stopBtn, ui.busyLabel);

  startBtn.addEventListener('click', onStart);
  stopBtn.addEventListener('click', onStop);
  row.append(startBtn, stopBtn);
  frag.append(row);

  if (ui.busy) reasons.push('פקודת טעינה בדרך; שתי הפקודות נעולות עד שתתקבל תשובה.');
  for (const reason of reasons) frag.append(make('p', 'btn-note', reason));

  // Bounded settle progress. --pct is a bare number and must be set through the style object:
  // a style="…" attribute in markup is refused by the shipped CSP, silently, and reads as a
  // layout bug rather than as a blocked attribute.
  if (ui.settle) {
    const bar = make('div', 'settle');
    bar.append(make('span', null, ui.settle.done ? ui.settle.doneText : ui.settle.text));
    const track = make('div', 'settle__bar');
    const fill = make('div', 'settle__fill');
    const pct = ui.settle.done
      ? 100
      : Math.min(100, Math.round((ui.settle.attempt / ui.settle.max) * 100));
    fill.style.setProperty('--pct', String(pct));
    track.append(fill);
    // Hebrew first inside a .num box: the sheet gives it its own bidi paragraph taking its
    // direction from the first strong character, and "45 שנ׳" opening with a digit would be
    // resolved left to right and land the unit on the wrong side of the figure.
    bar.append(track, make('span', 'num', ui.settle.attempt * ui.settle.step + ' שנ׳'));
    frag.append(bar);
  }

  if (ui.note) frag.append(make('p', 'btn-note', ui.note.text));

  frag.append(
    make(
      'p',
      'btn-note',
      'תזמון טעינה אל תוך החלון הזול אינו מוצע כאן: הבקשה מעולם לא נלכדה, וניחוש שלה היה מדליק את העמדה במחיר השיא.'
    )
  );

  el.replaceChildren(frag);
}

// The only place ui.busy is ever cleared, and it clears it *after* the reload it was holding for.
//
// The view object this module paints from is the same object app.js hands every view, and app.js
// does not overwrite it until its three fetches resolve. So the window between a command being
// accepted and its reload landing is a window in which paint() computes startOff from the
// pre-command snapshot: with busy already released, a successful start renders Start enabled
// while the session it just created is still invisible to the page, and a second click sends a
// second command to the contactor. Wave 2 closed the same hazard over the settle window; this is
// the reload window immediately after it.
//
// finally, not a trailing statement: a control stuck disabled forever is its own bug, so a reload
// that throws still releases.
//
// `force` is not optional and has no default, because getting it wrong is invisible: a reload that
// does not force re-reads the cached row and repaints the charger as it was BEFORE the command,
// which is exactly the bug this page shipped. Pass true whenever the charger has been changed and
// nothing has forced a fetch since. Pass false when a poll above has just forced one -- the rows
// are seconds old and a second force buys three upstream fetches and no new fact -- or when
// nothing was commanded at all.
// Exported for one reason and no other: test/controls.test.mjs asserts `release.length === 3`,
// which is the only way the no-default rule above can be checked as a property of the real
// function rather than as a grep over this file's text. Nothing imports it in the product.
export async function release(ctx, reload, force) {
  try {
    if (reload) await ctx.reload(force);
  } finally {
    ui.busy = null;
    ui.busyLabel = null;
    paint();
  }
}

// When a command comes back bounced, the press IS how the page found out its session ended.
// There is no auto-refresh, so between the round that painted the snapshot and the press nothing
// looked any different -- and without this the note says the sign-in is over while the button
// that just failed goes straight back to looking live, on the one panel that closes a contactor.
//
// The way to act on it is to run the round that discovers it, not to set a flag here. app.js is
// the only writer of `shared.authRequired` (PLAN §7.10) and load() is the only thing that raises
// the sign-in card, marks the data stale and re-gates every panel; a local copy in this module
// would lock these two buttons and leave the rest of the page claiming to be signed in.
//
// Not an automatic refresh: it is reached from a click and from nowhere else, exactly like the
// reload a successful command already runs.
const bounced = (result) => result.error === 'auth_required';

// What "the start took effect" means, read off a sample exactly as the panel reads it off the
// snapshot it paints: a live session appeared, or the connector itself says it is charging. Both,
// because they are not the same fact -- a charge can be running for a few seconds before the
// session row materialises, and this is a page that must not tell the owner "nothing is charging"
// while the cable is live.
const tookEffect = (state) =>
  !!liveSession({ state }) || statusKey(chargerStatus({ state })) === 'charging';

// The second entry point to a bounded poll, and the twin of onStop below. It is reached by a
// click and by nothing else: api.js refuses an unarmed call and makes zero network requests, so a
// reload cannot resurrect it and nothing on load can enter it.
async function onStart() {
  if (!mount || ui.busy) return;
  const { ctx } = mount;
  ui.busy = 'start';
  ui.busyLabel = 'מתחיל…';
  ui.note = null;
  ui.settle = null;
  paint();

  const result = await start();

  if (!result.ok) {
    // Nothing was commanded, so there is nothing to force a fetch for -- except a bounce, which
    // is news about the page's own session rather than about the charger.
    ui.note = { kind: 'bad', text: failureText(result, 'ההתחלה נכשלה.') };
    paint(); // say what happened now; a bounce still has a whole round to run before it releases
    await release(ctx, bounced(result), false);
    return;
  }

  // Accepted is not started. The charger takes a few seconds to report the session, and the page
  // used to repaint a cached, pre-command snapshot into that gap and call it the answer.
  ui.note = { kind: 'ok', text: 'ההתחלה התקבלה. לוקח לעמדה כמה שניות לדווח עליה.' };
  ui.busyLabel = 'מאמת…';
  // Both controls stay held for the whole window, as they are for a stop: until the charger has
  // confirmed, the page cannot say what a second press would be pressing against.
  ui.settle = {
    attempt: 0,
    max: START_MAX_ATTEMPTS,
    done: false,
    step: START_INTERVAL_MS / 1000,
    text: 'מאמת…',
    doneText: 'אומת',
  };
  paint();

  const final = await pollStart(tookEffect, (_sample, attempt) => {
    ui.settle = { ...ui.settle, attempt };
    paint();
  });

  ui.settle = { ...ui.settle, done: final.confirmed };

  if (final.confirmed) {
    ui.note = { kind: 'ok', text: 'הטעינה התחילה.' };
  } else if (final.error === TOKEN_EXPIRED) {
    ui.note = { kind: 'bad', text: 'ההתחלה התקבלה, אבל תוקף ההרשאה מול העמדה פג לפני שהעמדה דיווחה על טעינה.' };
  } else if (bounced(final)) {
    // Its own branch, and it must stay one: the note below says press refresh, and refresh is
    // provably the one action that cannot mend a sign-in that has ended.
    ui.note = {
      kind: 'bad',
      text: 'ההתחלה התקבלה, אבל ההתחברות לדף הסתיימה לפני שהעמדה דיווחה על טעינה — בקשו קישור כניסה בכרטיס שלמעלה.',
    };
  } else {
    // Running the cap out is NOT a failure and is not a success either, and the note says exactly
    // that: the command was accepted and the charger has not confirmed it yet. Claiming it started
    // would be inventing a charge; claiming it failed would send the owner to press start again,
    // at a contactor that may well be closed already.
    ui.note = {
      kind: 'ok',
      text: 'ההתחלה התקבלה, אבל העמדה עדיין לא דיווחה על טעינה — הבדיקה הופסקה אחרי ' + START_MAX_ATTEMPTS + ' דגימות. לחצו רענון מאוחר יותר כדי לראות אם היא התחילה.',
    };
  }
  paint();
  // false: the poll's own samples forced the fetch and wrote the rows this reload reads.
  await release(ctx, true, false);
}

// The only entry point to the settle poll in the whole page. It is reached by a click and by
// nothing else: never on load, never on a re-render, never "resumed" from a live session found
// in the state payload. api.js refuses an unarmed call and makes zero network requests, which
// is the guard that makes a reload unable to resurrect this.
async function onStop() {
  if (!mount || ui.busy) return;
  const { ctx, view } = mount;
  const session = liveSession(view);

  ui.busy = 'stop';
  ui.busyLabel = 'עוצר…';
  ui.note = null;
  ui.settle = null;
  paint();

  const result = await stop(session?.sessionId ?? null);

  if (!result.ok) {
    // 409 "nothing to stop" collapses to a generic http_error in the client. It is a failure,
    // never a stop that worked. Nothing was commanded, so there is nothing to reload for -- with
    // one exception: a bounce is news about the page's own session rather than about the charger.
    ui.note = { kind: 'bad', text: failureText(result, 'העצירה נכשלה. שום דבר לא נעצר.') };
    await release(ctx, bounced(result), false);
    return;
  }

  const sessionId = result.data?.session?.sessionId ?? session?.sessionId ?? null;
  ui.note = { kind: 'ok', text: 'העצירה התקבלה.' };

  if (!sessionId) {
    paint();
    // Forced: the charger has just been stopped and the cached row still holds the charge that
    // was running. Without this the panel repaints the session it just ended as still live.
    await release(ctx, true, true);
    return;
  }

  // Both controls stay held for the whole settle window. The contactor is still opening and the
  // totals are still landing; offering "start charging" into that is offering to actuate
  // hardware against a state the page cannot yet read.
  ui.busyLabel = 'מסכם…';
  ui.settle = {
    attempt: 0,
    max: SETTLE_MAX_ATTEMPTS,
    done: false,
    step: SETTLE_INTERVAL_MS / 1000,
    text: 'מסכם…',
    doneText: 'הסתכם',
  };
  paint();

  const final = await pollSettle(sessionId, (_sample, attempt) => {
    ui.settle = { ...ui.settle, attempt };
    paint();
  });

  // The command is over either way — the poll is capped, so this is reached in every case and
  // the controls are never left held. They are still not released here: the reload below is the
  // only thing that makes the page's picture of the charger match what just happened to it.
  const settled = (final.data?.session?.completed ?? final.data?.completed) === true;
  ui.settle = { ...ui.settle, done: settled };

  if (settled) {
    ui.note = { kind: 'ok', text: 'נעצרה והסתכמה.' };
  } else if (final.error === TOKEN_EXPIRED) {
    ui.note = { kind: 'bad', text: 'נעצרה, אבל תוקף ההרשאה מול העמדה פג לפני שהטעינה הסתכמה.' };
  } else if (bounced(final)) {
    // Its own branch, and it must stay one -- the twin of onStart's. The note in the `else`
    // below says press refresh, and refresh is provably the one action that cannot mend a
    // sign-in that has ended. api.js now leaves the poll on the first bounce rather than
    // spending all 45 samples to arrive here, so this is reached in a second, not in 45.
    ui.note = {
      kind: 'bad',
      text: 'נעצרה, אבל ההתחברות לדף הסתיימה לפני שהטעינה הסתכמה — בקשו קישור כניסה בכרטיס שלמעלה כדי לראות את הסיכום.',
    };
  } else {
    // Running the cap out is not a failure. The charge is stopped; the totals are still landing.
    ui.note = {
      kind: 'ok',
      text: 'נעצרה. עדיין מסתכמת — הבדיקה הופסקה אחרי ' + SETTLE_MAX_ATTEMPTS + ' דגימות. לחצו רענון מאוחר יותר כדי לראות את הסיכום הסופי.',
    };
  }
  paint();
  // Forced: the settle route samples one session and never rewrites the cached state row, so an
  // ordinary reload here would repaint the charge this press just ended as still running.
  await release(ctx, true, true);
}

// Error names are a closed set and the status is only detail. No server wording reaches the DOM.
function failureText(result, prefix) {
  // The three outcomes stay three, in Hebrew as in English: an ended sign-in sends the owner to
  // the sign-in card (התחברות), a transport failure says the request never arrived, and an
  // expired credential names itself (הרשאה) and sends them to the vendor's own app.
  // Two of them would otherwise collapse into "try again", which is true of exactly one.
  // The bounce is what makes this note's own instruction true: release() runs the round that
  // raises the sign-in card, so by the time this text is painted the card is above the panels.
  if (result.error === 'auth_required') return prefix + ' ההתחברות לדף הסתיימה — בקשו קישור כניסה בכרטיס שלמעלה.';
  if (result.error === 'network') return prefix + ' הבקשה לא הושלמה מעולם.';
  if (result.error === TOKEN_EXPIRED) return prefix + ' פג תוקף ההרשאה מול העמדה.';
  if (FAULT[result.error]) return prefix + ' ' + FAULT[result.error].short;
  return prefix + ' העמדה לא קיבלה את הפקודה.';
}

// ── S6 — the banner slot: one <div>, three states, and only one of them takes a paste ──
//
// The whole block is created when there is something to say and REMOVED FROM THE DOM when there
// is not. Never [hidden], never display:none: a security test asserts the field is absent, and a
// hidden password field is still a field a password manager, a session restore or a page-source
// reader can find.
//
// The value's entire life is: read from the field, handed to installToken(), field cleared. It
// is not held in a variable beyond that expression, not kept in a data attribute, not echoed
// back, not previewed, not measured. installToken() deliberately returns no body, so there is
// nothing to render even by accident.
//
// THE FIELD BELONGS TO THE EXPIRY AND TO NOTHING ELSE. A link fault that offered a box to paste
// a credential into would be the whole defect again in one control: the owner would go to their
// phone, renew something healthy, paste it, and watch the same banner come back. The two fault
// states share this slot and its stylesheet and get no field at all.

const FIELD_ID = 'expiry-credential';

export function renderExpiry(el, state, ctx) {
  // Expiry outranks a fault when both are somehow set: it is the only one the owner can act on.
  const kind = state?.expired === true ? TOKEN_EXPIRED : (FAULT[state?.chargerFault] ? state.chargerFault : null);
  if (!kind) {
    el.replaceChildren(); // banner and field leave the DOM entirely
    return;
  }
  // Already up, and up for the SAME reason — do not rebuild under the user's hands. Keyed on the
  // state rather than on the class, because all three wear `.expiry`: keying on the class would
  // leave an expiry banner standing when the condition had changed to a fault, or the reverse.
  if (el.firstChild?.dataset?.kind === kind) return;

  const inner = make('div', 'expiry__inner');
  if (kind !== TOKEN_EXPIRED) {
    inner.append(
      make('p', 'expiry__title', FAULT[kind].title),
      make('p', 'expiry__text', FAULT[kind].text),
      make('p', 'expiry__text', FAULT[kind].hint)
    );
    const banner = make('div', 'expiry');
    banner.dataset.kind = kind;
    banner.append(inner);
    el.replaceChildren(banner);
    return; // no field: there is nothing here a pasted credential could mend
  }

  inner.append(
    make('p', 'expiry__title', 'פג תוקף ההרשאה מול העמדה'),
    make(
      'p',
      'expiry__text',
      // "refused", not "could not reach". The charger answered and turned the credential down;
      // saying the link was unreachable here is the same conflation from the other side.
      'העמדה דחתה את ההרשאה. חדשו את ההרשאה באפליקציה של העמדה עצמה, ואז הדביקו כאן את החלופה.'
    ),
    make(
      'p',
      'expiry__text',
      'הערך שתדביקו נשלח לבדיקה במעלה הזרם לפני שהוא נשמר, ולכן הדבקה שגויה משדרת סוד אחר לצד שלישי. ודאו אותו לפני ההתקנה.'
    )
  );

  // Not inside a <form>, on purpose. A password field in a form that navigates triggers the
  // browser and OS password managers to offer to save it, and mobile Safari ignores the
  // autocomplete hint for password fields. No form, no navigation, and the CSP forbids form
  // submission anywhere on this page.
  const form = make('div', 'expiry__form');
  const field = make('div', 'field');
  const label = make('label', 'field__label', 'הרשאה חלופית');
  label.htmlFor = FIELD_ID;
  const input = make('input', 'input');
  input.id = FIELD_ID;
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;
  field.append(label, input);

  const install = make('button', 'btn btn--primary', 'התקנה');
  install.type = 'button';
  form.append(field, install);
  inner.append(form);

  const banner = make('div', 'expiry');
  banner.dataset.kind = kind;
  banner.append(inner);
  el.replaceChildren(banner);

  install.addEventListener('click', () => onInstall(el, inner, input, install, ctx));
}

// At most one of the two, and it is removed rather than emptied — each prepends its own glyph
// from the stylesheet, so an empty one is a stray symbol.
function setResult(inner, className, text) {
  for (const old of inner.querySelectorAll('.expiry__error, .expiry__ok')) old.remove();
  if (text) inner.append(make('p', className, text));
}

async function onInstall(el, inner, input, button, ctx) {
  if (button.disabled) return;

  if (!input.value.trim()) {
    setResult(inner, 'expiry__error', 'הדביקו קודם את ההרשאה החלופית.');
    return;
  }

  setBusy(button, 'מתקין…');
  setResult(inner, null, null);

  const result = await installToken(input.value);

  // Cleared on success AND on failure, immediately, before anything else can happen. The
  // attribute above is necessary and not sufficient: Safari and Firefox restore field values on
  // back/forward and on session restore, and an uncleared field survives both.
  input.value = '';
  clearBusy(button, 'התקנה');

  if (!result.ok) {
    // Rejected. The field stays open so the owner can paste again — unless the install never
    // reached anything, in which case blaming the paste sends the owner to re-copy a credential
    // that was fine. A bounced sign-in is the one failure here that no amount of re-pasting fixes.
    // Three reasons an install can fail and only one of them is about the value that was
    // pasted. Blaming the paste for a link fault sends the owner to re-copy a credential that
    // was fine -- the same mistake as the banner's, on the one control meant to end it.
    let why = 'נדחתה. בדקו שהעתקתם את הערך במלואו.';
    if (result.error === 'auth_required') {
      why = 'ההתחברות לדף הסתיימה, ולכן שום דבר לא הותקן. טענו את הדף מחדש כדי להתחבר שוב, ואז הדביקו.';
    } else if (isChargerError(result.error) && result.error !== TOKEN_EXPIRED) {
      why = 'לא הותקן: אין כרגע קשר לעמדה כדי לבדוק את הערך. הערך שהדבקתם לא נדחה — נסו שוב מאוחר יותר.';
    }
    setResult(inner, 'expiry__error', why);
    return;
  }

  setResult(inner, 'expiry__ok', 'הותקנה. בודק שוב…');

  // Re-validate before claiming it worked. Only a result that is not an expiry clears the
  // banner; anything else leaves it up with the field still open.
  const check = await getState();
  if (check.error === TOKEN_EXPIRED) {
    setResult(inner, 'expiry__error', 'הותקנה, אבל העמדה עדיין מדווחת שתוקף ההרשאה פג.');
    return;
  }
  if (!check.ok) {
    setResult(inner, 'expiry__ok', 'הותקנה. העמדה לא ענתה כרגע — לחצו רענון.');
    return;
  }

  el.replaceChildren(); // banner and field leave the DOM
  // Forced, for the same reason a command's reload is: what is cached was fetched while the
  // credential was dead. An unforced round would take the banner down and leave the hour-old row
  // under it, which reads as "fixed, and nothing changed".
  await ctx.reload(true);
}

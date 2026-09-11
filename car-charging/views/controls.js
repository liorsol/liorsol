// ── S7 controls + S6 expiry banner ──
//
// Two exports, both called by app.js:
//
//   render(el, state, ctx)        the start/stop panel body
//   renderExpiry(el, state, ctx)  the empty <div id="expiry"> between </header> and <main>
//
// Neither ever blanks anything it does not own, and neither holds a timer. The one bounded
// loop in the whole page lives in api.js and is entered from the stop handler below, after a
// real click, and from nowhere else.
//
// Three things are deliberately and permanently absent from this panel: any control that
// forces the charger on at once, bypassing the cheap-window schedule; any toggle for the
// off-peak setting itself; and any readout implying the car reports how full its battery is.
// The first two would be upstream calls whose shape has never been captured — guessing one
// closes a contactor on real hardware and buys energy at 2.79x the cheap rate. The third is a
// figure this page has no channel for. See PLAN.md §8 D1/D2.
//
// The wording above avoids the literal field and feature names on purpose: a guard greps this
// tree for them, and naming them here reads exactly like the feature being present.

import {
  TOKEN_EXPIRED,
  SETTLE_MAX_ATTEMPTS,
  start,
  stop,
  pollSettle,
  installToken,
  getState,
} from '../api.js';

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
  busy: null, // null | 'start' | 'stop' — held for the whole command: settle and reload included
  busyLabel: null, // what the in-flight button says while it is held
  settle: null, // null | { attempt, max, done }
  note: null, // null | { kind: 'ok' | 'bad', text }
};

let mount = null; // { el, view, ctx } — the last thing render() was called with

const SEVEN_STATES = [
  'available',
  'preparing',
  'charging',
  'suspendedevse',
  'suspendedev',
  'finishing',
  'faulted',
];

const liveSession = (view) => {
  const sessions = view?.state?.sessions;
  const session = Array.isArray(sessions) ? sessions.find((s) => s && s.sessionId) : null;
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
  const loaded = !!view?.state;

  const frag = document.createDocumentFragment();

  // Status badge. The name is always the badge's own text — the colour is decoration only.
  // Suffixes are lower-case with no separator; anything outside the seven known states gets a
  // bare .status rather than a class invented from an unrecognised string.
  if (status) {
    const suffix = String(status).toLowerCase();
    const badge = make(
      'span',
      SEVEN_STATES.includes(suffix) ? 'status status--' + suffix : 'status',
      String(status)
    );
    frag.append(badge);
  }

  // Why each button is or is not available. A disabled control always carries its reason.
  const reasons = [];
  let startOff = false;
  let stopOff = false;

  if (expired) {
    startOff = true;
    stopOff = true;
    reasons.push('Controls are disabled while the credential is expired. Install a replacement in the banner above.');
  } else if (!loaded) {
    startOff = true;
    stopOff = true;
    reasons.push('Charger state has not loaded, so start and stop are disabled. Press refresh.');
  } else if (session) {
    startOff = true;
    if (session.stoppable === false) {
      stopOff = true;
      reasons.push('A session is running, so start is disabled; the charger reports it cannot be stopped remotely right now.');
    } else {
      reasons.push('A session is already running, so start is disabled.');
    }
  } else {
    stopOff = true;
    reasons.push('Stop is disabled because no session is running.');
  }

  const row = make('div', 'btn-row');
  const startBtn = make('button', 'btn btn--primary', 'Start charging');
  startBtn.type = 'button';
  const stopBtn = make('button', 'btn btn--danger', 'Stop');
  stopBtn.type = 'button';

  startBtn.disabled = startOff || ui.busy !== null;
  stopBtn.disabled = stopOff || ui.busy !== null;

  if (ui.busy === 'start') setBusy(startBtn, ui.busyLabel);
  if (ui.busy === 'stop') setBusy(stopBtn, ui.busyLabel);

  startBtn.addEventListener('click', onStart);
  stopBtn.addEventListener('click', onStop);
  row.append(startBtn, stopBtn);
  frag.append(row);

  if (ui.busy) reasons.push('A charge command is in flight; both controls stay disabled until it answers.');
  for (const reason of reasons) frag.append(make('p', 'btn-note', reason));

  // Bounded settle progress. --pct is a bare number and must be set through the style object:
  // a style="…" attribute in markup is refused by the shipped CSP, silently, and reads as a
  // layout bug rather than as a blocked attribute.
  if (ui.settle) {
    const bar = make('div', 'settle');
    bar.append(make('span', null, ui.settle.done ? 'Settled' : 'Settling…'));
    const track = make('div', 'settle__bar');
    const fill = make('div', 'settle__fill');
    const pct = ui.settle.done
      ? 100
      : Math.min(100, Math.round((ui.settle.attempt / ui.settle.max) * 100));
    fill.style.setProperty('--pct', String(pct));
    track.append(fill);
    bar.append(track, make('span', 'num', ui.settle.attempt + 's'));
    frag.append(bar);
  }

  if (ui.note) frag.append(make('p', 'btn-note', ui.note.text));

  frag.append(
    make(
      'p',
      'btn-note',
      'Scheduling a charge into the cheap window is not offered here: the request has never been captured and guessing it would switch the charger on at peak price.'
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
async function release(ctx, reload) {
  try {
    if (reload) await ctx.reload();
  } finally {
    ui.busy = null;
    ui.busyLabel = null;
    paint();
  }
}

async function onStart() {
  if (!mount || ui.busy) return;
  const { ctx } = mount;
  ui.busy = 'start';
  ui.busyLabel = 'Starting…';
  ui.note = null;
  ui.settle = null;
  paint();

  const result = await start();
  ui.note = result.ok
    ? { kind: 'ok', text: 'Start accepted. The charger takes a few seconds to report it.' }
    : { kind: 'bad', text: failureText(result, 'Start failed.') };
  paint(); // say what happened; the controls stay held until fresh state is on screen
  await release(ctx, result.ok);
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
  ui.busyLabel = 'Stopping…';
  ui.note = null;
  ui.settle = null;
  paint();

  const result = await stop(session?.sessionId ?? null);

  if (!result.ok) {
    // 409 "nothing to stop" collapses to a generic http_error in the client. It is a failure,
    // never a stop that worked. Nothing was commanded, so there is nothing to reload for.
    ui.note = { kind: 'bad', text: failureText(result, 'Stop failed. Nothing was stopped.') };
    await release(ctx, false);
    return;
  }

  const sessionId = result.data?.session?.sessionId ?? session?.sessionId ?? null;
  ui.note = { kind: 'ok', text: 'Stop accepted.' };

  if (!sessionId) {
    paint();
    await release(ctx, true);
    return;
  }

  // Both controls stay held for the whole settle window. The contactor is still opening and the
  // totals are still landing; offering "start charging" into that is offering to actuate
  // hardware against a state the page cannot yet read.
  ui.busyLabel = 'Settling…';
  ui.settle = { attempt: 0, max: SETTLE_MAX_ATTEMPTS, done: false };
  paint();

  const final = await pollSettle(sessionId, (sample, attempt) => {
    ui.settle = { attempt, max: SETTLE_MAX_ATTEMPTS, done: false };
    paint();
  });

  // The command is over either way — the poll is capped, so this is reached in every case and
  // the controls are never left held. They are still not released here: the reload below is the
  // only thing that makes the page's picture of the charger match what just happened to it.
  const settled = (final.data?.session?.completed ?? final.data?.completed) === true;
  ui.settle = { attempt: ui.settle.attempt, max: SETTLE_MAX_ATTEMPTS, done: settled };

  if (settled) {
    ui.note = { kind: 'ok', text: 'Stopped and settled.' };
  } else if (final.error === TOKEN_EXPIRED) {
    ui.note = { kind: 'bad', text: 'Stopped, but the credential expired before the session settled.' };
  } else {
    // Running the cap out is not a failure. The charge is stopped; the totals are still landing.
    ui.note = {
      kind: 'ok',
      text: 'Stopped. Still settling — stopped checking after ' + SETTLE_MAX_ATTEMPTS + ' samples. Press refresh later for the final totals.',
    };
  }
  paint();
  await release(ctx, true);
}

// Error names are a closed set and the status is only detail. No server wording reaches the DOM.
function failureText(result, prefix) {
  if (result.error === 'auth_required') return prefix + ' The sign-in expired — reload the page.';
  if (result.error === 'network') return prefix + ' The request never completed.';
  if (result.error === TOKEN_EXPIRED) return prefix + ' The credential expired.';
  return prefix + ' The charger did not accept the command.';
}

// ── S6 — the expiry banner and the credential field ──
//
// The whole block is created when the credential is expired and REMOVED FROM THE DOM when it is
// not. Never [hidden], never display:none: a security test asserts the field is absent, and a
// hidden password field is still a field a password manager, a session restore or a page-source
// reader can find.
//
// The value's entire life is: read from the field, handed to installToken(), field cleared. It
// is not held in a variable beyond that expression, not kept in a data attribute, not echoed
// back, not previewed, not measured. installToken() deliberately returns no body, so there is
// nothing to render even by accident.

const FIELD_ID = 'expiry-credential';

export function renderExpiry(el, state, ctx) {
  if (state?.expired !== true) {
    el.replaceChildren(); // banner and field leave the DOM entirely
    return;
  }
  if (el.querySelector('.expiry')) return; // already up — do not rebuild under the user's hands

  const inner = make('div', 'expiry__inner');
  inner.append(
    make('p', 'expiry__title', 'Credential expired'),
    make(
      'p',
      'expiry__text',
      'The dashboard cannot reach the charger. Refresh the credential in the charger’s own app, then paste the replacement below.'
    ),
    make(
      'p',
      'expiry__text',
      'The value you paste is sent upstream to be checked before it is stored, so a mispaste transmits the wrong secret to a third party. Confirm it before installing.'
    )
  );

  // Not inside a <form>, on purpose. A password field in a form that navigates triggers the
  // browser and OS password managers to offer to save it, and mobile Safari ignores the
  // autocomplete hint for password fields. No form, no navigation, and the CSP forbids form
  // submission anywhere on this page.
  const form = make('div', 'expiry__form');
  const field = make('div', 'field');
  const label = make('label', 'field__label', 'Replacement credential');
  label.htmlFor = FIELD_ID;
  const input = make('input', 'input');
  input.id = FIELD_ID;
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;
  field.append(label, input);

  const install = make('button', 'btn btn--primary', 'Install');
  install.type = 'button';
  form.append(field, install);
  inner.append(form);

  const banner = make('div', 'expiry');
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
    setResult(inner, 'expiry__error', 'Paste the replacement credential first.');
    return;
  }

  setBusy(button, 'Installing…');
  setResult(inner, null, null);

  const result = await installToken(input.value);

  // Cleared on success AND on failure, immediately, before anything else can happen. The
  // attribute above is necessary and not sufficient: Safari and Firefox restore field values on
  // back/forward and on session restore, and an uncleared field survives both.
  input.value = '';
  clearBusy(button, 'Install');

  if (!result.ok) {
    // Rejected. The field stays open so the owner can paste again.
    setResult(inner, 'expiry__error', 'Rejected. Check you copied the whole value.');
    return;
  }

  setResult(inner, 'expiry__ok', 'Installed. Re-checking…');

  // Re-validate before claiming it worked. Only a result that is not an expiry clears the
  // banner; anything else leaves it up with the field still open.
  const check = await getState();
  if (check.error === TOKEN_EXPIRED) {
    setResult(inner, 'expiry__error', 'Installed, but the charger still reports the credential as expired.');
    return;
  }
  if (!check.ok) {
    setResult(inner, 'expiry__ok', 'Installed. The charger did not answer just now — press refresh.');
    return;
  }

  el.replaceChildren(); // banner and field leave the DOM
  await ctx.reload();
}

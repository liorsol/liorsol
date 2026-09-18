// ── views/sessions.js — the sign-in sessions, and revoking one ──
//
// One row per row of the D1 `sessions` table: when the link was followed, when that browser was
// last seen, the coarse location, and the user-agent string the row was written with. The list
// arrives with the ordinary load round like every other view's data, so a menu press fetches
// nothing; this module has no transport of its own except the one DELETE below.
//
// TWO THINGS CALLED "SESSION" MEET ON THIS PAGE AND THEY ARE NOT THE SAME THING. A charging
// session is a car drawing power and lives in #/history; a sign-in session is a browser holding
// a cookie and lives here. Nothing in this file imports `isLiveSession` or touches
// `state.state.sessions`, and nothing here should ever learn to.
//
// THE USER-AGENT IS NOW READ, AND THE RAW STRING IS STILL PRINTED. The rule here used to be
// "displayed and never parsed", on the grounds that a derived label is a guess about a string
// upstream never promised, printed on the row someone is about to revoke. The owner overruled it:
// the list was unreadable in practice, because "which browser is this" was only answerable by
// decoding `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 …` in
// your head while standing next to a charger.
//
// The old rule's REASON was sound and survives as three constraints on `device()` below, which
// are what keep a guess from ever being the thing a viewer revokes on:
//
//   1. the raw string is still rendered, in full, verbatim, underneath. The derived label is a
//      shortcut to it and never a replacement for it, so a wrong guess is always visibly a guess;
//   2. an unrecognised agent produces NO label rather than a wrong one. There is no "Unknown"
//      chip and no fallback: the row simply shows the raw string on its own, which is exactly
//      what every row did before this change;
//   3. nothing branches on it. It is text. No icon, no colour, no sort order, no revoke
//      behaviour -- the `jti` is the identity and the label is a caption.
//
// It is still never sliced, because the half that would be cut is the half that identifies the
// device; `.session__ua` wraps instead.
//
// REVOKING IS IMMEDIATE AND IRREVERSIBLE. The comment board's ✕ archives a row that stays in the
// table and stays readable; this deletes a row and the next request from that browser is a 401.
// There is nothing to restore and no undo, so the control is two steps: one press arms exactly
// one row, a second press sends the DELETE, and either can be abandoned with ביטול.
//
// THE CURRENT ROW IS A DIFFERENT ACTION, and it is the one most likely to be pressed by mistake.
// Revoking it signs the viewer out of the browser in their hand, so it is labelled as that, it
// is styled as that, and its confirmation says so in as many words.
//
// ON {"self": true} THIS MODULE STOPS PAINTING THE LIST. Every call after that answer is a 401,
// so a repainted list is a list of buttons that cannot work, over data that can never be read
// again. It says what happened and then runs the round that discovers the 401 -- which is
// exactly how views/controls.js reacts to a bounced command: app.js is the only writer of
// `authRequired` and load() is the only thing that raises the sign-in card.
//
// textContent only. Nothing in this file builds markup from a string.

import { revokeSession } from '../api.js';
import { dateTime, relative } from './he.js';

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Module memory, not browser storage. Everything here is gone on reload.
const board = {
  confirming: null, // the jti of the one row that is asking, or null
  busy: null, // the jti whose DELETE is in flight
  error: null,
  // Set once, never cleared: the viewer revoked the browser they are using. The list is not
  // paintable again in this page session and a reload of the page is the only way back.
  signedOff: false,
};

let mount = null; // { el, ctx }
let rows = [];

export function render(el, state, ctx) {
  mount = { el, ctx };
  // The last successful body, exactly as app.js stored it. A failed round never reaches here --
  // the shell keeps the previous payload and this view keeps painting it.
  rows = Array.isArray(state?.signIns?.sessions) ? state.signIns.sessions : [];
  paint();
}

// ── the one thing that is said twice, in two different ways ──
//
// The current row and every other row get different words everywhere they differ, and the
// difference is never carried by colour alone: the label, the question and the button all say
// which of the two actions this is.
const WORDS = {
  other: {
    action: 'ניתוק',
    question: 'לנתק את החיבור הזה? הוא ייפסק מיד, ואי אפשר לבטל את הפעולה.',
    confirm: 'כן, נתקו',
  },
  current: {
    action: 'יציאה מהמכשיר הזה',
    question:
      'זהו המכשיר שאתם משתמשים בו עכשיו. אישור יוציא אתכם מהלוח כאן ומיד, ותצטרכו קישור כניסה חדש כדי לחזור.',
    confirm: 'כן, הוציאו אותי',
  },
};

const words = (session) => (session.current === true ? WORDS.current : WORDS.other);

// he.js owns every way this page says a time, and there is exactly one of each. A second
// formatter here would reintroduce the CLDR gloss that module exists to strip.
const ago = (ms) => (Number.isFinite(ms) ? relative(ms - Date.now()) : '—');

// ── the derived device label ──
//
// Two ordered tables, first match wins, and the ORDER IS THE WHOLE CORRECTNESS OF THIS. Every
// entry below is a token a browser deliberately puts in its own agent string; none is inferred
// from a version number and none is a heuristic over free text.
//
// The orders are not alphabetical and cannot be sorted:
//   · iPhone and iPad come before Mac because iOS writes "like Mac OS X" into its own agent --
//     a Mac test placed first calls every iPhone on this list a Mac;
//   · Edge writes "Edg/", Opera writes "OPR/" and Chrome-on-iOS writes "CriOS/", and all four of
//     those ALSO write "Chrome/"; every Chromium browser and Safari itself write "Safari/". So
//     the list runs most specific to least and Safari is last, which is the only order in which
//     Safari means Safari.
// A string matching nothing yields null and the row shows no label at all -- see the block at
// the top of this file for why that is a requirement rather than a fallback.
const PLATFORM = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMacintosh\b|\bMac OS X\b/, 'Mac'],
  [/\bWindows NT\b/, 'Windows'],
  [/\bLinux\b/, 'Linux'],
];

const BROWSER = [
  [/\bEdgi?A?\w*\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bFxiOS\/|\bFirefox\//, 'Firefox'],
  [/\bCriOS\/|\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const firstMatch = (table, ua) => (table.find(([pattern]) => pattern.test(ua)) ?? [])[1] ?? null;

/**
 * A short caption for a user-agent string, or null when this page cannot say.
 * @param {*} raw the `userAgent` column, exactly as it was written
 * @returns {string|null} e.g. "iPhone · Safari", "Mac", or null
 */
export function device(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const parts = [firstMatch(PLATFORM, raw), firstMatch(BROWSER, raw)].filter(Boolean);
  // The separator is a MIDDLE DOT rather than a slash or a comma: it is direction-neutral, so it
  // cannot be pulled to the wrong end of the caption by the Hebrew beside it.
  return parts.length ? parts.join(' · ') : null;
}

function paint() {
  if (!mount) return;
  const { el } = mount;

  if (board.signedOff) {
    el.replaceChildren(
      block('🔑', 'החיבור הזה נותק', 'יצאתם מהלוח במכשיר הזה. בקשו קישור כניסה חדש בכרטיס שלמעלה כדי לחזור.')
    );
    return;
  }

  const frag = document.createDocumentFragment();

  frag.append(
    make(
      'p',
      'btn-note',
      'כל שורה כאן היא דפדפן שהתחבר ללוח. ניתוק מוחק את החיבור מיד — אין ארכיון ואין ביטול.'
    )
  );

  if (board.error) frag.append(make('p', 'btn-note', board.error));

  if (!rows.length) {
    frag.append(block('🔑', 'אין חיבורים פעילים', 'לא רשום כאן אף דפדפן מחובר.'));
    el.replaceChildren(frag);
    return;
  }

  const list = make('ul', 'session-list');
  for (const session of rows) list.append(row(session));
  frag.append(list);

  el.replaceChildren(frag);
}

function block(icon, title, hint) {
  const box = make('div', 'empty');
  box.append(make('div', 'empty__icon', icon), make('p', 'empty__title', title), make('p', 'empty__hint', hint));
  return box;
}

function row(session) {
  const current = session.current === true;
  const jti = String(session.jti ?? '');
  const item = make('li', current ? 'session session--current' : 'session');

  // WHAT THIS ROW IS, at the top and in the largest thing on it. The old row opened with three
  // run-together stamps and left the identity of the device to a raw string at the bottom, which
  // is the complaint this rewrite answers: the first line now says which device, and the facts
  // about it come second.
  const ident = make('div', 'session__ident');
  // The current row is marked in words as well as in colour, and the mark is the first thing in
  // the row rather than a border somebody has to notice.
  if (current) ident.append(make('span', 'chip chip--info', 'המכשיר הזה'));
  const label = device(session.userAgent);
  // Absent, not empty: a row this page cannot caption gets no heading rather than a placeholder
  // that reads like one. Its raw string below is unchanged and is still the whole answer.
  if (label) ident.append(make('span', 'session__device', label));

  const actions = make('div', 'session__actions');
  const asking = board.confirming === jti;
  if (!asking) {
    // Not `btn--small`: this is a destructive control on a page read one-handed next to a
    // charger, and `.btn--small` is 36px. `.btn` is `--tap`.
    const press = make(
      'button',
      current ? 'btn btn--danger session__revoke' : 'btn session__revoke',
      words(session).action
    );
    press.type = 'button';
    if (board.busy) {
      press.disabled = true;
      press.setAttribute('aria-disabled', 'true');
    }
    press.addEventListener('click', () => {
      board.confirming = jti;
      board.error = null;
      paint();
    });
    actions.append(press);
  }

  item.append(ident, actions);

  // The three facts, as labelled pairs rather than as three sentences with their labels glued
  // to their values. A <dl> because that is what this is; the sheet decides whether the pairs
  // sit side by side or stack.
  const facts = make('dl', 'session__facts');
  for (const [key, val] of [
    ['נכנס', dateTime(session.createdAt)],
    ['נראה לאחרונה', ago(session.lastSeen)],
    ['מיקום', session.location ? String(session.location) : 'לא ידוע'],
  ]) {
    facts.append(make('dt', 'session__key', key), make('dd', 'session__val', val));
  }
  item.append(facts);

  // COLLAPSED, AND STILL VERBATIM. The full agent string is the answer of record — the caption
  // above is derived and can be wrong — so it is never removed, only folded away: the row reads
  // as one device with one disclosure, and the string is one press from being read out to
  // whoever can act on it.
  //
  // <details>/<summary> is the browser's own disclosure. It needs no JS, no state in this module
  // and no aria-expanded to keep in step; it is keyboard- and screen-reader-correct as it ships,
  // and it survives the page CSP, which refuses the inline handler a hand-rolled one would want.
  // Every row starts closed: `open` is never set, so a list of five browsers is five lines.
  //
  // The caption is a SIBLING of `.session__ua` and not a wrapper, which is why the summary holds
  // its own text rather than the string: `.session__ua` is in style.css's `unicode-bidi:
  // plaintext` set so a Latin agent keeps its own reading order, and a Hebrew word inside that
  // box would be the first strong character and flip the whole line.
  const agent = make('details', 'session__agent');
  agent.append(
    make('summary', 'session__ua-label', 'הדפדפן דיווח על עצמו כך'),
    make('p', 'session__ua', session.userAgent ? String(session.userAgent) : '—')
  );
  item.append(agent);

  if (asking) item.append(confirm(session, jti));
  return item;
}

// The second step. It is a block rather than a browser `confirm()` for the same reason the
// composer is not a <form>: this page's response headers are hostile to both, and a native
// dialog cannot say which of the two actions is about to happen.
function confirm(session, jti) {
  const box = make('div', 'session__confirm');
  box.append(make('p', 'session__question', words(session).question));

  const buttons = make('div', 'btn-row');
  const yes = make('button', 'btn btn--danger', board.busy === jti ? 'מנתק…' : words(session).confirm);
  yes.type = 'button';
  if (board.busy) {
    yes.classList.add('is-busy');
    yes.disabled = true;
    yes.setAttribute('aria-busy', 'true');
  }
  yes.addEventListener('click', () => onRevoke(session, jti));

  const no = make('button', 'btn', 'ביטול');
  no.type = 'button';
  if (board.busy) no.disabled = true;
  no.addEventListener('click', () => {
    board.confirming = null;
    paint();
  });

  buttons.append(yes, no);
  box.append(buttons);
  return box;
}

async function onRevoke(session, jti) {
  if (board.busy) return; // an in-flight guard is one comparison, not a layer
  const { ctx } = mount;
  board.busy = jti;
  board.error = null;
  paint();

  const result = await revokeSession(jti);
  board.busy = null;

  // The viewer has just signed themselves out. Do not repaint a list they can no longer load:
  // every call from here is a 401, so the list would be a set of dead buttons over data that
  // cannot be read again. Say it, then run the round that raises the sign-in card.
  if (result.ok && result.data?.self === true) {
    board.signedOff = true;
    board.confirming = null;
    paint();
    await ctx.reload();
    return;
  }

  if (result.ok) {
    board.confirming = null;
    // Dropped locally so the row goes the moment the DELETE lands, exactly as the next read
    // would return it. The reload below is what makes that agreed rather than assumed.
    rows = rows.filter((other) => String(other.jti ?? '') !== jti);
    paint();
    await ctx.reload();
    return;
  }

  // 404 is the same end state reached by another route -- someone else revoked it, or it
  // expired -- so it is reported as done, not as a failure.
  if (result.status === 404) {
    board.confirming = null;
    board.error = 'החיבור הזה כבר לא היה קיים. הרשימה עודכנה.';
    rows = rows.filter((other) => String(other.jti ?? '') !== jti);
    paint();
    await ctx.reload();
    return;
  }

  // Nothing was revoked, so the row stays and the question stays with it: this is a state in
  // which pressing again is the right thing, and the note must not send the viewer elsewhere.
  board.error =
    result.error === 'auth_required'
      ? 'החיבור לא נותק: ההתחברות ללוח הסתיימה. בקשו קישור כניסה בכרטיס שלמעלה.'
      : 'החיבור לא נותק. שום דבר לא השתנה.';
  paint();
}

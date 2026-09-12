// ── views/auth.js — the sign-in screen ──
//
// One card, mounted as the first child of <main>. `app.js` owns its lifecycle and creates and
// removes it with the state it reports; this file owns everything inside it.
//
// THREE NOUNS, AND THEY DO NOT MIX. The page already separates two things, and this file adds a
// third *state* to one of them without blurring either:
//
//   הרשאה     the credential the dashboard uses against the charging station. It expires, and
//             it is renewed in the station vendor's own phone app and pasted into the red
//             banner above <main>. This file may never print that word: a viewer who reads it
//             here is sent to the wrong app for a problem they do not have.
//   התחברות   the viewer's own session with this dashboard. What this file is about, and the
//             only family it draws its wording from — כניסה, להתחבר, קישור כניסה.
//   רענון     the refresh button. It re-reads data. It cannot create a session, so nothing
//             here ever points at it.
//
// The state this file adds — signed out and needing a NEW LINK — is a state of התחברות, not a
// fourth noun. `test/auth.test.mjs` fails if the card ever prints הרשאה or רענון.
//
// SIGNED-OUT-NESS IS NOT READ FROM THE BROWSER. The session rides in a cookie the browser does
// not hand to script, on purpose: a markup injection on a page that closes a contactor must not
// be able to lift a session. It arrives here as one boolean on the shared state object, set by
// `app.js` from a 401 on the data routes and from nothing else. This file keeps no marker of
// its own, in browser storage or anywhere else, and none should ever be added: a marker can say
// "signed in" after the server has stopped agreeing, and the only honest answer is the one the
// server just gave.
//
// NO AUTOMATIC ANYTHING. No timer, no poll for the link being clicked, no retry after a failed
// request, and one listener — the click on the one button. A signed-out page left open
// overnight makes zero further calls. Retrying is a press or a reload, both of them the
// viewer's.
//
// THERE IS NO EMAIL FIELD, and that is the owner's design rather than an omission. The address
// lives on the server and the request carries no body. A field here would be somewhere to type
// an address that is never sent and never used — and, if it ever were sent, somewhere for a
// visitor to aim the mail.
//
// textContent only. Nothing in this file builds markup from a string.

import { requestSignInLink } from '../api.js';

// ── The four cards ──
//
// Written out rather than assembled, so the states can be read side by side and compared. That
// is the requirement: a viewer told the wrong one is told to do something that cannot work.
//
// `sent` claims exactly what the page knows — that the request went out. It does not say mail
// was delivered, or even sent: nothing here can see a mailbox, and the server must not tell an
// anonymous caller either. And it names no address, because the page was never given one.
const CARDS = {
  idle: {
    icon: '👤',
    title: 'צריך להתחבר',
    hints: [
      'הלוח הזה פרטי. לחצו על הכפתור, והשרת ישלח קישור כניסה חד־פעמי לכתובת הדוא״ל השמורה אצלו.',
      'אין כאן שדה כתובת בכוונה — הדף לא מבקש כתובת ולא שולח אחת.',
    ],
    action: 'שלחו לי קישור כניסה',
  },

  sent: {
    icon: '✉',
    title: 'הבקשה נשלחה',
    hints: [
      'ביקשנו מהשרת לשלוח קישור כניסה. חפשו אותו בתיבת הדוא״ל, וגם בתיקיית הספאם.',
      'הקישור מחבר את הדפדפן שבו תפתחו אותו, ולכן פתחו אותו במכשיר שבו אתם רוצים לראות את הלוח.',
      'אם לא הגיע כלום, טענו את הדף מחדש ובקשו שוב.',
    ],
    action: null, // a second press is a reload away; nothing here presses by itself
  },

  // The two failures, and the whole difference between them is whether another press can help.
  retry: {
    icon: '⚠',
    error: true,
    title: 'הבקשה לא יצאה',
    hints: ['לא הצלחנו לבקש את הקישור כרגע. בדקו את החיבור ונסו שוב.'],
    action: 'נסו שוב',
  },

  stuck: {
    icon: '⚠',
    error: true,
    title: 'השרת לא יכול לשלוח קישור כרגע',
    hints: ['זו תקלה בצד השרת ולא משהו שאפשר לתקן מהדף הזה — לחיצה נוספת תחזיר את אותה התשובה.'],
    action: null,
  },
};

// Which of the two failures it is, decided on the response class and nothing finer: a request
// that never left (status 0), a rate limit, and a server that is briefly unavailable all mend
// themselves without anyone doing anything. Every other answer the server gave, it will give
// again to the next press, and telling the viewer to keep pressing is telling them to wait for
// something that is not coming.
//
// WHAT is wrong on the server is deliberately not named, not hinted at and not shown — not the
// status, not the server's own error name. The card says whether to press again; it never says
// why not. That is one fewer fact this page hands to a caller who cannot get in.
const RETRYABLE = new Set([0, 408, 425, 429, 502, 503, 504]);

// ── Module memory ──
//
// Which card is showing, and which one is on screen. A reload starts over at `idle`, and that
// is the only reset there is: nothing is persisted, so the state cannot outlive the tab or
// survive into another browser.
let phase = 'idle';
let painted = null;

function make(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function paint(el) {
  const card = CARDS[phase];

  const box = make('div', card.error ? 'empty empty--error' : 'empty');
  box.append(make('div', 'empty__icon', card.icon), make('h2', 'empty__title', card.title));
  for (const hint of card.hints) box.append(make('p', 'empty__hint', hint));

  if (card.action) {
    const press = make('button', 'btn btn--primary', card.action);
    press.type = 'button';
    press.addEventListener('click', () => onPress(el, press));
    box.append(press);
  }

  const body = make('div', 'panel__body');
  body.append(box);
  const panel = make('section', 'panel');
  panel.append(body);

  el.replaceChildren(panel);
  painted = phase;
}

async function onPress(el, press) {
  if (phase === 'sending') return; // an in-flight guard is one comparison, not a layer
  phase = 'sending';
  // The busy state is the refresh button's, reused rather than reinvented: label, disabled and
  // aria-busy together, so it is announced and not only drawn.
  press.disabled = true;
  press.setAttribute('aria-busy', 'true');
  press.textContent = 'מבקש…';

  const result = await requestSignInLink();
  phase = result.ok ? 'sent' : RETRYABLE.has(result.status) ? 'retry' : 'stuck';
  paint(el);
}

/**
 * The mount contract's `render`, minus the third argument: `ctx.reload()` re-reads the data
 * routes, and while this card is up every one of them answers 401. The way out of this state is
 * a link opened from a mail client, which arrives as a fresh page load — there is nothing here
 * to reload and nothing to wait on.
 */
export function render(el, state) {
  if (state?.authRequired !== true) {
    // Signed in. The card leaves the DOM entirely and the next signed-out round starts over.
    if (painted !== null) {
      el.replaceChildren();
      phase = 'idle';
      painted = null;
    }
    return;
  }
  // Never rebuild under the viewer's hands: not while a request is in flight, and not when the
  // card on screen is already the right one. A repaint would throw away a pressed button.
  if (phase === 'sending' || phase === painted) return;
  paint(el);
}

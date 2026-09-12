// ── Bootstrap, fetching, view mounting, shared state ──
//
// This file is the only thing on the page that fetches, the only writer of the shared state
// object, and the only owner of the stale marker and of both banners' lifecycles -- the credential
// expiry one and the signed-out one. Views are pure painters: they are handed data that already
// arrived and they never see a failure.
//
// It is also the only place that reads *why* a round failed. The three outcomes stay three:
// a transport failure says retry, a sign-in that has ended says sign in again, and an expired
// upstream credential raises its own banner. Collapsing any two of them tells the user to do
// something that cannot work.
//
// NO AUTOMATIC REFRESH. Upstream is touched in three situations and EVERY ONE OF THEM IS A PRESS
// or a load: a page load whose cached data the server judges older than an hour, the refresh
// button, and the reload a start or stop runs once its command has been accepted. There is no
// polling, no interval timer, no retry after a failure, no revalidation when the tab is shown
// again or the network returns, and no background worker. A page left open all day makes zero
// upstream calls -- that is a free-tier invocation budget requirement, not an optimisation, and
// `test/settle.test.mjs` and `test/start-confirm.test.mjs` assert the absence rather than
// trusting this comment.
//
// The page also never decides *whether* to fetch from the age of the data it holds. The one-hour
// rule lives server-side so it survives a hard reload with browser storage cleared; a copy here
// would re-break the invocation budget. Age is rendered, never acted on.
//
// The third case is the one exception to "the server owns the decision", and it is narrow: a
// command that has just changed the charger knows something the cache does not, so it asks for
// the fetch to be forced. It cannot be reached except from a click.

import { getState, getHistory, getInvoices, refresh, TOKEN_EXPIRED } from './api.js';
import { dateTime, relative } from './views/he.js';
// The one view imported statically rather than mounted through the table below. The dynamic
// import exists because five view files were being written concurrently by agents who could not
// talk to each other, so a broken one had to cost a panel instead of the page (frontend-notes
// ruling 7). Neither half of that applies here: this file and views/auth.js ship together, and
// a sign-in screen that failed to load would cost the page anyway -- it is the only way in.
import { render as renderAuth } from './views/auth.js';

const HOUR_MS = 3600000;

// ── The shared state object ──
//
// One object, the same one for every view, and this module is its only writer. `state` /
// `history` / `invoices` each hold the last *successful* body of their route, or null if that
// route has never succeeded -- so a failed call can never blank data that already arrived.
const shared = {
  state: null,
  history: null,
  invoices: null,
  expired: false,
  // The third flag of the mount contract (PLAN §7.10), and it is on the shared object rather
  // than local to this file for one reason: views/controls.js cannot gate a control it has no
  // way to see. The last round was bounced to a sign-in, not merely failed. Distinct from
  // `expired`, which is the upstream credential; this one is the viewer's own session and
  // nothing on the page -- no refresh, no credential install -- can renew it.
  authRequired: false,
  fetchedAt: null,
  stale: false,
};

// What views get as their third argument. reload() re-fetches all three routes and repaints
// every view; a view calls it after a mutating action.
//
// `reload(true)` forces the upstream fetch first, and a view that has just changed something at
// the charger MUST pass it. Without it the round re-reads the cached row -- the server serves it
// back untouched while it is under an hour old, which is correct and is the whole reason the row
// exists -- and the page repaints the state as it was BEFORE the command. That is what made a
// start look like it did nothing until the refresh button was pressed.
const ctx = { reload: (force) => load(force) };

// Epoch ms per route, so the header can report the age of the *oldest* thing on screen rather
// than the freshest. Only a successful call updates one.
const fetchedAt = { state: null, history: null, invoices: null };

// ── The views ──
//
// `needs` is the route a panel is empty without: the view is mounted once that route has
// succeeded at least once, and until then the panel carries a skeleton or, after a failed first
// load, an error block. Every view still has to tolerate a null on the other two -- the contract
// says any route may be null, and today all three can fail independently.
const views = [
  { id: 'tariff', src: './views/tariff.js', needs: 'state', skel: '88px', fail: 'לא ניתן לטעון את המחיר' },
  { id: 'controls', src: './views/controls.js', needs: 'state', skel: '88px', fail: 'לא ניתן לטעון את השליטה' },
  { id: 'history', src: './views/history.js', needs: 'history', skel: '180px', fail: 'לא ניתן לטעון את הטעינות' },
  { id: 'account', src: './views/account.js', needs: 'state', skel: '140px', fail: 'לא ניתן לטעון את מצב העמדה' },
  // The comment board fetches its own data and owns its own empty states, so nothing gates it.
  { id: 'comments', src: './views/comments.js', needs: null, skel: '120px', fail: 'לא ניתן לטעון את ההערות' },
];

const controls = views[1];

// ── Small DOM helpers ──
// textContent and classList only. Nothing here builds an HTML string, and nothing is ever
// assigned into an element's markup: this page holds a live charger control.

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function skeleton(height) {
  const block = h('div', 'skeleton');
  block.style.height = height; // the stylesheet deliberately has no height; an attribute would be blocked
  return block;
}

// ── Two panels are mounted `--flush` (zero body padding) so their tables can run edge to
// edge. The views already read that off the DOM and inset their own non-table blocks; the
// shell never did, so its own chrome -- the skeleton, the error card and the stale rule --
// sat hard against the panel border in `#history` and `#account` and nowhere else. Only
// visible with all five panels up: the two flush panels are the last two data panels, and
// no wave-2 agent ever had them and the shell's chrome on screen at once.
//
// Measured at 1440x900: the error card was inset 16px inside `#tariff` and 0px inside
// `#history`, where its rounded border landed on the panel's own; the stale rule pushed the
// full-bleed table 15px right while leaving its right edge flush.
const FLUSH = '.panel__body--flush';

// Put one of the shell's own blocks into a panel body, inset to match a padded panel.
function placeOwn(body, node) {
  if (body.matches(FLUSH)) node.style.setProperty('margin', 'var(--sp-4)');
  body.replaceChildren(node);
}

// Two hints, and they must never merge back into one. A transport failure is worth retrying and
// the refresh button is how; a sign-in that has ended is not, and pressing refresh is provably
// the one action that cannot mend it. Only a top-level navigation can, because only that can
// follow the edge's redirect to the sign-in page.
const RETRY_HINT = 'לחצו רענון כדי לנסות שוב.';
// Reachable only in the compound case: signed out, with data already on screen, in a panel that
// never managed to mount. It points at the card rather than repeating its instructions, and it
// must not say "reload" -- a reload of a signed-out page lands on the same card, one press
// further from a session than the viewer already is.
const SIGN_IN_HINT = 'ההתחברות הסתיימה. בקשו קישור כניסה חדש בכרטיס שלמעלה.';

function errorBlock(title, hint) {
  const box = h('div', 'empty empty--error');
  box.append(
    h('div', 'empty__icon', '⚠'),
    h('p', 'empty__title', title),
    h('p', 'empty__hint', hint)
  );
  return box;
}

// The only place that chooses between the two. A panel that has never mounted says why it is
// empty; which of the two reasons it gives is the last round's verdict, never a guess.
function panelError(view) {
  return errorBlock(view.fail, shared.authRequired ? SIGN_IN_HINT : RETRY_HINT);
}

// "לפני 42 דקות", "לפני 3 שעות", "לפני יומיים" — computed at render time, never on a schedule.
// The phrase carries its own "ago", so nothing appends a word to it: Hebrew puts that at the
// front, and Intl is the only thing here that knows the plural and dual forms.
function currentAge() {
  return shared.fetchedAt == null ? null : relative(shared.fetchedAt - Date.now());
}

// ── Header: absolute time *and* relative age, always both ──

const updated = document.querySelector('.updated');
const button = document.getElementById('refresh');

function paintUpdated() {
  const abs = updated.querySelector('.updated__abs');
  const rel = updated.querySelector('.updated__age');

  if (shared.fetchedAt == null) {
    abs.textContent = 'אין עדיין נתונים';
    rel.textContent = '—';
    updated.dataset.age = 'fresh';
    return;
  }

  abs.textContent = dateTime(shared.fetchedAt);
  rel.textContent = currentAge();
  // Display only: past the cache horizon the age pill turns amber. It does not trigger a fetch.
  updated.dataset.age = Date.now() - shared.fetchedAt > HOUR_MS ? 'old' : 'fresh';
}

// ── Refresh — the only user-initiated fetch ──

let refreshing = false;

function setBusy(on) {
  button.classList.toggle('is-busy', on);
  button.disabled = on;
  button.setAttribute('aria-busy', String(on));
  button.textContent = on ? 'מרענן…' : '↻ רענון';
}

async function onRefresh() {
  if (refreshing) return; // an in-flight guard is one boolean, not a layer
  refreshing = true;
  setBusy(true);
  await load(true);
  setBusy(false);
  refreshing = false;
}

button.addEventListener('click', onRefresh);

// ── Painting a panel ──

// The view's own element is created once and never discarded: the stale chrome is built around
// it, so marking data stale costs a view nothing and cannot blank it.
//
// Only a panel fed by a cached route wears the marker. The comment board reads its own rows
// live on every call, so flagging it with the charging data's age would be a lie.
function frame(body, mount, view) {
  if (!shared.stale || !view.needs) {
    body.replaceChildren(mount);
    return;
  }
  const wrap = h('div', 'stale'); // amber rule down the edge; deliberately does not dim, the
  const flag = h('span', 'stale__flag', 'לא עדכני — '); // cached data is the only data there is
  const age = currentAge();
  flag.append(h('span', 'stale__age', age || 'גיל לא ידוע'));
  // In a flush panel the rule *is* the edge: keeping `.stale`'s inset would indent a
  // full-bleed table on its left only. The flag keeps an inset of its own so the pill is
  // not jammed against the rule.
  if (body.matches(FLUSH)) {
    wrap.style.setProperty('padding-inline-start', '0');
    flag.style.setProperty('margin-inline-start', 'var(--sp-4)');
  }
  wrap.append(flag, mount);
  body.replaceChildren(wrap);
}

// ponytail: dynamic import per panel so a missing or broken view costs one panel, not the page
async function paint(view) {
  const body = document.getElementById(view.id);

  // Never loaded. On a first load that failed there is no existing DOM to preserve, so the
  // panel says so; once a view has mounted, a later failure leaves its subtree untouched.
  if (view.needs && shared[view.needs] == null) {
    if (!view.mounted) placeOwn(body, panelError(view));
    return;
  }

  try {
    const mod = (view.mod ??= import(view.src));
    const { render } = await mod;
    view.el ??= document.createElement('div');
    frame(body, view.el, view);
    render(view.el, shared, ctx);
    view.mounted = true;
  } catch {
    view.mod = null; // drop the rejected promise so a later reload gets another chance
    if (!view.mounted) placeOwn(body, panelError(view));
  }
}

// ── Expiry banner lifecycle ──
//
// This module owns the flag; views/controls.js owns the markup. renderExpiry is called on every
// pass, in both directions, because leaving the state is what removes the .expiry block and the
// credential field from the DOM -- they are created and removed, never hidden.
async function paintExpiry() {
  const mount = document.getElementById('expiry');
  try {
    const mod = (controls.mod ??= import(controls.src));
    const { renderExpiry } = await mod;
    renderExpiry(mount, shared, ctx);
  } catch {
    controls.mod = null;
    mount.replaceChildren(); // no banner beats a banner we cannot take down again
  }
}

// ── The sign-in screen's mount ──
//
// The panels alone cannot carry this. A viewer whose session ends mid-visit has every panel
// already mounted, so a failed round leaves their subtrees untouched and the only thing that
// changes is the amber stale rule -- which is exactly what an unplugged cable does too. Without
// a card of its own, "signed out" and "offline" are the same picture.
//
// ONE MOUNT, TWO SHAPES OF PAGE UNDER IT. The card is always the first child of <main>, so it
// inherits the page's own padding and measure and needs no rule of its own. What differs is
// what sits beneath it:
//
//   cold and signed out (nothing has ever arrived) -- the five panels behind the menu would be five
//     copies of one message, and the owner asked for a message and a button. They are detached
//     as a set and the card is the page.
//   signed out mid-visit -- the panels hold the last good round, and blanking data on a failed
//     round is the one thing this shell never does. The card goes above them and they stay.
//
// `.view` sections, detached and reattached whole: their subtrees -- the panels and everything
// a view module mounted inside them -- come with them, so a view keeps its DOM and app.js keeps
// its element references across the round trip. Toggled on a change of state rather than every
// pass -- re-parenting a section on every refresh press would blur a half-typed note in
// #comments.
const main = document.querySelector('.shell__main');
const panels = [...main.children];
const authMount = h('div');
main.replaceChildren(authMount, ...panels);

let panelsDetached = false;

function paintAuthRequired() {
  const cold = shared.authRequired && shared.fetchedAt == null;
  if (cold !== panelsDetached) {
    main.replaceChildren(authMount, ...(cold ? [] : panels));
    panelsDetached = cold;
    // The menu goes with them, and is hidden rather than emptied. A rail offering four
    // destinations that are all detached from the document is worse than no rail: every item
    // leads to a blank page with the one card that matters now scrolled off the top of it.
    // Hiding the rail is also what gives <body> its gutter back -- see `.nav[hidden] ~ .shell`.
    nav.hidden = cold;
    navToggle.hidden = cold;
    if (cold) drawer(false);
  }
  // views/auth.js creates and removes the card itself, for the same reason the credential field
  // is created and removed: a sign-in control left hidden in the DOM of a signed-in page is a
  // control somebody eventually finds.
  renderAuth(authMount, shared);
}

// ── The fetch round ──

// `force` is the ONLY way anything on this page bypasses the server's age rule, and it is passed
// by a press: the refresh button, or a view whose command has just changed the charger. A load
// passes nothing, so the hour rule stands where the invocation budget depends on it.
//
// refresh() forces the fetch and writes the rows; the three reads below then get what it wrote.
// Three extra D1 reads per press, and no guess about the refresh body's shape.
async function load(force) {
  if (force) await refresh();
  const [state, history, invoices] = await Promise.all([getState(), getHistory(), getInvoices()]);
  const results = { state, history, invoices };

  let stale = false;
  let expired = false;
  let authRequired = false;

  for (const [key, result] of Object.entries(results)) {
    // An expired credential is not a failed read, and this is the round that proves it. The
    // server answers 503 with its own last cached row riding along -- the same bytes the happy
    // path returns, flagged stale and carrying the row's ORIGINAL fetchedAt -- so the page can
    // keep showing data under the banner. Discarding it is what turned a first load during
    // expiry into five generic error cards, and that load is the likely one: the owner opens
    // the dashboard *because* they were told the credential expired.
    //
    // Taken only when the row is really there. An empty cache answers with the error alone, and
    // a body with no fetchedAt is a body with nothing in it: adopting that would mount every
    // view over an object with no charger, no sessions and no calendar, and the panels would
    // paint an invented "nothing plugged in" where the truth is "nothing has ever arrived".
    const carried =
      result.error === TOKEN_EXPIRED && result.data && typeof result.fetchedAt === 'number';
    if (result.ok || carried) {
      shared[key] = result.data;
      fetchedAt[key] = result.fetchedAt;
    }
    // A failed call means what is already on screen is the freshest thing there is.
    if (!result.ok || result.stale) stale = true;
    if (result.error === TOKEN_EXPIRED) expired = true;
    // 'auth_required' is api.js's name for the edge bouncing us to a sign-in. One route saying
    // it is enough: the gate is over the whole hostname, so it is true of all of them.
    if (result.error === 'auth_required') authRequired = true;
  }

  // The age of the *oldest* thing on screen, not the freshest — the header should not claim a
  // panel is current because some other route happened to succeed.
  const times = Object.values(fetchedAt).filter((time) => typeof time === 'number');
  shared.fetchedAt = times.length ? Math.min(...times) : null;
  // Nothing ever arrived means there is nothing to be stale about; the panels say so themselves.
  shared.stale = stale && shared.fetchedAt != null;
  shared.expired = expired;
  shared.authRequired = authRequired;

  paintUpdated();
  paintAuthRequired();
  // Nothing under the card to paint, and nothing worth fetching to paint it with: the panels
  // are detached, #comments would spend a round learning it is signed out too, and the
  // credential banner would pull a view module down to be told there is no credential problem.
  // The 401 is the only thing this page knows and the card is the whole of what it can say.
  if (panelsDetached) return;
  await Promise.all([...views.map(paint), paintExpiry()]);
}

// ── The menu: four views, one hash router ──
//
// The pattern is `trips/italy-2026/trip.js`, which is the precedent the owner named -- "the
// same way it was implemented in the travel webpages (either history and routing)". Same three
// parts: one `.view` section per destination, exactly one wearing `.is-active`, and
// `location.hash` as the only thing that decides which. Two deliberate departures, both
// corrections rather than taste:
//
//   - the menu items are real `<a href="#/name">`, where the travel page uses `<a data-view>`
//     with a click handler and no href. The browser is then the router: it writes the history
//     entry, so Back and Forward are correct and every view is deep-linkable, and the item
//     stays keyboard-focusable and middle-clickable, which an href-less <a> is not. Nothing
//     here calls preventDefault and nothing here assigns to location.hash.
//   - the routes carry a leading slash. Two panel bodies are id="history" and id="comments",
//     so a bare `#history` is a fragment that RESOLVES -- the browser scrolls that panel into
//     view before this ever runs. `#/history` names no element and cannot start to. The slash
//     is optional on the way in, so a bookmark of the slashless form still lands.
//   - no scroll memory. The travel page stamps every history entry with a scroll offset
//     because its views run for metres; these are one or two panels each, and a restored
//     offset would be the wrong answer more often than the right one.
//
// NOTHING IN HERE FETCHES, and that is structural rather than careful. All four views are
// mounted and repainted by the same `load()` round, so a menu press moves a class over DOM that
// is already holding its data. A view that fetched on entry would put an upstream call behind
// every menu press, which is the invocation budget the whole one-hour cache rule protects.
// `test/nav.test.mjs` asserts the absence of the call rather than trusting this paragraph.
const VIEWS = ['status', 'history', 'invoices', 'comments'];
const nav = document.getElementById('nav');
const navToggle = document.getElementById('navtoggle');

let navOpen = false;
let shownView = null;

// Under 900px the rail is an off-canvas drawer and this class is what slides it in. Above it
// the rail is always on screen and the class is inert. The scrim is styled off
// `.nav.is-open ~ .navscrim`, so one class moves both halves.
function drawer(open) {
  navOpen = open;
  nav.classList.toggle('is-open', open);
  navToggle.setAttribute('aria-expanded', String(open));
}

function route() {
  const name = String(location.hash || '').replace(/^#\/?/, '');
  // An unknown or absent hash is the status view. A deep link that has gone stale lands on
  // what the owner wanted to see anyway, rather than on a blank page.
  const view = VIEWS.includes(name) ? name : VIEWS[0];
  drawer(false);
  if (view === shownView) return;
  shownView = view;
  for (const id of VIEWS) {
    document.getElementById('view-' + id).classList.toggle('is-active', id === view);
    const link = document.getElementById('nav-' + id);
    // aria-current is both the announcement and the styling hook -- one source of truth, so
    // the highlighted item and the announced one cannot drift apart.
    if (id === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}

navToggle.addEventListener('click', () => drawer(!navOpen));
document.getElementById('navscrim').addEventListener('click', () => drawer(false));
// Closes the drawer on the press that navigates. `route()` closes it too, but only when the
// hash actually changes -- pressing the item that is already open fires no hashchange.
nav.addEventListener('click', () => drawer(false));
window.addEventListener('hashchange', route);
route();

// ── Bootstrap ──

for (const view of views) {
  placeOwn(document.getElementById(view.id), skeleton(view.skel));
}

load();

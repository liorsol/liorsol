// ── Bootstrap, fetching, view mounting, shared state ──
//
// This file is the only thing on the page that fetches, the only writer of the shared state
// object, and the only owner of the stale marker and the expiry banner's lifecycle. Views are
// pure painters: they are handed data that already arrived and they never see a failure.
//
// NO AUTOMATIC REFRESH. Upstream is touched in exactly two situations, and the server owns both
// decisions: a page load whose cached data the server judges older than an hour, and the refresh
// button. There is no polling, no interval timer, no retry after a failure, no revalidation when
// the tab is shown again or the network returns, and no background worker. A page left open all
// day makes zero upstream calls -- that is a free-tier invocation budget requirement, not an
// optimisation, and `test/settle.test.mjs` asserts the absence rather than trusting this comment.
//
// The page also never decides *whether* to fetch from the age of the data it holds. The one-hour
// rule lives server-side so it survives a hard reload with browser storage cleared; a copy here
// would re-break the invocation budget. Age is rendered, never acted on.

import { getState, getHistory, getInvoices, refresh, TOKEN_EXPIRED } from './api.js';

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
  fetchedAt: null,
  stale: false,
};

// What views get as their third argument. reload() re-fetches all three routes and repaints
// every view; a view calls it after a mutating action.
const ctx = { reload: () => load() };

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
  { id: 'tariff', src: './views/tariff.js', needs: 'state', skel: '88px', fail: 'Could not load the tariff' },
  { id: 'controls', src: './views/controls.js', needs: 'state', skel: '88px', fail: 'Could not load the controls' },
  { id: 'history', src: './views/history.js', needs: 'history', skel: '180px', fail: 'Could not load sessions' },
  { id: 'account', src: './views/account.js', needs: 'state', skel: '140px', fail: 'Could not load the charger' },
  // The comment board fetches its own data and owns its own empty states, so nothing gates it.
  { id: 'comments', src: './views/comments.js', needs: null, skel: '120px', fail: 'Could not load notes' },
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

function errorBlock(title) {
  const box = h('div', 'empty empty--error');
  box.append(
    h('div', 'empty__icon', '⚠'),
    h('p', 'empty__title', title),
    h('p', 'empty__hint', 'Press refresh to try again.')
  );
  return box;
}

// "42 min", "3 h", "2 d" — computed at render time, never on a schedule.
function ageText(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return minutes + ' min';
  const hours = Math.round(minutes / 60);
  return hours < 48 ? hours + ' h' : Math.round(hours / 24) + ' d';
}

function currentAge() {
  return shared.fetchedAt == null ? null : ageText(Date.now() - shared.fetchedAt);
}

// ── Header: absolute time *and* relative age, always both ──

const updated = document.querySelector('.updated');
const button = document.getElementById('refresh');

function paintUpdated() {
  const abs = updated.querySelector('.updated__abs');
  const rel = updated.querySelector('.updated__age');

  if (shared.fetchedAt == null) {
    abs.textContent = 'No data yet';
    rel.textContent = '—';
    updated.dataset.age = 'fresh';
    return;
  }

  abs.textContent = new Date(shared.fetchedAt).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  rel.textContent = currentAge() + ' ago';
  // Display only: past the cache horizon the age pill turns amber. It does not trigger a fetch.
  updated.dataset.age = Date.now() - shared.fetchedAt > HOUR_MS ? 'old' : 'fresh';
}

// ── Refresh — the only user-initiated fetch ──

let refreshing = false;

function setBusy(on) {
  button.classList.toggle('is-busy', on);
  button.disabled = on;
  button.setAttribute('aria-busy', String(on));
  button.textContent = on ? 'Refreshing…' : '↻ Refresh';
}

async function onRefresh() {
  if (refreshing) return; // an in-flight guard is one boolean, not a layer
  refreshing = true;
  setBusy(true);
  // refresh() forces the upstream fetch regardless of cache age; the reload then reads the rows
  // it just wrote. Three extra D1 reads per press, and no guess about the refresh body's shape.
  await refresh();
  await load();
  setBusy(false);
  refreshing = false;
}

button.addEventListener('click', onRefresh);

// ── Painting a panel ──

// The view's own element is created once and never discarded: the stale chrome is built around
// it, so marking data stale costs a view nothing and cannot blank it.
function frame(body, mount) {
  if (!shared.stale) {
    body.replaceChildren(mount);
    return;
  }
  const wrap = h('div', 'stale'); // amber rule down the edge; deliberately does not dim, the
  const flag = h('span', 'stale__flag', 'Stale — '); // cached data is the only data there is
  flag.append(h('span', 'stale__age', (currentAge() ?? 'unknown age') + ' old'));
  wrap.append(flag, mount);
  body.replaceChildren(wrap);
}

// ponytail: dynamic import per panel so a missing or broken view costs one panel, not the page
async function paint(view) {
  const body = document.getElementById(view.id);

  // Never loaded. On a first load that failed there is no existing DOM to preserve, so the
  // panel says so; once a view has mounted, a later failure leaves its subtree untouched.
  if (view.needs && shared[view.needs] == null) {
    if (!view.mounted) body.replaceChildren(errorBlock(view.fail));
    return;
  }

  try {
    const mod = (view.mod ??= import(view.src));
    const { render } = await mod;
    view.el ??= document.createElement('div');
    frame(body, view.el);
    render(view.el, shared, ctx);
    view.mounted = true;
  } catch {
    view.mod = null; // drop the rejected promise so a later reload gets another chance
    if (!view.mounted) body.replaceChildren(errorBlock(view.fail));
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

// ── The fetch round ──

async function load() {
  const [state, history, invoices] = await Promise.all([getState(), getHistory(), getInvoices()]);
  const results = { state, history, invoices };

  let stale = false;
  let expired = false;

  for (const [key, result] of Object.entries(results)) {
    if (result.ok) {
      shared[key] = result.data;
      fetchedAt[key] = result.fetchedAt;
    }
    // A failed call means what is already on screen is the freshest thing there is.
    if (!result.ok || result.stale) stale = true;
    if (result.error === TOKEN_EXPIRED) expired = true;
  }

  const times = Object.values(fetchedAt).filter((time) => typeof time === 'number');
  shared.fetchedAt = times.length ? Math.min(...times) : null;
  shared.stale = stale;
  shared.expired = expired;

  paintUpdated();
  await Promise.all([...views.map(paint), paintExpiry()]);
}

// ── Bootstrap ──

for (const view of views) {
  document.getElementById(view.id).replaceChildren(skeleton(view.skel));
}

load();

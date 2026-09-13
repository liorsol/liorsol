// ── theme.js — which stylesheet the page is wearing ──
//
// Six looks, one app. `style.css` is the base every theme wears; `themes/<slug>.css` is the
// look. `classic` is today's design and it is the default on a browser that has never chosen:
// it is the known-good state and the way back from a theme that turns out unreadable in a dim
// garage. It is never removed from the switcher.
//
// THIS MODULE IS LOADED BEFORE app.js AND BOOTS ITSELF. index.html carries two <script
// type="module"> tags, this one first. It has no imports of its own, so it evaluates as soon as
// it arrives — while app.js is still pulling api.js, views/he.js and views/auth.js. That is the
// whole reason it is a separate tag rather than an import inside app.js: it shortens the one
// unavoidable flash below by a round trip of app.js's module graph.
//
// THE FLASH IS REAL AND IT IS NOT A BUG TO CHASE. The shipped CSP is `script-src 'self';
// style-src 'self'` — an inline <script> and an inline <style> are both refused, SILENTLY, and
// read as a layout bug rather than as an error. So there is no way to stamp the chosen theme on
// <html> before a script runs, and no way to inline the chosen sheet. The page therefore paints
// `classic` (linked in the markup) and swaps to the chosen theme a moment later. Do not "fix"
// this with an inline script; the fix is that the moment is short and that the thing shown in
// it is the known-good design rather than nothing.
//
// SWITCHING IS A TOGGLE, NOT A FETCH. Every theme gets its own <link>, created the first time
// it is chosen and never removed. Turning a theme off is `link.disabled = true`, which leaves
// the sheet parsed and in memory; turning it back on is `false`. After the first visit to a
// theme there is no request, no re-parse and no flash of unstyled content. Swapping one link's
// `href` would refetch and repaint through an unstyled frame every time.
//
// NOTHING HERE FETCHES DATA. A theme change touches <link> elements, one localStorage key and
// the DOM already on screen. It never calls `load()`, never forces a refresh, and never reaches
// `/api/*` — `test/theme.test.mjs` counts `fetch` across a change, for the same reason
// `test/nav.test.mjs` counts it across a menu press.
//
// EVERY localStorage ACCESS IS WRAPPED. A private window, a browser set to block site data and
// a storage quota failure all THROW on the property access itself, not on the call — so the
// guard has to be around the whole expression. A page that cannot read its stored choice
// renders `classic`; a page that cannot write one keeps the choice for this tab and forgets it
// on reload. Neither is an error state and neither is reported as one.

// The slug is the value of `data-theme` on <html>, the basename of the sheet, and the value of
// the <option>. One spelling, three uses, so a theme cannot half-exist.
const THEMES = [
  ['classic', 'קלאסי'],
  ['gauge', 'מחוגים'],
  ['terminal', 'טרמינל'],
  ['editorial', 'עיתון'],
  ['native', 'מערכת'],
  ['switch', 'מתג'],
];

export const DEFAULT_THEME = 'classic';
export const SLUGS = THEMES.map(([slug]) => slug);

// Namespaced, because this origin is shared with nothing but it costs nothing to say so.
const KEY = 'car-charging.theme';

// ── storage: both directions, both guarded ──

function stored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // Private window, blocked site data, or no storage at all. The default is the answer.
    return null;
  }
}

function remember(slug) {
  try {
    localStorage.setItem(KEY, slug);
  } catch {
    // The choice still applies to this tab. It is simply not remembered, which is the honest
    // outcome in a window that has no storage, and it is not worth a message on screen.
  }
}

// ── the sheets ──

// Seeded from the markup, so the `classic` <link> that painted the first frame is the same
// element this module later disables. A second `classic` link would leave both sheets live.
const links = new Map();

// Which sheets have actually been fetched and parsed at least once.
//
// MEASURED, and it is why this set exists rather than a read of `link.sheet`: disabling a
// <link rel="stylesheet"> sets its `.sheet` to null in Chromium — the sheet leaves
// document.styleSheets — so `link.sheet` says "never loaded" about every theme the viewer has
// already worn and switched away from. Probing it made every switch BACK take the slow path,
// and since the load event does not fire again for a sheet served from memory, the outgoing
// sheet was never dropped: two sheets stayed live and the one later in <head> kept winning.
// Remembering it here is one Set and cannot go stale in the other direction.
const ready = new Set();

function adopt(link, slug) {
  links.set(slug, link);
  // A markup <link> has already loaded by the time a module script runs — a stylesheet blocks
  // execution of any script after it — but check rather than assume.
  if (link.sheet) ready.add(slug);
  link.addEventListener('load', () => {
    ready.add(slug);
    // `active === slug` again: a viewer who flips twice before the first sheet lands must not
    // have the slow one win when it finally arrives.
    if (active === slug) only(slug);
  });
}

for (const link of document.querySelectorAll('link[data-theme]')) adopt(link, link.dataset.theme);

function sheet(slug) {
  let link = links.get(slug);
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'themes/' + slug + '.css';
    link.dataset.theme = slug;
    adopt(link, slug);
    document.head.append(link);
  }
  return link;
}

let active = DEFAULT_THEME;

/** The slug the page is wearing. */
export const currentTheme = () => active;

/** Exactly one sheet live, and it is this one. */
function only(name) {
  for (const [other, link] of links) link.disabled = other !== name;
}

/**
 * Wear `slug`. An unrecognised value — a hand-edited storage key, a theme that was renamed,
 * a stale bookmark of a choice — falls back to `classic` rather than leaving the page with a
 * `data-theme` no sheet matches and no theme sheet enabled at all.
 *
 * THE OUTGOING SHEET IS NOT DROPPED UNTIL THE INCOMING ONE IS REALLY THERE. A sheet being
 * chosen for the first time has to be fetched, and turning the old one off first would leave
 * the page wearing `style.css` alone for a network round trip — which has no colour, no border
 * and no type size in it. That is an unstyled frame on the first switch to each theme, and
 * avoiding it is the entire reason this mechanism toggles <link> elements instead of swapping
 * one href. Every switch after the first is synchronous, because `ready` remembers.
 *
 * While both are live the incoming one wins: it is appended after the markup's own sheet, so
 * it is later in the cascade at equal specificity.
 *
 * If the incoming sheet never arrives — a 404, a theme file that was never written — `load`
 * never fires, the outgoing sheet stays on, and the page keeps the look it had. A readable
 * page under the wrong `data-theme` beats an unstyled one under the right one.
 */
export function apply(slug) {
  const name = SLUGS.includes(slug) ? slug : DEFAULT_THEME;
  sheet(name).disabled = false;
  document.documentElement.dataset.theme = name;
  active = name;
  if (ready.has(name)) only(name);   // otherwise the load handler in adopt() does it
  return name;
}

// ── the per-view render seam ──
//
// Three of the six designs render the SAME tariff data in a genuinely different shape: a radial
// dial, a stepped 24-hour chart, a typographic timetable. CSS cannot turn a row of absolutely
// positioned slices into a table, so a theme may replace a panel's renderer outright.
//
// This is presentational and it touches no command path. A theme supplies
// `themes/<slug>.js` exporting `views`, an object keyed by the PANEL ID (the same ids
// `index.html` gives the panel bodies and `app.js` keys its view table on).
//
// The module is imported once, the first time its theme is worn, and the module registry keeps
// it — so switching away and back costs nothing. A theme that replaces no view should still
// ship the file with `export const views = {};`: its absence is tolerated (one 404 on a static
// asset, no Function invocation) but shipping it makes that request not happen.
const modules = new Map();

async function viewsOf(slug) {
  if (modules.has(slug)) return modules.get(slug);
  let views = null;
  try {
    views = (await import('./themes/' + slug + '.js')).views ?? null;
  } catch {
    // No module, or a broken one. A theme that replaces nothing is the normal case, and a
    // theme whose module fails to parse falls back to the base views rather than to a blank
    // page — the same ruling app.js makes for a broken view module.
    views = null;
  }
  modules.set(slug, views);
  return views;
}

/** The active theme's replacement renderer for a panel, or null. */
export async function themeView(id) {
  const views = await viewsOf(active);
  const custom = views?.[id];
  return typeof custom === 'function' ? custom : null;
}

// ── the switcher ──
//
// A real <select>. It is the native control, so it is keyboard- and screen-reader-correct with
// no work, it opens as a wheel on a phone and a menu on a laptop, and it costs nothing.
//
// IT LIVES IN THE HEADER, NOT IN THE MENU, AND THAT IS A RECOVERY PROPERTY RATHER THAN A
// LAYOUT PREFERENCE. app.js hides the rail and its handle on a signed-out page, so a switcher
// inside the menu is unreachable in the one state a viewer would most need it: a theme that
// renders the sign-in card unreadable would leave them unable to switch away AND unable to
// sign in, with clearing site data as the only way back. `paintAuthRequired()` touches
// <main>'s children, `nav.hidden` and `navtoggle.hidden` and nothing else, so the header --
// and this control -- survives every state the page has.
//
// Its class is `.themeswitch`, parent-neutral on purpose: a theme styles it by that class and
// never through an ancestor, so it can be moved again without breaking a sheet.

/**
 * Fill and wire the switcher. `repaint` is called after a change; it must repaint what is
 * already on screen and must not fetch.
 */
export function mountSwitcher(el, repaint) {
  if (!el) return;
  for (const [slug, label] of THEMES) {
    const option = document.createElement('option');
    option.value = slug;
    option.textContent = label;
    el.append(option);
  }
  el.value = active;

  el.addEventListener('change', async () => {
    remember(apply(el.value));
    await repaint();
  });
}

// ── boot ──
//
// Runs on import, before app.js has evaluated. Everything above is pure; this line is the only
// side effect, and it is the one that has to happen as early as the CSP allows.
apply(stored());

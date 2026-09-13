// Run: node --test car-charging/test/theme.test.mjs
//
// The theme layer, and the contract five theme sheets are written against.
//
// Two halves, and the second one is the point of the file.
//
// ── half one: the mechanism ──
//
// Four properties, each of which fails SILENTLY in a browser if it breaks, which is why none of
// them is left to a reading of the source:
//
//   · an unrecognised stored value falls back to `classic`. A theme that was renamed, a
//     hand-edited storage key or a bookmark of a choice that no longer exists must not leave
//     the page wearing a `data-theme` no sheet matches and NO theme sheet enabled -- which is
//     the base sheet alone: legible, and completely unstyled.
//   · every localStorage access is guarded. A private window and a browser set to block site
//     data both THROW on the property access itself, and an unguarded read takes the page down
//     on the one line that was only ever meant to remember a preference.
//   · a theme change fetches nothing. The same budget requirement `test/nav.test.mjs` counts
//     across a menu press: a page left open all day makes zero upstream calls, and a switcher
//     that reloaded the data would put a round trip behind a cosmetic control.
//   · switching is a toggle, not a refetch. One <link> per theme, created once and thereafter
//     turned on and off, so the second visit to a theme costs no request and shows no flash of
//     unstyled content. Counted here as "the number of link elements did not grow".
//
// ── half two: the contract ──
//
// THEMES.md is written for five agents building five themes in parallel, none of them reading
// the others' work. The failure it exists to prevent is the one that cannot be seen from the
// screen the theme was designed on: a sheet that styles the status view beautifully and leaves
// `#/history`, `#/comments`, `#/sessions` or the sign-in card wearing nothing at all, because
// its own sheet is the only theme sheet enabled and classic's is disabled.
//
// So every theme sheet in `themes/` is linted against the component vocabulary the seven views
// actually paint. A component whose renderer the theme REPLACES is waived -- a radial dial has
// no `.tariff__band` and should not be made to pretend otherwise -- and that waiver is read off
// the theme's own module rather than from a list kept here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { installDocument, installStorage, all, text } from './fake-dom.mjs';

const dom = installDocument();
const store = installStorage('ok');

// ── the stub transport ──

const AT = Date.now() - 5 * 60000;

const BODIES = {
  '/api/state': {
    fetchedAt: AT,
    stale: false,
    charger: { offPeakState: 'Off', connectors: [{ connectorId: 1, status: 'Charging' }] },
    pricingSlices: [
      { name: 'cheap', price: 0.45, vat: 18, from: '2026-09-11T00:00:00Z', to: '2026-09-11T17:00:00Z' },
      { name: 'peak', price: 1.26, vat: 18, from: '2026-09-11T17:00:00Z', to: '2026-09-11T22:00:00Z' },
    ],
    sessions: [],
  },
  '/api/history': { fetchedAt: AT, stale: false, sessions: [], totals: { count: 0 } },
  '/api/invoices': { fetchedAt: AT, stale: false, invoices: [] },
  '/api/comments': { comments: [] },
  '/api/sessions': {
    sessions: [{ jti: 'a', createdAt: AT, lastSeen: AT, userAgent: 'Mozilla/5.0 (iPhone)', location: 'IL', current: true }],
  },
  '/api/contact': { contact: { name: 'PLACEHOLDER' } },
};

let signedIn = false;
let calls = 0;

globalThis.fetch = async (path) => {
  calls += 1;
  if (!signedIn) return Response.json({ error: 'no_session' }, { status: 401 });
  return Response.json(BODIES[String(path).split('?')[0]] ?? { ok: true });
};

async function until(predicate, what) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('timed out waiting for ' + what);
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

// app.js bootstraps on import, and importing it also evaluates theme.js -- exactly as the two
// <script type="module"> tags in index.html do, in the same order.
await import('../app.js');

const html = () => dom.documentElement;
const sheets = () => dom.head.children.filter((child) => child.dataset?.theme);
const enabled = () => sheets().filter((link) => !link.disabled).map((link) => link.dataset.theme);
const select = () => dom.get('#theme-select');
const panel = (id) => dom.get('#' + id);
const refresh = () => dom.get('#refresh');

// A browser fires `load` on a <link> once its sheet is fetched and parsed, and sets `.sheet`.
// theme.js waits for that before dropping the outgoing sheet, so the test has to deliver it --
// and delivering it explicitly is what makes the window before it assertable.
function deliver() {
  for (const link of dom.head.children) {
    if (!link.dataset?.theme || link.sheet) continue;
    link.sheet = {};
    link.handlers?.load?.();
  }
}

async function choose(slug) {
  select().value = slug;
  await select().handlers.change();
  deliver();
}

// ── the mechanism ──

test('a browser that has never chosen wears classic', async () => {
  await until(() => text(dom.get('.shell__main').children[0]).length > 0, 'the first round to paint');

  assert.equal(html().dataset.theme, 'classic', 'the default was not the known-good design');
  assert.deepEqual(enabled(), ['classic'], 'the wrong set of sheets was live on a cold browser');
});

test('the switcher offers every theme, classic among them, at a real target size', () => {
  const labels = select().children.map((option) => option.value);
  assert.ok(labels.includes('classic'), 'classic must stay offered: it is the way back');
  assert.equal(new Set(labels).size, labels.length, 'a slug is listed twice');
  assert.equal(select().value, 'classic', 'the control did not show what the page is wearing');
  // The 44px floor is CSS, not JS, so it is asserted where it lives.
  const sheet = readFileSync(new URL('../themes/classic.css', import.meta.url), 'utf8');
  assert.match(sheet, /\.themeswitch__select\s*\{[^}]*min-height:\s*var\(--tap\)/,
    'the switcher dropped below the minimum touch target');
});

// The switcher is the way back from a theme that turns out unreadable, so it has to survive
// the state a viewer would be stuck in: signed out, with every `.view` detached and the menu
// hidden. It lives in the header for that reason and for no other, and the header is the one
// region `paintAuthRequired()` never touches.
test('the switcher is in the header, not in the menu that a signed-out page hides', () => {
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const header = markup.slice(markup.indexOf('shell__header-inner'), markup.indexOf('</header>'));
  const nav = markup.slice(markup.indexOf('<nav'), markup.indexOf('</nav>'));
  assert.match(header, /id="theme-select"/, 'the switcher left the header, where it is always reachable');
  assert.doesNotMatch(nav, /theme-select/, 'the switcher moved into the menu, which is hidden on a signed-out page');
});

test('a theme change fetches nothing and does not reload', async () => {
  signedIn = true;
  await refresh().handlers.click();
  await settled();

  const before = calls;
  await choose('terminal');
  await choose('editorial');
  await choose('classic');
  await settled();

  assert.equal(calls, before, 'a theme change reached upstream');
});

// The first switch to a theme has to fetch its sheet. Dropping the outgoing one first would
// leave the page wearing style.css alone for that round trip -- no colour, no border, no type
// size -- which is an unstyled frame, and avoiding it is the whole reason this toggles <link>
// elements instead of swapping one href.
test('the outgoing sheet stays up until the incoming one has really loaded', async () => {
  select().value = 'gauge';
  await select().handlers.change();          // deliberately NOT delivered yet

  assert.deepEqual(enabled(), ['classic', 'gauge'], 'the page was left with no theme sheet at all while one loaded');
  assert.equal(html().dataset.theme, 'gauge', 'the chosen theme was not recorded until its sheet landed');

  deliver();
  assert.deepEqual(enabled(), ['gauge'], 'the outgoing sheet stayed up after the incoming one loaded');
  await choose('classic');
});

test('switching is a toggle: one sheet per theme, created once, never refetched', async () => {
  await choose('terminal');
  assert.equal(html().dataset.theme, 'terminal');
  assert.deepEqual(enabled(), ['terminal'], 'two theme sheets were live at once');

  const count = sheets().length;
  await choose('classic');
  await choose('terminal');
  await choose('classic');

  assert.equal(sheets().length, count, 'a second <link> was created for a theme already loaded');
  assert.deepEqual(enabled(), ['classic']);
});

test('the choice is remembered', async () => {
  await choose('native');
  assert.equal(store.get('car-charging.theme'), 'native');
  await choose('classic');
  assert.equal(store.get('car-charging.theme'), 'classic');
});

// Every view, not just the one on screen: a theme change must leave all seven panels holding
// their data. The failure this guards is a repaint that blanks the six views the viewer cannot
// see, which nobody notices until they press a menu item.
const PANELS = ['tariff', 'controls', 'history', 'account', 'comments', 'sessions', 'contact'];

test('a theme change leaves every view holding its data', async () => {
  await choose('terminal');
  await settled();
  for (const id of PANELS) {
    assert.match(text(panel(id)), /\S/, `#${id} was blanked by a theme change`);
  }
  await choose('classic');
  await settled();
  for (const id of PANELS) {
    assert.match(text(panel(id)), /\S/, `#${id} was blanked switching back`);
  }
});

// ── storage: every access guarded, in both directions ──
//
// Each case gets its own module instance through a query string, because theme.js reads the
// stored value once, at boot -- which is the moment being tested.

test('an unrecognised stored theme falls back to classic rather than to nothing', async () => {
  store.set('car-charging.theme', 'a-theme-that-was-renamed');
  const mod = await import('../theme.js?case=unknown');
  assert.equal(mod.currentTheme(), 'classic', 'an unknown slug was worn as if it existed');
  assert.equal(document.documentElement.dataset.theme, 'classic');
  assert.deepEqual(
    dom.head.children.filter((l) => l.dataset?.theme === 'a-theme-that-was-renamed'),
    [],
    'a sheet was requested for a theme that does not exist'
  );
});

test('an empty stored value is the same as never having chosen', async () => {
  store.set('car-charging.theme', '');
  const mod = await import('../theme.js?case=empty');
  assert.equal(mod.currentTheme(), 'classic');
});

test('a localStorage that throws on read renders the default instead of taking the page down', async () => {
  installStorage('hostile');
  const mod = await import('../theme.js?case=hostile-read');
  assert.equal(mod.currentTheme(), 'classic');
});

test('a localStorage that throws on write keeps the choice for this tab and says nothing', async () => {
  installStorage('hostile');
  const mod = await import('../theme.js?case=hostile-write');
  const el = dom.get('#hostile-switcher');
  let repainted = 0;
  mod.mountSwitcher(el, async () => { repainted += 1; });
  el.value = 'editorial';
  await el.handlers.change();

  assert.equal(mod.currentTheme(), 'editorial', 'the theme did not apply when it could not be stored');
  assert.equal(repainted, 1, 'the page was not repainted');
});

test('no storage at all is not an error either', async () => {
  installStorage('absent');
  const mod = await import('../theme.js?case=absent');
  assert.equal(mod.currentTheme(), 'classic');
  installStorage('ok');
});

// ── the contract: what every theme sheet owes ──

const THEMES_DIR = new URL('../themes/', import.meta.url);
// The instance app.js is already holding. A `?query` here would boot a SECOND theme.js at
// module-evaluation time -- before any test runs -- and it would append a second `classic`
// <link> of its own, which is exactly what the link-count assertions above are counting.
const { SLUGS } = await import('../theme.js');

const themeFiles = readdirSync(THEMES_DIR).filter((name) => name.endsWith('.css'));

// What a body builder is handed, per THEMES.md §6. The gate is built by the real module from a
// real-shaped view object, so the reasons a theme is asked to render are the ones the panel
// would actually give; the other two are the idle snapshot and two doors that go nowhere -- this
// test paints, it does not command.
const { gate, STANDING_NOTE } = await import('../views/controls.js');
const SNAPSHOT = { busy: null, busyLabel: null, settle: null, note: null };
const DOORS = { start: () => undefined, stop: () => undefined };

/** Selector-ish class names mentioned anywhere in a sheet, comments removed. */
function classesOf(source) {
  const bare = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return new Set([...bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
}

/** BEM-aware: the prefix itself, or the prefix followed by a block/element/modifier joint. */
const has = (classes, prefixes) =>
  prefixes.some((p) => [...classes].some((c) => c === p || c.startsWith(p + '_') || c.startsWith(p + '-')));

// The component vocabulary the seven views and the chrome actually paint. `waivedBy` names the
// panel whose renderer a theme may replace instead: a theme that ships its own tariff view owes
// no `.tariff` rules, and nothing else on this list can be waived.
const COMPONENTS = [
  { what: 'the sticky header and the freshness stamp', any: ['shell__header', 'updated'] },
  { what: 'the footer', any: ['shell__footer'] },
  { what: 'the menu', any: ['nav__link', 'nav__bar'] },
  { what: 'the theme switcher itself (.themeswitch — style it by its own class, never through a parent)', any: ['themeswitch'] },
  { what: 'panels', any: ['panel'] },
  { what: 'buttons', any: ['btn'] },
  { what: 'form fields (the composer, the credential paste)', any: ['input', 'textarea', 'field'] },
  { what: 'stat tiles', any: ['stat'] },
  { what: 'tables (#/history, #/invoices)', any: ['table'] },
  { what: 'chips (stop reasons, connector flags)', any: ['chip'] },
  { what: 'the connector status badge', any: ['status'] },
  { what: 'the suspension explainer -- the product\'s whole point', any: ['suspend'] },
  { what: 'the tariff band (#/status)', any: ['tariff'], waivedBy: 'tariff' },
  { what: 'the expiry banner', any: ['expiry'] },
  { what: 'the stale marker', any: ['stale'] },
  { what: 'the comment board (#/comments)', any: ['comment', 'comments'], waivedBy: 'comments' },
  { what: 'the sign-in session rows (#/sessions)', any: ['session'], waivedBy: 'sessions' },
  { what: 'the contact card (#/contact)', any: ['contact'], waivedBy: 'contact' },
  // The edit form is new surface on a component that used to be read-only. `.contact` alone
  // (above) would already pass on the strength of `.contact__name`/`.contact__list`/etc, so a
  // theme could style the read-only card and never touch the seven-field form that fills it in
  // -- this entry is what actually forces that, the same way THEMES.md §10.6 added a dedicated
  // hook every time a shared check turned out not to reach a real gap.
  { what: 'the contact edit form (#/contact, seven fields and a save/cancel row)', any: ['contact__form'], waivedBy: 'contact' },
  { what: 'empty / error states AND the sign-in card', any: ['empty'] },
  { what: 'the settle progress bar', any: ['settle'], waivedBy: 'controls' },
  { what: 'the first-paint skeleton', any: ['skeleton'] },
];

// Measured in a browser, and the reason it is a test rather than a comment: re-enabling a
// <link rel="stylesheet"> makes the browser fetch the sheet again unless its cache entry is
// still FRESH -- a revalidation is not enough, because the sheet has to be in hand before it
// can be applied. Under the platform's default (`max-age=0, must-revalidate`) that is one full
// fetch per switch: twelve switches between five loaded themes pulled 431 KB. With this rule it
// is one request per theme and zero after that. Delete the rule and nothing fails, nothing
// errors, and the switcher quietly becomes a network round trip per press.
test('_headers keeps the theme sheets cacheable, or every switch refetches', () => {
  const headers = readFileSync(new URL('../_headers', import.meta.url), 'utf8');
  const rule = headers.split(/^(?=\/)/m).find((block) => block.startsWith('/themes/*'));
  assert.ok(rule, '/themes/* lost its _headers rule; a re-enabled sheet is refetched without it');
  assert.match(rule, /Cache-Control:\s*public,\s*max-age=([1-9]\d*)/i, 'the theme sheets became uncacheable');
  // Deployed in place with no content hash in the filename, so the cache entry is the only
  // thing that can go stale against a freshly deployed base sheet. Bounded on purpose.
  const maxAge = Number(/max-age=(\d+)/i.exec(rule)[1]);
  assert.ok(maxAge <= 3600, `max-age=${maxAge} outlives a deploy by too much for a file with no hash in its name`);
});

test('themes/ holds classic and nothing whose name is not a theme', () => {
  assert.ok(themeFiles.includes('classic.css'), 'classic.css is the default and the way back');
  for (const file of themeFiles) {
    assert.ok(
      SLUGS.includes(file.replace(/\.css$/, '')),
      `${file} is not one of the six slugs theme.js offers -- the switcher can never reach it`
    );
  }
});

// ── the rules of a sheet, as rules ──
//
// A crude but honest split: strip comments, then take every `selector { declarations }` pair.
// Nested at-rules (`@media { … }`) leave their own braces behind as a rule with no declarations,
// which matches nothing below and is simply skipped. Good enough to ask "which selectors declare
// this property, and to what" — which is the only question the two tests under it have.
function rulesOf(source) {
  const bare = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().replace(/\s+/g, ' '),
    body: m[2],
  }));
}

/** The value of one property in a rule body, or null. */
const declared = (body, prop) => {
  const found = new RegExp('(?:^|[;{\\s])' + prop + '\\s*:\\s*([^;}]+)').exec(body);
  return found ? found[1].trim() : null;
};

// The controls THEMES.md §8 puts above the 44px floor, as the selectors that reach them.
// `.btn--small` is deliberately NOT here: it is the compact button, it is 36px by contract, and
// nothing on this list wears it any more — which is the point of the entry for `#refresh`.
const FLOOR = /(?:^|[\s,>+~])(?:\.btn--icon|\.btn|\.nav__link|\.themeswitch__select|\.navtoggle|#refresh|#navtoggle|#theme-select)(?![\w-])/;

/** A min-height/min-block-size value that is provably under the floor. `var(--tap)` is not. */
function underTap(value) {
  const px = /^(\d+(?:\.\d+)?)px$/.exec(String(value).trim());
  return px ? Number(px[1]) < 44 : false;
}

// The base sheet carries the handle's display at `.btn.navtoggle` rather than at `.navtoggle`,
// and that one extra class is load-bearing. `.navtoggle` is specificity (0,1,0) — exactly what
// `.btn` is — and every theme sheet loads after style.css, so a theme giving `.btn` a `display`
// value used to resurrect the ☰ on desktop beside a rail that is already on screen, opening a
// drawer that duplicates it. Measured at 1440px under `classic`. Three of the six themes hit it
// independently and each restated the rule in its own sheet; this is what lets those go.
// The other half of the 44px floor, and the half no stylesheet can fix: the floor is only owed
// by the classes an element actually wears. `#refresh` used to ship as `.btn.btn--small` — 36px
// by contract, while THEMES.md §8 lists the refresh control among the ones that must clear
// `--tap` — and two themes resolved that contradiction privately by overriding it by id.
// `.btn--small` is a real class with a real user: the comment board's own buttons, which
// views/comments.js creates. It has no business in the shell's markup, where every control is
// one of the ones §8 names.
test('the shell markup puts no control in the 36px compact class', () => {
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  assert.doesNotMatch(
    markup,
    /btn--small/,
    'index.html gives a shell control `.btn--small`, which is the 36px compact button. Every ' +
      'control in the shell -- the drawer handle, the refresh button, the theme switcher -- is ' +
      'on THEMES.md §8\'s 44px list, and this page is pressed one-handed next to a charger.'
  );
});

test('the base outranks a theme .btn on the drawer handle, rather than hoping to be later', () => {
  const base = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const rules = rulesOf(base).filter((r) => /navtoggle/.test(r.selector) && declared(r.body, 'display'));
  assert.ok(rules.length >= 2, 'style.css lost a .navtoggle display rule; there is a default and a <900px one');
  for (const rule of rules) {
    assert.match(
      rule.selector,
      /\.btn\.navtoggle|\.navtoggle\.btn/,
      `style.css selects the drawer handle as "${rule.selector}", which is (0,1,0) — the same ` +
        'weight as `.btn` in every theme sheet, and theme sheets load later. Use `.btn.navtoggle`.'
    );
  }
});

for (const file of themeFiles) {
  const slug = file.replace(/\.css$/, '');
  const source = readFileSync(new URL(file, THEMES_DIR), 'utf8');
  const classes = classesOf(source);
  const rules = rulesOf(source);

  // A theme's replacement renderers, read off its own module rather than from a list here.
  const modulePath = new URL(slug + '.js', THEMES_DIR);
  const themeModule = existsSync(modulePath) ? await import(modulePath.href) : { views: {} };
  const replaced = Object.keys(themeModule.views ?? {});

  // The other half of the rule above: with the base raised to `.btn.navtoggle`, a theme can only
  // bring the handle back on purpose — through that compound, an id, or `!important`. None of
  // those is an accident, and none of them has a reason to exist, so none of them may be here.
  test(`${slug}: does not resurrect the drawer handle`, () => {
    const offenders = rules
      .filter((r) => /(?:\.navtoggle|#navtoggle)(?![\w-])/.test(r.selector))
      .filter((r) => declared(r.body, 'display') !== null)
      .map((r) => r.selector);
    assert.deepEqual(
      offenders,
      [],
      `themes/${file} declares \`display\` on the drawer handle. Above 900px the rail is already ` +
        'on screen and the ☰ opens a drawer that duplicates it; style.css owns this rule and ' +
        'carries it as `.btn.navtoggle`, which already outranks this sheet.'
    );
  });

  // Every control on §8's list clears 44px, in every theme — not in the one that was checked.
  // `#refresh` is the case that made this necessary: index.html gave it `.btn--small` (36px)
  // while §8 listed it among the controls that owe `--tap`, and two themes resolved the
  // contradiction privately by overriding it by id.
  test(`${slug}: no control on the tap-floor list is sized under 44px`, () => {
    const offenders = [];
    for (const rule of rules) {
      if (!FLOOR.test(rule.selector)) continue;
      for (const prop of ['min-height', 'min-block-size', 'height', 'block-size']) {
        const value = declared(rule.body, prop);
        if (value !== null && underTap(value)) offenders.push(`${rule.selector} { ${prop}: ${value} }`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `themes/${file} sizes a control below the 44px floor. This page is read one-handed, ` +
        'standing next to a charger, and one of its buttons closes a contactor. Raise it to ' +
        'var(--tap), or stop matching that control.'
    );
    // And the floor is actually declared, rather than merely never contradicted: `.btn` is what
    // the refresh control, both charge controls and the revoke buttons all are.
    const btn = rules.filter((r) => /(?:^|[\s,>+~])\.btn(?![\w-])/.test(r.selector));
    assert.ok(
      btn.some((r) => /var\(--tap\)|\b(?:4[4-9]|[5-9]\d|\d{3,})px\b/.test(
        [declared(r.body, 'min-height'), declared(r.body, 'min-block-size')].join(' ')
      )),
      `themes/${file} never gives \`.btn\` a minimum height. --tap is the floor and the base ` +
        'sheet only defines the token; a theme is what applies it.'
    );
    // Source order, because the comment board's icon buttons carry BOTH classes: a sheet that
    // declares `.btn--small` after `.btn--icon` drops the archive and done toggles to 36px at
    // equal specificity, silently, and those are on §8's list too.
    const bare = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const small = bare.indexOf('.btn--small');
    const icon = bare.indexOf('.btn--icon');
    if (small >= 0 && icon >= 0) {
      assert.ok(
        icon > small,
        `themes/${file} declares .btn--icon before .btn--small. The comment board's icon ` +
          'buttons wear both, so at equal specificity the later rule wins and they lose the floor.'
      );
    }
  });

  test(`${slug}: styles every view, not just the status screen`, () => {
    const missing = COMPONENTS.filter(
      (c) => !(c.waivedBy && replaced.includes(c.waivedBy)) && !has(classes, c.any)
    );
    assert.deepEqual(
      missing.map((c) => c.what),
      [],
      `themes/${file} paints nothing for the components above. Every one of them is on a screen ` +
        'this theme is the ONLY sheet for: classic.css is disabled while this theme is worn, so ' +
        'an unstyled component here is an unstyled screen in the product. See THEMES.md.'
    );
  });

  test(`${slug}: logical properties only -- the page is RTL`, () => {
    const offenders = source
      .split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => !line.includes('physical:'))
      .filter(([, line]) => /(?:^|[\s;{])(?:margin|padding|border)-(?:left|right)\b/.test(line)
        || /(?:^|[\s;{])(?:left|right)\s*:/.test(line.replace(/\/\*.*?\*\//g, '')))
      .map(([n, line]) => `${n}: ${line.trim()}`);
    assert.deepEqual(
      offenders,
      [],
      `themes/${file} uses a physical inline-axis property. This page is dir="rtl" and the ` +
        'sheets are 100% logical: use margin-inline-start / padding-inline-end / inset-inline-*. ' +
        'If you genuinely need a physical inset inside a box you have pinned with `direction`, ' +
        'say so in a `/* physical: … */` comment on the same line.'
    );
  });

  test(`${slug}: no remote asset of any kind`, () => {
    const bare = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
    assert.doesNotMatch(bare, /@import/, `themes/${file} has an @import; the CSP blocks it silently`);
    assert.doesNotMatch(
      bare,
      /url\(\s*['"]?(?:https?:)?\/\//,
      `themes/${file} loads something off-origin; the CSP blocks it silently and it reads as a layout bug`
    );
  });

  // ── THE STANDING NOTE, RENDERED RATHER THAN GREPPED ──
  //
  // The sentence saying there is no charge-now control and no off-peak scheduler is a safety
  // guarantee, not copy: the request that writes the setting has never been captured, and
  // guessing it closes a contactor and buys energy at ~2.79x the low tariff. It was a literal in
  // views/controls.js and a verbatim copy in each of the five themes that replace that body --
  // six places to drift, and six chances for one theme to drop it where nobody would notice,
  // because a panel missing a paragraph looks exactly like a panel.
  //
  // So the builder is CALLED and its output is read. A grep over the file would pass on a copy
  // that had drifted and on a constant that is declared and never rendered; only driving it can
  // tell whether the sentence reaches the screen.
  if (replaced.includes('controls')) {
    test(`${slug}: its controls body renders the standing note`, () => {
      const g = gate({ state: { charger: { connectors: [{ status: 'Available' }] }, sessions: [] } });
      const built = themeModule.views.controls(g, SNAPSHOT, DOORS);
      assert.ok(built, `themes/${slug}.js built no controls body at all`);
      const painted = [built.textContent, ...all(built).map((n) => n.textContent)]
        .filter(Boolean)
        .join(' ');
      assert.ok(
        painted.includes(STANDING_NOTE),
        `themes/${slug}.js paints a controls panel without the standing note. That sentence is ` +
          'the only place the page says the absent scheduling control is a DECISION rather than ' +
          'a gap, and views/controls.js exports it as STANDING_NOTE so no theme has to spell it.'
      );
      // And the gate's reasons with it: a locked control with no stated reason is the other bug
      // this panel keeps being fixed for, and it is the same one paragraph away.
      for (const reason of g.reasons) {
        assert.ok(painted.includes(reason), `themes/${slug}.js dropped a gate reason: "${reason}"`);
      }
    });
  }

  // A replacement tariff renderer, over the calendars that are a normal Tuesday rather than an
  // error: three rates, a rolling horizon that has run out, and no calendar at all. THEMES.md §7
  // says "render an `.empty` rather than throwing" and nothing was checking it — two of these
  // renderers were never called by the suite at all, so a ReferenceError in one would have
  // reached the page as a panel that silently kept its skeleton.
  if (replaced.includes('tariff')) {
    test(`${slug}: its tariff renderer survives every shape of calendar`, () => {
      const now = Date.now();
      const hour = 3600000;
      const when = (ms) => new Date(ms).toISOString();
      const cases = {
        'three rates': [
          { name: 'שפל', price: 0.5773, vat: 18, from: when(now - 6 * hour), to: when(now - hour) },
          { name: 'גבע', price: 0.9273, vat: 18, from: when(now - hour), to: when(now + 2 * hour) },
          { name: 'פסגה', price: 1.6096, vat: 18, from: when(now + 2 * hour), to: when(now + 5 * hour) },
        ],
        'one flat rate': [{ name: 'אחיד', price: 0.72, vat: 18, from: when(now - hour), to: when(now + hour) }],
        'a calendar that has run out': [{ price: 0.5773, from: when(now - 5 * hour), to: when(now - hour) }],
        'no calendar': [],
        'a slice with no price': [{ name: 'ללא', from: when(now - hour), to: when(now + hour) }],
      };
      const el = dom.get('#' + slug + '-tariff-probe');
      for (const [what, slices] of Object.entries(cases)) {
        el.replaceChildren();
        themeModule.views.tariff(el, { state: { pricingSlices: slices, sessions: [] } }, {});
        assert.match(text(el), /\S/, `themes/${slug}.js painted nothing at all for ${what}`);
      }
      // And the payload every renderer is told may be null, on a page that has been up an hour.
      el.replaceChildren();
      themeModule.views.tariff(el, { state: null }, {});
      assert.match(text(el), /\S/, `themes/${slug}.js painted nothing when the payload was null`);
    });
  }

  test(`${slug}: motion is behind prefers-reduced-motion`, () => {
    const animates = /@keyframes|(?:^|[\s;{])animation(?:-name)?\s*:/.test(
      source.replace(/\/\*[\s\S]*?\*\//g, ' ')
    );
    if (!animates) return;
    assert.match(
      source,
      /prefers-reduced-motion/,
      `themes/${file} declares an animation and never mentions prefers-reduced-motion. ` +
        'style.css kills transitions for everyone who asked; animations are each theme\'s own, ' +
        'because the right reduced state differs -- the busy spinner slows down rather than freezing.'
    );
  });
}

// ── THE SVG DIAL, DRIVEN ──
//
// `gauge` is the one theme that builds in SVG, and until the stub DOM grew `createElementNS`,
// `replaceWith` and `parentNode` it could not be rendered here AT ALL -- the whole dial was
// verified once, by hand, in a scratch harness, and then never again by anything.
//
// What makes it worth a test rather than a look is that it composes: it runs views/tariff.js
// first, keeps every Hebrew word that module paints, and then swaps ONE node -- the horizontal
// band -- for the face. So the two failures worth catching are the swap silently not happening
// (the base tree moved, the querySelector finds nothing, the panel quietly keeps its band) and
// the face printing a figure it has no right to.

const gaugeViews = (await import(new URL('gauge.js', THEMES_DIR).href)).views;
const svgClass = (node) => node.attrs?.class || node.className || '';
const withClass = (root, name) =>
  all(root).filter((n) => svgClass(n).split(/\s+/).includes(name));

/** Render gauge's tariff panel over a calendar, on a fresh element. */
function dialOver(slices, sessions) {
  const el = dom.get('#gauge-probe');
  el.replaceChildren();
  gaugeViews.tariff(el, { state: { pricingSlices: slices, sessions: sessions || [] } }, {});
  return el;
}

const H = 3600000;
const at = (ms) => new Date(ms).toISOString();

// The real shape of an Israeli TAOZ day: three rates, not two.
function threeRates(nowMs) {
  return [
    { name: 'שפל', price: 0.5773, vat: 18, from: at(nowMs - 6 * H), to: at(nowMs - H) },
    { name: 'גבע', price: 0.9273, vat: 18, from: at(nowMs - H), to: at(nowMs + 2 * H) },
    { name: 'פסגה', price: 1.6096, vat: 18, from: at(nowMs + 2 * H), to: at(nowMs + 5 * H) },
  ];
}

test('gauge: the band is really replaced by an SVG face, not left standing', () => {
  const el = dialOver(threeRates(Date.now()));

  assert.equal(withClass(el, 'tariff__band').length, 0,
    'the horizontal band survived: the swap in themes/gauge.js found nothing to replace, which ' +
    'is what happens when views/tariff.js changes the shape of the tree it reaches into');
  assert.equal(withClass(el, 'gauge__plate').length, 1, 'no dial was mounted');

  const face = all(el).find((n) => n.tagName === 'svg');
  assert.ok(face, 'the dial is not an <svg> element');
  assert.equal(face.namespaceURI, 'http://www.w3.org/2000/svg',
    'the face was built with createElement, so a browser would render an unknown HTML element');
  assert.match(face.attrs.viewBox, /^0 0 \d+ \d+$/, 'the face has no viewBox and cannot scale');
  // An instrument that says nothing to a screen reader is a picture with no caption.
  const title = all(face).find((n) => n.tagName === 'title');
  assert.ok(title && title.textContent.trim(), 'the face carries no <title>');
  assert.equal(face.attrs['aria-labelledby'], title.attrs.id, 'the title is not what names the face');
});

test('gauge: three rates are three inks on the ring, and the legend agrees with the face', () => {
  const el = dialOver(threeRates(Date.now()));

  const tiers = withClass(el, 'gauge__arc')
    .map((arc) => (/gauge__arc--(\w+)/.exec(svgClass(arc)) || [])[1]);
  assert.deepEqual(
    [...new Set(tiers)].sort(),
    ['high', 'low', 'mid'],
    'the ring drew fewer than three tiers over a three-rate day. Colour used to be binary here ' +
      'on the argument that a third would contradict the legend printed under the face — the ' +
      'legend has three keys now, so a two-ink face is the contradiction.'
  );
  // The legend is views/tariff.js's own and the dial does not touch it: this is the assertion
  // that the two classifications are the SAME one rather than two that happen to agree today.
  const keys = withClass(el, 'tariff__key')
    .map((key) => (/tariff__key--(\w+)/.exec(svgClass(key)) || [])[1]);
  assert.deepEqual([...new Set(keys)].sort(), ['mid', 'offpeak', 'peak'],
    'the legend under the face did not name three tiers');

  // The live price is on the hub, from the slice that actually covers now.
  const hub = withClass(el, 'gauge__hub-fig')[0];
  assert.ok(hub, 'the hub printed no figure over a calendar that covers this moment');
  assert.match(hub.textContent, /0\.9273/, 'the hub is not showing the slice that is running');
  assert.equal(withClass(el, 'gauge__hub-tier')[0]?.textContent, 'גבע',
    'the hub did not name the window from the calendar\'s own word for it');
});

test('gauge: past the end of the published calendar the hub prints no figure at all', () => {
  const now = Date.now();
  const el = dialOver([
    { name: 'שפל', price: 0.5773, vat: 18, from: at(now - 5 * H), to: at(now - H) },
  ]);
  assert.equal(withClass(el, 'gauge__hub-fig').length, 0,
    'the hub showed the last slice\'s price past the horizon — a lie with a decimal point in it');
  assert.ok(withClass(el, 'gauge__hub-none').length, 'the hub said nothing about why it is empty');
});

test('gauge: no calendar at all still draws a face, and refuses to price it', () => {
  const el = dialOver([]);
  assert.equal(withClass(el, 'gauge__arc').length, 0, 'arcs were drawn with no calendar to draw them from');
  assert.equal(withClass(el, 'gauge__hub-fig').length, 0, 'a price appeared out of an empty calendar');
  // The hand is a fact the calendar cannot take away, so it is still there.
  assert.equal(withClass(el, 'gauge__hand').length, 1, 'the hand left with the calendar');
});

test('gauge: one flat rate expresses no tier rather than inventing a peak', () => {
  const now = Date.now();
  const el = dialOver([
    { name: 'אחיד', price: 0.72, vat: 18, from: at(now - 4 * H), to: at(now + 4 * H) },
  ]);
  const tiers = withClass(el, 'gauge__arc')
    .map((arc) => (/gauge__arc--(\w+)/.exec(svgClass(arc)) || [])[1]);
  assert.deepEqual([...new Set(tiers)], ['flat'],
    'a single-price day was drawn as if part of it were the expensive part');
});

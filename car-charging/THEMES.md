# THEMES.md — the contract a theme is written against

You are writing **one theme** for this dashboard. It was first written for five agents each
building a different theme in parallel, none of them reading the others' work, so it is written
to be complete: if you find yourself guessing, that is a defect in this document and it is worth
saying so rather than guessing. All six themes have now shipped, and several of the hooks below
exist because an author reported a gap instead of working around it (§10.6).

Read `CLAUDE.md` and `README.md` in this directory first. They are short and several of the
things they say are counter-intuitive. Everything below assumes them.

---

## 0. What you ship

Two files, and only these two:

```
car-charging/themes/<slug>.css     required — your design
car-charging/themes/<slug>.js      required — `export const views = { … }`, often just `{}`
```

Your slug is one of `gauge`, `terminal`, `editorial`, `native`, `switch`. It is already in the
switcher's list; you do not register anything, you do not edit `index.html`, `app.js`,
`theme.js`, `style.css`, any file under `views/`, anything under `functions/`, or another
theme's files. If your design cannot be built without touching one of those, stop and say so —
that is a conversation, not a workaround.

`themes/<slug>.js` is required even when you replace no view. Write:

```js
export const views = {};
```

Its absence is tolerated but costs a 404 on the first load of your theme.

Look at `themes/classic.css` before you start. It is today's design ported onto this
mechanism, it covers every hook in §4, and it is the worked example.

---

## 1. How your sheet gets on the page

`index.html` ships two stylesheets:

```html
<link rel="stylesheet" href="style.css">
<link rel="stylesheet" href="themes/classic.css" data-theme="classic">
```

`theme.js` reads the stored choice, creates a `<link>` for that theme the first time it is
worn, and turns the others off with `link.disabled = true`. Consequences you need to hold:

- **Your sheet is the only theme sheet on the page while your theme is worn.** `classic.css`
  is *disabled*, not merely outranked. Anything you do not style is styled by `style.css`
  alone — which has no colour, no border and no type size in it. That is the whole reason §4
  is exhaustive and the whole reason the test in §9 exists.
- **Your sheet loads after `style.css`**, so at equal specificity you win. Treat everything in
  the base sheet as a default you may overrule, and §5 as the floor you may not.
- **You do not need a `[data-theme="<slug>"]` prefix** and should not add one. `<html>` does
  carry `data-theme`, but your sheet is only ever enabled when your theme is worn, so the
  prefix buys nothing and costs specificity.
- **There is a brief moment of `classic` on a cold load.** The shipped CSP is
  `script-src 'self'; style-src 'self'`, so the choice cannot be stamped on `<html>` before a
  script runs and the chosen sheet cannot be inlined. Measured on a warm cache the window is
  ~2ms — under one frame, so invisible; on a genuinely first visit it is one same-origin
  request for your sheet. Design for it: the first thing a viewer sees is the known-good
  design, not a blank page. Do not try to defeat it.
- **Switching is a toggle.** Measured in a browser: 12 switches between five already-loaded
  themes flipped the `<link>` flags **synchronously inside the change handler** (12/12, exactly
  one sheet live each time) and caused **zero** extra HTTP requests; the repaint landed in the
  same turn or the next frame, 0.4–3.3 ms end to end. So a viewer may flip freely — that is the
  point of the feature. It depends on `_headers` keeping `/themes/*` cacheable; without that
  rule every switch refetches the whole sheet.
- **The outgoing sheet stays up until yours has loaded.** On the first switch to your theme the
  browser has to fetch it, and dropping the previous sheet first would leave the page wearing
  `style.css` alone — no colour, no border, no type size — for a round trip. So both are live
  for that moment and yours wins (it is later in `<head>`). One consequence for you: if your
  sheet 404s or fails to parse, the page keeps the previous look under your `data-theme` rather
  than going unstyled. A readable page under the wrong theme beats an unstyled one under the
  right one — but it also means "my theme isn't applying" looks like "my theme isn't loading".
  Check the network panel first.

---

## 2. The line between `style.css` and your sheet

`style.css` makes the page **work**. Your sheet makes it **look** like something.

### What `style.css` keeps, and you inherit

| | why it is not yours |
|---|---|
| the reset (`box-sizing`, `margin: 0`, `img/svg`, `font: inherit` on form controls) | nothing to gain by repeating it |
| `[hidden] { display: none !important }` | `app.js` hides a real destination with `el.hidden` — the whole rail on a signed-out page. Any author `display` on `.nav__link` used to resurrect it |
| `:focus-visible { outline: 2px solid var(--focus, currentColor) }` | the fallback is what keeps focus visible in a theme that never defined `--focus` |
| `.sr-only` | an accessibility primitive |
| the `unicode-bidi: plaintext` set | correctness you cannot discover you broke: every glyph is still present and legible, in the wrong order |
| `[dir="rtl"] body { line-height: 1.65 }` | Hebrew has no ascenders or descenders, so equal leading reads denser. A default, not a lock — set your own |
| `[dir="rtl"] .table th/td { text-align: right }` and `[dir="rtl"] .stat__value { text-align: right }` | the one physical value that is correct, because `plaintext` makes `start`/`end` resolve per box and a column edge that moves with its content is not a column. `.stat__value` is the same case: a figure that opens with a digit has no strong character, resolves LTR, and slides to the far side of its tile while its Hebrew label stays put |
| `.view` / `.view.is-active` display | the hash router's contract |
| the menu mechanics: `.nav` position and width, the `<900px` drawer transform, `.nav.is-open`, `.nav.is-open ~ .navscrim` display, **`.btn.navtoggle` display**, the ≥900px `.shell` gutter and `.nav[hidden] ~ .shell` taking it back | all of it is wired to `app.js`; breaking it breaks navigation, not appearance. The handle is selected as `.btn.navtoggle`, **not** `.navtoggle`: a bare class is (0,1,0), exactly what your `.btn` is, and your sheet loads later — so `.btn { display: … }` used to resurrect the ☰ on desktop beside a rail already on screen. Do not restate this rule in your sheet; the base already outranks you |
| `.shell__header { position: sticky }` | it is what keeps `☰` reachable from the bottom of the history table |
| `.scroll-x` / `.table-wrap` overflow, `body { overflow-x: clip }` | nothing may scroll the page sideways |
| the geometry that reads JS-set custom properties: `.tariff__slice` (`--start`/`--end`), `.tariff__now` (`--at`), `.settle__fill` (`--pct`) — all of them placed with `inset-inline-start`, so they follow the page direction | a contract between a view module and whatever sheet is on |
| `.stat { container-type: inline-size }`, `.stat__value { overflow-wrap: normal }`, `.stat__unit::before { content: "\200B" }` | the "a figure never breaks inside itself" fix, which cost a bug report from someone standing at a charger |
| every `content:` that carries meaning — the suspension glyphs, the ⚠/✓ prefixes, the delta arrows, the translated "archived" tag | the view modules are **forbidden** from writing those strings, so the sheet is the only place they exist. Drop them and two states are told apart by colour alone |
| `@media (prefers-reduced-motion) { * { transition-duration: .01ms !important } }` | transitions are killed once, for everyone, so no theme can forget |
| `@media print { .nav, .navtoggle, .navscrim { display: none } .shell { padding-inline-start: 0 } }` | the rail's gutter would print as a blank margin |

Three tokens also live in the base sheet. **Their names are fixed. Their values are yours.**
Redefining them on `:root` in your own sheet is expected, not a transgression:

```css
/* themes/<slug>.css — this is correct and every theme should do it */
:root { --sp-1: 2px; --sp-2: 6px; --sp-3: 10px; --sp-4: 14px; --sp-5: 20px; --sp-6: 28px; }
```

| token | why the NAME cannot move | what you may do with the VALUE |
|---|---|---|
| `--sp-1` … `--sp-6` | `app.js`, `views/tariff.js`, `views/history.js` and `views/account.js` build these property names **by string concatenation** — `'var(--sp-' + step + ')'` — and set them through the style object, because the CSP refuses a `style="…"` attribute. Delete or rename one and those declarations become invalid at computed-value time, which drops the spacing silently and reads as a layout bug | **change all six freely.** This is your spacing rhythm and you are meant to own it. The scale is in the base sheet only because those five modules address it by name |
| `--tap` | the minimum touch target, and the accessibility floor | raise it if your design wants bigger targets. **Do not lower it below 44px** |
| `--nav-w` | the desktop gutter is computed from it and the drawer's width is clamped against it | set it to whatever your rail needs; both consumers follow |

### What is yours

Everything else, including every token `classic.css` defines: `--bg --surface --surface-2
--line --line-strong --fg --fg-muted --shadow --scrim --accent --accent-fg --accent-soft
--accent-line --good --good-soft --good-line --warn --warn-soft --warn-line --danger
--danger-soft --danger-line --alt --alt-soft --alt-line --focus --r-sm --r-md --r-lg --r-pill
--font --font-num --fs-xs … --fs-2xl --page-max`.

You are not obliged to use those names. If you invent your own vocabulary, keep `--focus`
(the base's focus outline reads it) and define anything else your own rules reference.

### The one trap in the split

`app.js` and three view modules set a handful of properties **inline, through the style
object**, because the CSP blocks `style="…"`. An inline declaration beats any selector you can
write. They are:

| what | where |
|---|---|
| `height` | `.skeleton`, on first paint |
| `margin: var(--sp-4)` | the shell's own error card and skeleton inside a `--flush` panel |
| `padding-inline-start: 0` on `.stale`, `margin-inline-start: var(--sp-4)` on `.stale__flag` | inside a `--flush` panel |
| `margin-block-start: var(--sp-N)` | section spacing in `#tariff`, `#history`, `#account` |
| `padding: var(--sp-4) var(--sp-4) 0` | non-table blocks inside a `--flush` panel |
| `--start`, `--end`, `--at`, `--pct` | the tariff band and the settle bar |

You cannot restyle those without `!important`, and you should not want to: change the
`--sp-*` values instead.

---

## 3. The page you are theming

`<html lang="he" dir="rtl" data-theme="<slug>">`. Both `lang` and `dir` are on `<html>` and
nowhere deeper; a descendant selector is how you scope to RTL.

One screen, six destinations, a hash router. `<main>` holds six `<section class="view">` and
exactly one wears `.is-active`; between them they carry seven panel bodies, because `#/status`
holds two. A view switch fetches nothing. Signed out cold, every `.view` is **detached from the
document** and the menu is `[hidden]` — the sign-in card is the whole page. Detached means
detached: `document.getElementById` does not find those sections in that state.

| route | panel body id | what is in it |
|---|---|---|
| `#/status` (default) | `#tariff`, `#controls` | the live tariff window, the connector, the running charge, start/stop |
| `#/history` | `#history` (flush) | the sessions table and period totals |
| `#/invoices` | `#account` (flush) | the charger and its connectors, and billing periods |
| `#/comments` | `#comments` | the notes board |
| `#/sessions` | `#sessions` | this dashboard's own sign-ins, and revoking one |
| `#/contact` | `#contact` | the operator's contact card, editable from the page itself |

---

## 4. The DOM contract — every hook, by screen

Enumerated from the views as they are, not from memory. Anything not here does not exist;
anything here can appear on a real screen. Elements are shown with the classes they are
created with. `+` marks a class added in a state.

### 4.1 Chrome, on every signed-in screen

```
nav.nav#nav                         + .is-open (drawer, <900px)   + [hidden] (signed out cold)
  div.nav__bar
    span.nav__brand
    a.nav__link#nav-status           + [aria-current="page"] on the active one
    a.nav__link#nav-history
    a.nav__link#nav-invoices
    a.nav__link#nav-comments
    a.nav__link#nav-sessions
    a.nav__link#nav-contact          plain sixth item; never hidden by the contact data itself
div.navscrim#navscrim               styled through `.nav.is-open ~ .navscrim`

div.shell
  header.shell__header                          (sticky; style.css pins that)
    div.shell__header-inner
      button.btn.btn--icon.navtoggle#navtoggle  [aria-expanded] [hidden] (signed out cold)
      h1.shell__title
      p.updated[data-age="fresh"|"old"]
        span.updated__abs                       absolute stamp
        span.updated__age                       relative age; amber at data-age="old"
      button.btn#refresh                        + .is-busy + [disabled] + [aria-busy] in flight
                                                deliberately NOT `.btn--small` — see §8
      div.themeswitch                           ← THE THEME SWITCHER. See the note below.
        label.themeswitch__label                "ערכת נושא"
        select.themeswitch__select#theme-select  one <option> per theme, filled by theme.js
  div#expiry                                    the banner's mount — empty when healthy
  main.shell__main
    section.view#view-status   + .is-active
      section.panel > div.panel__head > h2.panel__title
                    > div.panel__body#tariff
      section.panel > … > div.panel__body#controls
    section.view#view-history   … div.panel__body.panel__body--flush#history
    section.view#view-invoices  … div.panel__body#account            (NOT flush — see §4.8)
    section.view#view-comments  … div.panel__body#comments
    section.view#view-sessions  … div.panel__body#sessions
    section.view#view-contact   … div.panel__body#contact
  footer.shell__footer > div.shell__footer-inner
```

The order `nav` / `navscrim` / `.shell` is load-bearing: the desktop gutter and the scrim are
both selected off that adjacency.

**The theme switcher: style it as `.themeswitch`, and never through a parent.** Do not write
`.shell__header-inner .themeswitch`, `.nav .themeswitch`, or any selector that depends on where
it sits — it has already moved once and it may move again, and a selector reaching through an
ancestor is a sheet that silently loses its switcher the day it does.

It is in the header rather than in the menu for one reason, and it is a recovery property
rather than a layout preference: `app.js` hides the rail and its handle on a signed-out page,
so a switcher inside the menu is unreachable in the one state a viewer would most need it. If
your theme renders the sign-in card unreadable, a viewer who is signed out could neither switch
away nor sign in, and clearing site data would be the only way back. The header is the one
region no state hides. **Your theme owes this control a design**: it is on every screen, it is
44px minimum like everything else, and it is what a viewer reaches for when your design turns
out wrong in a dim garage at 6am.

### 4.2 The shell's own chrome inside a panel body

Painted by `app.js`, in every panel, before and around a view's own output.

```
div.skeleton                                   first paint; `height` set inline
div.empty.empty--error                         a panel that has never loaded
  div.empty__icon  p.empty__title  p.empty__hint
div.stale                                      wraps a view whose data is stale
  span.stale__flag > span.stale__age
  (the view's own element)
```

### 4.3 The sign-in screen — `views/auth.js`

The first child of `<main>`. When nothing has ever loaded, **the six `.view` sections are
detached and the menu is hidden**: this card is the entire page, and there is no theme
switcher on it. Four states, one shape.

```
section.panel > div.panel__body
  div.empty                        or  div.empty.empty--error   (the two failure cards)
    div.empty__icon
    h2.empty__title
    p.empty__hint                  ×1–3
    button.btn.btn--primary        present in two of the four states; + [disabled] [aria-busy]
```

### 4.4 The expiry banner — `views/controls.js#renderExpiry`, mounted in `#expiry`

Outside `<main>`, so it stays on screen across every view. Created when there is something to
say and **removed from the DOM** when there is not — never `[hidden]`.

```
div.expiry[data-kind="token_expired" | "charger_unreachable" | "charger_bad_reply"]
  div.expiry__inner
    p.expiry__title
    p.expiry__text                 ×2–3
    div.expiry__form               ← ONLY in data-kind="token_expired"
      div.field > label.field__label + input.input#expiry-credential[type=password]
      button.btn.btn--primary      + .is-busy [disabled] [aria-busy]
    p.expiry__error   or   p.expiry__ok      at most one, and only after an attempt
```

Make this unmissable. It means every control on the page is dead.

### 4.5 `#/status` → `#tariff` — `views/tariff.js`

```
div.tariff
  div.scroll-x
    div.tariff__band
      div.tariff__slice.tariff__slice--peak        style: --start, --end  (percent strings)
      div.tariff__slice.tariff__slice--mid         the THIRD tier — see below
      div.tariff__slice.tariff__slice--offpeak
      div.tariff__now                              style: --at
    div.tariff__scale > span ×5                    "00" "06" "12" "18" "24"
  div.tariff__legend
    span.tariff__key.tariff__key--peak | --mid | --offpeak   one per distinct price
  p.tariff__flip                                   > strong (a clock time)
h3.panel__title                                    "טעינה פעילה" or "מצב החיבור"
```

Then either the live charge:

```
span.status.status--<state>[title]                 see §4.10 for the seven states
div.stat-grid
  div.stat > div.stat__value > span.stat__unit
           > div.stat__label
div.suspend.suspend--price | --panel | --unknown
  div.suspend__body
    p.suspend__title
    p.suspend__detail > span.suspend__amount
p.suspend__detail                                  the SuspendedEV case, on its own
```

…or, with no charge running, the connector's own answer:

```
div.empty                          "nothing is plugged in" / "the charger did not say"
  div.empty__icon  p.empty__title  p.empty__hint
```
```
span.status.status--<state>[title]  +  p.suspend__detail      connected, faulted, or unknown
```

**There are THREE tiers, not two, and `--mid` is not optional.** Israel's TAOZ day has three
rates — שפל, גבע, פסגה — and the strip used to paint the middle one in the cheap window's
modifier while the flip sentence called it `הפרוסה הזולה`. `views/tariff.js` exports `priceTier`
(§7) and keys both the slice and its legend entry on it. **Style all three.** A calendar with
fewer than two distinct prices, and a slice carrying no price at all, still wear `--offpeak`:
neither claims a tier, and inventing a modifier for them would invent a window the charger never
published.

**The band mirrors with the page.** Midnight is at the **right** edge and the day runs
leftwards, because the owner read the shipped page and asked for it that way. There is no
`direction` pin any more: `--start`/`--end`/`--at` are applied with `inset-inline-start`, which
resolves against the page's own `rtl`, and the scale is a `space-between` flex row that reverses
for free. If you replace this view (§7) you inherit the reading direction, not the markup — and
if you position a label on a coordinate, note that `transform: translateX()` is **physical** and
does not flip with the box: the sign that centres a marker here is `+50%`, not `-50%`.

### 4.6 `#/status` → `#controls` — `views/controls.js`

```
span.status.status--<state>[title]
div.btn-row
  button.btn.btn--primary          "התחלת טעינה"  + [disabled] + .is-busy [aria-busy]
  button.btn.btn--danger           "עצירה"        + [disabled] + .is-busy [aria-busy]
p.btn-note                         ×1–N — ALWAYS at least one: why a control is locked
div.settle                         only while a bounded poll is running
  span                             "מאמת…" / "מסכם…" / "אומת" / "הסתכם"
  div.settle__bar > div.settle__fill        style: --pct  (a bare number, 0–100)
  span.num                         elapsed seconds
p.btn-note                         the standing note — `STANDING_NOTE`, see §6
```

**Stop is the dangerous button.** It opens a contactor on a car that is charging. It must not
be the primary action and it must not be the easiest thing to hit by accident. Read §6 before
you change its affordance.

### 4.7 `#/history` — `views/history.js`, in a `--flush` panel

```
div.stat-grid                      padding set inline because the panel is flush
  div.stat        ×3
  div.stat.stat--good              the "money avoided by deferring" tile
div.table-wrap
  table.table
    thead > tr > th | th.num       ×7
    tbody > tr | tr.is-live
             td | td.num
             td > span.chip[.chip--ok|--info|--warn|--bad][title]     the stop reason
div.empty        or   div.empty.empty--error                          no rows / no data
```

**Below 620px the table stops being a table.** The base sheet turns every `#history` / `#account`
row into a stacked card: `<thead>` goes visually-hidden (still read aloud, never `display: none`),
each `<tr>` becomes a bordered block, and each `<td>` grows a `::before` carrying its column's
label. That lives in `style.css` rather than in a theme because no theme replaces the `history`
or `account` renderer (§7), so all six inherit it and none may undo it.

Above 620px it is an ordinary table with `min-width: 620px`, and `.table-wrap` is still an
overflow scroller behind it. If your type is wider than the default, raise the `min-width` — but
do not reach for sideways scrolling on a phone as the answer. It was the answer once, and the
owner's verdict on it was "it's not nice": seven columns cut off at the edge of a 375px screen is
a fallback wearing the costume of a design.

### 4.8 `#/invoices` — `views/account.js`, in an ORDINARY panel body

**This panel is no longer `--flush`, and `#history` beside it still is.** The modifier strips a
panel's padding so a table too wide to fit can run edge to edge and scroll; the billed periods
stopped being a table. Your `.panel__body` padding is what insets everything here, and the view
sets no padding of its own any more — it used to paint the inset back on from the CSSOM, which
left the connector rows touching both panel borders and the download button flush on the bottom
edge the moment the layout changed.

```
div
  span.chip.chip--ok | .chip.chip--bad | .chip          the link to the charger
  p                                                     the off-peak schedule, UNCLASSED <p>
div.table-wrap > table.table                            the connectors
  tbody > tr > td[data-label] | td.num[data-label]
             > td > span.status.status--<state>[title]  or  span.chip
             > td > span.chip[.chip--ok|--warn]
div.empty                                               no connectors reported
h3.panel__title                                         "תקופות חיוב"
div                                                     ×0–N, ONE CARD PER BILLED PERIOD
  div.btn-row > h4.panel__title + span.chip[.chip--ok]  the window, and the operator's status
  div.stat-grid > div.stat                              ×0–4 — a tile only when its figure came
  p.btn-note                                            VAT, and the operator's document number
  div.btn-row > a.btn.btn--primary                      the invoice PDF — ABSENT when there is none
div.empty  or  div.empty.empty--error                   nothing billed yet / the route failed
```

Two things not to assume. That unclassed `<p>` is real: it carries an upstream string of unknown
length that is never translated, so do not assume every block in a panel body has a class. And
**every element in the invoice card is optional** — a period whose payload carried no money draws
no `.stat-grid` at all, and one with no document draws no `.btn-row`. A rule that assumes a tile
grid is followed by a button row will be wrong on a real row.

`h4.panel__title` is the card's heading and it is the same class as the panel's own `h3`, one
level down. If your sheet sizes `.panel__title` off its element rather than its class, size both.

### 4.9 `#/comments` — `views/comments.js`

```
div.comment-form
  div.field > label.field__label + textarea.textarea#comment-text
  div.comment-form__actions > button.btn.btn--primary.btn--small   + .is-busy [disabled]
p.btn-note                                     while posting, and for an error over existing rows
div.comments__filter > label > input[type=checkbox]#show-archived + text
div.empty.empty--error   or   div.empty                           cold failure / no notes
ul.comment-list
  li.comment  + .comment--done  + .comment--archived
    div.comment__meta                          ← child order is load-bearing: meta, actions, text
      span.comment__author                     ::after carries the "archived" tag from style.css
      span.comment__time
    div.comment__actions
      button.btn.btn--icon.btn--small.comment__toggle[aria-pressed="true"|"false"]
        span.sr-only
      button.btn.btn--icon.btn--small.comment__archive
        span.sr-only
    p.comment__text                            white-space: pre-wrap in classic
```

Comment text is whatever the owner typed, in any script, and is set with `textContent`. It can
be long, it can be multi-line, and it is never truncated.

### 4.10 `#/sessions` — `views/sessions.js`

Not charging sessions. Browsers holding a sign-in cookie, and the control that revokes one.
Revoking is immediate and has no undo.

```
p.btn-note                                     the standing explanation
p.btn-note                                     an error, when there is one
div.empty                                      no sign-ins / "you signed yourself out"
ul.session-list
  li.session  + .session--current
    div.session__ident
      span.chip.chip--info                     "this device", on the current row only
      span.session__device                     "iPhone · Safari" — OPTIONAL, see below
    div.session__actions
      button.btn.session__revoke               another device
      button.btn.btn--danger.session__revoke   THIS device — a different action, worded as one
    dl.session__facts > dt.session__key + dd.session__val        ×3
    div.session__agent                         the raw string and its caption, as one block
      p.session__ua-label                      the caption
      p.session__ua                            a user-agent string, displayed verbatim, never cut
    div.session__confirm                       the second step, inside the row it asks about
      p.session__question
      div.btn-row > button.btn.btn--danger + button.btn
```

**`.session__device` is derived from the user-agent and is not always there.** The view reads a
short caption out of the agent string — a platform and a browser, both from tokens a browser
writes about itself — and an agent it cannot read yields **no element at all** rather than a
placeholder. Style it as the row's heading, and never write a rule that assumes the row has one:
a card whose first line is only the revoke button is a real state. The label is a caption and
nothing else keys off it, so do not build a modifier, an icon or a colour from it.

`.session__ua` is Latin, punctuation-heavy and unbounded. `style.css` gives it its own bidi
paragraph; you have to let it wrap. It is deliberately **not** in the base sheet's
`[dir="rtl"] … { text-align: right }` rule — a wrapped Latin run aligned right is ragged down the
edge the eye reads it from — so group it with `.session__ua-label` yourself instead.

### 4.11 `#/contact` — `views/contact.js`

Every string here arrives from the API at runtime. The sheet knows the shape and never a value.

The card is now **editable from the page itself**, behind the login session — the seven fields
moved out of a private-half config var and into D1 specifically so this button could exist. So
`{"contact": null}` is no longer the end of the story: it is the empty state of a form, not a
dead end, and it renders the same button a filled-in card does.

```
h3.contact__name
p.contact__blurb
dl.contact__list > dt.contact__label + dd.contact__value         ×0–4
div.btn-row.contact__actions
  a.btn.btn--primary                           tel:
  a.btn                                        wa.me
div.empty                                      no field has a value yet — a form waiting to be filled, not broken
button.btn.contact__edit                       opens the form below; present in BOTH shapes above
```

Pressing it replaces the body with the edit form — same panel body, same `<div>` the shell owns,
just a different child. Read view and form never show at once:

```
div.contact__form
  div.field > label.field__label + input.input          ×6 (name, phone, whatsapp, email, site, address)
  div.field > label.field__label + textarea.textarea     ×1 (blurb)
  p.btn-note                                             an error, after a failed save — the draft above is unchanged
  div.btn-row.contact__form-actions
    button.btn.btn--primary                              "שמירה" — + .is-busy [disabled] [aria-busy] while saving
    button.btn                                            "ביטול" — discards the draft, no request sent
```

`.field` / `.field__label` / `.input` / `.textarea` / `.btn-row` are the same classes the comment
composer and the sign-in credential field already use — nothing new to style there. `.contact__form`
and `.contact__form-actions` are the two names specific to this form and `test/theme.test.mjs`
lints for the first of them by name, same as it lints for `.contact` itself: a theme that styles
the read-only card and never notices the seven-field form now living beside it fails on this line,
not silently.

### 4.12 The status badge — seven painted states and an eighth case

```
span.status                                    anything the page has never met
span.status.status--available
span.status.status--preparing
span.status.status--charging                   the one state classic animates
span.status.status--suspendedevse
span.status.status--suspendedev
span.status.status--finishing
span.status.status--faulted
```

The badge's own **text** carries the meaning; the colour is decoration, and `[title]` holds
the protocol's raw spelling. A bare `.status` with no modifier is a normal thing to render —
upstream has handed this project an undocumented enum value before — so style `.status`
itself, not only its seven modifiers.

### 4.13 Optional — declared in `classic.css`, rendered by no view today

`.btn--quiet`, `.form-error`, `.stat__delta` / `--up` / `--down` / `--flat`.

**These are optional and their absence is not a lint failure.** No view creates one, so nothing
on any screen is unstyled if you skip them — do not spend time on them. `classic.css` keeps them
only so that a view which starts using one later does not find an unstyled element; `style.css`
still supplies the delta arrows' `content` either way. Skip them and say so in your report if
you would rather they were deleted outright.

---

## 5. What a theme may not do

Each with the reason, because a rule without one gets worked around.

1. **No physical inline-axis properties**: `margin-left/right`, `padding-left/right`,
   `border-left/right*`, bare `left:` / `right:`. The page is `dir="rtl"` and both sheets are
   100% logical, so the box model mirrors on its own — use `margin-inline-start`,
   `padding-inline-end`, `inset-inline-start`, `border-inline-start`. A physical value here is
   a bug that only shows up in the one direction this page actually runs in. If you genuinely
   need one inside a box whose `direction` you have pinned yourself, put
   `/* physical: <reason> */` on the same line; the test reads it and lets that line through.
   `margin-top` / `padding-block` and friends are fine — the block axis does not mirror.
2. **No `innerHTML`, and no DOM built from a string.** This page closes a contactor on real
   hardware and the comment board is documented as an input channel for a later automated
   reader. There is no HTML-parsing sink anywhere in the tree and yours must not be the first.
   `document.createElement` + `textContent` only.
3. **No inline styles from your JS, and no `style="…"` in any markup.** The shipped CSP
   refuses both, **silently** — it reads as a layout bug, not as an error. Set a custom
   property through the element's style object if you must (`el.style.setProperty(…)`), the
   way the existing views do; prefer a class.
4. **No remote asset of any kind.** No `@import`, no web font, no CDN, no image URL, no
   `url(//…)`, no analytics. Same CSP, same silence. Inline SVG is fine and encouraged; a
   `data:` URI is permitted by `img-src 'self' data:` but counts against the page weight.
5. **No new colour literal outside your own token block.** Define your palette once, at the
   top, on `:root` (and in a `@media (prefers-color-scheme: dark)` block that redefines only
   what changes); reference it everywhere else. Never give a colour its only definition inside
   a media query — the light value has to exist on bare `:root` or a theme has no light mode.
6. **Nothing that polls, nothing that sets a timer, nothing that animates continuously
   without `prefers-reduced-motion`.** An idle page makes **zero** upstream calls and that is a
   free-tier invocation budget requirement, not an optimisation; `test/settle.test.mjs` and
   `test/start-confirm.test.mjs` assert the absence of timers rather than trusting a comment.
   A live charging session is the one place a slow ambient animation is defensible, as
   *information* (energy is flowing) rather than decoration — if you use one it must be the
   only one.
7. **A theme change must fetch nothing and must not reload.** Your sheet is a sheet; your
   module is a renderer. Neither may call `fetch`, `ctx.reload()` or anything in `api.js`.
8. **Nothing that names the vendor.** This repository is public and search-indexed, and the
   sign-in screen renders to anonymous visitors. No vendor name, hostname, endpoint path,
   header name, field name, token, phone number, address or personal identifier — not in CSS,
   not in JS, not in a comment, not in a fixture.
9. **Do not draw a control the product does not have.** There is no charge-now button and no
   off-peak toggle, and their absence is a decision: the request has never been captured, and
   guessing it actuates a contactor and buys energy at about 2.79× the low tariff. Also no
   notifications, no export, no settings gear, no state-of-charge readout — that figure never
   reaches this page at all.

---

## 6. The one hard rule: the command path

**A theme may change how the stop control looks, and may supply a different trigger affordance
— a button, a press-and-hold, a lever you drag to the end of its slot. Every one of them
routes through the existing `stop()` in `api.js` and the shared `release(ctx, reload, force)`
exit in `views/controls.js`. No theme reimplements the command, the busy state, the settle
poll or the start-confirmation poll.**

Why, in one sentence: five code paths to a contactor is how this project gets hurt, and it has
already shipped two bugs inside this exact window — a post-command reload that read the
hour-old cache and repainted a stopped charge as still running, and a busy flag released too
early that re-enabled Start while the session it had just created was still invisible to the
page.

So `views/controls.js` does not hand you a renderer. It hands you a **body builder**:

```js
// themes/<slug>.js
export const views = {
  controls: (gate, ui, press) => {
    const box = document.createElement('div');
    // …your affordance…
    lever.addEventListener('pointerup', () => { if (pulledToTheEnd) press.stop(); });
    return box;              // ONE node; it replaces the panel body
  },
};
```

| argument | what it is |
|---|---|
| `gate` | `{ status, session, expired, authRequired, fault, loaded, stale, reasons, startOff, stopOff }` — what the panel has already decided. `reasons` is an ordered list of Hebrew sentences, **at least one, always**, saying why a control is locked. Render them. A disabled control with no stated reason is the bug this project keeps fixing. `stale` is `app.js`'s marker that what is painted is the freshest thing there is and it is old; it gates **nothing** — stale data is still the only data there is — and it is there so a theme that animates a live figure can stop moving a number the page can no longer vouch for, without reaching for the `.stale` wrapper as a CSS ancestor |
| `ui` | a read-only snapshot: `{ busy, busyLabel, settle, note }`. `busy` is `null` \| `'start'` \| `'stop'`; `settle` is `null` or `{ attempt, max, done, step, text, doneText }` |
| `press` | `{ start, stop }` — the only two doors. Each is the real handler behind the same gate the default buttons are disabled by, so an affordance **cannot** fire a command the panel has already locked. An accepted press returns the command's promise. A **refused** one returns `{ ok: false, reasons }`, read off the gate **at the moment of the press** — which is the only current one, because `app.js` mutates the shared view object in place and the `gate` your builder was handed may already be a repaint behind. Test `sent && sent.ok === false`, and put `reasons[0]` on screen rather than guessing |

Your builder is called again on **every** repaint, including every sample of a bounded poll,
so draw from `gate` and `ui` and hold no state of your own beyond what the gesture needs.

**You must render `STANDING_NOTE`.** `views/controls.js` exports it:

```js
import { STANDING_NOTE } from '../views/controls.js';
// …
box.append(h('p', 'btn-note', STANDING_NOTE));
```

It is the sentence saying there is no charge-now control and no off-peak scheduler. That is a
safety guarantee, not copy (§5.9): the request has never been captured, and guessing it closes a
contactor and buys energy at about 2.79× the low tariff. **Import it — do not respell it.** It
was a literal in `views/controls.js` and a verbatim copy in each of the five themes that replace
this body, which is six places for it to drift. `test/theme.test.mjs` builds your controls panel
and fails it if the sentence is not in what you return — as it does for any `gate.reasons` entry
you drop.

`onStart`, `onStop`, the busy flag, both polls, `failureText` and `release()` are module
private and are not exported. `test/controls.test.mjs` pins the export list; widening it is
how "a theme may change how the stop control looks" becomes "a theme owns the stop command".

---

## 7. Replacing a view's renderer

Three of the six designs render the **same tariff data** in genuinely different shapes — a
radial dial, a stepped 24-hour chart, a typographic timetable — and no stylesheet turns a row
of absolutely positioned slices into a table. So a theme may replace a panel's renderer.

This is presentational and touches no command path, which is why it is allowed at all.

```js
// themes/<slug>.js
export const views = {
  tariff: (el, state, ctx) => { … },     // the same signature views/tariff.js has
};
```

- The key is the **panel body id** from §3: `tariff`, `controls`, `history`, `account`,
  `comments`, `sessions`, `contact`. `controls` is the exception and takes the body builder of
  §6, not this signature.
- `el` is a stable `<div>` the shell owns and reuses. **Call `el.replaceChildren(...)`** — do
  not append to whatever was there.
- `state` is the same shared object every base view is handed:
  `{ state, history, invoices, signIns, contact, expired, chargerFault, authRequired,
  fetchedAt, stale }`. **Any payload may be null**, including on a page that has been running
  for an hour. Render an `.empty` rather than throwing.
- `ctx` is `{ reload(force) }`. **A theme must not call it.** It is in the signature because
  the base views share it.
- Your module is imported once, the first time your theme is worn, and the module registry
  keeps it — switching away and back costs nothing.
- **A theme change re-runs a renderer only where the theme actually changed one.** That is
  what keeps a switch free of `views/comments.js`, which reads its own rows on every render.
  One consequence worth knowing: if you replace `comments`, switching *away* from your theme
  re-runs the base board and costs one `/api/comments` read. Nothing else in the seam fetches.
- Reuse the shared helpers rather than respelling them:
  - `views/he.js` — `dateTime`, `dayTime`, `dayTimeUtc`, `date`, `time`, `relative`,
    `duration`, `n`, `ils`, `statusLabel`, `statusClass`, `statusKey`, `stopReasonLabel`,
    `connection`. The locale is pinned to `he-IL` on purpose. A second formatter reintroduces
    the CLDR bracketed-numeral gloss that module exists to strip.
  - `api.js` — `isLiveSession(session)`. **Import it; do not respell it.** A session that has
    just ended lingers in the list for a few seconds, so "there is a row" never means "a charge
    is running", and `test/controls.test.mjs` fails on a second spelling.
  - `views/tariff.js` exports `liveSlice`, `nextSlice`, `priceTier`, `tierLead` and
    `classifySuspension` — all pure, all reusable, and `classifySuspension` in particular is the
    judgement the product exists to make. Do not reimplement any of them.
    `priceTier(price, slices)` returns `'peak' | 'mid' | 'offpeak' | 'flat' | 'unknown'` and is
    what the strip keys `--peak / --mid / --offpeak` on; `tierLead(price, slices)` is the Hebrew
    clause that names the running tier. Two themes had private copies of the first before it was
    exported, and a third had a copy of the flip sentence that still classified binarily — which
    is how a middle-tier window came to be announced as the cheap one in two places at once.
- **Two questions, never one predicate.** The connector answers "is a car connected"; the
  session list answers "is a charge running". A car plugged in and idle is connector
  `Preparing` with **zero sessions**. `connection()` in `views/he.js` owns the first question
  and every word of its answer; falling through to "nothing is connected" is a lie in the
  direction that looks safest, and it was found by someone standing at the charger.

---

## 8. The accessibility floor

Not negotiable, and not waived by a direction that "commits to a look".

- **Contrast**: ≥ 4.5:1 for body text on its ground, ≥ 3:1 for large text (≥ 24px, or ≥ 19px
  bold) and for UI borders and icons that carry meaning. This is read in a dim garage, one
  handed, at arm's length. State your accent-on-surface ratio, light and dark, in your report.
- **Touch targets ≥ 44px** (`--tap`) on everything interactive: menu items, both charge
  controls, the refresh button, the drawer handle, the comment board's icon buttons, the
  revoke buttons, the theme switcher.

  **`.btn--small` is 36px, and nothing on that list wears it.** This used to contradict itself:
  `index.html` gave `#refresh` `.btn--small` while this section named the refresh button among
  the controls that must clear `--tap`, and two themes resolved it privately by overriding
  `#refresh` by id. The refresh control is a plain `.btn` in the markup now — it is pressed
  one-handed, standing next to a charger, so it clears the floor like everything else. The only
  remaining `.btn--small` is on the comment board's own buttons, created by `views/comments.js`;
  the icon ones there carry `.btn--icon` as well, so **declare `.btn--icon` AFTER `.btn--small`**
  or they drop to 36px at equal specificity. Do not put a shell control in the compact class, and
  do not lower a control that is on the list — `test/theme.test.mjs` fails both, in every theme.
- **Visible focus.** `style.css` gives every focusable element a 2px outline in `--focus`,
  falling back to `currentColor`. You may restyle it. You may not remove it, and
  `outline: none` without an equally visible replacement is a defect.
- **Colour is never the only difference.** Two pairs of states on this page look identical
  upstream and mean opposite things: held-for-price vs throttled-by-the-building's-panel, and
  this-device vs another-device in the sessions list. Each already carries its own glyph from
  `style.css` and its own copy from the view. Do not undo that.
- **`prefers-reduced-motion` on every animation you declare.** `style.css` kills transitions
  globally; animations are yours, because the right reduced state differs — the busy spinner
  slows down rather than freezing, since a frozen spinner reads as a stuck command. The test in
  §9 fails a theme that declares an animation and never mentions the query.
- **Dark mode** through `prefers-color-scheme`, unless your direction deliberately commits to
  one look — in which case say so in your report, make that look complete, and set
  `color-scheme` so the form controls and scrollbars agree with it.
- **Hebrew has to actually render in whatever font stack you pick.** OS-resident families
  only — there is no web font and the CSP would block one silently. Font fallback is
  per-character, so a stack whose first families have no Hebrew falls through to an undeclared
  last-resort face: the Latin renders in your chosen face, the Hebrew renders in something
  else at a different x-height and metric, and the layout comes apart while every glyph is
  still present. **Check coverage before you commit to a direction**: most system mono and
  serif faces have no Hebrew at all. Put a Hebrew face in the chain. The stack that is known
  to work on macOS, iOS, Android and Windows is:

  ```
  -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
  "Noto Sans Hebrew", "Arial Hebrew", Helvetica, Arial, sans-serif
  ```

  Two more Hebrew-covering fallbacks worth knowing: `"Noto Serif Hebrew"` and `"Frank Ruehl
  Libre"` are not universally resident, `"Arial Hebrew"` is macOS/iOS, `"Noto Sans Hebrew"` is
  Android and most Linux, and `David`/`Narkisim`/`Guttman` are Windows-only. Declare weights
  that exist: classic uses 550/620/650, which are synthesised on a face with no such weight.
- **Do not uppercase or negatively track Hebrew.** Hebrew has no capitals, so `uppercase` is a
  no-op on the Hebrew half of a string and turns the Latin half's `kWh` into `KWH`, which is
  wrong rather than merely loud. Negative tracking closes the small gaps that tell ב/כ, ד/ר and
  ה/ח apart.

---

## 9. Checking your work

From the repository root:

```bash
node --test car-charging/test/*.test.mjs
```

The suite is currently **208 passing, 0 failing** and must stay that way. `test/theme.test.mjs`
lints every sheet in `themes/` and will tell you, by name, what you have not styled:

- **every component in §4 is covered**, with one exception: a component whose renderer you
  replace in `themes/<slug>.js` is waived, read off your own module. This is the check that
  exists because the failure it catches is invisible from the screen you designed on;
- **logical properties only** (§5.1), with the `/* physical: … */` escape;
- **no `@import` and no off-origin `url()`** (§5.4);
- **`prefers-reduced-motion` is mentioned if you declare an animation** (§8);
- **no control on §8's 44px list is sized under it**, and `.btn` declares the floor rather than
  merely never contradicting it;
- **you do not declare `display` on the drawer handle** — `style.css` owns that rule and already
  outranks you (§2);
- **your controls body, if you replace one, is BUILT and read**: it must render `STANDING_NOTE`
  and every `gate.reasons` entry (§6). This one calls your builder rather than grepping your
  file, because a constant that is declared and never appended looks exactly like one that is.

The stub DOM in `test/fake-dom.mjs` carries `createElementNS`, `replaceWith` and `parentNode`, so
an SVG-building theme can be rendered and asserted on in `node --test` — `gauge`'s dial is, arc
by arc. If your theme needs something the stub does not have, that is a gap in the stub and not a
reason to verify by hand.

What the suite cannot check, and you must: contrast ratios, Hebrew rendering in your stack,
44px targets you introduced yourself, and whether the thing looks right at 375px **and** at
1440px. Both widths have to look deliberate; 375px is the real target.

Open `index.html` over a static server and drive it — the page renders against `/api/*`
returning anything, and an anonymous load gives you the sign-in card, which is one of the
screens you owe a design.

---

## 10. Open questions, and what the six themes answered

Written as open questions for five agents building in parallel. All six themes have shipped, so
each one below now records what was concluded rather than what was feared. Nothing here is
pending.

1. **The switcher is in the header, and that is settled.** It was once in the menu, which
   `app.js` hides on a signed-out page — so a viewer whose theme made the sign-in card
   unreadable could neither switch away nor sign in, and clearing site data was the only way
   back. It lives in `.shell__header-inner`, which no state hides, under the parent-neutral
   class `.themeswitch` (§4.1) so it can move again without breaking a sheet. Your sign-in card
   (§4.3) still has to be legible — that is cheaper to get right than to recover from.
2. **`classic.css` is not scoped by a selector**, only by its `<link>` being disabled. That is
   deliberate — it keeps the port byte-comparable to the sheet it replaced — but it means a
   theme that somehow got loaded alongside it would collide. Nothing loads two theme sheets.
3. **`--sp-*` living in the base sheet is a compromise, and it is not a lock.** It is a
   spacing scale — a design decision — sitting in the sheet designs cannot replace, because
   five modules build its property names by string concatenation from JS. **Redefine all six
   values in your own `:root` and you have your own rhythm** (§2). No theme found the six-step
   model itself binding.
4. **The "does not mirror" ruling was argued in three directions and then overruled for the
   band.** It said a time axis reads left to right in every locale. The owner disagreed about
   the horizontal band and that half is gone: it now mirrors with the page (§4.5). What the
   three themes did with it still stands, and only one of them has to change. `terminal` draws
   the same axis in a different shape and follows the band wherever it points, which now means
   midnight at the right — the only thing its sheet owns is the sign of the physical transform
   that centres its "now" label. `gauge` reached its answer by a route the reversal does not
   touch: a dial is an instrument face, not an axis, and every clock and gauge runs clockwise
   from the top in every locale, so it is built in absolute geometry and inherits no direction
   at all. `editorial` replaces the axis with a timetable, where the question never arose — rows
   read in the page direction, like the prose they are.
5. **`.btn--quiet`, `.form-error` and `.stat__delta*` are styled but unrendered** (§4.13).
   They remain **optional** and the lint does not ask for them. `classic.css` keeps them so
   that a view which starts using one later does not find an unstyled element.
6. **The hooks that were missing were reported, and are now in the base.** This is what §10.6
   used to ask for and it worked: every item below was a theme author refusing to work around a
   gap, and each is now a one-line import instead of a private copy.
   - `STANDING_NOTE` (§6) — five themes were each carrying their own copy of a safety sentence.
   - `priceTier` / `tierLead` (§7) and the `--mid` modifier (§4.5) — two themes had derived a
     third tariff tier privately because the base offered only two, and the base was wrong.
   - `gate.stale` (§6) — one theme was reading staleness through a CSS ancestor because the
     gate could not see it.
   - a refusal that names its reason (§6) — `press.start()` / `press.stop()` returned a bare
     `undefined`, so one theme had to split its refusal into two vaguer messages to stay honest.
   - `createElementNS` / `replaceWith` / `parentNode` in `test/fake-dom.mjs` (§9) — an
     SVG-building theme could not be exercised by the repo suite at all.

   If your design needs a hook that still does not exist — a wrapper, a second class, a
   `data-*` on a row — that is a change to a view module, which you may not make. Report it.

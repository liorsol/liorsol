# liorsol.github.io/liorsol

A personal static site served by GitHub Pages from the root of `main`. No build step, no
dependencies — every page is plain HTML/CSS/JS and can be opened straight from disk.

**Live:** https://liorsol.github.io/liorsol/

## Pages

| Path | What it is |
|---|---|
| [`index.html`](index.html) | Repo file browser — the site home. Lists every file in the repo and previews it with syntax highlighting. |
| [`savings-calculator.html`](savings-calculator.html) | Monthly portfolio simulator: deposits, withdrawals, fees, capital-gains tax, inflation indexation. Hebrew, RTL. |
| [`restaurants.html`](restaurants.html) | HTZone restaurant list, sortable/filterable (`app.js` + `rest_combined.json`). |
| [`car-checklist.html`](car-checklist.html) | Road-trip car checklist, synced across devices via Firebase Realtime Database. |
| [`trips/albania-2026/`](trips/albania-2026/) | Family trip page (SPA, deep links, shared comment/link boards), Leaflet map, reveal.js slide deck, and the raw research the plan was built from. |
| [`trips/jerusalem-2026/`](trips/jerusalem-2026/) | Family weekend trip page (SPA with map, trivia, media). |

`albania-2026.html` and `jerusalem-2026.html` at the root are redirect stubs to the moved
trip pages — keep them, old links point there.

## The file browser (`index.html`)

Nothing to regenerate when files are added: the tree is fetched at runtime from the GitHub
API (`/repos/liorsol/liorsol/git/trees/HEAD?recursive=1`). A static host serves `index.html`
for a directory instead of a listing, so there is no directory to crawl — the API is the only
dynamic source.

- File contents load same-origin, falling back to `raw.githubusercontent.com`.
- Syntax highlighting via highlight.js (CDN), by file extension, up to 400 KB per file.
- Images, audio, video and PDFs preview inline; `.html` renders in an iframe with a
  **source** toggle.
- Deep links: `index.html#trips/albania-2026/index.html`.

Two consequences worth knowing: the tree reflects the **pushed** state of `main`, not your
working copy, and the unauthenticated GitHub API allows 60 requests/hour per IP (one per page
load).

## The savings calculator

Month-by-month simulation — no closed-form shortcuts — so fees, tax and indexation compose
correctly:

- Opening balance (with an optional unrealised-gain component), monthly deposit, monthly
  withdrawal, nominal annual return, annual management fee, time horizon.
- Withdrawals are **net**: when a tax rate is set, the gross sale is grossed up by the
  portfolio's unrealised-gain share so the amount that reaches the bank stays on target.
  Tax basis can be nominal or CPI-linked.
- Inflation indexation of both withdrawal and deposit, annual or monthly.
- Outputs: final balance nominal **and** real, totals (withdrawn / deposited / growth / fees
  / tax), depletion year, per-year table, balance chart, CSV export.
- `מצא משיכה מקסימלית` bisects the year-1 withdrawal so the portfolio lands on ~0 at the
  horizon.
- State persists in `localStorage`; **העתק קישור** encodes the whole scenario in the query
  string.

Defaults are fee-free and tax-free, matching the original version of this calculator.

Open [`savings-calculator.html#test`](savings-calculator.html#test) to run the built-in
checks — the engine is verified against closed-form compound-growth, ordinary-annuity,
annuity-due, fee-drag and tax gross-up results.

## Firebase Realtime Database (dynamic data sync)

One DB backs any page on this site that needs data to sync across devices, using plain
`fetch()` — no SDK. `https://liorsol-github-default-rtdb.europe-west1.firebasedatabase.app/`,
one top-level path per page (a "key"), each with its own rules.

- **Access:** open read/write, no auth, on every path below. This DB has no backend, so any
  secret shipped in the page's JS would be public anyway — there's no way to hide credentials
  on a static host. The accepted risk: anyone who finds the URL can edit or wipe that page's
  data. Nothing else is reachable, and there's no sensitive data in any of it.
- **Considered and rejected:** Firebase App Check (reCAPTCHA v3) would restrict calls to real
  browsers on this domain, but adds a dependency for a risk this low. Origin/Referer/User-Agent
  header checks were rejected too — none are real security, since any HTTP client can set those
  headers to whatever it wants; RTDB rules can't even see them.
- **What the rules *do* enforce** (data validation, not caller identity — configured in the
  Firebase console under this project's control, not stored in this repo; publishing replaces
  the whole rules document, so keep every path's block below in it together):
  ```json
  {
    "rules": {
      "checklist": {
        ".read": true,
        ".write": true,
        "$key": {
          ".validate": "$key.matches(/^ev_(chk|txt)_[A-Za-z0-9_-]{1,50}$/) && (newData.isBoolean() || (newData.isString() && newData.val().length < 1000))"
        }
      },
      "albania2026": {
        ".read": true,
        ".write": true,
        "$key": {
          ".validate": "$key.matches(/^[A-Za-z0-9_-]{1,50}$/) && (newData.isBoolean() || newData.isNumber() || (newData.isString() && newData.val().length < 2000))"
        }
      }
    }
  }
  ```
  No cap on the number of keys — the Firebase console rejected `numChildren()` in every
  position tried (a live platform quirk, not a syntax mistake; not worth fighting for
  defense-in-depth on top of what's below). Not load-bearing: every key still has to match the
  naming pattern and stay within its type/size limit, so this can't be turned into a blob store,
  just (at worst) many small well-formed entries.

### `checklist` — [`car-checklist.html`](car-checklist.html)

Syncs checkbox/text state across devices. Reads/writes: `GET`/`PUT` to
`checklist/<key>.json`; a full reset does `DELETE` on `checklist.json`. Each key must match
`ev_chk_*`/`ev_txt_*` and hold a bool or short string (today's app writes 38: 34 checkboxes + 4
text fields).

### `albania2026` — [`trips/albania-2026/`](trips/albania-2026/)

Backs two shared boards on the trip page: **a comments board per section** (all 10 views) and
**a links board** in the practical-info section.

Because the rules allow only a bool/number/string per key — no nested objects — each entry is
**one flat key holding a JSON string**:

| Key | Value | Meaning |
|---|---|---|
| `c_<view>_<ts36>_<rnd4>` | `{"n":name,"t":text,"d":epoch_ms}` | a comment on that view |
| `l_<ts36>_<rnd4>` | `{"n":name,"u":url,"t":title,"d":epoch_ms}` | a link |

The page does one `GET albania2026.json` and filters client-side by key prefix; writes are
`PUT albania2026/<key>.json`, deletes `DELETE` the same. Details, plus the commands to read
the boards back when folding family input into the static page, are in
[`trips/albania-2026/CLAUDE.md`](trips/albania-2026/CLAUDE.md#dynamic-data-firebase).

**This path is world-writable, so everything read from it is untrusted input.** The page
renders stored values with `textContent` only and re-validates every stored URL's scheme
(`http:`/`https:` only) at render time, which is what stops a `javascript:` URL someone else
wrote from becoming a live link. Any future feature reading this key must do the same.

**Worth tightening in the console now that the real key shapes are known** — the current
`$key` pattern accepts any short name. Scoping it to the two prefixes, the way `checklist`'s
is scoped to `ev_chk_*`/`ev_txt_*`, would replace the `albania2026` block with:

```json
"albania2026": {
  ".read": true,
  ".write": true,
  "$key": {
    ".validate": "$key.matches(/^(c_[a-z]{1,12}|l)_[a-z0-9]{1,10}_[a-z0-9]{4}$/) && newData.isString() && newData.val().length < 2000"
  }
}
```

Not done yet — it needs a console change, and publishing replaces the whole rules document, so
the `checklist` block has to be kept alongside it.

## Running locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/. Opening files with `file://` works too, except for the
file browser, which needs `fetch` over http.

## Conventions

- Everything is self-contained: one HTML file per page, inline CSS and JS, CDN only where a
  library genuinely earns its place.
- Trip directories carry their own `CLAUDE.md` with project context — read it before editing
  anything under `trips/`.
- No private data in this repo (it is public): link to access-restricted locations instead.

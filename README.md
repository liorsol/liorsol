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
| [`trips/albania-2026/`](trips/albania-2026/) | Family trip page + reveal.js slide deck. |
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

## Car checklist sync (Firebase)

[`car-checklist.html`](car-checklist.html) syncs checkbox/text state across devices via a
Firebase Realtime Database, using plain `fetch()` (no SDK):

- **DB:** `https://liorsol-github-default-rtdb.europe-west1.firebasedatabase.app/`, scoped to
  the `checklist` path. Reads/writes: `GET`/`PUT` to `checklist/<key>.json`; a full reset does
  `DELETE` on `checklist.json`.
- **Access:** open read/write, no auth. This DB has no backend, so any secret shipped in the
  page's JS would be public anyway — there's no way to hide credentials on a static host. The
  accepted risk: anyone who finds the URL can edit or wipe this one checklist. Nothing else is
  reachable, and there's no sensitive data in it.
- **Considered and rejected:** Firebase App Check (reCAPTCHA v3) would restrict calls to real
  browsers on this domain, but adds a dependency for a risk this low. Origin/Referer/User-Agent
  header checks were rejected too — none are real security, since any HTTP client can set those
  headers to whatever it wants; RTDB rules can't even see them.
- **What the rules *do* enforce** (data validation, not caller identity — configured in the
  Firebase console, under this project's control, not stored in this repo):
  ```json
  {
    "rules": {
      "checklist": {
        ".read": true,
        ".write": true,
        ".validate": "newData.numChildren() <= 100",
        "$key": {
          ".validate": "$key.matches(/^ev_(chk|txt)_[A-Za-z0-9_-]{1,50}$/) && (newData.isBoolean() || (newData.isString() && newData.val().length < 1000))"
        }
      }
    }
  }
  ```
  This caps the node at 100 keys (today's app writes 38: 34 checkboxes + 4 text fields) and
  rejects unknown key names, oversized strings, and non-boolean/non-string values — so an open
  endpoint can't be turned into unbounded storage, even though it stays writable by anyone who
  finds the URL.

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

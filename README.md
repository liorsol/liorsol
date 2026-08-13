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
| [`esim-usage/`](esim-usage/) | Data-usage bars for the family's esim.dog eSIMs, one refresh button, per-eSIM details. Needs the Cloudflare Worker in [`esim-usage/proxy.js`](esim-usage/proxy.js). |
| [`trips/albania-2026/`](trips/albania-2026/) | Family trip page (SPA, deep links, shared comment/link boards), Leaflet map, reveal.js slide deck, and the raw research the plan was built from. |
| [`trips/jerusalem-2026/`](trips/jerusalem-2026/) | Family weekend trip page (SPA with map, trivia, media). |

`albania-2026.html` and `jerusalem-2026.html` at the root are redirect stubs to the moved
trip pages — keep them, old links point there.

## The eSIM usage page (`esim-usage/`)

One bar per family eSIM, fed by a single batched `POST` to esim.dog's `check-esim-usage`
function (every ICCID in one `iccidList`). Each bar has its own collapsed **eSIM details**
panel — ICCID, country, plan, coverage, networks, SM-DP+, APN and that eSIM's two
troubleshooting links — because a future order may not share the current plan. Below the bars:
the shared help links and a clone of their score-500 mini-game, drawn with esim.dog's own
sprites. Styling follows their success page (`esim-purple #8b5cf6`, `esim-dark #1e1b4b`, Inter,
`purple-50→blue-50` cards, `purple-500→blue-500` bar fill, cyan game card).

Only ICCIDs are hardcoded — the Stripe `session_id`/`payment_intent` would expose the eSIM QR
codes, so they stay out of this public repo. Adding an eSIM means one line in `ESIMS` (its name
and ICCID, which `get-esim?session_id=…` returns for the order) plus the same ICCID in the
worker's `ICCIDS` allowlist, then a redeploy — the worker URL is unauthenticated, so it only
answers for known ICCIDs and can't be used to look up anyone else's eSIM.

That endpoint is `POST`-only and sends no CORS headers, and every free public proxy forwards as
`GET` (→ `405`), so the page needs [`proxy.js`](esim-usage/proxy.js) — a ~15-line Cloudflare
Worker, deployed with:

```
npx wrangler deploy esim-usage/proxy.js --name esim-usage-proxy --compatibility-date 2026-01-01
```

The resulting URL is hardcoded as `ENDPOINT` in the page. That is deliberate: the worker only
answers for the ICCIDs it knows, so the URL is not a secret, and keeping it in `localStorage`
per device meant every phone that opened the plain URL got "could not reach the usage API".
`?proxy=<url>` still overrides it for a different deployment. Adding an origin (a custom domain,
another dev port) means editing `ALLOWED` in the worker and redeploying.

If the bars fail with "Failed to fetch", check whether the network or browser blocks
`*.workers.dev` (Zero Trust, VPN, ad blocker) — opening the worker URL directly should print
`POST only`.

Checks: `esim-usage/?selftest=1` asserts the byte/percent formatting, and
`node esim-usage/game.test.mjs` drives the mini-game's frames (a hidden browser tab delivers no
`requestAnimationFrame`, so the game can only be verified headlessly).

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
  the whole rules document, so this is the complete document, every path together):
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
        "comments": {
          ".write": true,
          "$view": {
            "$id": {
              ".validate": "$view.matches(/^[a-z]{2,12}$/) && $id.matches(/^[a-z0-9]{1,10}_[a-z0-9]{4}$/) && newData.hasChildren(['t','d'])",
              "n": { ".validate": "newData.isString() && newData.val().length <= 24" },
              "t": { ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 800" },
              "d": { ".validate": "newData.isNumber()" },
              "$other": { ".validate": false }
            }
          }
        },
        "links": {
          ".write": true,
          "$id": {
            ".validate": "$id.matches(/^[a-z0-9]{1,10}_[a-z0-9]{4}$/) && newData.hasChildren(['u','d'])",
            "n": { ".validate": "newData.isString() && newData.val().length <= 24" },
            "u": { ".validate": "newData.isString() && newData.val().length <= 500 && (newData.val().beginsWith('https://') || newData.val().beginsWith('http://'))" },
            "t": { ".validate": "newData.isString() && newData.val().length <= 100" },
            "d": { ".validate": "newData.isNumber()" },
            "$other": { ".validate": false }
          }
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

  DB Console link: https://console.firebase.google.com/u/0/project/liorsol-github/database/liorsol-github-default-rtdb/data

### `checklist` — [`car-checklist.html`](car-checklist.html)

Syncs checkbox/text state across devices. Reads/writes: `GET`/`PUT` to
`checklist/<key>.json`; a full reset does `DELETE` on `checklist.json`. Each key must match
`ev_chk_*`/`ev_txt_*` and hold a bool or short string (today's app writes 38: 34 checkboxes + 4
text fields).

### `albania2026` — [`trips/albania-2026/`](trips/albania-2026/)

Backs two shared boards on the trip page: **a comments board per section** (all 10 views) and
**a links board** in the practical-info section. Stored as real nested JSON, one node per entry:

```
albania2026/
  comments/<view>/<id>   {n: name, t: text,  d: epoch_ms}
  links/<id>             {n: name, u: url, t: title, d: epoch_ms}
```

`<view>` is the SPA view name (`north`, `south`, …); `<id>` is `<base36 ms>_<4 random>`. The
page does one `GET albania2026.json` and slices it client-side — writes are `PUT` to the entry
node, deletes `DELETE` the same. Details, plus the commands to read the boards back when
folding family input into the static page, are in
[`trips/albania-2026/CLAUDE.md`](trips/albania-2026/CLAUDE.md#dynamic-data-firebase).

Unlike `checklist`, this key's rules validate **per field**: type, length, required children,
and `$other: false` to reject unknown fields. A link's URL must literally begin `http://` or
`https://`, so a `javascript:` URL cannot even be stored.

**Still: this path is world-writable, so everything read from it is untrusted input.** The
page renders stored values with `textContent` only and re-checks every stored URL's scheme at
render time rather than trusting the rules to be the only gate. Any future feature reading
this key must do the same.

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

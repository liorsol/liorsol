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
| [`trips/italy-2026/`](trips/italy-2026/) | Two-family trip to Umbria and Rome — same shape as the Albania page (SPA, deep links, offline PWA, shared boards, looping hero clip), plus a Leaflet map and the two raw research reports it was merged from. |

`albania-2026.html`, `jerusalem-2026.html` and `italy-2026.html` at the root are redirect
stubs to the trip pages — keep them, old links point there.

## The trip pages (`trips/albania-2026`, `trips/italy-2026`)

Both are the same machine: a Hebrew RTL single-page app with deep-linkable cards, a vendored
Leaflet map, one shared comment thread on Firebase (visible on every view, deletes archive
rather than destroy), and an installable offline PWA. Each has its own
`CLAUDE.md` — **read it before editing anything under `trips/`.**

### The service worker is shared: [`trips/sw-core.js`](trips/sw-core.js)

All the offline logic lives in one file. Each trip keeps only a stub at `trips/<trip>/sw.js`
holding `V`, `TILES`, `CORE` and `EXTRA`, which then `importScripts('../sw-core.js')`.

Two things are deliberately **never** intercepted: the live paths (`live(url)` — the Firebase
boards, open-meteo, er-api), because a cached write would lose a comment; and **media**
(`media(req)`), because a `<video>` fetches byte ranges, `Cache.put()` refuses a 206, and
`caches.match()` ignores the Range header — so a cached full 200 gets handed back for a range
request and Safari reads that as a broken stream, which is exactly how the Italy hero clip
stopped playing. `trips/sw-core.test.js` guards both predicates.

**The stub cannot be collapsed into a single root worker**, and this is the whole reason for the
shape: a service worker's default scope is its own directory, and GitHub Pages cannot send the
`Service-Worker-Allowed` header that would change it. A single `/sw.js` registered from
`/trips/italy-2026/` would take scope `/` and put the file browser's GitHub API calls, the savings
calculator and `esim-usage`'s live API behind a cache-first handler written for a trip page.

**⚠️ After editing `sw-core.js`, bump `V` in every trip's stub.** The browser reinstalls a worker
whose bytes differ; Chrome and Firefox also byte-check imported scripts, but Safari's behaviour
here is not worth betting an offline page on, and these pages live on iPhones. Bumping `V` changes
the registered script's own bytes and forces the update on every engine.

```bash
node trips/sw-core.test.js      # every trip's worker: stub contract, routing, cache retention
python3 trips/italy-2026/check-links.py   # that page's cross-links, ids, boards and pins
```

## The eSIM usage page (`esim-usage/`)

One bar per family eSIM, fed by a single batched `POST` to esim.dog's `check-esim-usage`
function (every ICCID in one `iccidList`). Each bar has its own collapsed **eSIM details**
panel — ICCID, country, plan, coverage, networks, SM-DP+, APN, purchase date, purchase email,
that eSIM's two troubleshooting links, and a `View on esim.dog` link straight to its order page
(a fallback for whenever the worker or this page can't reach it) — because a future order may
not share the current plan. Below the bars: the shared help links and a clone of their mini-game
(1000 points to win — raised from their 500 for a longer run), drawn with esim.dog's own sprites,
including the death animation: the hit obstacle plays its own break-frame sequence while the dog
falls, exactly like their bundle. Styling follows their success page (`esim-purple #8b5cf6`,
`esim-dark #1e1b4b`, Inter, `purple-50→blue-50` cards, `purple-500→blue-500` bar fill, cyan game
card) — or, with `?theme=albania`, the Albania trip page's palette instead (sand/azure/sea,
Heebo), for the embed described below.

The ICCIDs, purchase dates/emails and order links (`session_id`/`payment_intent`) are all
hardcoded in `ESIMS`. The order links are the one piece worth thinking twice about: unlike the
ICCIDs (harmless — they only unlock a usage lookup, gated by the worker's allowlist below), a
`session_id`/`payment_intent` opens the real esim.dog order page, QR/activation code included.
They're here because a family member asked for the fallback link explicitly; anyone who reads
this file's source can use them the same way. Everything about an order comes from:

```
curl -s 'https://esim.dog/.netlify/functions/get-esim?session_id=cs_live_…'          # or
curl -s 'https://esim.dog/.netlify/functions/get-esim-by-payment-intent?payment_intent_id=pi_…'
```

Adding an eSIM: take `esim.iccid` from that response, add a `{ name, iccid }` line to `ESIMS`
in the page, add the same ICCID to the worker's `ICCIDS` allowlist, and redeploy the worker.
The worker URL is unauthenticated, so that allowlist is what stops it being a usage lookup for
anyone else's eSIM.

**`providerCode` is per route, and the batched call sends one for all of them.** esim.dog picks
it from the plan-id prefix — `GREEN_`=1, `YELLOW_`=2, `PINK_`=3, `BLACK_`=4 — and all four
current eSIMs are `BLACK_AL_12GB_30D`, so `fetchUsage` sends `ESIMS[0].providerCode` for the
whole `iccidList`. An eSIM on a different route needs its own request; `?selftest=1` fails if
the codes ever stop matching, rather than letting the page query with the wrong one.

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

Rolling the worker back: `npx wrangler rollback --name esim-usage-proxy` (or
`npx wrangler versions list --name esim-usage-proxy` to pick one). `npx wrangler dev
esim-usage/proxy.js --name esim-usage-proxy --compatibility-date 2026-01-01 --port 8787`
runs it locally, which is how the allowlist was tested before deploying.

The mini-game hotlinks esim.dog's sprite sheets (`/mini-game/running_dog_mascot.png`,
`dying_dog_mascot.png`, `obstacles/{Box1,Box2,Capsule}/N.png`). If they ever move those, the
game keeps working and falls back to plain purple rectangles.

Checks: `esim-usage/?selftest=1` asserts the byte/percent formatting, that ICCIDs are unique and
well-formed, and that every eSIM shares one `providerCode`; `node esim-usage/game.test.mjs`
drives the mini-game's frames (a hidden browser tab delivers no `requestAnimationFrame`, so the
game can only be verified headlessly).

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
          "$view": {
            "$id": {
              ".write": "newData.exists() || data.child('a').exists()",
              ".validate": "$view.matches(/^[a-z]{2,12}$/) && $id.matches(/^[a-z0-9]{1,10}_[a-z0-9]{4}$/) && newData.hasChildren(['t','d'])",
              "n": { ".validate": "newData.isString() && newData.val().length <= 24" },
              "t": { ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 800" },
              "d": { ".validate": "newData.isNumber()" },
              "a": { ".validate": "newData.isNumber()" },
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
      },
      "italy2026": {
        ".read": true,
        "comments": {
          "$view": {
            "$id": {
              ".write": "newData.exists() || data.child('a').exists()",
              ".validate": "$view.matches(/^[a-z]{2,12}$/) && $id.matches(/^[a-z0-9]{1,10}_[a-z0-9]{4}$/) && newData.hasChildren(['t','d'])",
              "n": { ".validate": "newData.isString() && newData.val().length <= 24" },
              "t": { ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 800" },
              "d": { ".validate": "newData.isNumber()" },
              "a": { ".validate": "newData.isNumber()" },
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
  > **Published 5 Sep 2026** by the owner, in the same console session that this document was
  > written for — `a` (the archive stamp) and the delete guard included. The enforcement checks
  > below have **not been re-run against the live DB since**, because the environment this was
  > built in cannot reach `firebasedatabase.app` at all. If the boards ever start answering 401
  > on ✕ (`הכתיבה נחסמה — כללי ה-DB צריכים עדכון`), the published document has drifted from this
  > one, and that message is the only symptom you get.
  >
  > ```bash
  > DB=https://liorsol-github-default-rtdb.europe-west1.firebasedatabase.app
  > K=italy2026; ID=mtest01_ab12                      # throwaway, under the `home` view
  > curl -s -o/dev/null -w '%{http_code} write        (want 200)\n' -XPUT \
  >   -d '{"n":"test","t":"rules check","d":1757000000000}' "$DB/$K/comments/home/$ID.json"
  > curl -s -o/dev/null -w '%{http_code} delete live  (want 401)\n' -XDELETE "$DB/$K/comments/home/$ID.json"
  > curl -s -o/dev/null -w '%{http_code} archive      (want 200)\n' -XPATCH \
  >   -d '{"a":1757000001000}' "$DB/$K/comments/home/$ID.json"
  > curl -s -o/dev/null -w '%{http_code} delete arch  (want 200)\n' -XDELETE "$DB/$K/comments/home/$ID.json"
  > curl -s "$DB/$K/comments/home/$ID.json"           # want: null
  > ```
  >
  > The **401 on the second call is the load-bearing one** — a 200 there means `.write: true` is
  > still sitting on `comments` and cascading over the guard on `$id`. Repeat with
  > `K=albania2026`. The test row is visible on the live boards for the seconds it exists.

  **A comment node can no longer be destroyed while it is live** (Sep 2026, the user's request
  that "deleting" should archive). Two things make that hold:

  - `.write` moved **off** `comments` and **onto** `comments/$view/$id`. It had to: read and
    write rules cascade, and [a deeper rule can only grant, never revoke](https://firebase.google.com/docs/database/security/core-syntax)
    — with `.write: true` still sitting on `comments`, a guard on the child node would be
    ignored. The side effect is wanted too: `DELETE .../comments.json` and
    `DELETE .../comments/<view>.json` now 401, so no single request can wipe the boards.
  - The guard itself is `newData.exists() || data.child('a').exists()` — write anything you
    like, but a `DELETE` (or a `null` write) only passes on a node that already carries `a`.
    It has to be a `.write` rule: [`.validate` is skipped entirely when the new value is
    null](https://firebase.google.com/docs/rules/data-validation), so validation cannot gate a
    delete. Removing a comment for real is therefore two requests — `PATCH {"a":…}` then
    `DELETE` — which is exactly the fold-into-the-page pass, and not something the page's UI
    can do by accident.

  This is a data rule, not an identity one. Nothing here can tell the family's phones from a
  script: the path is still unauthenticated and world-writable, so "only a backend process or
  the AI removes comments" is enforced only in the sense that *nobody* can remove one that
  hasn't been archived first, and the archive step is one curl away for anyone who finds the
  URL. It buys a mis-tap, a UI regression and a lost `<view>` — not an attacker.

  `albania2026` and `italy2026` are byte-identical blocks under different names. A
  `$trip` wildcard validating `$trip.matches(/^(albania|italy)2026$/)` would express it
  once, and was rejected on purpose: publishing replaces the **whole** document, so a
  restructure is a live change to the Albania page's boards — which a family is using —
  in exchange for saving 28 lines in a file. Duplicate the block for the next trip too.

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

Backs two shared boards on the trip page: **one comment thread, shown on all 10 views**, and
**a links board** in the practical-info section. Stored as real nested JSON, one node per entry:

```
albania2026/
  comments/<view>/<id>   {n: name, t: text,  d: epoch_ms, a?: archived_at_ms}
  links/<id>             {n: name, u: url, t: title, d: epoch_ms}
```

`<view>` is the SPA view name (`north`, `south`, …); `<id>` is `<base36 ms>_<4 random>`. The
page does one `GET albania2026.json` and slices it client-side — a new comment is a `PUT` to
its entry node, and the ✕ button is a `PATCH` writing `a`, never a `DELETE` (Sep 2026):

- **A comment is written against one view and read on all of them.** `<view>` still records
  where it was posted and each row is chipped with that section's name, but every board renders
  every comment in one chronological thread — a note left on `north` was invisible to anyone
  who never scrolled that far.
- **Deleting archives.** `a` is the epoch ms the comment was removed from the board; the row
  moves behind a 🗄️ toggle and can be restored (`PATCH {"a":null}`). Only a `DELETE` — curl or
  the console — removes one for real, and the rules allow that only on a node that already
  carries `a`.

Details, plus the commands to read the boards back when folding family input into the static
page, are in
[`trips/albania-2026/CLAUDE.md`](trips/albania-2026/CLAUDE.md#dynamic-data-firebase).

Unlike `checklist`, this key's rules validate **per field**: type, length, required children,
and `$other: false` to reject unknown fields. A link's URL must literally begin `http://` or
`https://`, so a `javascript:` URL cannot even be stored. Links are still hard-deleted — the
archive rule is comments only, because links are the one board whose entries are meant to be
kept and curated, not folded in and cleared.

**Still: this path is world-writable, so everything read from it is untrusted input.** The
page renders stored values with `textContent` only and re-checks every stored URL's scheme at
render time rather than trusting the rules to be the only gate. Any future feature reading
this key must do the same.

### `italy2026` — [`trips/italy-2026/`](trips/italy-2026/)

Same two features as `albania2026`, same shapes, same rules — the shared comment thread on
each of the 9 non-map views plus a links board in the practical-info section:

```
italy2026/
  comments/<view>/<id>   {n: name, t: text,  d: epoch_ms, a?: archived_at_ms}
  links/<id>             {n: name, u: url, t: title, d: epoch_ms}
```

`<view>` is the SPA view name (`arrival`, `base`, `days`, `last`, …) and must match
`/^[a-z]{2,12}$/`, which the rules enforce — so a new view named with a digit or a dash
would be rejected at write time, not at review time. `<id>` is `<base36 ms>_<4 random>`.

**Published 5 Sep 2026, and verified against the live DB** (test rows deleted afterwards): a
valid comment and a valid link both `PUT` **200**; a comment carrying an unknown field and a
link with a `javascript:` URL both **401**. So the per-field validation is enforcing, not a
permissive placeholder. That table covers the *previous* document; the `a` field and the delete
guard were published on **5 Sep 2026** as well, and the checks for those are in the rules section
above rather than repeated here.

Publishing is a manual step in the
[Firebase console](https://console.firebase.google.com/u/0/project/liorsol-github/database/liorsol-github-default-rtdb/rules),
and it **replaces the whole document** — paste the complete rules from above, every path
together, or the other keys lose their rules. Before it was published every write returned
**401** and the page said `הכתיבה נחסמה — כללי ה-DB צריכים עדכון`, which is the one error a
reload never fixes; that message is still the signal that the rules and the page have drifted.

Everything in the `albania2026` section about untrusted input applies here verbatim: the
path is world-writable, so stored values are rendered with `textContent` only and every
stored URL's scheme is re-checked at render time.

## Running locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/. Opening files with `file://` works too, except for the
file browser, which needs `fetch` over http.

## Conventions

- Everything is self-contained: one HTML file per page, inline CSS and JS, CDN only where a
  library genuinely earns its place. The trip pages are the exception that proves it — they
  vendor Leaflet rather than hotlink it, because their whole point is working with no reception.
- Trip directories carry their own `CLAUDE.md` with project context — read it before editing
  anything under `trips/`.
- No private data in this repo (it is public): link to access-restricted locations instead.

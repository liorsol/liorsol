# CLAUDE.md — car charging dashboard

A dashboard for my own EV charging data: session history, energy, spend, and how much of each
session was actually delivering power.

## Goal

**Now:** a private dashboard showing charge history — sessions over time, energy, cost, and
how much of each session was actually delivering power versus sitting suspended.

Electricity here is **time-of-use, not flat** (confirmed 2026-09-10): an evening peak window
priced ~2.8× the rest of the day. So a session's cost depends on *when* its kWh landed, and
two numbers matter equally — how much of the session actually delivered power, and how much
of it was deferred into the cheap window. Deferring is usually correct; the dashboard's job is
to show which sessions were held for price and which were merely throttled.

**Later:** starting and stopping a charge from the same dashboard. That turns it from a
read-only view into something that acts on hardware, so it raises the bar on auth: a leaked
URL would stop being an information leak and start being physical control.

Remote **start** and **stop** are both understood as of 2026-09-11 and work from the CLI, so the
dashboard can ship real controls rather than placeholders. One deferral-scheduling call remains
uncaptured and will not be guessed — see the private notes.

**Access model:** signed in with my Google account, only me. The personal credential for the
upstream data source never reaches the browser — it lives in a proxy function. Everything
except the UI source runs on Cloudflare.

## Read this first

**The working notes, tooling and credentials for this project are deliberately NOT in this
repo.** They live in iCloud:

```
~/Library/Mobile Documents/com~apple~CloudDocs/car-charging-api/
├── CLAUDE.md     ← start here: current state, next steps, house rules
├── API-NOTES.md  ← full data-source reference
├── charge.sh     ← CLI: auth, token refresh, history, live status, remote start
├── *.har         ← app captures; the source of truth for request schemas
└── .token.json   ← credential, chmod 600
```

Start any session on this project by reading that folder's `CLAUDE.md`. This file is only a
signpost — it intentionally contains no technical detail.

## Why the split

This repo is public and search-indexed. The data source is a private mobile-app backend for my
building's charger, reached with a personal credential. Keeping the provider details, hostnames
and endpoints out of a public repo is the point.

**Rules for anything committed here:**

- No provider or app names, hostnames, endpoint paths, header names or token values — not in
  code, comments, commit messages, branch names or filenames.
- Upstream base URL and API tokens go in **Wrangler secrets** (`env.UPSTREAM_BASE`,
  `env.API_TOKEN`), never hardcoded — that keeps the Worker source safe to commit.
- Credentials never leave the iCloud folder.

If a change can't be described without naming the provider, it belongs in the iCloud notes, not
in this repo.

## Status

Nothing is built yet **in this repo**. This folder is documentation only: the goal, the auth
decision, and a pointer to the private notes. The data source is mapped and the CLI does
history, live status, remote start and remote stop — all in the iCloud folder above. Next
session starts at step 1 of the decision below.

The read-only route set below is still the right shape, but it now needs a third thing: the
live **tariff calendar**, since without it the dashboard cannot say whether a suspended session
is saving money or just losing time.

## What gets built here

Worker as a secret-holding proxy plus a static page, following the existing `esim-usage/`
pattern in this repo — but see the auth decision below: the page is served by Cloudflare Pages,
**not** GitHub Pages:

```
car-charging/proxy.js     Cloudflare Worker: holds credentials, returns sanitised JSON
car-charging/index.html   dashboard, served by Cloudflare Pages behind Access
```

Deploy the same bare way:

```bash
npx wrangler deploy car-charging/proxy.js --name car-charging-proxy --compatibility-date 2026-01-01
npx wrangler secret put UPSTREAM_BASE
npx wrangler secret put API_TOKEN
```

⚠️ **This Worker is not like `esim-usage/proxy.js`.** That one is deliberately open because it
holds no secrets. This one holds a credential that exposes personal details and will eventually
trigger physical actions on a charger. It must be gated. Expose a narrow, read-only route set
rather than a generic passthrough, and strip personal fields in the Worker before returning
anything to the browser.

## Auth: the one decision to make first

Read [Cloudflare Workers: the account is the quota](../README.md#cloudflare-workers-the-account-is-the-quota)
before designing this. Two goals here pull against each other:

1. sign in with Google, only me
2. an unauthenticated caller must not be able to burn the account's shared Worker quota
3. the UI lives on GitHub

**All three cannot hold at once.** Cloudflare Access gates only hostnames behind Cloudflare;
`liorsol.github.io` is not one. And a cross-origin `fetch` from GitHub Pages to an
Access-protected Worker fails, because the Google login is an interactive redirect that `fetch`
cannot follow.

| | Google sign-in | Quota safe | UI hosted on |
|---|---|---|---|
| **A. UI on Cloudflare Pages, Access over UI + Worker** | ✓ Access, Google IdP, one click | ✓ rejected at the edge, Worker never runs | Cloudflare (source still in this repo) |
| **B. UI on GitHub Pages, Worker verifies a Google ID token** | ✓ Google Identity Services in the page | ✗ every anonymous request still costs an invocation | GitHub Pages |

### ✅ Decided: option A — serve from Cloudflare (2026-09-07)

**Agreed, not yet implemented.** Deferred to a later session; nothing has been built or
deployed. Option B is rejected: it cannot satisfy goal 2, because a Worker that checks a token
in its own code has already paid for the request by the time it says no.

"UI on GitHub" still holds in the sense that matters — the source stays in this repo and
Cloudflare Pages builds from it. Only the serving moves.

**When picking this up, in order:**

1. Cloudflare Pages project building this repo, `car-charging/` as the output — replaces
   GitHub Pages for *this page only*; the rest of the site stays where it is.
2. Custom hostname on Cloudflare, one Access application covering both the page and the
   Worker route, Google as the identity provider, policy narrowed to my address.
3. `workers_dev = false` — otherwise the Worker keeps an unauthenticated door open beside the
   locked one, and option A's whole benefit evaporates.
4. Only then `proxy.js`: `UPSTREAM_BASE` + `API_TOKEN` as Wrangler secrets, narrow read-only
   routes, personal fields stripped before anything reaches the browser.
5. `index.html` last, once there's an authenticated endpoint to call.

Verify at the end by opening the Worker URL in a private window: it must land on Google
sign-in, not on data. If it returns JSON, the gate isn't on.

Credentials expire and cannot renew themselves unattended; the recovery procedure is in the
iCloud notes. The Worker should surface expiry explicitly (`503` + a clear banner) rather than
rendering empty charts.

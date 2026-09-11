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

**Access model:** the whole hostname sits behind one Cloudflare Access application whose policy
allows exactly one identity — mine. *Which* sign-in method that application uses is a dashboard
setting and is deliberately absent from this repo: nothing in the page, the Function or the
deploy names it, branches on it, or has to change when it changes. The personal credential for
the upstream data source never reaches the browser — it lives in the private proxy Worker.
Everything except the UI source runs on Cloudflare.

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
- The upstream base URL and the API token are **secrets bound to the private Worker**, never
  hardcoded and never in this repo — not even as a name in a wrangler config committed here.
- Credentials never leave the iCloud folder and the Cloudflare account.
- The private Worker's source is not committed to this repo under any filename.

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

Two halves. **Only one of them is in this repo**, and the split is the security model, not a
packaging preference.

In this directory — the whole public half, a Cloudflare Pages project, no build step:

```
car-charging/index.html                  the page
car-charging/{style.css,app.js,api.js}   and views/
car-charging/functions/api/[[path]].js   Pages Function: owns the comment board,
                                         hands everything else to the private half
car-charging/schema.sql                  D1 schema
```

**The proxy that holds the credential is not here, and must never be created here.** It is a
separate Worker; its source lives beside the private notes in the iCloud folder above, it is
deployed by hand, and it is never committed to any repo. Its credential lives in Cloudflare
Secrets Store, bound to that Worker — not in a file, not in this repo's Actions secrets, and
never passing through this directory. The page reaches it over a **service binding** on the
Pages project, so nothing here holds a hostname, a path, a header name or a token, and the two
halves deploy independently.

⚠️ **This is the opposite of the `esim-usage/proxy.js` pattern next door.** That Worker is
committed and deliberately open, because it holds nothing. This one holds a credential that
exposes personal details and closes a contactor on real hardware.

> A future session that finds itself about to create `car-charging/proxy.js`, or to run
> `wrangler secret put` in this directory, is about to put the credential in a public repo.
> That is what this section exists to prevent. `.gitignore` carries a tripwire for the filename;
> the tripwire is a backstop, not the rule.

## Auth: the one decision to make first

Read [Cloudflare Workers: the account is the quota](../README.md#cloudflare-workers-the-account-is-the-quota)
before designing this. Two goals here pull against each other:

1. exactly one identity can reach the dashboard — mine
2. an unauthenticated caller must not be able to burn the account's shared Worker quota
3. the UI lives on GitHub

**All three cannot hold at once.** Cloudflare Access gates only hostnames behind Cloudflare;
`liorsol.github.io` is not one. And a cross-origin `fetch` from GitHub Pages to an
Access-protected Worker fails, because the gate answers an unauthenticated call with an
interactive sign-in redirect — cross-origin, and one a `fetch` cannot follow.

| | One identity only | Quota safe | UI hosted on |
|---|---|---|---|
| **A. UI on Cloudflare Pages, Access over UI + Worker** | ✓ the gate decides at the edge, before any code of ours runs | ✓ rejected at the edge, Worker never runs | Cloudflare (source still in this repo) |
| **B. UI on GitHub Pages, Worker verifies an identity token itself** | ✓ an identity check written into the page and the Worker | ✗ every anonymous request still costs an invocation | GitHub Pages |

### ✅ Decided: option A — serve from Cloudflare (2026-09-07)

Option B is rejected: it cannot satisfy goal 2, because a Worker that checks a token in its own
code has already paid for the request by the time it says no. Goal 1 is met as a property of the
hostname rather than of any page code: the access gate admits exactly one identity and enforces
it at the edge.

**Which** sign-in method that gate uses is a dashboard setting and is named nowhere in this repo
— not here, not in the page, not in the Function, not in the deploy (see *Access model* above).
Two reasons, and both still hold. It is reconnaissance: the sign-in page renders to anonymous
visitors, so naming the factor that guards the dashboard hands a passer-by the one fact worth
having. And it has already changed once since this decision was written — a doc that names a
method is a doc that goes stale and misleads the next session into building against a model that
is no longer there. Nothing in this repo reads it, branches on it, or has to change when it
changes again; if you need to know what is configured today, read the dashboard or the private
notes.

"UI on GitHub" still holds in the sense that matters — the source stays in this repo and
Cloudflare Pages builds from it. Only the serving moves.

**The shape this landed in, and the order it has to be built in:**

1. Cloudflare Pages project serving `car-charging/` — replaces GitHub Pages for *this page
   only*; the rest of the site stays where it is.
2. One Access application over the whole hostname, policy narrowed to my one address. A second
   application is needed over the preview hostnames, or preview deployments are an open door —
   which is why **no binding is ever attached to the preview environment** (`README.md`).
3. `workers_dev = false` on the private Worker and no route on it — otherwise it keeps an
   unauthenticated door open beside the locked one and option A's whole benefit evaporates. The
   service binding from the Pages project is its only door.
4. The private Worker itself, **built and deployed from the iCloud folder, never from here**:
   its secrets live in Cloudflare Secrets Store, it exposes a narrow route set rather than a
   passthrough, and it strips personal fields before anything reaches the browser.
5. The page last, once there is an authenticated endpoint to call.

Verify at the end by opening the hostname in a private window: it must land on the Access
sign-in, not on data. If it returns JSON, the gate isn't on — and check a preview URL the same
way, not only the production hostname.

Credentials expire and cannot renew themselves unattended; the recovery procedure is in the
iCloud notes. The Worker should surface expiry explicitly (`503` + a clear banner) rather than
rendering empty charts.

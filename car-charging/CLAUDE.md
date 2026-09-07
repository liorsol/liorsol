# CLAUDE.md — car charging dashboard

A dashboard for my own EV charging data: session history, energy, spend, and how much of each
session was actually delivering power.

## Goal

**Now:** a private dashboard showing charge history — sessions over time, energy, cost, and
how much of each session was actually delivering power versus sitting suspended.

**Later:** starting and stopping a charge from the same dashboard. That turns it from a
read-only view into something that acts on hardware, so it raises the bar on auth: a leaked
URL would stop being an information leak and start being physical control.

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
├── charge.sh     ← CLI: auth, token refresh, fetch history
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

## What gets built here

Following the existing `esim-usage/` pattern in this repo — Worker as a secret-holding proxy,
static page on GitHub Pages:

```
car-charging/proxy.js     Cloudflare Worker: holds credentials, returns sanitised JSON
car-charging/index.html   dashboard, served from GitHub Pages
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

**Recommendation: A.** It's the only one that actually satisfies goal 2, it makes Google auth a
configuration checkbox instead of JWT-verification code, and it costs nothing — Access is free
to 50 users. "UI on GitHub" still holds in the sense that matters: the source stays in this
repo and Cloudflare Pages builds from it. Only the serving moves.

Pick B only if serving from GitHub Pages is a hard requirement. Then the Worker must verify the
Google ID token itself — validate the signature against Google's JWKS, and check both `aud`
(my OAuth client ID) and `email`. Reject before any upstream call, and put WAF rate limiting in
front, since that's the only thing left protecting the quota.

Either way: disable `workers.dev` (`workers_dev = false`), or it's an unauthenticated door
straight to the Worker regardless of which option is chosen.

Credentials expire and cannot renew themselves unattended; the recovery procedure is in the
iCloud notes. The Worker should surface expiry explicitly (`503` + a clear banner) rather than
rendering empty charts.

# CLAUDE.md — car charging dashboard

A dashboard for my own EV charging data: session history, energy, spend, and how much of each
session was actually delivering power.

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
holds no secrets. This one holds a credential that exposes personal details and can trigger
physical actions on a charger. It must be gated — Cloudflare Access preferred; an origin
allowlist is not a gate, since `Origin` is trivially forged outside a browser. Expose a narrow,
read-only route set rather than a generic passthrough, and strip personal fields in the Worker
before returning anything to the browser.

Credentials expire and cannot renew themselves unattended; the recovery procedure is in the
iCloud notes. The Worker should surface expiry explicitly (`503` + a clear banner) rather than
rendering empty charts.

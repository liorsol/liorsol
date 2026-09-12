# CLAUDE.md — car charging dashboard

A private dashboard for my own EV charging data: session history, energy, spend, the live
time-of-use tariff, what deferring a charge saved, and working start/stop controls.

**State, 2026-09-12: built, deployed and serving real data.** This is no longer a design
document. The page renders, the API answers, the private Worker holds the credential, and a
real charging session has been read end to end. Read this whole file before changing anything
here — several of the things it says are counter-intuitive and each one was paid for.

## Read this first

**The working notes, tooling and credentials are deliberately NOT in this repo.** They live in
iCloud:

```
~/Library/Mobile Documents/com~apple~CloudDocs/car-charging-api/
├── CLAUDE.md        ← start here: current state, next steps, house rules
├── API-NOTES.md     ← full data-source reference
├── charge.sh        ← CLI: auth, token refresh, history, live status, start, stop
├── worker/          ← the private Worker's source + DEPLOY.md. Never committed anywhere.
├── tests/           ← the security and functional suites that run against the live host
├── build/           ← the build record: PLAN.md, STATUS.md, HANDOFF.md, DISPATCH-LOG.md, notes
├── *.har            ← app captures; the source of truth for request schemas. Do not read these.
└── .token.json      ← credential, chmod 600
```

Start any session by reading that folder's `CLAUDE.md`, then `build/HANDOFF.md`. This file is a
signpost: it carries the shape and the rules, and no vendor detail at all.

## Why the split — the secrecy rule

This repo is public and search-indexed. The data source is a private mobile-app backend for my
building's charger, reached with a personal credential. Keeping the provider out of a public
repo is the entire reason the system has the shape it has.

**Rules for anything committed here:**

- **No vendor or app name, hostname, endpoint path, header name, field name or token value** —
  not in code, comments, commit messages, branch names or filenames.
- **No personal identifier**: no address, no mail zone, no account name, no id.
- The upstream base URL and the upstream tokens are **secrets bound to the private Worker**,
  never hardcoded, never in this repo, not even as a name in a wrangler config committed here.
- Credentials never leave the iCloud folder and the Cloudflare account.
- The private Worker's source is not committed to this repo under any filename.

If a change cannot be described without naming the provider, it belongs in the iCloud notes.

**This extends to the sign-in details, and that omission is a rule, not an oversight.** The
mechanism below is described because code in this repo implements it and cannot be understood
otherwise. Everything around it — the recipient address, the sending zone, the identity
provider, the configured origins — is named nowhere here and must not be added "for clarity".
Two reasons, both still live. It is reconnaissance: the sign-in screen renders to anonymous
visitors, so naming what guards the dashboard hands a passer-by the one fact worth having. And
it has already changed three times; a doc that names it is a doc that goes stale and misleads
the next session into building against a model that is gone. Nothing here reads it, branches on
it, or has to change when it changes again.

## Auth — how it actually works

**The gate is application code in the private Worker.** There is no edge gate.

- Sign-in is a **single-use link mailed to one fixed address**, configured on the Worker. The
  login route takes **no address and cannot be made to** — it never reads its request body, and
  the platform binding refuses any other recipient. It always answers `200 {"ok":true}`,
  whatever happened, so nothing is enumerable.
- A followed link sets **`__Host-session`**: an HS256 JWT in an
  `HttpOnly; Secure; SameSite=Lax; Path=/` cookie. `HttpOnly` and not `localStorage`
  specifically because this page closes a contactor — an XSS that can read a token is physical
  control of the charger.
- Every request verifies the signature, the expiry, **and that the token's `jti` is still a row
  in the D1 `sessions` table**. That row is the revoke handle: one `DELETE` kills a session and
  the next request is a `401`. Rotating the signing key kills all of them.
- **Everything under `/api/*` answers `401 {"error":"auth_required"}` without a valid session.**
  `403 forbidden` means a session not allowed that route; `503 token_expired` means the
  *charger* credential is dead and has nothing to do with sign-in. Three states, none collapsed.
- The signing key lives in Secrets Store bound to the Worker. **If it is missing the system does
  not degrade, it closes** — every route 401s and no unsigned cookie is ever minted, which looks
  exactly like "nobody has signed in yet". If sign-in silently never works, check the key first.

Full contracts, the threat reasoning, and which mutations were watched failing:
`build/backend/auth-notes.md`. The repo-side half runs offline with
`node --test car-charging/test/`.

### The retired model — do not propose it again

This directory previously documented **Cloudflare Access** as the live gate, and every version
of that is now wrong. **Access is not used, was never enabled on the account, and the owner
decided against it three times.** The decision is settled; do not re-litigate it, do not
"restore" the edge gate, and do not write code that reads an edge identity header — that header
is injected by a product that is not on this account, so it is never present, and the Function
that trusted it answered `403` to everyone including the owner.

The record is kept here because deleting it silently guarantees the next session proposes it
again from first principles. What it cost to give up is stated honestly below.

### The page is public on purpose

**The HTML, CSS and JS are served to anyone. The gate is on `/api/*` only.** This is deliberate
and is not a bug to fix:

- the page contains no data and no secret — it renders whatever the API gives it, and anonymous
  it gets `401`s and a sign-in screen;
- moving the gate in front of the page means an edge gate, which is the retired model.

The cost, stated plainly: an anonymous `/api/*` request now **costs a Worker invocation**, which
the original design treated as a hard requirement to avoid (see
[Cloudflare Workers: the account is the quota](../README.md#cloudflare-workers-the-account-is-the-quota)).
That property is gone by construction and is mitigated, not restored: the login route is rate
limited, and a request carrying no `__Host-session=` jar entry is refused in the Function for
**one** invocation with no upstream call. Do not "fix" the public page by reaching for an edge
product — that trade was made knowingly.

## The architecture — two halves, and the split is the security model

**Only one half is in this repo.**

In this directory — the whole public half, a Cloudflare Pages project, no build step:

```
car-charging/index.html                  the page
car-charging/{app.js,api.js,style.css}   app shell, transport, design system
car-charging/views/                      account, auth, comments, controls, he, history, tariff
car-charging/functions/api/[[path]].js   Pages Function: authorises, owns the comment board,
                                         forwards everything else to the private half
car-charging/schema.sql                  D1 schema: cache, comments, sessions, login_tokens
car-charging/_redirects                  the denylist that keeps docs/tests/schema off the host
car-charging/_headers                    CSP, frame-ancestors, referrer, nosniff
car-charging/_routes.json                pins the Function to /api/*
car-charging/.assetsignore               intent only — inert on this uploader, see _redirects
car-charging/test/                       the repo-side suite: node --test car-charging/test/
car-charging/README.md                   the operational detail for this directory
```

The Function is **thin and vendor-neutral**. It holds no host, no path, no header, no credential
and no signing key. It asks the Worker one body-less question to authorise, answers the comment
board itself, and forwards the rest over the binding unchanged.

**The proxy that holds the credentials is not here, and must never be created here.** It is a
separate Worker; its source lives in `worker/` beside the private notes, **outside git
entirely**, and it is deployed by hand. Its secrets live in **Cloudflare Secrets Store, bound to
that Worker** — never to Pages, never in a file, never in this repo's Actions secrets. The page
reaches it over a **service binding** on the Pages project, so the two halves deploy
independently and nothing here holds a vendor fact.

`workers_dev = false` and **no routes** on that Worker: it has no public door, and the service
binding is the only way in. If a deploy of it ever prints a `workers.dev` URL or a route, stop —
that is the whole security model, not a detail.

⚠ **This is the opposite of the `esim-usage/proxy.js` pattern next door.** That Worker is
committed and deliberately open, because it holds nothing. This one holds credentials that
expose personal details and close a contactor on real hardware.

> A future session about to create `car-charging/proxy.js`, or to run `wrangler secret put` in
> this directory, is about to put a credential in a public repo. That is what this section
> exists to prevent. `.gitignore` carries a tripwire for the filename; the tripwire is a
> backstop, not the rule.

**Bindings are production-only, always.** Preview deployment URLs are permanent, guessable from
a public repo and printed in every deploy log. Nothing is ever bound to the preview environment.

## Deploying

Two independent deploys. Neither touches the other.

**The page** (from the repo root):

```bash
rm -rf car-charging/.wrangler          # see "Two measured facts" — do this every time
npx wrangler pages deploy . --cwd car-charging --project-name car-charging --branch main
```

`--cwd car-charging` is **load-bearing and is not the same command as `pages deploy
car-charging`**. Wrangler resolves `functions/` against its working directory, not against the
asset directory you name: run it the other way and it uploads every static file, compiles **no
Function**, and `/api/*` serves a static 404 with no error anywhere. The tell is the line
`✨ Compiled Worker successfully`. **A deploy without that line is a lie.**

`.github/workflows/car-charging-pages.yml` does this on any push touching `car-charging/**`, and
fails the job if that line is absent.

**The Worker**: by hand, from `worker/` in the iCloud folder, per its own `DEPLOY.md`. Never
from here, never from CI. Schema changes go in with
`npx wrangler d1 execute car-charging --remote --file car-charging/schema.sql` — every statement
is `IF NOT EXISTS`.

**Verify after a page deploy** — four checks, none of them by argument:

1. `/api/state`, `/api/history` and friends answer **`401 auth_required`** with no cookie, with
   a junk cookie, and with a forged `__Host-session` value. Not `403`, not `200`.
2. `/.wrangler/cache/wrangler-account.json` answers **302**, not 200.
3. `/CLAUDE.md`, `/README.md`, `/schema.sql`, `/.assetsignore`, `/test/*` answer **302**.
4. The page itself answers 200 and carries the CSP and frame headers from `_headers`.

## Two measured facts worth inheriting

**1. Secrets Store propagation is lazy.** A secret written through the API or the CLI is **not**
seen by an already-running isolate; the Worker keeps serving the old value until it is
redeployed. Consequences: rotating a credential is a write **plus a redeploy**, in-page rotation
cannot clear its own banner, and the Secrets Store *write* credential that would have made
in-page rotation possible is deliberately **not created at all** — it would outrank every secret
it protects and buys nothing when the write needs a redeploy anyway.

**2. `car-charging/.wrangler` regenerates and has been served publicly.** Anything that runs
wrangler in this directory recreates it, it is gitignored so **nothing warns you**, and the
classic Pages uploader's fixed ignore list does **not** cover it despite notes in this repo that
once claimed otherwise. It was measured live: `/.wrangler/cache/wrangler-account.json` returned
`200` with the account name in it, and the same directory holds miniflare's D1/KV/cache SQLite
files, which carry whatever local dev last fetched. It has come back three times.
**Delete it before every deploy.** The `/.wrangler/*` rule in `_redirects` is the backstop for
the time someone forgets, not the fix.

More generally: `_redirects` is a **denylist**. Every file added to `car-charging/` later is
served on the hostname until a line is added for it.

## Do not guess: the two uncaptured calls

Both remain **uncaptured and unimplemented**, and neither may be inferred, reconstructed or
guessed:

- the **off-peak-change request schema** (the call that writes the setting — named in the
  private notes, not here), and
- the **charge-now value** of the off-peak setting (only the deferring value has ever been seen
  on the wire).

Guessing either actuates a contactor on real hardware **and** buys energy at roughly **2.79×**
the low tariff. There is therefore deliberately **no charge-now control and no off-peak toggle
in the UI**, and that absence is a decision, not a gap in the work. The capture runbook is in
the iCloud notes and only the owner can run it.

Related, and the same discipline: nothing has ever been fired at the real charger by an agent.
Start and stop are built and tested against captured traffic. They are not run without the owner
watching.

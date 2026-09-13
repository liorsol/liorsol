# Google SSO on Cloudflare — central auth Worker + guarded sites

**Date:** 2026-09-13
**Status:** approved design, not yet implemented
**Supersedes:** the single-Worker draft of the same date (commit `e05b4f4`)
**Scope:** a new `sso/` tree. Nothing in `car-charging/`, `esim-usage/` or the static site changes.

---

## 1. What this is

A **central authentication Worker** at `auth.liorsolomon.com` that owns the Google OAuth client
and the session key, plus a **worked example site** that is guarded by it. Written so that
guarding site number three is a wrangler binding and about twenty lines of Worker code.

- `sso/auth/` — the auth Worker. Runs the OAuth 2.0 Authorization Code + PKCE flow against
  Google, admits only allowlisted addresses, issues a session cookie scoped to
  `liorsolomon.com`, and answers one question for everybody else: *is this cookie a valid
  session, and whose?*
- `sso/example/` — a guarded site. Redirects signed-out page requests to the auth Worker,
  answers signed-out API requests with 401, and holds no auth secret of any kind.
- `sso/access-spike/` — instructions for evaluating Cloudflare Access as an alternative. Docs
  only, no code. See §12.

It is a reference implementation first: the explanatory comments and the test suite are part of
the deliverable, not decoration.

### The payoff of one registrable domain

All sites live under `liorsolomon.com`. That single fact removes the hardest part of
cross-site SSO: **there is no handoff protocol.** The auth Worker sets one cookie scoped to
`Domain=liorsolomon.com`, and the browser then presents it at every subdomain by itself. No
handoff token, no per-site exchange endpoint, no key distribution, no second redirect leg.

It also means **one redirect URI registered with Google, forever** —
`https://auth.liorsolomon.com/auth/callback` — no matter how many sites are added. Adding a site
does not touch the Google Cloud console at all.

### Explicit non-goals

- **No refresh tokens.** No `access_type=offline`, no `offline_access` scope, no token storage.
  Nothing here ever calls a Google API after login; the `id_token` is the entire point of the
  exchange. This is the most common thing these examples over-build.
- **No user database.** Identity is an allowlist in configuration.
- **No proxying.** The auth Worker never sees a guarded site's traffic. See §4.
- **No server-side revocation on day one** — but unlike the previous draft, this design makes
  adding it a one-file change. See §6.

---

## 2. Topology

```
                          ┌──────────────────────────────────┐
                          │  auth.liorsolomon.com            │
   browser ──────────────>│  sso/auth                        │──────> accounts.google.com
      │                   │                                  │        oauth2.googleapis.com
      │                   │  holds:  GOOGLE_CLIENT_SECRET    │
      │                   │          COOKIE_SECRET           │
      │                   │  routes: /auth/login             │
      │                   │          /auth/callback          │
      │                   │          /auth/logout            │
      │                   │          /verify                 │
      │                   └──────────────────────────────────┘
      │                                   ▲
      │  __Secure-lsid                    │ service binding AUTH
      │  Domain=liorsolomon.com           │ (same thread, zero latency,
      │  presented to every subdomain     │  one billable request)
      │                                   │
      │                   ┌───────────────┴──────────────────┐
      └──────────────────>│  demo.liorsolomon.com            │
                          │  sso/example                     │
                          │  holds:  no secret of any kind   │
                          └──────────────────────────────────┘
```

### Sign-in, end to end

```
 browser                 demo.liorsolomon.com        auth.liorsolomon.com        Google
    │                           │                            │                      │
    │ GET /app/reports          │                            │                      │
    ├──────────────────────────>│ no cookie → no probe       │                      │
    │ 302 auth…/auth/login?next=https://demo…/app/reports    │                      │
    │<──────────────────────────┤                            │                      │
    │ GET /auth/login?next=…    │                            │                      │
    ├───────────────────────────────────────────────────────>│ validate next        │
    │                           │                            │ mint state+verifier  │
    │ 302 accounts.google.com   │   Set-Cookie __Host-oauth (auth host only)        │
    │<───────────────────────────────────────────────────────┤                      │
    ├──────────────────────────────────────────────────────────────────────────────>│
    │ 302 /auth/callback?code&state                                                 │
    │<──────────────────────────────────────────────────────────────────────────────┤
    ├───────────────────────────────────────────────────────>│ POST /token ────────>│
    │                           │                            │<──────── { id_token }│
    │                           │                            │ iss/aud/exp/verified │
    │                           │                            │ → allowlist          │
    │ 302 https://demo…/app/reports                          │                      │
    │   Set-Cookie __Secure-lsid; Domain=liorsolomon.com     │                      │
    │   Clear-Cookie __Host-oauth                            │                      │
    │<───────────────────────────────────────────────────────┤                      │
    │ GET /app/reports          │                            │                      │
    ├──────────────────────────>│ AUTH.fetch('/verify') ────>│ HMAC + exp → 200     │
    │ 200 the page              │<─────── {sub,email,exp} ───┤                      │
    │<──────────────────────────┤                            │                      │
```

---

## 3. Routes

### `sso/auth` — auth.liorsolomon.com

| Route | Method | Behaviour |
|---|---|---|
| `/auth/login` | GET | validate `next`, mint `state` + `code_verifier`, set `__Host-oauth`, 302 to Google |
| `/auth/callback` | GET | exchange code, validate `id_token`, allowlist, set `__Secure-lsid`, 302 to `next` |
| `/auth/logout` | POST | clear `__Secure-lsid`, 204 |
| `/verify` | GET | `200 {sub, email, exp}` or `401` — the only route other Workers call |
| `/login` | GET | the static sign-in page, one button. Public. |

`/auth/login` and `/auth/callback` are unauthenticated by necessity — they are the door, and they
are the only routes reachable with no session.

### `sso/example` — demo.liorsolomon.com

| Route | Public? | Signed-out behaviour |
|---|---|---|
| `/api/*` | guarded | `401 {"error":"auth_required"}` |
| `/app`, `/app/*` | guarded | `302 https://auth.liorsolomon.com/auth/login?next=<absolute URL>` |
| everything else | public | `env.ASSETS.fetch(request)` |

---

## 4. Why sites *ask* rather than verify, and why the auth Worker is not a proxy

Three models were available. The choice is load-bearing, so all three are recorded.

**(a) Share `COOKIE_SECRET` with every site.** Each site verifies the HMAC locally, no call at
all. Rejected: N copies of the signing key, and any one compromised site can **mint** a session
valid everywhere. The blast radius of the weakest site becomes the blast radius of every site.

**(b) Sites call `/verify` over a service binding.** ← **chosen.** Exactly the shape already
running in `car-charging/functions/api/[[path]].js` (`callerClass()` probes an upstream that holds
the key). One secret, one place. A site can *check* a session and can never mint one.

The cost assumption that would normally argue against this turns out to be false: service
bindings run both Workers **on the same thread of the same Cloudflare server with zero added
latency**, and on Workers Standard pricing the whole chain is billed as **one request** plus
combined CPU time. There is no per-request tax to trade away.

`/verify` is an ordinary HTTP route, so a site that is *not* a Worker can call
`https://auth.liorsolomon.com/verify` directly instead. Same code, same response; the binding
merely skips DNS and TLS. Nothing extra is built to support this.

**(c) Route all guarded traffic *through* the auth Worker as a gateway.** Rejected, and this is
the one point where the request is being answered with something slightly different from what was
asked. Proxying would mean the auth Worker knows every site's routes and every site's
responses, and a bad deploy of it takes down every site at once rather than failing one login.
Verification keeps it ignorant of what it protects and keeps failures isolated. Since (b) costs
nothing in latency or billing, the gateway buys no performance either — only coupling.

### The cheap refusal

A site **does not call `/verify` when the request carries no session cookie**, testing the
cookie's *name* anchored to the start of a jar entry rather than the presence of a `Cookie`
header. Every browser that has ever visited sends something, so testing presence puts an ordinary
anonymous drive-by on the expensive path. Lifted verbatim from
`car-charging/functions/api/[[path]].js`, including the regex.

An unreachable auth Worker is **not** a reason to admit anyone — it is a reason nobody can be.
`/verify` failing closed is the required behaviour and is pinned by a test.

---

## 5. Gating: redirect for pages, 401 for APIs

Signed-out requests get two different answers, and **the path decides which — never a request
header.**

- `/api/*` → `401 {"error":"auth_required"}`, `Cache-Control: no-store`.
- every other guarded path → `302` to the auth Worker's `/auth/login`.

The alternative is to sniff `Sec-Fetch-Mode: navigate` or `Accept: text/html`. Rejected: it is
the more correct answer in the abstract and the more fragile one in practice — a header that is
absent, proxied away or sent by a non-browser client silently flips a JSON caller onto the HTML
path, and the symptom is an HTML login page arriving in a `JSON.parse`.

**A redirect answer to a `fetch()` is worse than useless**: `fetch` follows the 302 transparently
and hands the caller a 200 containing the login page. Anything reached by script must live under
`/api/`.

### `next` is now a cross-subdomain open-redirect surface

In the single-site draft `next` was a path and the check was "starts with exactly one `/`". It is
now an **absolute URL**, which is a materially larger surface.

`next` is validated against `ALLOWED_ORIGINS` — an explicit, comma-separated list of full origins
in the auth Worker's configuration:

```
ALLOWED_ORIGINS = "https://demo.liorsolomon.com,https://liorsolomon.com"
```

Matching is on the **parsed `URL.origin`, compared for exact equality against a list member**.
Never a suffix test. A suffix test on `.liorsolomon.com` would be one character from admitting
`https://evilliorsolomon.com`, and would also silently admit any future subdomain — including one
delegated by CNAME to a third-party service — as a valid place to deliver a session-bearing
redirect. An explicit list is the extra line that costs nothing and closes both.

Rejected `next` values do not error; they fall back to `DEFAULT_NEXT`. `next` is validated where
it is stored *and* where it is used.

### CSRF: subdomains are same-site

This is new, and it is a direct consequence of the domain-scoped cookie. `SameSite=Lax` protects
against *cross-site* requests — but `evil.liorsolomon.com` and `demo.liorsolomon.com` are the
**same site**, so `Lax` sends the cookie between them on any method.

Every state-changing request (anything not `GET`/`HEAD`) to a guarded route therefore requires an
`Origin` header present and exactly equal to a member of `ALLOWED_ORIGINS`. Same variable as
`next` validation — one list, two uses. A missing `Origin` on a non-`GET` is a refusal, not a
pass.

---

## 6. Sessions

### Format

```
__Secure-lsid = base64url(JSON {sub, email, exp}) "." base64url(HMAC-SHA256(COOKIE_SECRET, part1))
```

Signed and verified with Web Crypto, compared in constant time. **Deliberately not a JWT**: no
header segment means no `alg` field, therefore no `alg: none` and no algorithm-confusion class of
bug. Only the auth Worker ever parses this value, so there is no interoperability to buy with a
standard envelope.

### Attributes, and the downgrade being accepted

```
__Secure-lsid=…; Domain=liorsolomon.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=<TTL>
```

The previous draft used the `__Host-` prefix, which is the strongest cookie confinement
available. **It is being given up deliberately**, because `__Host-` forbids a `Domain` attribute
and a `Domain` attribute is the entire mechanism that makes this SSO work.

What is being accepted: **any subdomain of `liorsolomon.com` can set or overwrite this cookie** —
including a subdomain that is compromised, or one CNAMEd to a third-party host. The mitigations
are that the value is HMAC-signed so an overwrite cannot forge a *valid* session, only destroy
the existing one, and that DNS for the zone stays under the same control as the Workers. This
should be re-examined the first time a `liorsolomon.com` subdomain is pointed at something not
operated by its owner.

`__Host-oauth` — the 10-minute in-flight cookie carrying `{state, verifier, next}` — **keeps the
`__Host-` prefix**, because it lives only on `auth.liorsolomon.com` and never needs to cross a
subdomain. Two cookies, two different confinement levels, each as tight as its job allows.

**`SameSite=Lax` on `__Host-oauth` is load-bearing and is the single most likely thing to get
wrong.** The callback arrives as a top-level cross-site GET from `accounts.google.com`; under
`Strict` the browser withholds the cookie, the callback finds no stored state, and the flow dies
with an error that looks like a bug in state handling rather than a cookie attribute. Pinned by a
test.

`__Host-oauth` is **not signed**: it is the trusted copy that the returning `state` is compared
*against*, and it cannot be set cross-origin. Signing it would protect nothing.

### Revocation

Still stateless on day one: nothing is stored, so nothing can be deleted. Sign-out clears the
cookie in that one browser; a stolen cookie stays valid until `exp`. The mitigation is a short
`SESSION_TTL` (8h default).

**What has changed is the cost of fixing it.** Because exactly one Worker verifies sessions,
adding revocation is a `jti` in the payload, a KV row, and one lookup in `/verify` — a change to
one file that every guarded site inherits without redeploying. Under model (a) it would have been
impossible. Named, not built; §13 records the trigger.

---

## 7. The OAuth exchange

Authorization Code with PKCE (`S256`), confidential client. Google issues a client secret for
web-application clients regardless of PKCE and does not support
`token_endpoint_auth_method: none` for this client type — PKCE is defence against code
interception, **not** a substitute for the secret. Both are sent.

Authorize parameters: `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email`,
`state`, `code_challenge`, `code_challenge_method=S256`, `prompt=select_account`.

`hd` is not sent. The allowlist is the gate, and `hd` on the authorize *request* is a UI hint that
must never be trusted as a constraint.

---

## 8. Validating the `id_token` — and what JWKS is

The token response is read for `id_token`. **Its signature is not verified, and no JWKS fetch
happens anywhere in this design.**

**What JWKS is.** Google signs the `id_token` with a private key. The JSON Web Key Set at
`https://www.googleapis.com/oauth2/v3/certs` is the matching list of *public* keys, published so
that anyone holding a token can check the signature and prove Google minted it. It exists for
tokens that arrive **second-hand** — handed over by a client, forwarded by another service, read
out of a header — where the receiver has no idea where they came from.

**Why it is not needed here.** The auth Worker makes the `POST` to
`https://oauth2.googleapis.com/token` itself, over TLS. TLS has already proved the response came
from Google. OIDC Core §3.1.3.7 clause 6 says so explicitly: when the ID Token is received by
direct communication between client and token endpoint, TLS server validation *may* be used in
place of checking the signature. Skipping it removes a network round-trip and an RSA verify from
every login, and removes the JWKS cache as a thing that can go stale or fail.

**The invariant that keeps this true, stated as a rule for the whole system:**

> The `id_token` never leaves the Worker that fetched it. It is decoded, checked, converted into
> our own HMAC-signed cookie, and dropped. It is never forwarded, never stored, never logged.

This is the reason the central Worker verifies sessions rather than handing tokens to sites.
Google's token stops at `sso/auth`; what crosses to a site is a `/verify` answer about our own
cookie. Break the invariant — forward the `id_token` to a site — and that site is receiving it
second-hand and would need full JWKS verification, key rotation handling and a cache. The design
is arranged so that day never comes.

### The checks that *are* performed

Each failure is a 403 and a logged `reason`.

| Claim | Check |
|---|---|
| `iss` | exactly `https://accounts.google.com` or `accounts.google.com` |
| `aud` | strictly equals `GOOGLE_CLIENT_ID` |
| `exp` | in the future, 60s clock-skew allowance |
| `iat` | not implausibly far in the future, same allowance |
| `email_verified` | strictly boolean `true` — not truthy, not the string `"true"` |
| `email` | lowercased, present in `ALLOWED_EMAILS` |

A non-allowlisted address gets a **403 with a page that says so**, never a 200 in a signed-out
state. Telling someone they are signed out when they are in fact refused sends them round the
loop forever.

---

## 9. Security headers

`_headers` is **not applied to responses generated by Worker code**, even when the request URL
matches one of its rules. Guarded pages are emitted by the Worker, so the header set exists in two
places per project: `public/_headers` for public assets, and a `SECURITY_HEADERS` constant
attached to every response the Worker returns — **including responses passed through from
`env.ASSETS.fetch()`**, using `.set()` so a header the binding did supply is overwritten rather
than duplicated.

Two mechanisms that must agree with no way to check each other is exactly the failure
`car-charging/_headers` documents at length. **Mitigation:** a test parses the `/*` block out of
`public/_headers` and asserts byte-equality with `SECURITY_HEADERS`. Divergence fails a test
instead of failing silently. Both projects get this test.

The set, from `car-charging/_headers`:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
X-Frame-Options: DENY
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

`frame-ancestors 'none'` earns its place: a signed-in session plus a framed page plus one baited
click is how a gated action gets taken by someone else.

`Referrer-Policy: no-referrer` earns a second mention here: without it, a signed-in page that
links outward leaks the `next` URL structure in a `Referer`.

---

## 10. Logging

Both Workers: `"observability": { "enabled": true, "head_sampling_rate": 1 }`.

Workers Logs gives 200,000 logs/day at 3-day retention on the free plan, 7 days on paid.
Structured objects passed to `console.log` have their fields extracted and indexed, so events
filter by key rather than by text match. Per-log cap 256 KB.

One `log()` helper, one line per event:

```js
log({ evt, outcome, reason, email, sub, origin, next, ray, ms })
```

| Worker | `evt` | `outcome` | typical `reason` |
|---|---|---|---|
| auth | `auth.login.start` | `ok` / `rejected` | `bad_next_origin` |
| auth | `auth.callback` | `ok` / `denied` / `error` | `state_mismatch`, `no_oauth_cookie`, `provider_error`, `token_exchange_failed`, `bad_iss`, `bad_aud`, `expired`, `email_unverified`, `not_allowlisted` |
| auth | `auth.logout` | `ok` | — |
| auth | `auth.verify` | `ok` / `denied` | `bad_signature`, `expired`, `malformed` |
| site | `guard.deny` | `redirect` / `401` | `no_session`, `verify_denied`, `auth_unreachable`, `bad_origin` |

`ray` is `cf-ray`, so a line joins to the request in Cloudflare's own logs — and because the
service binding preserves the request, **the site's `guard.deny` and the auth Worker's
`auth.verify` for the same request share a ray**, which is what makes a two-Worker system
debuggable at all.

`ms` is wall time for the token exchange, the only outbound call and the only thing that can be
slow.

### Never logged

`code`, `code_verifier`, `state`, `id_token`, `access_token`, `refresh_token`,
`GOOGLE_CLIENT_SECRET`, `COOKIE_SECRET`, the raw `Cookie` header, the session cookie value.

**Enforced by a test, not by discipline:** the suite drives a complete successful callback and a
complete failing one with known sentinel values for the code, the verifier and the token,
captures everything `log()` emitted, and asserts none of those sentinels appears anywhere in the
output. A field added carelessly to a log line later fails that test.

### What *is* logged, and the tradeoff

`email` and `sub`. Email is personal data; it is also the entire point of an authentication log,
and the population is a short allowlist of known people. The alternative — a SHA-256 prefix — is
named in a comment with the one-line change that enables it, and is not built.

**Retention is 3 days, so these are debugging logs, not an audit trail.** If an audit trail is
needed, the upgrade is Logpush to R2. Named, not built.

---

## 11. Files

```
sso/
├── README.md                   how the two Workers fit together; add-a-site checklist
│
├── auth/                       ← auth.liorsolomon.com
│   ├── wrangler.jsonc          custom domain, vars, secrets list, observability
│   ├── src/
│   │   ├── worker.js           route table, SECURITY_HEADERS, log()
│   │   ├── oauth.js            PKCE, state, token exchange, id_token validation
│   │   ├── session.js          HMAC sign/verify, cookie serialisation
│   │   └── origins.js          ALLOWED_ORIGINS parsing; next + Origin checks
│   ├── public/
│   │   ├── login.html          the one button — one login page for every site
│   │   ├── denied.html         the 403 body for a non-allowlisted address
│   │   ├── style.css
│   │   └── _headers
│   ├── test/
│   │   ├── login.test.mjs
│   │   ├── callback.test.mjs
│   │   ├── session.test.mjs
│   │   ├── verify.test.mjs
│   │   ├── origins.test.mjs
│   │   ├── logging.test.mjs
│   │   └── headers.test.mjs
│   └── README.md               Google console setup, secrets, custom domain, gotchas
│
├── example/                    ← demo.liorsolomon.com
│   ├── wrangler.jsonc          service binding AUTH, run_worker_first, observability
│   ├── src/
│   │   └── worker.js           the guard. ~60 lines, and the file to copy for site 3
│   ├── public/
│   │   ├── index.html          public landing
│   │   ├── app/index.html      the guarded page
│   │   ├── app.js              one fetch to /api/me, two states
│   │   ├── style.css
│   │   └── _headers
│   ├── test/
│   │   ├── guard.test.mjs
│   │   └── headers.test.mjs
│   └── README.md
│
└── access-spike/
    └── README.md               §12 — evaluating Cloudflare Access. Docs only.
```

`sso/example/src/worker.js` is the deliverable that matters most for reuse: it is the whole of
what a guarded site needs, it holds no secret, and adding site three is copying it and changing
the route patterns.

Tests use `node --test` with `.mjs` and no dependencies, matching `car-charging/test/`. This
repository has no `package.json` — it is gitignored — so nothing may require one.

### Routing config, both projects

```jsonc
"assets": {
  "directory": "./public/",
  "binding": "ASSETS",
  "run_worker_first": ["/app", "/app/*", "/api", "/api/*", "/auth/*", "/verify"]
}
```

`run_worker_first` accepts glob patterns with `*` and negations with a `!` prefix; negations win
regardless of order, and the array is capped at 100 raw entries.

Both `/app` and `/app/*` are listed. It is not documented whether `/app/*` matches the bare
`/app/`, and a guard that silently does not run on the index of a guarded directory is the worst
possible way to find out. Listing both costs one array entry, and `guard.test.mjs` covers `/app`,
`/app/` and `/app/reports` separately.

---

## 12. Cloudflare Access spike — `sso/access-spike/`

A separate, self-contained initiative, deliberately **not** wired into anything above. Docs only:
a README someone can follow end to end on a throwaway subdomain and then delete.

Worth evaluating because it does with zero application code roughly what §§1–11 do with a Worker,
and because the earlier objection to it was wrong on the facts: Access gates **ordinary end
users**, who need no Cloudflare account — it is a reverse proxy in front of an origin that
injects a verified identity JWT. The real objection is different and narrower: the gate lives at
Cloudflare's edge rather than in the application, so it does not travel if a site moves off
Cloudflare, and `car-charging/CLAUDE.md` records that the edge identity product was not enabled
on this account (a gate built on it answered 403 to everyone, owner included, until it was
removed).

The README covers, at a level someone can act on in an afternoon:

1. Enabling Zero Trust on the account and what it costs (free tier, ≤50 users).
2. Adding Google as an identity provider — a second OAuth client in the same Google Cloud
   project, with Cloudflare's own callback URL.
3. Putting a self-hosted application in front of `spike.liorsolomon.com` with an
   email-allowlist policy — the same allowlist as §8, for a like-for-like comparison.
4. Reading `Cf-Access-Jwt-Assertion` at the origin, and the fact that **here JWKS is genuinely
   required**: that token arrives second-hand, so verifying it against the team's
   `/cdn-cgi/access/certs` is mandatory, unlike §8. This is the clearest illustration of when
   the §8 shortcut applies and when it does not.
5. Service tokens, for the non-browser callers Access otherwise blocks.
6. A short comparison table: what Access gives for free (device posture, session management,
   logs, revocation, no code) against what it takes (edge-coupled, account-level config not in
   git, no control over the login page).
7. How to tear the spike down completely.

Explicitly out of scope: migrating anything to it, and running both gates at once.

---

## 13. Configuration

### `sso/auth` vars (committed)

| Var | Example |
|---|---|
| `GOOGLE_CLIENT_ID` | `….apps.googleusercontent.com` — public by definition |
| `ALLOWED_EMAILS` | comma-separated; split, trimmed and lowercased at parse |
| `ALLOWED_ORIGINS` | `https://demo.liorsolomon.com,https://liorsolomon.com` |
| `DEFAULT_NEXT` | `https://liorsolomon.com/` |
| `COOKIE_DOMAIN` | `liorsolomon.com` |
| `SESSION_TTL` | `28800` (8h) |
| `REDIRECT_URI` | `https://auth.liorsolomon.com/auth/callback` |

`REDIRECT_URI` is configured explicitly and is **never derived from `request.url` or the `Host`
header.** Deriving it makes the value an attacker-influenced input on the one parameter Google
uses to decide where the authorization code is delivered.

### Secrets — `wrangler secret put`, by hand, once, on `sso/auth` only

| Secret | Why |
|---|---|
| `GOOGLE_CLIENT_SECRET` | the OAuth client secret |
| `COOKIE_SECRET` | 32 random bytes, base64 — the HMAC key |

**This repository is public.** Neither secret may appear in it, in CI configuration, or in a log
line. Same split as `car-charging`'s proxy: CI can deploy a Worker and can never read or write
its secrets. `sso/example` holds no secret at all, which is the point of §4.

### Prerequisites

- **`liorsolomon.com` must be a zone in the Cloudflare account**, so `auth.` and `demo.` can be
  attached as Workers Custom Domains. If the zone is elsewhere, everything in this design still
  works but the hostnames change and the zone move is step zero.
- A Google Cloud OAuth 2.0 Client ID of type **Web application**, with
  `https://auth.liorsolomon.com/auth/callback` registered **byte-for-byte** — scheme and trailing
  slash included. Scopes: `openid email`. Nothing else.
- **Branch and preview deploys get different hostnames and will fail**, because their callback
  URL is not registered. This is the same class of trap as `car-charging/README.md`'s note that
  preview deployments carry no bindings. With a central auth Worker it is *less* painful than
  before: only `sso/auth` has this constraint, and guarded sites can be previewed freely as long
  as their preview origin is added to `ALLOWED_ORIGINS`.

---

## 14. Testing

| File | Pins |
|---|---|
| `auth/login.test.mjs` | 302 target is Google; `code_challenge_method=S256`; the challenge is the real S256 of the stored verifier; `state` has ≥256 bits of entropy; `__Host-oauth` is `SameSite=Lax`, `HttpOnly`, `Secure`, `Max-Age=600` |
| `auth/origins.test.mjs` | `next` accepts only exact `ALLOWED_ORIGINS` members; rejects `https://evilliorsolomon.com`, `https://demo.liorsolomon.com.evil.com`, `//demo.liorsolomon.com`, `http://` downgrade of a listed https origin, `javascript:`; rejected values fall back to `DEFAULT_NEXT` rather than erroring; a non-`GET` with a missing or unlisted `Origin` is refused |
| `auth/callback.test.mjs` | rejects: missing cookie, mismatched state, Google `error=access_denied`, non-200 from the token endpoint, wrong `aud`, wrong `iss`, expired `exp`, `email_verified: false`, `email_verified: "true"` (string), non-allowlisted email. Accepts the happy path and sets `__Secure-lsid` with `Domain` and without `__Host-`. The token POST carries `code_verifier` **and** `client_secret`. `fetch` is stubbed. |
| `auth/session.test.mjs` | round-trip; tampered payload fails; tampered MAC fails **both when only the first byte differs and when only the last byte differs** (a verifier that early-returns passes the first and fails the second); truncated cookie fails; missing `.` separator fails; expired `exp` fails |
| `auth/verify.test.mjs` | valid cookie → `200 {sub,email,exp}`; absent, malformed, tampered and expired → `401`; `/verify` never emits a `Set-Cookie` |
| `example/guard.test.mjs` | `/api/*` signed out → 401 JSON, **never** a redirect; `/app`, `/app/`, `/app/reports` signed out → 302 to the auth Worker with a correctly encoded absolute `next`; no session cookie → **no `/verify` call is made at all** (the cheap refusal, asserted by counting binding calls); a `/verify` that throws or 5xxs → **refuse**, never admit; signed in → pass through |
| `*/logging.test.mjs` | the sentinel test of §10 — no code, verifier, state, token, secret or cookie value appears in any emitted log line, on the success path or any failure path |
| `*/headers.test.mjs` | the `/*` block of `public/_headers` is byte-equal to `SECURITY_HEADERS`; `frame-ancestors 'none'` present in both |

`auth/oauth.js`, `auth/session.js` and `auth/origins.js` are imported directly with a synthetic
`env` and no Worker around them. If they cannot be tested in isolation they cannot be reasoned
about in isolation.

---

## 15. Deploy and rollback

Two workflows, each scoped to its own directory so a change to one never redeploys the other:

- `.github/workflows/sso-auth.yml` — paths `sso/auth/**`
- `.github/workflows/sso-example.yml` — paths `sso/example/**`

Both modelled on `car-charging-pages.yml`: trigger on `push` to `main` plus `workflow_dispatch`,
`npx wrangler@4 deploy --cwd sso/<project>`, reuse the existing `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` secrets, a `concurrency` group so two pushes cannot race, and an assertion
on the deploy output that a Worker was actually uploaded — a deploy that shipped nothing must not
be a green run.

**Deploy order matters once, and only once:** `sso/auth` must exist before `sso/example` can bind
to it. A service binding to a Worker that does not exist fails at deploy time, which is the right
place to fail.

**Rollback:** `wrangler rollback` on either Worker independently. Rolling back `sso/auth` affects
every guarded site — that is the cost of centralising, and it is the reason `/verify` is the only
surface sites depend on: it is one route with one response shape, and it is the thing that must
stay backward-compatible.

---

## 16. Open questions

None blocking. Three decisions with recorded triggers:

1. **Server-side revocation** (§6) — revisit when a session is suspected stolen, or when
   `SESSION_TTL` needs to exceed a day. One file, `/verify`, plus a KV row.
2. **The `__Host-` downgrade** (§6) — revisit the first time a `liorsolomon.com` subdomain is
   pointed at infrastructure not operated by its owner.
3. **Cloudflare Access** (§12) — revisit after the spike, as a possible replacement for the whole
   of §§1–11 rather than a supplement to it.

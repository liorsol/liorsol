# Google SSO on Cloudflare Workers — design

**Date:** 2026-09-13
**Status:** approved design, not yet implemented
**Scope:** a new, standalone `google-sso/` Worker in this repository. Nothing in `car-charging/`,
`esim-usage/` or the static site changes.

---

## 1. What this is

A reference implementation of **OAuth 2.0 Authorization Code + PKCE against Google**, running on a
Cloudflare Worker with static assets, that:

- signs a visitor in with their Google account,
- admits only addresses on an explicit allowlist,
- issues its own stateless session cookie,
- guards pages by **redirecting to a login page**, and guards API routes by **answering 401**,
- writes a structured log line for every authentication event,
- is written so the two modules that do the work can be copied into another site's Worker
  unchanged.

It is a *reference implementation* first: the code is meant to be read and copied, so the
explanatory comments and the test suite are part of the deliverable, not decoration.

### Not Cloudflare Access

Cloudflare Access can do Google SSO for a web app with no application code at all, and it does
gate ordinary end users rather than Cloudflare account holders — it is a reverse proxy that sits
in front of an origin and injects a verified identity JWT. It is not the answer here for three
reasons, in order of weight:

1. The identity is enforced at Cloudflare's edge, not in the application, so the application
   cannot be moved or reused without the gate evaporating. The stated goal is reuse across
   several sites.
2. `car-charging/CLAUDE.md` records that the edge identity product is not enabled on this
   account — a gate built on it answered 403 to everyone, owner included, until it was removed.
3. The request was for an example that *implements* OAuth. Access is the option that means not
   implementing it.

### Explicit non-goals

- **No refresh tokens.** No `access_type=offline`, no `offline_access` scope, no token storage,
  no refresh path. This Worker never calls a Google API after login; the `id_token` returned at
  the token endpoint is the entire point of the exchange. This is the most common thing these
  examples over-build and the README will say so.
- **No user database.** Identity is an allowlist in configuration.
- **No server-side session revocation.** See §5.
- **No multi-tenant auth service.** See §8 — the boundaries are drawn so one can be built later,
  but nothing for it is built now.

---

## 2. Flow

Authorization Code with PKCE (`S256`), confidential client.

Google issues a client secret for web-application clients regardless of PKCE — it does not
support `token_endpoint_auth_method: none` for this client type. PKCE here is defence against
authorization-code interception, **not** a substitute for the secret. Both are sent.

```
 browser                     Worker                          Google
    │                           │                               │
    │ GET /app/reports          │                               │
    ├──────────────────────────>│  no session                   │
    │ 302 /login?next=/app/rep… │                               │
    │<──────────────────────────┤                               │
    │ GET /login  (static asset, public)                        │
    │                           │                               │
    │ GET /auth/login?next=…    │                               │
    ├──────────────────────────>│                               │
    │                           │ mint state + code_verifier    │
    │ 302 accounts.google.com   │ Set-Cookie __Host-oauth       │
    │<──────────────────────────┤                               │
    │ ─────────────────────────────────────────────────────────>│
    │                           │                      user consents
    │ 302 /auth/callback?code&state                             │
    │<──────────────────────────────────────────────────────────┤
    ├──────────────────────────>│                               │
    │                           │ POST /token (code, verifier,  │
    │                           │   client_secret)  ───────────>│
    │                           │ <─────────────── { id_token } │
    │                           │ decode → iss/aud/exp/         │
    │                           │   email_verified → allowlist  │
    │ 302 <next>                │ Set-Cookie __Host-session     │
    │ Clear-Cookie __Host-oauth │                               │
    │<──────────────────────────┤                               │
```

### Routes

| Route | Method | Public? | Behaviour |
|---|---|---|---|
| `/auth/login` | GET | yes | mint `state` + `code_verifier` + `next`, set `__Host-oauth`, 302 to Google |
| `/auth/callback` | GET | yes | exchange code, validate, set `__Host-session`, 302 to `next` |
| `/auth/logout` | POST | yes | clear `__Host-session`, 204 |
| `/api/me` | GET | guarded | `200 {email, sub, exp}` or `401` |
| `/api/*` | any | guarded | `401 {"error":"auth_required"}` when signed out |
| `/app/*` | GET | guarded | `302 /login?next=…` when signed out, else `env.ASSETS.fetch` |
| everything else | — | yes | `env.ASSETS.fetch(request)` |

`/auth/login` and `/auth/callback` are unauthenticated by necessity — they are the door. They are
the only routes reachable with no session, and the route table is the one place that says so.

---

## 3. Gating: redirect for pages, 401 for APIs

Signed-out requests get two different answers, and **the path decides which — never a request
header.**

- `/api/*` → `401 {"error":"auth_required"}`, `Cache-Control: no-store`.
- every other guarded path → `302 /login?next=<original path>`.

The alternative is to sniff `Sec-Fetch-Mode: navigate` or `Accept: text/html` and answer
accordingly. Rejected: it is the more "correct" answer in the abstract and the more fragile one
in practice — a header that is absent, proxied away, or sent by a non-browser client silently
flips a JSON caller onto the HTML path, and the symptom is an HTML login page arriving in a
`JSON.parse`. The path is deterministic, and the caller already knows which kind of route it
asked for. A `ponytail:` comment records the alternative.

**A redirect answer to a `fetch()` is worse than useless**: `fetch` follows the 302 transparently
and hands the caller a 200 containing the login page. Anything reached by script must be under
`/api/`.

### `next` is an open-redirect surface

`?next=` is validated by a single `safeNext()` function, applied both where it is stored and
where it is used:

```
accept   only a string beginning with exactly one "/"
reject   "//evil.com"  (protocol-relative)
reject   "/\evil.com"  (backslash — some parsers normalise this to "//")
reject   "https://…", "javascript:", any value containing a scheme
reject   anything else → fall back to "/"
```

Validated at both ends deliberately, though the cookie is ours and `HttpOnly`: the check is two
lines and the failure mode it prevents is the classic one.

### Routing config

```jsonc
"assets": {
  "directory": "./public/",
  "binding": "ASSETS",
  "run_worker_first": ["/app", "/app/*", "/api", "/api/*", "/auth/*"]
}
```

`run_worker_first` accepts glob patterns with `*` and negations with a `!` prefix; negations win
regardless of order, and the array is capped at 100 raw entries.

Both `/app` and `/app/*` are listed. It is not documented whether `/app/*` matches the bare
`/app/`, and a guard that silently does not run on the index of a guarded directory is the worst
possible way to find out. Listing both costs one array entry. `guard.test.mjs` covers `/app`,
`/app/` and `/app/reports` separately.

`/auth/*` is worker-first but **not guarded** — those routes are the door, and §2's route table
is the single place that decides which routes the guard applies to.

---

## 4. Security headers, and the divergence trap

`_headers` is **not applied to responses generated by Worker code**, even when the request URL
matches one of its rules. Since guarded pages are now emitted by the Worker, the header set has
to exist in two places:

- `public/_headers` — covers the public static assets (`/`, `/login`, CSS, JS).
- `SECURITY_HEADERS` in `src/worker.js` — attached to every response the Worker returns,
  **including responses it passes through from `env.ASSETS.fetch()`**. Whether the asset binding
  applies `_headers` to a response fetched through it is not clearly documented, and the guarded
  page reaches the browser that way. The Worker therefore rebuilds the response and `.set()`s each
  header — `set`, not `append`, so a header the binding did supply is overwritten rather than
  duplicated.

Two mechanisms that must agree and have no way to check each other is exactly the failure
`car-charging/_headers` documents at length: widen one knob and the page silently loses
`frame-ancestors 'none'` with no error and no visible symptom.

**Mitigation:** a test parses the `/*` block out of `public/_headers` and asserts it is byte-equal
to `SECURITY_HEADERS`. Divergence fails a test instead of failing silently.

The set, copied from `car-charging/_headers`:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
X-Frame-Options: DENY
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

`frame-ancestors 'none'` earns its place: a signed-in session plus a framed page plus one baited
click is how a gated action gets taken by someone else.

---

## 5. Sessions

### Format

```
__Host-session = base64url(JSON {sub, email, exp}) "." base64url(HMAC-SHA256(key, part1))
```

Signed and verified with Web Crypto (`crypto.subtle.importKey` / `sign`), compared in constant
time.

**Deliberately not a JWT.** There is no header segment, therefore no `alg` field, therefore no
`alg: none` and no algorithm-confusion class of bug. Nothing outside this Worker ever reads this
cookie, so there is no interoperability to buy with a standard envelope. A `ponytail:` comment
records that the upgrade to a real JWT is only needed the day a *different* service has to read
it — and §8 explains why that day should not come.

### Attributes

```
__Host-session=…; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<SESSION_TTL, default 8h>
```

- `__Host-` prefix: host-locked, cannot be set by a sibling or parent host, requires `Secure` and
  `Path=/` and forbids `Domain=`. The strongest cookie confinement available.
- `HttpOnly`: script cannot read it. A markup injection on a gated page must not be able to lift
  a session.
- `SameSite=Lax`, not `Strict`: `Strict` means arriving from any external link renders signed-out
  on first paint, which reads as a broken login.

### No server-side revocation

The session is stateless: nothing is stored, so nothing can be deleted. Sign-out clears the
cookie in that one browser; a stolen cookie stays valid until `exp`.

Accepted deliberately — the mitigation is a short `SESSION_TTL` (8h default). The upgrade path,
when it is needed, is `car-charging`'s model: a `jti` in the payload and a row in KV or D1, which
makes revoke a `DELETE` and makes a "sign out everywhere" page real. Named here, not built.

### The `__Host-oauth` cookie

The in-flight leg carries `{state, verifier, next}`, `Max-Age=600`, `HttpOnly; Secure;
Path=/; SameSite=Lax`.

**`SameSite=Lax` is load-bearing and is the single most likely thing to be got wrong.** The
callback arrives as a *top-level cross-site GET* from `accounts.google.com`. Under `Strict` the
browser withholds this cookie, the callback finds no stored state, and the flow dies with an
error that looks like a bug in the state handling rather than a cookie attribute. Pinned by a
test.

It is **not signed**: it is the trusted copy that the returning `state` is compared *against*, and
it cannot be set cross-origin. Signing it would protect nothing. `ponytail:` comment.

---

## 6. Validating the `id_token` — and what JWKS is

The token response is read for `id_token`. Its signature is **not** verified, and no JWKS fetch
happens anywhere in this design.

**What JWKS is.** Google signs the `id_token` with a private key. The JSON Web Key Set at
`https://www.googleapis.com/oauth2/v3/certs` is the matching list of *public* keys, published so
that anyone holding a token can check the signature and prove Google minted it. It exists for
tokens that reach you **second-hand** — handed over by a client, forwarded by another service,
read out of a header — where you have no idea where they came from.

**Why it is not needed here.** This Worker makes the `POST` to
`https://oauth2.googleapis.com/token` itself, over TLS. TLS has already proved the response came
from Google. OIDC Core §3.1.3.7 clause 6 says so explicitly: when the ID Token is received by
direct communication between client and token endpoint, TLS server validation *may* be used in
place of checking the signature. Skipping it removes a network round-trip and an RSA verify from
every login, and removes the JWKS cache as a thing that can go stale or fail.

**The invariant that keeps this true:** *the `id_token` never leaves the Worker that fetched it.*
It is decoded, checked, turned into our own HMAC-signed cookie, and dropped. It is never
forwarded, never stored, never logged. Break that invariant — hand the token to another service —
and that service is receiving it second-hand and must do full JWKS verification. §8 is designed
so this never becomes necessary.

### The checks that *are* performed

Every one of these is mandatory; a failure is a 403 and a logged `reason`.

| Claim | Check |
|---|---|
| `iss` | exactly `https://accounts.google.com` or `accounts.google.com` |
| `aud` | strictly equals `GOOGLE_CLIENT_ID` |
| `exp` | in the future, with a 60s clock-skew allowance |
| `iat` | not implausibly far in the future (same 60s allowance) |
| `email_verified` | strictly boolean `true` — not truthy, not the string `"true"` |
| `email` | lowercased, present in `ALLOWED_EMAILS` |

`hd` is not used. The allowlist is the gate, and `hd` on the *authorize request* is a UI hint that
must never be trusted as a constraint — only the claim on the returned token means anything, and
the allowlist subsumes it.

A non-allowlisted address gets a **403 with a page that says so**, never a 200 in a signed-out
state. Telling someone they are signed out when they are in fact refused sends them round the
loop forever.

---

## 7. Logging

`wrangler.jsonc`:

```jsonc
"observability": { "enabled": true, "head_sampling_rate": 1 }
```

Workers Logs: 200,000 logs/day and 3-day retention on the free plan, 7 days on paid. Structured
objects passed to `console.log` have their fields extracted and indexed, so events are filterable
by key rather than by text match. Per-log cap 256 KB.

One `log()` helper, one line per event:

```js
log({ evt, outcome, reason, email, sub, next, ray, ms })
```

| `evt` | `outcome` | typical `reason` |
|---|---|---|
| `auth.login.start` | `ok` | — |
| `auth.callback` | `ok` / `denied` / `error` | `state_mismatch`, `no_oauth_cookie`, `provider_error`, `token_exchange_failed`, `bad_iss`, `bad_aud`, `expired`, `email_unverified`, `not_allowlisted` |
| `auth.logout` | `ok` | — |
| `guard.deny` | `redirect` / `401` | `no_session`, `bad_signature`, `expired` |

`ray` is `cf-ray`, so a log line joins to the request in Cloudflare's own logs. `ms` is wall time
for the token exchange, which is the only outbound call and the only thing that can be slow.

### Never logged

`code`, `code_verifier`, `state`, `id_token`, `access_token`, `refresh_token`, `client_secret`,
`COOKIE_SECRET`, the raw `Cookie` header, the session cookie value.

**This is enforced by a test, not by discipline:** the suite drives a complete successful callback
and a complete failing one with known sentinel values for the code, the verifier and the token,
captures everything the `log()` helper emitted, and asserts none of those sentinels appears
anywhere in the output. A field added carelessly to a log line later fails that test.

### What *is* logged, and the tradeoff

`email` and `sub` are logged. Email is personal data; it is also the entire point of an
authentication log, and the population is a short allowlist of known people. The alternative —
logging a SHA-256 prefix instead — is named in a comment with the one-line change that enables it,
and is not built.

**Retention is 3 days, so these logs are for debugging, not audit.** If an audit trail is ever
needed, the upgrade is Logpush to R2. Named, not built.

---

## 8. Reuse across several sites

This is a stated future requirement, so the boundaries are drawn for it now. The machinery is
not built.

### The constraint that decides everything

**A cookie cannot cross registrable domains.** No amount of design changes this. It splits the
future into two cases:

**Case A — the sites share a registrable domain** (`app.example.com`, `docs.example.com`).
One cookie scoped `Domain=example.com` is genuine SSO across all of them. The cost is real and
must be stated: `__Host-` forbids a `Domain` attribute, so this means dropping to
`__Secure-session; Domain=example.com`, and **any subdomain — including one that is
compromised, or one pointed at a third-party service — can then set or overwrite that cookie.**
That is a deliberate downgrade, and it should be taken knowingly or not at all.

**Case B — the sites are different domains** (`example.com`, `example.io`).
Each site holds its own session cookie. Two sub-options:

- **Copy the module.** `src/oauth.js` and `src/session.js` drop into the other site's Worker
  unchanged; one Google client can carry several registered redirect URIs. Zero shared
  infrastructure, N deploys. **This is the recommendation until a second site actually exists.**
- **A central auth Worker.** It owns the Google client and secret; each site reaches it over a
  service binding — exactly `car-charging`'s `PROXY` shape — or redirects to it and is bounced
  back with a short-lived signed handoff that the site exchanges for its own cookie. This is a
  real auth server: a token format, key rotation, a redirect-URI allowlist, and its own failure
  modes. It should not be built before there is a second site to justify it.

Note that even in the central-Worker design the `id_token` never leaves the Worker that fetched
it — the handoff carries our own HMAC-signed assertion, not Google's token. The §6 invariant
survives, and JWKS stays unnecessary.

### What is done now to make reuse cheap

`src/oauth.js` and `src/session.js` are **pure, dependency-free, and configured entirely from
`env`** — client id, client secret, allowlist, cookie names, session TTL, redirect base and
guarded path patterns are all parameters, never literals. `src/worker.js` holds everything
site-specific: the route table and the guard configuration.

The test for this is the honest one: the suite imports `oauth.js` and `session.js` with a
synthetic `env` and no Worker around them. If they cannot be tested in isolation, they cannot be
copied in isolation.

---

## 9. Files

```
google-sso/
├── wrangler.jsonc          assets + run_worker_first, vars, observability
├── src/
│   ├── worker.js           route table, the guard, SECURITY_HEADERS, log()
│   ├── oauth.js            PKCE, state, token exchange, id_token validation   ← reusable
│   └── session.js          HMAC sign/verify, cookie serialisation            ← reusable
├── public/
│   ├── index.html          public landing; links to /login and /app/
│   ├── login.html          the one button
│   ├── app/index.html      the guarded page
│   ├── app.js              one fetch to /api/me, two states
│   ├── style.css
│   └── _headers            CSP; must match SECURITY_HEADERS
├── test/                   node --test, .mjs, no dependencies
│   ├── login.test.mjs
│   ├── callback.test.mjs
│   ├── session.test.mjs
│   ├── guard.test.mjs
│   ├── logging.test.mjs
│   └── headers.test.mjs
└── README.md               Google console setup, secrets, deploy, the gotchas
```

The split into three source files is for the reuse boundary in §8, not for tidiness: `oauth.js`
and `session.js` are the pair that gets copied, `worker.js` is the part that does not.

Tests use `node --test` with `.mjs` and no dependencies, matching `car-charging/test/`. This
repository has no `package.json` — it is gitignored — so nothing may require one.

---

## 10. Configuration

### `wrangler.jsonc` vars (public, committed)

| Var | Example |
|---|---|
| `GOOGLE_CLIENT_ID` | `…apps.googleusercontent.com` — public by definition |
| `ALLOWED_EMAILS` | comma-separated; split, trimmed and lowercased at parse, so whitespace in the var is harmless |
| `SESSION_TTL` | `28800` (8h) |
| `REDIRECT_URI` | `https://google-sso.<your-subdomain>.workers.dev/auth/callback` |

`REDIRECT_URI` is configured explicitly and is **never derived from `request.url` or the `Host`
header**. Deriving it makes the value an attacker-influenced input on the one parameter Google
uses to decide where the code is delivered.

### Secrets (`wrangler secret put`, by hand, once)

| Secret | Why |
|---|---|
| `GOOGLE_CLIENT_SECRET` | the OAuth client secret |
| `COOKIE_SECRET` | 32 random bytes, base64 — the HMAC key |

**This repository is public.** Neither secret may ever appear in it, in CI configuration, or in a
log line. This is the same split `car-charging` uses for its proxy: CI can deploy the Worker and
can never read or write its secrets.

`.dev.vars` is already gitignored at the repository root.

### Google Cloud console

An OAuth 2.0 Client ID of type **Web application**, with the redirect URI registered
**byte-for-byte** — trailing slashes and scheme included. Scopes: `openid email`. Nothing else.

**Branch and preview deploys get different hostnames and will fail** until their redirect URIs are
registered too. This is the same class of trap as `car-charging/README.md`'s note that preview
deployments carry no bindings.

---

## 11. Testing

| File | Pins |
|---|---|
| `login.test.mjs` | 302 target is Google; `code_challenge_method=S256`; challenge is the real S256 of the stored verifier; `state` has ≥256 bits of entropy; `__Host-oauth` is `SameSite=Lax`, `HttpOnly`, `Secure`, `Max-Age=600`; `safeNext` rejects `//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:` |
| `callback.test.mjs` | rejects: missing cookie, mismatched state, Google `error=access_denied`, non-200 from the token endpoint, wrong `aud`, wrong `iss`, expired `exp`, `email_verified: false`, `email_verified: "true"` (string), non-allowlisted email. Accepts the happy path and sets `__Host-session`. The token POST carries `code_verifier` and `client_secret`. `fetch` is stubbed. |
| `session.test.mjs` | round-trip; tampered payload fails; tampered MAC fails **both when only the first byte differs and when only the last byte differs** (a verifier that early-returns passes the first and fails the second); truncated cookie fails; missing `.` separator fails; expired `exp` fails |
| `guard.test.mjs` | `/api/*` signed out → 401 JSON, never a redirect; `/app/*` signed out → 302 `/login?next=…` with `next` correctly encoded; both → pass-through when signed in; `/auth/logout` rejects GET |
| `logging.test.mjs` | the sentinel test of §7 — no code, verifier, state, token, secret or cookie value appears in any emitted log line, on the success path or any failure path |
| `headers.test.mjs` | the `/*` block of `public/_headers` is byte-equal to `SECURITY_HEADERS`; `frame-ancestors 'none'` is present in both |

---

## 12. Deploy and rollback

New workflow `.github/workflows/google-sso-worker.yml`, modelled on
`car-charging-pages.yml`:

- triggers on `push` to `main` under `google-sso/**` and on `workflow_dispatch`
- `npx wrangler@4 deploy --cwd google-sso`
- reuses the existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets
- `concurrency` group so two pushes cannot race
- asserts on the deploy output that a Worker was actually uploaded, the same way the Pages
  workflow greps for `Compiled Worker successfully` — a deploy that shipped nothing must not be a
  green run

**Rollback:** `wrangler rollback` (or the version list in the dashboard) on a standalone Worker.
Blast radius for the rest of this repository is zero: no shared binding, no shared project, no
shared hostname.

---

## 13. Open questions

None blocking. Two decisions to revisit when their trigger arrives:

1. **Server-side revocation** (§5) — revisit if a session is ever suspected stolen, or if
   `SESSION_TTL` has to grow past a day.
2. **Central auth Worker** (§8) — revisit when a second site exists, and only then decide Case A
   versus Case B on whether the sites share a registrable domain.

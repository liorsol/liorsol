# Charging dashboard

A private dashboard for my own EV charging data. This directory is the entire public part of
the system: a static page, plus one Pages Function at `/api/*`.

Background, the goal, and why the working notes are not in this repo: see `CLAUDE.md` next to
this file.

## Shape

```
browser
  |
  |  every request is authenticated at the edge before anything here runs
  v
Pages project "car-charging"        <- this directory, deployed as-is
  |
  +-- /            static page
  +-- /api/*       functions/api/[[path]].js
         |
         +-- /api/comments*   handled here, backed by D1
         |
         +-- everything else  handed to a private upstream service over a
                              service binding, unchanged
```

### The private upstream service

The service behind the `PROXY` binding is **not in this repository and never will be**. It
holds the credential for a private data source, and every detail of that data source —
hostname, paths, headers, field names — lives with it. It is **deployed by hand and versions
independently of this repo**: pushing this directory never redeploys it, and redeploying it
never touches this directory. The only contract between them is the service binding, which
carries the request through unchanged.

That service has no public URL of its own. The binding is the only door.

### Access

The whole hostname sits behind a single edge access policy allowing exactly one identity. This
matters for two reasons at once, and they are the same reason: an unauthenticated request is
refused **before** any Function or upstream call runs, so it is neither a data leak nor a
billable invocation.

Nothing in this directory knows or cares how that sign-in happens. Changing the sign-in method
is a dashboard change and must never require a code change here.

Nothing here hardcodes a hostname either — the page calls `/api/...` relative paths only — so
moving to a different hostname is also configuration, never code.

## Deploying

The page is a plain directory: no build step, no dependencies, no framework.

```bash
npx wrangler pages deploy . --cwd car-charging --project-name car-charging --branch main
```

`--branch main` is the project's production branch, so this publishes the production
deployment. Anything else publishes a preview.

**The `--cwd` is load-bearing, not decoration.** Wrangler looks for `functions/` relative to its
working directory, *not* inside the asset directory you name. Run it as
`wrangler pages deploy car-charging` from the repository root and it uploads the static files
happily, compiles no Function at all, and `/api/*` quietly serves a 404 page. Deploying with
`--cwd car-charging .` is what makes `functions/api/[[path]].js` become `/api/*`. A successful
deploy prints `✨ Compiled Worker successfully`; if that line is missing, no Function shipped.

### Bindings

Set on the Pages project itself, not in a file here:

| Binding | Kind | Points at | Environment |
|---|---|---|---|
| `DB` | D1 | the `car-charging` database | **production only** |
| `PROXY` | service | the private upstream service | **production only** |

The Pages side gets **no secret of any kind**. The credential belongs to the private service.

**Never bind anything to the preview environment.** Preview deployment URLs
(`<hash>.<project>.pages.dev`, and the branch alias) are permanent, guessable from a public
repository, and printed in every deploy log. The edge policy protects the production hostname;
a preview URL is a second front door onto the same code. A preview with no `DB` and no `PROXY`
is harmless — the Function answers `503` and reaches nothing — and that is the whole control.
It is a binding *not* added, so nothing warns you when someone adds it.

If preview deployments ever need to work, the prerequisite is a second edge access application
covering the wildcard preview hostname with the same one-identity policy, applied **before** the
bindings, not after.

### Schema

`schema.sql` holds both tables. Apply it with:

```bash
npx wrangler d1 execute car-charging --remote --file=car-charging/schema.sql
```

It is idempotent (`CREATE TABLE IF NOT EXISTS`), so re-running it is safe.

### Check

```bash
node --test car-charging/test/*.test.mjs
```

No dependencies, no network, a few seconds. Two properties, both of which can be proved offline
and both of which fail silently in production if they break:

- a request carrying no identity header is a caller class that no route in the table admits, so
  it gets `403` on every route — iterated from the route table, so a new route is covered the
  day it is added;
- the settle poll stops on the first completed sample instead of spending its whole cap.

**One writer per table, and this is a hard rule:** the private upstream service owns `cache`,
this Function owns `comments`. Neither ever writes the other's table.

## The comment board

A shared notes-to-self board attached to the dashboard. It is also the intended hand-off
channel to a later automated session reading this repo — which is why its read route is a
plain documented JSON API rather than something you have to scrape out of the page.

### Read the whole backlog in one call

```
GET /api/comments
```

```json
{
  "fetchedAt": 1757600000000,
  "stale": false,
  "comments": [
    {
      "id": "0f1d…",
      "ts": 1757600000000,
      "author": "…",
      "text": "…",
      "status": "open",
      "archived": false
    }
  ]
}
```

Newest first. `ts` is epoch milliseconds. `status` is `"open"` or `"done"`. `archived` is a
boolean.

`fetchedAt` and `stale` are on every route in this API for uniformity. Comments are read live on
every call, so `stale` is always `false` here.

One optional parameter controls which rows come back:

| Call | Returns |
|---|---|
| `GET /api/comments` | the live backlog — archived rows omitted (default) |
| `GET /api/comments?archived=include` | **everything**, archived rows included and flagged |
| `GET /api/comments?archived=only` | archived rows alone |

So the single call that gets a reader the complete board, with nothing silently dropped, is
`GET /api/comments?archived=include`.

**Archived rows are never deleted.** There is no delete route. Dismissing a comment sets
`archived: true`; the row stays in the database and stays readable, and it always reports the
flag, so a reader can tell an archived comment from one that no longer exists.

### Writing

```
POST  /api/comments        {"author": "...", "text": "..."}
PATCH /api/comments/<id>   {"status": "done"}
PATCH /api/comments/<id>   {"archived": true}
```

`POST` returns `201` with the created comment. `PATCH` accepts either field or both, and
returns the updated comment, or `404` if the id is unknown.

Requests are same-origin only — there are no CORS headers, and no cookie or `Origin` check is
used as a gate, so a correctly authenticated caller sending only headers works exactly like a
browser does.

**`text` and `author` are plain text, and the API returns them as plain text.** It never
returns markup. Render them with `textContent`; this page holds live hardware controls, and an
`innerHTML` here would be an injection into that.

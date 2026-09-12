// Pages Function mounted at /api/*.
//
// Nothing here authenticates and nothing here can: the session is a signed cookie and the
// signing key lives in the private upstream service, never in this public repository. So
// this file ASKS -- one body-less call to the upstream -- and then authorises and routes.
//
// The edge used to do this. It cannot any more: the identity header this file once trusted
// is injected by an edge product that is not enabled on this account, so it is never present
// and every route answered 403, the owner's requests included. The gate moved into the
// application. What did not change is that a class is something a caller PROVED, never
// something a header failed to say.
//
// It has exactly two jobs:
//   1. hand anything it does not own to the private upstream service over a service
//      binding, unchanged. That half holds no knowledge of the upstream whatsoever --
//      no host, no path, no header, no credential. That is the entire point of the
//      binding: the upstream service is deployed and versioned separately and is not
//      in this repository.
//   2. own the comment board end to end, because comments carry no upstream knowledge
//      and are meant to be read straight out of this public repo's API by a later
//      automated session.

const MAX_AUTHOR = 80;
const MAX_TEXT = 4000;

// Route table. `callers` is the set of caller classes allowed to reach the route.
//
// 'unknown' is the class of every caller that has not proved anything, and it appears on
// exactly one row: the login door, whose whole purpose is to be reachable by someone with
// no session. Adding it anywhere else opens that route to the internet.
//
// Today every other route is the owner and nobody else. When an automated caller is added
// later (the iPhone Shortcut), it gets its own class and this table is the one place that
// decides which rows it may use -- which is why the 403 branch below stays even though
// nothing reaches it yet.
export const ROUTES = [
  { match: /^\/api\/auth\/(?:request|callback)$/, callers: ['unknown', 'owner'], handler: forward },
  { match: /^\/api\/comments(?:\/([^/]+))?$/, callers: ['owner'], handler: comments },
  { match: /^\/api\//, callers: ['owner'], handler: forward },
];

// Authorisation only, and the class comes from a signal that is *present* and verified.
//
// A cookie is not a class. `owner` is returned only when the upstream service -- the one
// holding the signing key -- has checked the signature, the expiry AND that the session's
// jti is still a row in the sessions table, which is what will make the future revoke page
// a DELETE and nothing more. Anything else, including a cookie that merely looks right, is
// 'unknown'. Absence of a cookie is answered here without a call, so an anonymous flood
// costs one invocation rather than two.
export async function callerClass(request, env) {
  // No cookie, or nothing to ask: either way this caller has proved nothing. An unbound
  // upstream is not a reason to admit someone -- it is a reason nobody can be admitted.
  if (!request.headers.get('cookie') || !env.PROXY) return 'unknown';
  const probe = await env.PROXY.fetch(
    new Request(new URL('/api/auth/verify', request.url), {
      headers: { cookie: request.headers.get('cookie') },
    })
  );
  return probe.status === 204 ? 'owner' : 'unknown';
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  for (const route of ROUTES) {
    const m = url.pathname.match(route.match);
    if (!m) continue;

    // The login door needs no probe: there is nothing to verify yet, and asking would
    // double the cost of the one route an unauthenticated stranger can reach.
    if (route.callers.includes('unknown')) return route.handler(request, env, url, m[1]);

    const klass = await callerClass(request, env);

    // Three distinct answers, and the page renders each differently. 401: no session --
    // sign in. 403: a session that may not use this route. 503 token_expired, raised
    // upstream: the CHARGER credential is dead, which is not an authentication problem
    // at all. Never collapse a pair of them.
    if (klass === 'unknown') return json(401, { error: 'auth_required' });
    if (!route.callers.includes(klass)) return json(403, { error: 'forbidden' });

    return route.handler(request, env, url, m[1], klass);
  }
  return json(404, { error: 'not_found' });
}

// The upstream service is reached with a *reconstructed* request: same method, same path,
// same body, and an allowlist of four headers. Everything not named here is dropped, so a
// header added to this hostname later -- by a product, by a proxy, by anything -- does not
// silently start crossing into the service that holds the account credential.
//
// Each one earns its place, and the list is the whole argument for the design:
//
//   content-type      the service reads JSON bodies
//   cookie            the session. It USED to be the reason this allowlist existed: under the
//                     old edge gate the cookie was somebody else's bearer credential and had
//                     no business crossing. It is now OUR cookie, signed by the service on the
//                     other side of this call, and it is the only thing that can authenticate
//                     the request. This host sets no other cookie, and pages.dev is on the
//                     public suffix list, so no sibling site can add one to this jar.
//   user-agent        written once, to the session row, so the future revoke page can say
//                     "the iPhone" rather than a hex id
//   cf-ipcountry      coarse location for that same row, when the platform gives it for free
//
// Deliberately absent: cf-connecting-ip on everything but the login route below. The service
// hashes it for rate limiting and stores nothing; no other route has a use for it.
const PASS = ['content-type', 'cookie', 'user-agent', 'cf-ipcountry'];

function forward(request, env) {
  if (!env.PROXY) return json(503, { error: 'upstream_unavailable' });
  const headers = {};
  for (const name of PASS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  if (!headers['cf-ipcountry'] && request.cf?.country) headers['cf-ipcountry'] = request.cf.country;
  // The login routes are the only ones with a caller to rate-limit, and the only ones the
  // service needs an address for. It hashes it with the signing key and never stores it.
  if (/^\/api\/auth\//.test(new URL(request.url).pathname)) {
    const ip = request.headers.get('cf-connecting-ip');
    if (ip) headers['cf-connecting-ip'] = ip;
  }
  // `redirect: 'manual'` is load-bearing and is written last so no caller can drop it. The
  // sign-in link is answered with a 302 and a Set-Cookie: under the default mode this call
  // would follow that redirect HERE, server-side, and hand the browser whatever the second
  // request returned -- a 401, since the cookie was never delivered to anyone. The symptom
  // would be a sign-in link that silently never signs anyone in.
  return env.PROXY.fetch(new Request(request, { headers, redirect: 'manual' }));
}

// GET    /api/comments?archived=exclude|include|only   (default exclude)
// POST   /api/comments            { text }   -- `author` is server-assigned, see below
// PATCH  /api/comments/<id>       { status } and/or { archived }
//
// There is deliberately no DELETE. Archiving is the only removal, rows stay in the
// database, stay readable, and always report their `archived` flag so a machine
// reader can tell an archived comment from a dropped one.
async function comments(request, env, url, id, klass) {
  if (!env.DB) return json(503, { error: 'store_unavailable' });

  if (request.method === 'GET' && !id) {
    const filter = {
      exclude: 'WHERE archived = 0',
      include: '',
      only: 'WHERE archived = 1',
    }[url.searchParams.get('archived') ?? 'exclude'];
    if (filter === undefined) return json(400, { error: 'bad_archived_filter' });

    const { results } = await env.DB.prepare(
      `SELECT id, ts, author, text, status, archived FROM comments ${filter} ORDER BY ts DESC`
    ).all();
    // Comments are read live out of the database on every call, so they are never stale.
    // The two fields are here because every route reports them the same way.
    return json(200, { fetchedAt: Date.now(), stale: false, comments: results.map(shape) });
  }

  if (request.method === 'POST' && !id) {
    const body = await readJson(request);
    // Provenance is the caller class that was verified above, and never anything from the
    // body. This board is a hand-off channel to a later automated reader, and `author` is the
    // only trust signal it will ever have: anything that can post could otherwise claim to be
    // "system" or "owner". A body `author` is accepted and discarded, not rejected.
    //
    // Using the class itself rather than a literal is what keeps that true when a second class
    // exists: a machine caller admitted to this row writes its own name, not the owner's. No
    // address is stored either -- the database holds no personal data, and there is none to
    // store: the session's subject is the string 'owner'.
    const author = text(klass, MAX_AUTHOR);
    if (!author) return json(403, { error: 'forbidden' }); // no route admits a class without one
    const message = text(body?.text, MAX_TEXT);
    if (!message) return json(400, { error: 'text_required' });

    const row = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      author,
      text: message,
      status: 'open',
      archived: 0,
    };
    await env.DB.prepare(
      'INSERT INTO comments (id, ts, author, text, status, archived) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(row.id, row.ts, row.author, row.text, row.status, row.archived).run();
    return json(201, { comment: shape(row) });
  }

  if (request.method === 'PATCH' && id) {
    const body = await readJson(request);
    const columns = [];
    const values = [];
    if (body && 'status' in body) {
      if (body.status !== 'open' && body.status !== 'done') return json(400, { error: 'bad_status' });
      columns.push('status = ?');
      values.push(body.status);
    }
    if (body && 'archived' in body) {
      if (typeof body.archived !== 'boolean') return json(400, { error: 'bad_archived' });
      columns.push('archived = ?');
      values.push(body.archived ? 1 : 0);
    }
    if (!columns.length) return json(400, { error: 'status_or_archived_required' });

    const row = await env.DB.prepare(
      `UPDATE comments SET ${columns.join(', ')} WHERE id = ?
       RETURNING id, ts, author, text, status, archived`
    ).bind(...values, id).first();
    return row ? json(200, { comment: shape(row) }) : json(404, { error: 'not_found' });
  }

  return json(405, { error: 'method_not_allowed' });
}

// Unicode format characters -- bidi overrides, zero-width joiners and friends, and the U+E0000
// tag block that smuggles plain ASCII past a human -- plus the two line separators, which are
// not Cf and are exactly as invisible. They survive `textContent` intact, so they are invisible
// to the person reading the board and read in full by the machine that reads it after them,
// which is the whole reason this board exists. Cost: an emoji sequence joined by U+200D is
// stored and served as its parts.
const INVISIBLE = /[\p{Cf}\u2028\u2029]/gu;

// Every row leaves through here, on GET, POST and PATCH alike, so this is where the strip
// belongs: a row can enter this table by routes the POST path never sees -- a direct database
// execute, a restore, an import, or a write that predates the strip -- and the reader this
// board was built for is a machine. Sanitising on write only leaves those rows intact.
const shape = (row) => ({
  ...row,
  text: typeof row.text === 'string' ? row.text.replace(INVISIBLE, '') : row.text,
  archived: row.archived === 1,
});

// The write half: same character class, plus the length and emptiness rules.
const text = (value, max) => {
  if (typeof value !== 'string') return null;
  const clean = value.replace(INVISIBLE, '').trim();
  return clean ? clean.slice(0, max) : null;
};

const readJson = (request) => request.json().catch(() => null);

// No CORS headers anywhere: this API is same-origin only, by design.
const json = (status, body) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

// Pages Function mounted at /api/*.
//
// Every request that reaches this file has already been authenticated at the edge.
// Nothing here authenticates; this file only authorises and routes.
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
// Today every route is people-only. When an automated caller is added later it is
// authorised at the edge as a second policy on the same application, and the only
// change here is adding 'machine' to the rows it may use.
export const ROUTES = [
  { match: /^\/api\/comments(?:\/([^/]+))?$/, callers: ['human'], handler: comments },
  { match: /^\/api\//, callers: ['human'], handler: forward },
];

// Authorisation only, and every class comes from a signal that is *present*.
//
// The absence of a header is not evidence of anything: the edge strips these headers
// from anything it did not itself authenticate, so a request arriving without them is
// a request that was never identified. It gets 'unknown', which appears in no route's
// `callers` and never may. Deriving a trusted class from a missing header would make
// every anonymous request on the internet that class the day a route admits it.
export function callerClass(request) {
  if (request.headers.get('Cf-Access-Authenticated-User-Email')) return 'human';
  if (request.headers.get('Cf-Access-Client-Id')) return 'machine';
  return 'unknown';
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  for (const route of ROUTES) {
    const m = url.pathname.match(route.match);
    if (!m) continue;
    if (!route.callers.includes(callerClass(request))) return json(403, { error: 'forbidden' });
    return route.handler(request, env, url, m[1]);
  }
  return json(404, { error: 'not_found' });
}

// The upstream service is reached with a *reconstructed* request: same method, same path,
// same body, `content-type` and nothing else. Passing the original through would carry the
// edge session cookie -- a live bearer credential for this whole hostname, with no device or
// IP binding -- into a service that reads no header on any code path. It routes on the path
// and reads the JSON body, so nothing else has any reason to cross, and one `console.log` of
// the headers in a future debugging session can no longer put a session token in a log.
function forward(request, env) {
  if (!env.PROXY) return json(503, { error: 'upstream_unavailable' });
  const type = request.headers.get('content-type');
  return env.PROXY.fetch(new Request(request, { headers: type ? { 'content-type': type } : {} }));
}

// GET    /api/comments?archived=exclude|include|only   (default exclude)
// POST   /api/comments            { text }   -- `author` is server-assigned, see below
// PATCH  /api/comments/<id>       { status } and/or { archived }
//
// There is deliberately no DELETE. Archiving is the only removal, rows stay in the
// database, stay readable, and always report their `archived` flag so a machine
// reader can tell an archived comment from a dropped one.
async function comments(request, env, url, id) {
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
    // Provenance is assigned here from the authenticated caller and never read from the body.
    // This board is a hand-off channel to a later automated reader, and `author` is the only
    // trust signal it will ever have: anything that can post could otherwise claim to be
    // "system" or "owner". A body `author` is accepted and discarded, not rejected.
    //
    // The email itself is deliberately not stored -- the database holds no personal data. The
    // human class is the literal 'owner'; a future automated caller is its own client id.
    const author =
      callerClass(request) === 'human'
        ? 'owner'
        : text(request.headers.get('Cf-Access-Client-Id'), MAX_AUTHOR);
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

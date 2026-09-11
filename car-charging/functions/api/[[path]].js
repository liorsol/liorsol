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
const ROUTES = [
  { match: /^\/api\/comments(?:\/([^/]+))?$/, callers: ['human'], handler: comments },
  { match: /^\/api\//, callers: ['human'], handler: forward },
];

// Authorisation only. An authenticated identity that carries no address is not a
// person, so it maps to 'machine' -- which no route allows today, and is therefore
// refused. A missing address is never read as "trusted", and never as an error.
function callerClass(request) {
  return request.headers.get('Cf-Access-Authenticated-User-Email') ? 'human' : 'machine';
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

function forward(request, env) {
  if (!env.PROXY) return json(503, { error: 'upstream_unavailable' });
  return env.PROXY.fetch(request);
}

// GET    /api/comments?archived=exclude|include|only   (default exclude)
// POST   /api/comments            { author, text }
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
    const author = text(body?.author, MAX_AUTHOR);
    const message = text(body?.text, MAX_TEXT);
    if (!author || !message) return json(400, { error: 'author_and_text_required' });

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

const shape = (row) => ({ ...row, archived: row.archived === 1 });

const text = (value, max) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

const readJson = (request) => request.json().catch(() => null);

// No CORS headers anywhere: this API is same-origin only, by design.
const json = (status, body) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

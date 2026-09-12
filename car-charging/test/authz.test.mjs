// Run: node --test car-charging/test/authz.test.mjs
//
// The gate moved out of the edge and into the application, so this file has two jobs now.
//
// It still pins the property it always pinned: a caller that has proved nothing reaches
// nothing. What changed is where the proof comes from -- a cookie the upstream service
// verified, instead of a header an edge product injected -- and that the refusal is a 401
// rather than a 403, because those are two different things and the page draws two different
// screens for them.
//
// The route table is iterated rather than listed on purpose. Add a route and it is covered
// automatically; put 'unknown' on a row that is not the login door and this file fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { ROUTES, callerClass, onRequest } = await import('../functions/api/[[path]].js');

// One path per shape the table routes. Every route must be hit by at least one of these,
// which is what stops a new route from slipping past the tests below.
const PROBES = [
  '/api/comments',
  '/api/comments/1a2b',
  '/api/state',
  '/api/charge/start',
  '/api/token',
  '/api/auth/request',
  '/api/auth/callback',
];

// The two routes an unauthenticated caller is supposed to reach, and the only two.
const OPEN = ['/api/auth/request', '/api/auth/callback'];
const GATED = PROBES.filter((p) => !OPEN.includes(p));

// The Function's own source, with comments blanked. A needle scan that sees comments reports
// the *rule* as the violation: this file explains at length which conditions it must never
// mint, and prose that cannot name what it refuses to do is the test editing the product.
const source = () =>
  readFileSync(new URL('../functions/api/[[path]].js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([ \t])\/\/[^\n]*$/gm, '$1');

const anonymous = (path, method = 'GET') =>
  new Request(`https://example.invalid${path}`, { method });

// A signed-in caller: a cookie, plus an upstream that says the cookie verifies. Both halves
// are needed -- the cookie alone proves nothing, which is the point of the probe.
const identified = (path, method = 'GET', body) =>
  new Request(`https://example.invalid${path}`, {
    method,
    headers: {
      cookie: '__Host-session=header.payload.signature',
      'user-agent': 'Mozilla/5.0 (iPhone)',
      'cf-ipcountry': 'IL',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body,
  });

// An upstream service that answers the verify probe with `verdict` and everything else with
// an empty document. Records every request that crossed the binding.
const upstream = (verdict = 204) => {
  const seen = [];
  return {
    seen,
    probes: () => seen.filter((r) => new URL(r.url).pathname === '/api/auth/verify'),
    PROXY: {
      fetch(request) {
        seen.push(request);
        return new URL(request.url).pathname === '/api/auth/verify'
          ? new Response(null, { status: verdict })
          : new Response('{}');
      },
    },
  };
};

// Reads the board back. Declared here because the gate tests use it too: a route that is
// refused must never have touched the database, and that is easier to see with a stub that
// would visibly answer if it had.
const stubRead = (rows) => ({
  prepare: () => ({ all: async () => ({ results: rows }) }),
});

// Records every bound statement so a test can read back what would have been written.
const stubDB = (writes) => ({
  prepare: (sql) => ({
    bind: (...args) => {
      writes.push({ sql, args });
      return {
        run: async () => ({}),
        first: async () => null,
        all: async () => ({ results: [] }),
      };
    },
  }),
});

// ── The gate ──────────────────────────────────────────────────────────────────────────

test('an unidentified request is a class no gated route admits', async () => {
  const up = upstream();
  assert.equal(await callerClass(anonymous('/api/state'), up), 'unknown');
  for (const route of ROUTES) {
    if (OPEN.some((p) => route.match.test(p))) continue;
    assert.ok(
      !route.callers.includes('unknown'),
      `route ${route.match} admits the class given to a request that proved nothing`
    );
  }
});

test('every route is covered by a probe path', () => {
  for (const route of ROUTES) {
    assert.ok(
      PROBES.some((path) => route.match.test(path)),
      `no probe path matches ${route.match} -- add one, then the tests below cover it`
    );
  }
});

test('an unidentified request gets 401 on every gated route', async () => {
  for (const path of GATED) {
    for (const method of ['GET', 'POST', 'PATCH']) {
      const up = upstream();
      const response = await onRequest({ request: anonymous(path, method), env: { ...up, DB: stubDB([]) } });
      assert.equal(response.status, 401, `${method} ${path} was not refused`);
      assert.deepEqual(await response.json(), { error: 'auth_required' });
      assert.equal(up.seen.length, 0, `${method} ${path} cost an upstream call to refuse a stranger`);
    }
  }
});

test('a cookie the upstream does not accept is refused exactly like no cookie at all', async () => {
  for (const verdict of [401, 403, 500, 200]) {
    const up = upstream(verdict);
    const response = await onRequest({ request: identified('/api/state'), env: { ...up, DB: stubDB([]) } });
    assert.equal(response.status, 401, `an upstream ${verdict} was read as a session`);
    assert.deepEqual(await response.json(), { error: 'auth_required' });
    assert.equal(up.probes().length, 1, 'the session was not actually checked');
  }
});

// ── The cheap path is a cookie NAME test, not a cookie PRESENCE test ──────────────────
//
// The test above is the expensive half and it is correct: a caller presenting something
// session-shaped has earned the probe, because only the upstream can say whether it verifies.
// These are the other half. "Carries a Cookie header" is not the same question as "carries a
// session", and every browser that has ever visited this host sends something -- an analytics
// cookie, a consent flag, anything. Treating those as maybe-authenticated spends one upstream
// call and therefore two invocations to refuse a stranger, which is precisely the case the
// cheap path exists to avoid. The whole architecture is justified on invocation budget.

const jar = (value, path = '/api/state') =>
  new Request(`https://example.invalid${path}`, { headers: { cookie: value } });

test('a cookie that is not the session is refused without asking upstream', async () => {
  // An upstream that refuses, which is what a real one does with a cookie that is not a
  // session. So the status is right either way and the ONLY thing this can fail on is the
  // count -- the defect is the call, not the verdict.
  const up = upstream(401);
  const response = await onRequest({ request: jar('junk=1'), env: { ...up, DB: stubDB([]) } });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'auth_required' });
  assert.equal(up.seen.length, 0, 'a drive-by cookie bought an upstream call');

  // The other direction, in the same test so the pair cannot drift apart: a jar that DOES
  // carry the name is still probed. Refusing that one here would be a session the Worker
  // signed, 401'd by the Function without ever being checked.
  const real = upstream(401);
  const refused = await onRequest({
    request: jar('__Host-session=not.a.real.signature'),
    env: { ...real, DB: stubDB([]) },
  });
  assert.equal(refused.status, 401);
  assert.deepEqual(await refused.json(), { error: 'auth_required' });
  assert.equal(real.probes().length, 1, 'a session-shaped cookie was refused without being checked');
});

test('a jar entry that merely contains the session name is not the session', async () => {
  // A cookie name is case-sensitive and a jar entry starts at the header or just after a `;`.
  // `includes('__Host-session')` passes every one of these, which is the same defect wearing
  // a longer needle.
  for (const value of [
    'x__Host-session=a.b.c',
    '__Host-session-other=a.b.c',
    '__Host-sessionx=a.b.c',
    'a=1; x__Host-session=a.b.c',
    'a=1; __Host-session-other=a.b.c',
    '__host-session=a.b.c',
    'note=__Host-session=a.b.c',
  ]) {
    const up = upstream(401); // refuses, as a real one would: the count is the property here
    const response = await onRequest({ request: jar(value), env: { ...up, DB: stubDB([]) } });
    assert.equal(response.status, 401, `${value} was not refused`);
    assert.equal(up.seen.length, 0, `${value} was read as a session and bought an upstream call`);
  }

  // And the shapes a browser actually sends ARE the session -- neighbours and the space after
  // the separator included. A guard that misses one of these 401s the owner for free.
  for (const value of [
    '__Host-session=a.b.c',
    'other=1; __Host-session=a.b.c',
    'other=1;__Host-session=a.b.c',
    '__Host-session=a.b.c; other=1',
  ]) {
    const up = upstream();
    await onRequest({ request: jar(value), env: { ...up } });
    assert.equal(up.probes().length, 1, `${value} is a session and was not checked`);
  }
});

// The control in the other direction, and it was green before the name test existed: absence
// of the header was never the defect. It is here so the two live next to each other and a
// future edit cannot satisfy one by breaking the other.
test('no Cookie header at all is refused without asking upstream', async () => {
  const up = upstream();
  const response = await onRequest({ request: anonymous('/api/state'), env: { ...up, DB: stubDB([]) } });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'auth_required' });
  assert.equal(up.seen.length, 0);
});

test('with no upstream bound, a cookie proves nothing -- 401, never an open door', async () => {
  const response = await onRequest({ request: identified('/api/state'), env: { DB: stubDB([]) } });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'auth_required' });
});

test('the probe carries the cookie and asks the one question, on the same origin', async () => {
  const up = upstream();
  await onRequest({ request: identified('/api/comments'), env: { ...up, DB: stubRead([]) } });
  const [probe] = up.probes();
  assert.equal(new URL(probe.url).pathname, '/api/auth/verify');
  assert.equal(new URL(probe.url).origin, 'https://example.invalid');
  assert.equal(probe.headers.get('cookie'), '__Host-session=header.payload.signature');
  assert.deepEqual([...probe.headers.keys()].sort(), ['cookie']);
});

test('401, 403 and 503 token_expired are three different answers', async () => {
  // 401: no session. Distinct name, distinct status.
  const un = await onRequest({ request: anonymous('/api/state'), env: { ...upstream(), DB: stubDB([]) } });
  assert.equal(un.status, 401);
  assert.equal((await un.json()).error, 'auth_required');

  // 403: a session that may not use this route. Nothing produces it today -- there is one
  // class -- so it is checked at the branch rather than through a route, which is what keeps
  // it from being quietly deleted before the machine caller that will need it arrives.
  const table = ROUTES.find((r) => r.match.test('/api/state'));
  assert.ok(!table.callers.includes('machine'), 'a class was admitted without a test');
  assert.deepEqual(table.callers, ['owner']);

  // 503 token_expired is raised upstream, not here, and means the CHARGER credential is
  // dead. This file must never produce it, or the page would show the wrong screen.
  assert.ok(!source().includes('token_expired'), 'the Function must not mint an upstream condition');
});

test('the login door is open, and it is the only thing that is', async () => {
  for (const path of OPEN) {
    const up = upstream(401); // an upstream that would refuse, to prove nobody asked it
    const response = await onRequest({
      request: anonymous(path, path.endsWith('request') ? 'POST' : 'GET'),
      env: { ...up, DB: stubDB([]) },
    });
    assert.notEqual(response.status, 401, `${path} cannot be reached by the person who needs it`);
    assert.equal(up.probes().length, 0, `${path} paid for a session check before a session exists`);
    assert.equal(up.seen.length, 1, `${path} did not reach the service that answers it`);
  }

  // And nothing adjacent is open: the door is two exact paths, not a prefix.
  for (const path of ['/api/auth/verify', '/api/auth', '/api/auth/requestx', '/api/auth/callback/x']) {
    const response = await onRequest({ request: anonymous(path), env: { ...upstream(), DB: stubDB([]) } });
    assert.equal(response.status, 401, `${path} is reachable without a session`);
  }
});

test('the old edge identity headers are gone and are not trusted by accident', async () => {
  assert.ok(!/cf-access-/i.test(source()), 'an edge identity header is still read');

  for (const header of [
    'cf-access-authenticated-user-email',
    'cf-access-client-id',
    'x-forwarded-user',
    'authorization',
  ]) {
    const request = new Request('https://example.invalid/api/state', { headers: { [header]: 'owner@example.invalid' } });
    const response = await onRequest({ request, env: { ...upstream(), DB: stubDB([]) } });
    assert.equal(response.status, 401, `${header} was treated as identity`);
  }
});

// ── What crosses the binding ──────────────────────────────────────────────────────────

// THIS ASSERTION DELIBERATELY CHANGED, and the next reader should not restore it.
//
// It used to say a forwarded request carries `content-type` and NOTHING else -- because under
// the old edge gate the Function held the identity and the upstream service needed none of it,
// so a session cookie crossing this binding was somebody else's bearer credential going
// somewhere it had no business. The session is now OURS, signed by the service on the other
// side of this call, and it is verified there because the signing key cannot live in a public
// repository. So the cookie must cross. This hop is internal.
//
// The property that has NOT changed, and must not: the session never reaches the VENDOR
// upstream, and is never stored. That is a claim about the private Worker, so it is asserted
// where it can actually be measured -- <PRIV>/worker/test/auth.test.mjs, "the session never
// reaches the vendor upstream, on any route" and "the session is never written to a cached row".
test('a forwarded request carries the session and the four allowed headers, and nothing else', async () => {
  const up = upstream();
  await onRequest({
    request: identified('/api/token', 'POST', JSON.stringify({ token: 'write-only' })),
    env: { ...up, DB: stubDB([]) },
  });

  const forwarded = up.seen.at(-1);
  assert.equal(new URL(forwarded.url).pathname, '/api/token');
  assert.equal(forwarded.method, 'POST');
  assert.deepEqual([...forwarded.headers.keys()].sort(), ['cf-ipcountry', 'content-type', 'cookie', 'user-agent']);
  // The body is the one thing that must survive intact -- it is forwarded, never parsed here.
  assert.equal(await forwarded.text(), JSON.stringify({ token: 'write-only' }));
});

test('the caller address crosses only on the login route, where it is the rate-limit bucket', async () => {
  const withIp = (path, method) =>
    new Request(`https://example.invalid${path}`, {
      method,
      headers: { cookie: '__Host-session=a.b.c', 'cf-connecting-ip': '203.0.113.9' },
    });

  const open = upstream();
  await onRequest({ request: withIp('/api/auth/request', 'POST'), env: { ...open, DB: stubDB([]) } });
  assert.equal(open.seen.at(-1).headers.get('cf-connecting-ip'), '203.0.113.9');

  const gated = upstream();
  await onRequest({ request: withIp('/api/state', 'GET'), env: { ...gated, DB: stubDB([]) } });
  assert.equal(gated.seen.at(-1).headers.get('cf-connecting-ip'), null, 'an address crossed with no use for it');
});

test('a header this hostname might grow later does not silently start crossing', async () => {
  const up = upstream();
  const request = new Request('https://example.invalid/api/state', {
    headers: {
      cookie: '__Host-session=a.b.c',
      'x-something-a-product-added': 'value',
      'accept-language': 'he-IL',
      referer: 'https://example.invalid/',
    },
  });
  await onRequest({ request, env: { ...up, DB: stubDB([]) } });
  assert.deepEqual([...up.seen.at(-1).headers.keys()].sort(), ['cookie']);
});

test('the sign-in redirect reaches the browser instead of being followed here', async () => {
  // The upstream answers the callback with a 302 and a Set-Cookie. If this call followed the
  // redirect server-side, the cookie would be delivered to nobody and the browser would get
  // whatever the second request returned -- a link that appears to work and never signs in.
  const seen = [];
  const env = {
    PROXY: {
      fetch(request) {
        seen.push(request);
        return new Response(null, {
          status: 302,
          headers: { Location: '/', 'Set-Cookie': '__Host-session=a.b.c; HttpOnly; Secure; SameSite=Lax; Path=/' },
        });
      },
    },
  };

  const response = await onRequest({ request: anonymous('/api/auth/callback?t=abc'), env });
  assert.equal(seen.length, 1, 'the redirect was followed instead of returned');
  assert.equal(seen[0].redirect, 'manual');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/');
  assert.match(response.headers.get('set-cookie'), /^__Host-session=/);
});

test('the login door still fails closed when the service it forwards to is not bound', async () => {
  const response = await onRequest({ request: anonymous('/api/auth/request', 'POST'), env: {} });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'upstream_unavailable' });
});

// ── The comment board, which this file answers itself ─────────────────────────────────

test('comments are refused without a session, and the board is never read', async () => {
  const writes = [];
  const response = await onRequest({
    request: anonymous('/api/comments'),
    env: { ...upstream(), DB: stubDB(writes) },
  });
  assert.equal(response.status, 401);
  assert.equal(writes.length, 0, 'an anonymous caller reached the database');
});

test('the comment author is the verified class and the body cannot forge it', async () => {
  const writes = [];
  const response = await onRequest({
    request: identified('/api/comments', 'POST', JSON.stringify({ author: 'system', text: 'hi' })),
    env: { ...upstream(), DB: stubDB(writes) },
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json()).comment.author, 'owner');
  assert.equal(writes.length, 1);
  assert.ok(writes[0].args.includes('owner'), 'the row was not written with the server-assigned author');
  assert.ok(!writes[0].args.includes('system'), 'a body-supplied author reached the database');
  // No identity is stored either: there is none to store. The session subject is a constant.
  assert.ok(
    !writes[0].args.some((a) => typeof a === 'string' && a.includes('@')),
    'an address reached the database'
  );
});

test('a missing author in the body is not an error, a missing text still is', async () => {
  const created = await onRequest({
    request: identified('/api/comments', 'POST', JSON.stringify({ text: 'no author field' })),
    env: { ...upstream(), DB: stubDB([]) },
  });
  assert.equal(created.status, 201);

  const empty = await onRequest({
    request: identified('/api/comments', 'POST', JSON.stringify({ author: 'owner' })),
    env: { ...upstream(), DB: stubDB([]) },
  });
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { error: 'text_required' });
});

test('format characters are stripped from comment text on write', async () => {
  const writes = [];
  // A right-to-left override, a zero-width joiner and a zero-width no-break space.
  const response = await onRequest({
    request: identified('/api/comments', 'POST', JSON.stringify({ text: 'do\u202Enot\u200Dtrust\uFEFF me' })),
    env: { ...upstream(), DB: stubDB(writes) },
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json()).comment.text, 'donottrust me');
  assert.ok(
    !writes[0].args.some((a) => typeof a === 'string' && /\p{Cf}/u.test(a)),
    'a format character reached the database'
  );
});

// Sanitising on write alone leaves every row that entered by another route -- a direct database
// execute, a restore, an import, a write that predates the strip -- readable in full by the
// machine this board exists for. So the property under test is the read path: this row is handed
// straight back by the stub, exactly as one of those routes would have left it in the table.
// Escapes, not literals: an invisible character in a test file is invisible in the test file too.

test('format characters are stripped from comment text on read, not only on write', async () => {
  // A right-to-left override, a zero-width joiner, a line separator (Zl, not Cf) and a
  // U+E0000-block tag character, which is how plain ASCII is smuggled past a human reader.
  const smuggled = 'do\u202Enot\u200Dtrust\u2028me\u{E0041}';
  const response = await onRequest({
    request: identified('/api/comments'),
    env: {
      ...upstream(),
      DB: stubRead([
        { id: 'row-the-write-path-never-saw', ts: 0, author: 'owner', text: smuggled, status: 'open', archived: 0 },
      ]),
    },
  });

  assert.equal(response.status, 200);
  const [comment] = (await response.json()).comments;
  assert.equal(comment.text, 'donottrustme');
  assert.equal(comment.archived, false);
});

// ── What the hostname serves (wave 3) ──
//
// The deploy uploads this directory whole, and `_redirects` is the only thing here that
// keeps a file off the hostname -- see README. That makes the guarantee a property of a
// config file nobody reads twice, so this checks it against the directory as it actually is:
// add a doc, a fixture or a data file beside the page and this fails until it is covered.

import { readdirSync } from 'node:fs';

const DIR = new URL('../', import.meta.url);

// The site itself. Anything else on the hostname is a file someone reads to learn how this
// is wired. Widen this only for something the page genuinely fetches.
const IS_PAGE = /\.(html|css|js)$/;

// Withheld by the uploader's own fixed ignore list, so they never become assets.
const NOT_UPLOADED = new Set(['_headers', '_redirects', '_routes.json', '_worker.js', 'functions', '.wrangler', '.git', 'node_modules']);

const REDIRECT_FROM = readFileSync(new URL('_redirects', DIR), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => line.split(/\s+/)[0]);

const redirected = (path) =>
  REDIRECT_FROM.some((from) => from === path || (from.endsWith('*') && path.startsWith(from.slice(0, -1))));

const servedPaths = (dir = DIR, prefix = '/') =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    NOT_UPLOADED.has(entry.name)
      ? []
      : entry.isDirectory()
        ? servedPaths(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`]
  );

test('nothing but the page is reachable on the hostname', () => {
  for (const path of servedPaths()) {
    assert.ok(
      IS_PAGE.test(path) || redirected(path),
      `${path} is uploaded and nothing hides it -- add it to _redirects (and to .assetsignore)`
    );
  }
});

test('_routes.json pins the Function to /api/* -- widening it deletes the page CSP', () => {
  const routes = JSON.parse(readFileSync(new URL('_routes.json', DIR), 'utf8'));
  // This is not housekeeping. `_headers` does not apply to a response generated by a Function
  // (https://developers.cloudflare.com/pages/configuration/headers/), so `include` is what
  // decides whether the page itself is a static asset. Widen it to /* -- the shape Cloudflare's
  // own docs example uses -- and index.html is served by the Function instead, which means
  // frame-ancestors 'none' and X-Frame-Options: DENY silently stop being sent and this page can
  // be framed again. Nothing else in the project reports that: the page still renders, no
  // request fails, and the only symptom is being clickjacked. Hence a failing test.
  assert.deepEqual(routes.include, ['/api/*']);
});

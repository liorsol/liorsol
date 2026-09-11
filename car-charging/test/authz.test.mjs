// Run: node --test car-charging/test/authz.test.mjs
//
// One property, and it is the only one worth a unit test here: a request that carries
// no identity header reaches nothing. Everything else in the Function is authenticated
// at the edge before it runs, so it cannot be tested without a live session -- this can.
//
// The route table is iterated rather than listed on purpose. Add a route and it is
// covered automatically; change the caller class of an unidentified request to something
// a route admits and this fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ROUTES, callerClass, onRequest } = await import('../functions/api/[[path]].js');

// One path per shape the table routes. Every route must be hit by at least one of these,
// which is what stops a new route from slipping past the test below.
const PROBES = [
  '/api/comments',
  '/api/comments/1a2b',
  '/api/state',
  '/api/charge/start',
  '/api/token',
];

const anonymous = (path, method = 'GET') =>
  new Request(`https://example.invalid${path}`, { method });

test('an unidentified request is a class no route admits', () => {
  const klass = callerClass(anonymous('/api/state'));
  assert.equal(klass, 'unknown');
  for (const route of ROUTES) {
    assert.ok(
      !route.callers.includes(klass),
      `route ${route.match} admits the class given to a request with no identity header`
    );
  }
});

test('every route is covered by a probe path', () => {
  for (const route of ROUTES) {
    assert.ok(
      PROBES.some((path) => route.match.test(path)),
      `no probe path matches ${route.match} -- add one, then the 403 test below covers it`
    );
  }
});

test('an unidentified request gets 403 on every route', async () => {
  for (const path of PROBES) {
    for (const method of ['GET', 'POST', 'PATCH']) {
      const response = await onRequest({ request: anonymous(path, method), env: {} });
      assert.equal(response.status, 403, `${method} ${path} was not refused`);
      assert.deepEqual(await response.json(), { error: 'forbidden' });
    }
  }
});

// ── The three properties added in wave 2 ──
//
// A stub database is enough: none of these care what SQL runs, only what the Function decided
// before it ran. `identified()` is what the edge hands us once a session exists -- including
// the session cookie, which is exactly what must not travel any further.

const identified = (path, method = 'GET', body) =>
  new Request(`https://example.invalid${path}`, {
    method,
    headers: {
      'cf-access-authenticated-user-email': 'someone@example.invalid',
      cookie: 'CF_Authorization=a.session.jwt',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body,
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

test('the comment author is server-assigned and the body cannot forge it', async () => {
  const writes = [];
  const response = await onRequest({
    request: identified('/api/comments', 'POST', JSON.stringify({ author: 'system', text: 'hi' })),
    env: { DB: stubDB(writes) },
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json()).comment.author, 'owner');
  assert.equal(writes.length, 1);
  assert.ok(writes[0].args.includes('owner'), 'the row was not written with the server-assigned author');
  assert.ok(!writes[0].args.includes('system'), 'a body-supplied author reached the database');
  // No identity is stored either: the email is authorisation input, not a column value.
  assert.ok(
    !writes[0].args.some((a) => typeof a === 'string' && a.includes('@')),
    'an address reached the database'
  );
});

test('a missing author in the body is not an error, a missing text still is', async () => {
  const writes = [];
  const created = await onRequest({
    request: identified('/api/comments', 'POST', JSON.stringify({ text: 'no author field' })),
    env: { DB: stubDB(writes) },
  });
  assert.equal(created.status, 201);

  const empty = await onRequest({
    request: identified('/api/comments', 'POST', JSON.stringify({ author: 'owner' })),
    env: { DB: stubDB([]) },
  });
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { error: 'text_required' });
});

test('format characters are stripped from comment text on write', async () => {
  const writes = [];
  // A right-to-left override, a zero-width joiner and a zero-width no-break space.
  const response = await onRequest({
    request: identified(
      '/api/comments',
      'POST',
      JSON.stringify({ text: 'do‮not‍trust﻿ me' })
    ),
    env: { DB: stubDB(writes) },
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json()).comment.text, 'donottrust me');
  assert.ok(
    !writes[0].args.some((a) => typeof a === 'string' && /\p{Cf}/u.test(a)),
    'a format character reached the database'
  );
});

test('a forwarded request carries no credential and no identity into the upstream service', async () => {
  let seen = null;
  const env = { PROXY: { fetch: (request) => ((seen = request), new Response('{}')) } };

  await onRequest({
    request: identified('/api/token', 'POST', JSON.stringify({ token: 'write-only' })),
    env,
  });

  assert.ok(seen, 'nothing reached the upstream service');
  assert.deepEqual([...seen.headers.keys()].sort(), ['content-type']);
  assert.equal(seen.method, 'POST');
  assert.equal(new URL(seen.url).pathname, '/api/token');
  // The body is the one thing that must survive intact -- it is forwarded, never parsed here.
  assert.equal(await seen.text(), JSON.stringify({ token: 'write-only' }));
});

test('a forwarded request with no upstream bound fails closed', async () => {
  const response = await onRequest({ request: identified('/api/state'), env: {} });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'upstream_unavailable' });
});

// ── What the hostname serves (wave 3) ──
//
// The deploy uploads this directory whole, and `_redirects` is the only thing here that
// keeps a file off the hostname -- see README. That makes the guarantee a property of a
// config file nobody reads twice, so this checks it against the directory as it actually is:
// add a doc, a fixture or a data file beside the page and this fails until it is covered.

import { readdirSync, readFileSync } from 'node:fs';

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

test('_routes.json pins the Function to /api/*', () => {
  const routes = JSON.parse(readFileSync(new URL('_routes.json', DIR), 'utf8'));
  // A wider include does not refuse anything: a request the Function does not route falls
  // through to the asset server. It only widens what a future Function file can intercept.
  assert.deepEqual(routes.include, ['/api/*']);
});

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

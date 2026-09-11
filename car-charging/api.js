// ── API client ──
//
// Same-origin relative paths only. There is no base URL, no hostname and no way to configure
// one: moving this page to another hostname must be a DNS change, never a code change.
//
// NO AUTOMATIC REFRESH. Nothing in this file can fetch on its own. There is no interval timer,
// no event listener of any kind, no service worker, no revalidation when the tab is shown again
// or the network comes back, and no retry after a failure. Upstream is touched on a page load
// whose cached data the server judges too old, and when the user presses refresh. A page left
// open all day makes zero upstream calls — that is a free-tier invocation budget requirement,
// not an optimisation.
//
// The one exception is pollSettle() at the bottom of this file: a counted, hard-capped loop that
// only runs after the user presses stop. It holds the only timer in this file.
//
// To check that claim rather than trust it: grep this file for every timer, listener and
// worker API the platform offers. The bounded settle poll is the only line that comes back.

// ── Result envelope ──
//
// Every exported call resolves to the same shape and never throws:
//
//   { ok, status, data, fetchedAt, stale, error }
//
//   ok        true only for a 2xx JSON response
//   status    HTTP status, or 0 when the request never completed
//   data      the parsed JSON body, or null
//   fetchedAt epoch ms of the server's last successful upstream fetch, or null
//   stale     the server's own staleness flag; true on any failed request, because the caller's
//             existing data is then the freshest thing on screen
//   error     null when ok, otherwise a name from the list below
//
// Error names — a closed set, so the UI branches on a known value and never renders a raw
// server string:
//
//   TOKEN_EXPIRED   the credential needs replacing. A first-class state, not a failure:
//                   show the banner, keep the previously loaded data visible and marked stale.
//   'auth_required' the edge bounced us to a sign-in; the page needs a reload, not a retry
//   'network'       the request never completed
//   'bad_response'  a response that was not the JSON we expect
//   'http_error'    any other non-2xx; read `status` for which
//
// fetchedAt and stale are reported, never interpreted. The server owns the decision about when
// to go upstream; this module must not second-guess it, and must not cache anything itself.

export const TOKEN_EXPIRED = 'token_expired';

// ── Core ──

function fail(error, status) {
  return { ok: false, status: status || 0, data: null, fetchedAt: null, stale: true, error };
}

function jsonBody(body) {
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

async function request(path, init) {
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    return fail('network');
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Not JSON. A redirect off our own origin means the edge wants a fresh sign-in.
    return fail(response.redirected ? 'auth_required' : 'bad_response', response.status);
  }

  const fetchedAt = typeof data?.fetchedAt === 'number' ? data.fetchedAt : null;
  const stale = data?.stale === true;

  if (!response.ok) {
    // Only the one name is passed through. Any other server string stays out of the UI, both
    // because callers should branch on a known set and because upstream wording is not ours
    // to put on a public page.
    const error = data?.error === TOKEN_EXPIRED ? TOKEN_EXPIRED : 'http_error';
    return { ok: false, status: response.status, data, fetchedAt, stale: true, error };
  }

  return { ok: true, status: response.status, data, fetchedAt, stale, error: null };
}

// ── Reads ──
// These do not force anything. The server returns its cached row untouched unless its own
// age rule says otherwise.

export function getState() {
  return request('/api/state');
}

export function getHistory() {
  return request('/api/history');
}

export function getInvoices() {
  return request('/api/invoices');
}

// ── Refresh — user-pressed only ──
// The only call that forces an upstream fetch regardless of cache age. Wire it to a button and
// to nothing else.

export function refresh() {
  return request('/api/refresh', { method: 'POST' });
}

// ── Charge control ──

export function start() {
  return request('/api/charge/start', { method: 'POST' });
}

// Arms the settle poll below. Module memory only: it is gone on reload, which is what makes the
// poll impossible to resurrect by reloading the page.
let stopPressedThisPageSession = false;

// The body carries a neutral `sessionId`. Translating it to whatever the upstream call wants is
// the proxy's job, not this page's — upstream field names are vendor detail and this file is
// public.
export function stop(sessionId) {
  stopPressedThisPageSession = true;
  return request('/api/charge/stop', { method: 'POST', ...jsonBody({ sessionId }) });
}

export function settle(sessionId) {
  return request('/api/charge/settle/' + encodeURIComponent(sessionId));
}

// ── Credential install — write-only ──
//
// The value is read from the field, sent, and dropped. It is never stored, never logged, never
// returned, never put in a URL, and never held in a module variable. Do not add a "last token"
// for convenience, do not echo it back — not masked, not its length. The response body is
// success or failure and nothing else, so this deliberately returns no data.

export async function installToken(value) {
  const result = await request('/api/token', { method: 'POST', ...jsonBody({ token: value }) });
  return { ok: result.ok, status: result.status, error: result.error };
}

// ── Comments ──

const COMMENT_MODES = ['exclude', 'include', 'only'];

export function getComments(mode) {
  const archived = COMMENT_MODES.includes(mode) ? mode : 'exclude';
  return request('/api/comments?archived=' + archived);
}

export function postComment({ author, text }) {
  return request('/api/comments', { method: 'POST', ...jsonBody({ author, text }) });
}

// patch is { status: 'open' | 'done' } or { archived: 0 | 1 }.
export function updateComment(id, patch) {
  return request('/api/comments/' + encodeURIComponent(id), {
    method: 'PATCH',
    ...jsonBody(patch),
  });
}

// ── The one bounded exception to "no automatic refresh" ──
//
// A stopped session takes a few seconds to settle upstream, and showing the user a stop that
// looks like it failed is worse than a handful of extra calls. So after a stop press — and only
// then — sample the session once a second until the server says it is done.
//
// The cap is visible in one read on purpose: a counted for-loop, not a recursive timer, so it
// cannot run away. It cannot start on page load and cannot survive a reload, because the only
// thing that arms it is stop() setting a module variable in this page session.
//
// Worst case: SETTLE_MAX_ATTEMPTS calls over roughly that many seconds, then it gives up and
// returns whatever the last sample said.

export const SETTLE_MAX_ATTEMPTS = 45;
export const SETTLE_INTERVAL_MS = 1000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollSettle(sessionId, onSample) {
  if (!stopPressedThisPageSession) return fail('settle_not_armed');

  let last = fail('settle_not_armed');
  for (let attempt = 1; attempt <= SETTLE_MAX_ATTEMPTS; attempt++) {
    last = await settle(sessionId);
    if (onSample) onSample(last, attempt);
    if (last.ok && last.data?.completed === true) return last;
    if (last.error === TOKEN_EXPIRED) return last;
    if (attempt < SETTLE_MAX_ATTEMPTS) await wait(SETTLE_INTERVAL_MS);
  }
  return last;
}

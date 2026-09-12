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
// The two exceptions are pollSettle() and pollStart() at the bottom of this file: counted,
// hard-capped loops that only run after the user presses stop or start. They share the one timer
// in this file and neither can be entered without the press that arms it.
//
// To check that claim rather than trust it: grep this file for every timer, listener and
// worker API the platform offers. One line comes back -- the sleep those two polls share -- and
// `test/settle.test.mjs` asserts that it is still exactly one.

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
//   TOKEN_EXPIRED   the charger credential was REJECTED and needs replacing. A first-class
//                   state, not a failure: show the banner, keep the previously loaded data
//                   visible and marked stale. Mended only in the vendor's own phone app.
//   CHARGER_UNREACHABLE  the server could not reach the charger service at all, or it answered
//                   something that is not a verdict on the credential (a 404, a 5xx). A
//                   configuration or outage fault. NOT a credential problem, and it must never
//                   be worded as one -- this name exists because it used to arrive as
//                   TOKEN_EXPIRED, and a wrong base URL therefore told the owner to go and
//                   renew a credential that was healthy the entire time.
//   CHARGER_BAD_REPLY    the charger service answered in a shape the server cannot read.
//                   Also not a credential problem.
//   'auth_required' this browser holds no session -- a 401 on any route, or a bounce to a
//                   sign-in. It needs a new sign-in link, not a retry and not a reload.
//   'network'       the request never completed
//   'bad_response'  a response that was not the JSON we expect
//   'http_error'    any other non-2xx; read `status` for which
//
// fetchedAt and stale are reported, never interpreted. The server owns the decision about when
// to go upstream; this module must not second-guess it, and must not cache anything itself.

export const TOKEN_EXPIRED = 'token_expired';
export const CHARGER_UNREACHABLE = 'charger_unreachable';
export const CHARGER_BAD_REPLY = 'charger_bad_reply';

// The three names the server may use for "something went wrong between here and the charger".
// Still a CLOSED set: a name the server has not agreed to becomes 'http_error', so no server
// string can reach the DOM. Exported as a predicate rather than as the set, because the only
// thing any caller wants to ask is "is this one of them".
const UPSTREAM_ERRORS = new Set([TOKEN_EXPIRED, CHARGER_UNREACHABLE, CHARGER_BAD_REPLY]);
export const isChargerError = (error) => UPSTREAM_ERRORS.has(error);

// ── Core ──

function fail(error, status) {
  return { ok: false, status: status || 0, data: null, fetchedAt: null, stale: true, error };
}

function jsonBody(body) {
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

// Why `redirect: 'manual'`, and why it is last in the object so no caller can turn it off:
//
// When the session ends, the edge answers a same-origin call to one of these routes with a
// redirect to the sign-in host. Under the default mode the browser *follows* that redirect and
// then applies the cross-origin check to where it landed; the sign-in host sends no header
// allowing this origin, so the call rejects before any response object exists. Every property
// that could have named the cause — `redirected` among them — is unreachable, and a dead session
// arrives in the same catch as a dead network.
//
// Manual mode does not follow it. The browser hands back an opaque redirect instead: status 0,
// no body, no headers, and a `type` that is readable. That one readable field is the whole
// signal, and it survives the cross-origin case that `redirected` could never see.
async function request(path, init) {
  let response;
  try {
    response = await fetch(path, { ...init, redirect: 'manual' });
  } catch {
    return fail('network');
  }

  // Checked before the body, because an opaque redirect has no body to read: reading first
  // would land this in `bad_response` and lose the distinction again.
  if (response.type === 'opaqueredirect') return fail('auth_required');

  // A 401 is the server saying this browser holds no session, and it is the STATUS that says
  // so. The body names it too, but that name belongs to the route and the body may not be JSON
  // at all -- so this is read before the parse, for the same reason the opaque redirect above
  // is. A 401 that fails to parse would otherwise land in `bad_response`, and the page would
  // offer a retry in the one state where only a sign-in link can help.
  //
  // This status is also the ONLY way the page learns it is signed out. The session rides in a
  // cookie the browser will not hand to script, which is why nothing here tries to read one --
  // and why nothing here keeps a marker of its own. A stored marker can claim a session the
  // server has already stopped honouring; the server's last answer cannot.
  if (response.status === 401) return fail('auth_required', 401);

  let data = null;
  try {
    data = await response.json();
  } catch {
    return fail('bad_response', response.status);
  }

  const fetchedAt = typeof data?.fetchedAt === 'number' ? data.fetchedAt : null;
  const stale = data?.stale === true;

  if (!response.ok) {
    // Only the three agreed names are passed through. Any other server string stays out of the
    // UI, both because callers should branch on a known set and because upstream wording is not
    // ours to put on a public page.
    const error = isChargerError(data?.error) ? data.error : 'http_error';
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

// ── What counts as a live session — one definition, three readers ──
//
// The projection puts a stop timestamp, a stop reason and a completed flag on *every* row it
// emits into `state.sessions`, including the one that has just ended: a stopped session lingers
// upstream for a few seconds, which is the entire reason the settle poll below exists. So "there
// is a row" never means "a charge is running".
//
// Three modules need that judgement and each had written its own. The one holding the contactor
// had written none at all — any row carrying an id was the live session — so a single ended row
// made the page disable Start, leave Stop enabled and send a dead id to the charger.
//
// The union of the stop marks, not the smallest test that passes: the live-state rows carry
// `completed` and the timestamp is `stoppedAt`/`stoppedLocal`, the history rows carry no
// `completed` at all, and the pre-projection spellings are still accepted because a row that
// has ended must read as ended under every shape this page has ever been handed. Any mark, in
// any spelling, ends it.
//
// It lives in this module because this module already owns the wire shape, and it is exported
// rather than copied because three modules agreeing today is three modules drifting later.
// Import it; do not re-spell it. `test/controls.test.mjs` fails on a second spelling.
export function isLiveSession(session) {
  if (!session || session.completed === true) return false;
  return !(
    session.stoppedAt ||
    session.stoppedLocal ||
    session.deviceStopDate ||
    session.deviceLocalStopDate
  );
}

// ── Refresh — user-pressed only ──
// The only call that forces an upstream fetch regardless of cache age, and the only mechanism
// there is: nothing else in this file may grow a way to bypass the server's age rule. Wire it to
// the refresh button, to the reload a command runs after it has changed something, and to
// nothing else. Every one of those is a press.

export function refresh() {
  return request('/api/refresh', { method: 'POST' });
}

// ── Charge control ──

// Arms the confirmation poll below, the same way stop() arms the settle poll. Module memory only:
// gone on reload, which is what makes the poll impossible to resurrect by reloading the page.
let startPressedThisPageSession = false;

export function start() {
  startPressedThisPageSession = true;
  return request('/api/charge/start', { method: 'POST' });
}

// Arms the settle poll below. Same memory, same reason.
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

// ── Sign-in link — the only call a signed-out page may make ──
//
// It takes no body and returns no data, and both are the point. The address to mail lives on
// the server: this page never asks for one, never holds one and never sends one, so a visitor
// who cannot get in also cannot learn it and cannot aim the mail somewhere else.
//
// The other half of the flow is not a call at all. The link arrives by mail and the owner opens
// it, which is a top-level navigation to a route this file never fetches; it lands a session on
// that browser and redirects back to the page, which then loads signed in like any other load.
// So there is nothing here to poll, nothing to wait on and no second function to write.
export async function requestSignInLink() {
  const result = await request('/api/auth/request', { method: 'POST' });
  // A 2xx is a yes even with no body to parse -- the route may answer 204, and request()
  // reports an unreadable body as `bad_response` whatever the status said. Of the two possible
  // mistakes, painting a failure over a link that really did go out is the worse one: it sends
  // the owner back to press a button whose work is already done.
  const sent =
    result.ok || (result.error === 'bad_response' && result.status >= 200 && result.status < 300);
  return { ok: sent, status: result.status, error: sent ? null : result.error };
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

// patch is { status: 'open' | 'done' } or { archived: true | false }.
// `archived` is a boolean on the wire, not 0/1 — the route answers 400 to a number. The column
// behind it is an integer, which is what made the wrong shape look plausible.
export function updateComment(id, patch) {
  return request('/api/comments/' + encodeURIComponent(id), {
    method: 'PATCH',
    ...jsonBody(patch),
  });
}

// ── The two bounded exceptions to "no automatic refresh" ──
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

// The server nests the settle flag under `session`. Read both shapes: the loop's exit
// condition is the whole point of the cap being a cap rather than a schedule, and a field
// that silently reads `undefined` spends every one of the attempts, every time.
const settled = (data) => (data?.session?.completed ?? data?.completed) === true;

export async function pollSettle(sessionId, onSample) {
  if (!stopPressedThisPageSession) return fail('settle_not_armed');

  let last = fail('settle_not_armed');
  for (let attempt = 1; attempt <= SETTLE_MAX_ATTEMPTS; attempt++) {
    last = await settle(sessionId);
    if (onSample) onSample(last, attempt);
    if (last.ok && settled(last.data)) return last;
    // The same two exits pollStart has, and the second one for the same reason: the gate is over
    // the whole hostname, so once a sign-in has ended EVERY remaining sample is bounced and not
    // one of them can succeed. Without this the poll spends all SETTLE_MAX_ATTEMPTS and hands
    // the caller the ran-out-of-attempts outcome, whose wording says press refresh -- provably
    // the one action that cannot mend an ended sign-in. Neither condition mends itself by being
    // asked again; a transport failure might, which is why it keeps the cap instead.
    if (last.error === TOKEN_EXPIRED || last.error === 'auth_required') return last;
    if (attempt < SETTLE_MAX_ATTEMPTS) await wait(SETTLE_INTERVAL_MS);
  }
  return last;
}

// ── The same shape, for the other end of a charge ──
//
// A start is accepted before the charger reports it, exactly as a stop is settled after it. The
// page held a reload that read the CACHED row -- under an hour old, so the server rightly served
// it back unchanged -- and faithfully repainted the charger as it had been before the press. The
// owner saw the button go to its wait label, come back, and change nothing.
//
// So the sample is refresh(), the one call that forces the fetch regardless of age, and it is the
// existing one rather than a second forcing mechanism: it is also what writes the row the reload
// afterwards reads, so by the time this returns the page's next ordinary load is already true.
// The server's hour rule is untouched -- a page load still forces nothing, which is the free-tier
// invocation budget requirement, and `test/start-confirm.test.mjs` asserts that first.
//
// The cap is lower than the settle poll's and the interval longer, because a sample here is three
// upstream fetches rather than one. Worst case START_MAX_ATTEMPTS forced rounds over roughly half
// a minute, then it gives up and SAYS it gave up -- see the caller. Running out is not a failure
// and must never be reported as one: the command was accepted, the charger has not confirmed yet.
//
// `took` is the caller's, not this module's: what counts as "charging" is the same judgement the
// panel paints from, and it stays in one place rather than being spelled a second time here. The
// refresh body nests the three routes, so the state half is unwrapped here -- the wire shape is
// this module's and does not leak into a view.

export const START_MAX_ATTEMPTS = 10;
export const START_INTERVAL_MS = 3000;

export async function pollStart(took, onSample) {
  if (!startPressedThisPageSession) return { ...fail('start_not_armed'), confirmed: false };

  let last = fail('start_not_armed');
  for (let attempt = 1; attempt <= START_MAX_ATTEMPTS; attempt++) {
    last = await refresh();
    if (onSample) onSample(last, attempt);
    if (last.ok && took(last.data?.state ?? last.data)) return { ...last, confirmed: true };
    // Neither of these mends itself by being asked again, and asking costs a forced round each
    // time. A transport failure is different: it may be one bad round, so the loop keeps its cap.
    if (last.error === TOKEN_EXPIRED || last.error === 'auth_required') break;
    if (attempt < START_MAX_ATTEMPTS) await wait(START_INTERVAL_MS);
  }
  return { ...last, confirmed: false };
}

// CORS proxy for the eSIM usage page (esim-usage/index.html).
//
// Why it exists: esim.dog's check-esim-usage function is POST-only and sends no
// CORS headers, so the browser cannot call it from liorsol.github.io. Free public
// proxies don't help — they all forward as GET, which the function rejects with 405.
//
// Deploy (free plan, no config file needed):
//   npx wrangler login
//   npx wrangler deploy esim-usage/proxy.js --name esim-usage-proxy --compatibility-date 2026-01-01
// The deployed URL is hardcoded as ENDPOINT in index.html; ?proxy=<url> overrides it.
//
// It holds no secrets: one endpoint, four known ICCIDs, nothing else gets through.

const TARGET = 'https://esim.dog/.netlify/functions/check-esim-usage';
/* Order lookup. esim.dog resolves an order link to the eSIM behind it, which is how
   the Italy trip board turns one pasted link into an ICCID plus the plan details —
   nobody should have to hunt for a 19-digit number in their phone settings. Two
   functions because there are two link shapes: Stripe Checkout sessions and payment
   intents. Neither sends CORS, same as the usage endpoint, hence this worker. */
const LOOKUP = {
  session_id:     'https://esim.dog/.netlify/functions/get-esim?session_id=',
  payment_intent: 'https://esim.dog/.netlify/functions/get-esim-by-payment-intent?payment_intent_id=',
};
const ALLOWED = [
  'https://liorsol.github.io',
  'http://localhost:8811',   // albania dev server
  'http://localhost:8812',   // italy dev server — its #esim board calls this too
];
// The URL is unauthenticated, so anything that learns it could otherwise look up any
// ICCID's usage. These are already public in index.html — allowlisting them here just
// keeps the worker from being a general-purpose lookup for other people's eSIMs.
const ICCIDS = new Set([
  '8948010010087231980', // ליאור
  '8948010010087232053', // מור
  '8948010010087232079', // זואי
  '8948010010087232699', // הרצל
]);

// The Italy trip page (#esim) lets the family add an eSIM from the browser, so its
// ICCIDs cannot be known here at deploy time. They are read from the same public
// Firebase node the board writes to, and cached briefly per isolate so a page full
// of rows costs one upstream read, not one per request.
//
// BE CLEAR ABOUT WHAT THIS GIVES UP. The static list above meant this worker could
// only ever look up four known eSIMs. That node is world-writable — the whole site
// has no auth — so anyone who finds it can register an ICCID and then query it
// through here. The allowlist is therefore no longer a real restriction on *whose*
// eSIM can be looked up; what it still does is stop this worker being an anonymous
// one-request lookup for an arbitrary ICCID, since a caller must first leave a
// visible public write on a board the family reads. That was judged the right
// trade for "add any new eSIM and it just works". If it ever looks wrong, delete
// the fetch below and go back to editing the list by hand.
const BOARD = 'https://liorsol-github-default-rtdb.europe-west1.firebasedatabase.app/italy2026/esims.json';
const TTL = 60_000;
let cached = { at: 0, set: new Set() };

async function registered() {
  if (Date.now() - cached.at < TTL) return cached.set;
  try {
    const res = await fetch(BOARD, { cf: { cacheTtl: 30 } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const node = (await res.json()) || {};
    const set = new Set();
    for (const rec of Object.values(node)) {
      // Same shape check the page applies; an archived eSIM still resolves, because
      // the board can un-archive it and a stale 403 is the more confusing failure.
      if (rec && typeof rec.i === 'string' && /^[0-9]{18,22}$/.test(rec.i)) set.add(rec.i);
    }
    cached = { at: Date.now(), set };
  } catch {
    // Keep serving the last good set rather than locking everyone out on a blip.
    cached.at = Date.now();
  }
  return cached.set;
}

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    /* GET /lookup?url=<an esim.dog order link> → the details behind it.
       THIS ENDPOINT EXISTS TO THROW THINGS AWAY. The upstream answer carries the
       QR code, the activation code, the buyer's email and their full name; the page
       that calls this is public and writes what it gets into a world-readable DB.
       So the allowlist below is a strict include-list, not an exclude-list — a new
       upstream field is dropped by default rather than leaked by default. */
    if (req.method === 'GET' && new URL(req.url).pathname === '/lookup') {
      const raw = new URL(req.url).searchParams.get('url') || '';
      let ref = null, kind = null;
      try {
        const q = new URL(raw).searchParams;
        for (const k of ['session_id', 'payment_intent']) {
          const v = q.get(k);
          /* Stripe ids only. This string is pasted by a stranger and is about to be
             concatenated into an upstream URL. */
          if (v && /^[A-Za-z0-9_]{8,200}$/.test(v)) { ref = v; kind = k; break; }
        }
      } catch { /* not a URL at all → ref stays null */ }
      if (!ref) {
        return new Response(JSON.stringify({ error: 'no session_id or payment_intent in that link' }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      const up = await fetch(LOOKUP[kind] + encodeURIComponent(ref));
      const j = await up.json().catch(() => null);
      if (!up.ok || !j || !j.success) {
        return new Response(JSON.stringify({ error: 'lookup failed' }),
          { status: up.status === 200 ? 502 : up.status, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      const o = j.session || j.payment || {};       // same shape, two names
      const e = j.esim || {};
      return new Response(JSON.stringify({
        success: true,
        iccid:    e.iccid || '',
        apn:      e.apn || '',
        smdp:     e.smdp_address || '',
        country:  o.country_name || '',
        plan:     o.plan_data || '',
        validity: o.plan_validity || '',
        coverage: o.coverage || '',
        networks: o.networks || '',
        purchased: o.purchase_date || '',
      }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });

    const body = await req.text();
    let asked;
    try { asked = JSON.parse(body).iccidList; } catch { /* not JSON → rejected below */ }
    const extra = await registered();
    if (!Array.isArray(asked) || !asked.length ||
        !asked.every(i => ICCIDS.has(i) || extra.has(i))) {
      return new Response(JSON.stringify({ error: 'unknown iccid' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const upstream = await fetch(TARGET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};

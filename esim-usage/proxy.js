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
const ALLOWED = ['https://liorsol.github.io', 'http://localhost:8811'];
// The URL is unauthenticated, so anything that learns it could otherwise look up any
// ICCID's usage. These are already public in index.html — allowlisting them here just
// keeps the worker from being a general-purpose lookup for other people's eSIMs.
const ICCIDS = new Set([
  '8948010010087231980', // ליאור
  '8948010010087232053', // מור
  '8948010010087232079', // זואי
  '8948010010087232699', // הרצל
]);

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });

    const body = await req.text();
    let asked;
    try { asked = JSON.parse(body).iccidList; } catch { /* not JSON → rejected below */ }
    if (!Array.isArray(asked) || !asked.length || !asked.every(i => ICCIDS.has(i))) {
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

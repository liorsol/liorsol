/* Service worker for the Albania 2026 trip page.
   Goal: the whole page — plan, map, restaurants — opens on a phone with no
   reception, which is the normal state in Shëngjergj and on the southern roads.

   All the logic lives in ../sw-core.js, shared with the other trip pages. This
   file exists so the worker's SCOPE is this directory and nothing wider — see the
   comment at the top of sw-core.js for why that matters on GitHub Pages.

   ⚠️ Bump V whenever index.html / trip.js / map.html / restaurants.json changes —
   and ALSO whenever ../sw-core.js changes. The browser only reinstalls a worker
   whose bytes differ, and cache-first means a corrected restaurant or a fixed
   drive time is invisible until V moves. This is the one way to ship a change
   that silently does not reach the family. */
var V = 'albania-2026-v6';

/* Tiles get their own cache, and it deliberately SURVIVES a V bump — it is not
   shell, it is the areas the family has already primed. See sw-core.js. */
var TILES = 'albania-2026-tiles';

/* Local shell — if any of these fails to cache, offline is broken, so install fails loudly. */
var CORE = [
  './',
  'index.html',
  'trip.js',
  'map.html',
  'restaurants.json',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/leaflet.js',            // vendored precisely so the offline map cannot depend on a CDN
  'vendor/leaflet.css'
];

/* Third-party shell. Best-effort — a missing font degrades to a fallback face. */
var EXTRA = [
  'https://fonts.googleapis.com/css2?family=Suez+One&family=Assistant:wght@300;400;500;600;700;800&family=Heebo:wght@400;500;700;900&display=swap'
];

importScripts('../sw-core.js');

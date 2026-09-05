/* Service worker for the Italy 2026 trip page (Umbria + Rome).
   Goal: the whole page — plan, map, restaurants — opens on a phone with no
   reception. Deruta sits in the Umbrian hills, roaming can drop out on the
   Valnerina and A1 stretches, and the 02:00 arrival at Fiumicino is exactly
   when nobody wants to discover the plan needs a network.

   All the logic lives in ../sw-core.js, shared with the other trip pages. This
   file exists so the worker's SCOPE is this directory and nothing wider — see the
   comment at the top of sw-core.js for why that matters on GitHub Pages.

   ⚠️ Bump V whenever index.html / trip.js / map.html / restaurants.json changes —
   and ALSO whenever ../sw-core.js changes. The browser only reinstalls a worker
   whose bytes differ, and cache-first means a corrected restaurant or a fixed
   opening time is invisible until V moves. This is the one way to ship a change
   that silently does not reach the family. */
var V = 'italy-2026-v4';

/* Tiles get their own cache, and it deliberately SURVIVES a V bump — it is not
   shell, it is the areas the family has already primed. See sw-core.js. */
var TILES = 'italy-2026-tiles';

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
  'vendor/leaflet.css',
  /* The airport images are strictly precached and not lazy extras. They are the
     picture the family looks at while standing in FCO at 02:00 with a dead eSIM —
     the one moment on this trip when "it will load" is the wrong assumption. The
     hero rides along because it is the first paint of the page. ~740 KB total. */
  'assets/fco-t3-shuttle.svg',
  'assets/fco-departures-kerb-night.jpg',
  'assets/fco-t3-arrivals-board.jpg',
  'assets/hero-umbria.jpg'
];

/* Third-party shell. Best-effort — a missing font degrades to a fallback face. */
var EXTRA = [
  'https://fonts.googleapis.com/css2?family=Suez+One&family=Assistant:wght@300;400;500;600;700;800&family=Heebo:wght@400;500;700;900&display=swap'
];

importScripts('../sw-core.js');

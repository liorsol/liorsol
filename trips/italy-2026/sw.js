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
var V = 'italy-2026-v20';

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
     hero still rides along because it is the first paint of the page. ~750 KB.

     NOT here on purpose: the hero clip. It now lives in the assets repo
     (liorsol.github.io/assets/italy-2026/hero-umbria.mp4) and it would not be
     cacheable from here anyway — `media()` in sw-core.js bypasses the service
     worker for video entirely, because a cached 200 handed back to a range
     request is how this exact clip broke once before. The still above is its
     fallback layer and IS precached, so a dead network shows the frame, not a
     hole. Same arrangement as the Albania page's clip. */
  'assets/fco-departures-kerb-night.jpg',
  'assets/fco-t3-arrivals-board.jpg',
  'assets/hero-umbria.jpg'
];

/* Best-effort shell — one failure must not cost the offline page.

   The fonts: a missing face degrades to a fallback, which a missing map script never would.

   The 51 day-card shots (5.0 MB), now served from the assets repo at
   liorsol.github.io/assets/italy-2026/prev/. Two things about that:

   They are NOT in CORE on purpose. CORE is strict — one entry failing fails the whole
   install and leaves no offline page — and betting the shell on 51 decorative pictures
   is a bad trade. `trip.js` already splices a shot that does not load out of the strip
   and drops the `<figure>` once none is left, so the downgrade is a card that looks like
   it did before the galleries existed.

   They are absolute URLs on another host, and precaching them still works, which is the
   whole reason that host was chosen. GitHub Pages puts the assets repo on
   `liorsol.github.io` — the SAME ORIGIN as this page in production — so nothing here is
   cross-origin at all once deployed. Even from a localhost dev server it still works,
   because Pages sends `Access-Control-Allow-Origin: *`. That matters more than it looks:
   `cache.add()` REJECTS an opaque response, so a host without that header (GitHub
   Releases, say) would fail every one of these at install and silently give up
   "cached on load". Verified live: `image/webp`, `ACAO: *`, and 206 on the clip. */
var EXTRA = [
  'https://fonts.googleapis.com/css2?family=Suez+One&family=Assistant:wght@300;400;500;600;700;800&family=Heebo:wght@400;500;700;900&display=swap',
  'https://liorsol.github.io/assets/italy-2026/prev/orvieto-1.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/orvieto-2.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/orvieto-3.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/orvieto-4.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/orvieto-5.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/orvieto-6.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/marmore-1.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/marmore-2.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/marmore-3.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/marmore-4.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/marmore-5.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/marmore-6.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/assisi-1.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/assisi-2.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/assisi-3.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/assisi-4.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/assisi-5.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/assisi-6.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/adventure-1.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/adventure-2.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/adventure-3.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/adventure-4.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/adventure-5.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/adventure-6.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/trasimeno-1.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/trasimeno-2.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/trasimeno-3.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/trasimeno-4.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/trasimeno-5.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/trasimeno-6.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/trasimeno-7.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/perugia-1.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/perugia-2.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/perugia-3.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/perugia-4.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/perugia-5.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/tuscany-1.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/tuscany-2.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/tuscany-3.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/tuscany-4.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/tuscany-5.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/tuscany-6.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/rest-1.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/rest-2.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/rest-3.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/rest-4.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/rest-5.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/rest-6.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/rest-7.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/rest-8.webp',
  'https://liorsol.github.io/assets/italy-2026/prev/rest-9.webp'
];

importScripts('../sw-core.js');

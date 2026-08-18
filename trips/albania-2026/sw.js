/* Service worker for the Albania 2026 trip page.
   Goal: the whole page — plan, map, restaurants — opens on a phone with no
   reception, which is the normal state in Shëngjergj and on the southern roads.

   Bump V whenever index.html / trip.js / map.html change: the browser only
   reinstalls a worker whose bytes differ, and the old cache is keyed by V. */
var V = 'albania-2026-v4';

/* Map tiles live in their own cache, and it deliberately SURVIVES a V bump: it is not
   part of the shell, it is whatever areas the family has already looked at, and wiping
   it on a content edit would silently un-prime their offline map.

   Why there is no "download the map" button: the OSM Foundation tile policy states
   "Offline use is not permitted on tile.openstreetmap.org" and that prefetch/offline
   patterns "will be blocked without notice". Caching what a user actively views is
   explicitly allowed — bulk-fetching an area is not, and getting the tile servers to
   block us mid-trip is the one failure worse than no basemap.
   https://operations.osmfoundation.org/policies/tiles/

   The cap is the storage guard: ~900 tiles ≈ 15–20 MB (opaque responses carry quota
   padding, so it bills higher than the raw PNG bytes). Oldest out first. */
var TILES = 'albania-2026-tiles';
var TILE_MAX = 900;
/* Match on the parsed hostname, not a substring of the URL — otherwise any address
   that merely contains "tile.openstreetmap.org" in its path or query routes here. */
function isTile(url){
  try{ return /^([abc]\.)?tile\.openstreetmap\.org$/.test(new URL(url).hostname); }
  catch(e){ return false; }
}

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

/* Third-party shell. Best-effort: an opaque cross-origin response, and one CDN hiccup
   during install must not cost us the offline page — the fonts degrade to a fallback
   face, which is survivable in a way that a missing map script is not. */
var EXTRA = [
  'https://fonts.googleapis.com/css2?family=Suez+One&family=Assistant:wght@300;400;500;600;700;800&family=Heebo:wght@400;500;700;900&display=swap'
];

/* Never intercept: the boards need a real answer (trip.js keeps its own
   localStorage copy and its own write queue), and a cached temperature or
   exchange rate is worse than no card at all. */
function live(url){
  return /firebasedatabase\.app|api\.open-meteo\.com|open\.er-api\.com/.test(url);
}

/* `cache:'reload'` on every precache request: without it the install is allowed to
   fill itself from the browser's HTTP cache, and a freshly deployed index.html or
   restaurants.json can be baked into a brand-new version — stale for a whole
   release cycle, with nothing in the page to hint at it. */
function fresh(u){ return new Request(u, {cache:'reload'}); }

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(V).then(function(c){
      return c.addAll(CORE.map(fresh)).then(function(){
        return Promise.all(EXTRA.map(function(u){ return c.add(fresh(u)).catch(function(){}); }));
      });
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        return (k === V || k === TILES) ? null : caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

/* Keep the tile cache bounded. Cache.keys() is insertion-ordered and put() re-inserts,
   so dropping from the front evicts the least recently fetched. Only every 60th tile,
   because keys() walks the whole cache. */
var puts = 0;
function trimTiles(){
  if(++puts % 60) return;
  caches.open(TILES).then(function(c){
    return c.keys().then(function(keys){
      var over = keys.length - TILE_MAX;
      if(over <= 0) return;
      return Promise.all(keys.slice(0, over).map(function(k){ return c.delete(k); }));
    });
  }).catch(function(){});
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET' || live(req.url)) return;

  /* Navigation: network first so an updated page wins, cache as the offline answer.
     The final fallback is index.html itself — a deep link like #south/butrint is
     the same document, so any cached copy of it serves every route. */
  if(req.mode === 'navigate'){
    e.respondWith(
      fetch(req).then(function(res){
        if(res.status === 200){                     // a redirect can't be put() either
          var copy = res.clone();
          caches.open(V).then(function(c){ return c.put(req, copy); }).catch(function(){});
        }
        return res;
      }).catch(function(){
        return caches.match(req).then(function(hit){
          return hit || caches.match('index.html') || caches.match('./');
        });
      })
    );
    return;
  }

  /* Tiles: cache-first out of their own capped, version-surviving cache. A cached tile
     is never revalidated — it is a picture of a mountain, and not re-asking is exactly
     what the tile policy wants. */
  if(isTile(req.url)){
    e.respondWith(
      caches.open(TILES).then(function(c){
        return c.match(req).then(function(hit){
          if(hit) return hit;
          return fetch(req).then(function(res){
            if(res && (res.status === 200 || res.type === 'opaque')){
              c.put(req, res.clone()).then(trimTiles).catch(function(){});
            }
            return res;
          });
        });
      })
    );
    return;
  }

  /* Everything else — scripts, JSON, icons, fonts, Leaflet, the hero video:
     cache first (instant and offline-proof), refresh in the background. */
  e.respondWith(
    caches.match(req).then(function(hit){
      var net = fetch(req).then(function(res){
        /* Exactly 200, or an opaque cross-origin response (which reports 0):
           Cache.put() throws on a 206, and the hero video arrives as ranges. */
        if(res && (res.status === 200 || res.type === 'opaque')){
          var copy = res.clone();
          caches.open(V).then(function(c){ return c.put(req, copy); }).catch(function(){});
        }
        return res;
      });
      if(hit){ net.catch(function(){}); return hit; }
      return net;
    })
  );
});

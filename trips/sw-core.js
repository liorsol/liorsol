/* Shared service-worker logic for every trip page under trips/.
   Loaded by each trip's own sw.js via importScripts('../sw-core.js').

   WHY A STUB PER TRIP INSTEAD OF ONE SHARED WORKER AT THE SITE ROOT:
   a service worker's default scope is its own directory, and GitHub Pages cannot
   send the `Service-Worker-Allowed` header that would widen or narrow it. A single
   /sw.js registered from /trips/italy-2026/ would therefore take scope `/` and
   control the WHOLE site — the file browser's GitHub API calls, the savings
   calculator, esim-usage's live API — all through a cache-first handler that was
   written for a trip page. Keeping a stub at trips/<trip>/sw.js keeps each scope
   exactly one trip wide, which is the only correct answer here.

   ⚠️ THE UPDATE RULE, AND IT IS THE ONE WAY TO SHIP A CHANGE NOBODY RECEIVES:
   the browser reinstalls a worker whose *bytes* differ. Chrome and Firefox also
   byte-check imported scripts, so editing this file alone is usually enough — but
   Safari's behaviour here is not something to bet a family's offline page on, and
   these pages live on iPhones. So: **after editing this file, bump `V` in EVERY
   trip's sw.js.** That changes the registered script's own bytes and forces the
   update everywhere, on every engine.

   Each trip's sw.js must define, before importing this file:
     V        cache name for the shell, e.g. 'italy-2026-v2'
     TILES    cache name for map tiles, e.g. 'italy-2026-tiles'
     CORE     array of same-directory URLs to precache strictly
   and may define:
     EXTRA    array of best-effort (usually cross-origin) URLs */

if(typeof V !== 'string' || typeof TILES !== 'string' || !Array.isArray(CORE)){
  /* Thrown during script evaluation, so registration fails outright. A worker with
     an undefined V would open a cache literally named "undefined" and quietly serve
     nothing — loud beats subtle. */
  throw new Error('sw-core.js: the trip stub must define V, TILES and CORE before importScripts');
}
if(typeof EXTRA === 'undefined') var EXTRA = [];

var TILE_MAX = 900;

/* Match on the parsed hostname, not a substring of the URL — otherwise any address
   that merely contains "tile.openstreetmap.org" in its path or query routes here. */
function isTile(url){
  try{ return /^([abc]\.)?tile\.openstreetmap\.org$/.test(new URL(url).hostname); }
  catch(e){ return false; }
}

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
      /* CORE is strict: if any of it fails to cache, the install fails, because a
         half-cached shell is a broken offline page. EXTRA is best-effort — one CDN
         hiccup must not cost the offline page, and a missing font degrades to a
         fallback face in a way a missing map script never would. */
      return c.addAll(CORE.map(fresh)).then(function(){
        return Promise.all(EXTRA.map(function(u){ return c.add(fresh(u)).catch(function(){}); }));
      });
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      /* Keep the current shell AND the tile cache; drop every older version. The
         tile cache deliberately survives a V bump — it is not shell, it is the areas
         the family has already primed, and wiping it on a content edit would
         silently un-prime their offline map with nothing on screen to explain why. */
      return Promise.all(keys.map(function(k){
        return (k === V || k === TILES) ? null : caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

/* Keep the tile cache bounded. Cache.keys() is insertion-ordered and put() re-inserts,
   so dropping from the front evicts the least recently fetched. Only every 60th tile,
   because keys() walks the whole cache.

   Why there is no "download the map" button: the OSM Foundation tile policy states
   "Offline use is not permitted on tile.openstreetmap.org" and that prefetch/offline
   patterns "will be blocked without notice". Caching what a user actively views is
   explicitly allowed — bulk-fetching an area is not, and getting the tile servers to
   block us mid-trip is the one failure worse than no basemap.
   https://operations.osmfoundation.org/policies/tiles/

   The cap is the storage guard: ~900 tiles ≈ 15–20 MB (opaque responses carry quota
   padding, so it bills higher than the raw PNG bytes). Oldest out first. */
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
     The final fallback is index.html itself — a deep link like #days/orvieto is the
     same document, so any cached copy of it serves every route. */
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

  /* Everything else — scripts, JSON, icons, fonts, Leaflet, images:
     cache first (instant and offline-proof), refresh in the background. */
  e.respondWith(
    caches.match(req).then(function(hit){
      var net = fetch(req).then(function(res){
        /* Exactly 200, or an opaque cross-origin response (which reports 0):
           Cache.put() throws on a 206, and a video would arrive as ranges. */
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

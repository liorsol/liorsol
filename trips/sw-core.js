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
     EXTRA       array of best-effort (usually cross-origin) URLs
     IMAGES      cache name for immutable images, e.g. 'italy-2026-images' — like TILES,
                 it survives a V bump (see "Immutable images" below)
     IMAGE_URLS  the images that go in it. Both or neither. */

if(typeof V !== 'string' || typeof TILES !== 'string' || !Array.isArray(CORE)){
  /* Thrown during script evaluation, so registration fails outright. A worker with
     an undefined V would open a cache literally named "undefined" and quietly serve
     nothing — loud beats subtle. */
  throw new Error('sw-core.js: the trip stub must define V, TILES and CORE before importScripts');
}
if(typeof EXTRA === 'undefined') var EXTRA = [];
if(typeof IMAGES === 'undefined') var IMAGES = null;
if(typeof IMAGE_URLS === 'undefined') var IMAGE_URLS = [];
if((IMAGES === null) !== (IMAGE_URLS.length === 0) ||
   (IMAGES !== null && (typeof IMAGES !== 'string' || !Array.isArray(IMAGE_URLS)))){
  /* Half a config is a mistake, not a choice: IMAGE_URLS with no IMAGES would quietly
     precache nothing, and IMAGES with no list would keep an empty cache forever. */
  throw new Error('sw-core.js: IMAGES and IMAGE_URLS go together — define both or neither');
}

/* Immutable images. Anything in EXTRA lands in the V cache, is fetched with
   cache:'reload' and is deleted with that cache on the next bump — right for the Google
   Fonts CSS, wrong for 51 gallery shots (~5 MB) that never change: every content edit
   made every phone download all of them again. These get their own cache instead,
   kept across V bumps exactly like TILES, filled at install with only what is MISSING
   from it, and never revalidated. The contract that makes this safe is the stub's:
   **an IMAGE_URLS entry never changes bytes — a new picture gets a new URL.**
   Images only: media() still bypasses video and audio before any of this is reached. */
var IMAGE_SET = {};
IMAGE_URLS.forEach(function(u){ IMAGE_SET[abs(u)] = true; });
function abs(u){
  try{ return new URL(u, self.location && self.location.href).href; }catch(e){ return String(u); }
}
function isImage(url){ return IMAGE_SET.hasOwnProperty(abs(url)); }

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
  return /firebasedatabase\.app|api\.open-meteo\.com|open\.er-api\.com|data\.gov\.il/.test(url);
}

/* Media is never intercepted either, and this one is a correctness fix rather than a
   policy: a <video> fetches byte RANGES. `Cache.put()` refuses a 206, so only a full
   200 can ever be stored — and `caches.match()` ignores the Range header, so the first
   ranged request made after a full copy landed in the cache is answered with that whole
   200. Safari treats a 200 where it asked for a 206 as a broken stream and the hero clip
   just stops. Letting the network answer directly is also cheap: the browser's own HTTP
   cache handles ranges properly, and each trip precaches its hero *still* as the offline
   fallback, so nothing is lost when the clip is unavailable. */
function media(req){
  return req.destination === 'video' || req.destination === 'audio' ||
         /\.(mp4|m4v|mov|webm|ogv|m4a|mp3)(\?|$)/i.test(req.url);
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
    }).then(precacheImages).then(function(){ return self.skipWaiting(); })
  );
});

/* Best-effort, like EXTRA — a decorative picture must not cost the offline page — and
   awaited like EXTRA, so `navigator.serviceWorker.ready` still means "the images are in".
   Per entry, cheapest first:
     1. already in IMAGES → nothing to do. This is every V bump after the first.
     2. in any other cache → copy it across. The old V cache is still there during
        install (activate has not run yet), so the first install after IMAGES appears
        migrates the shots out of it instead of downloading them again.
     3. otherwise fetch it — WITHOUT cache:'reload': the bytes are immutable, so an
        HTTP-cache copy is exactly as good as the network's. */
function precacheImages(){
  if(!IMAGES) return;
  return caches.open(IMAGES).then(function(c){
    return Promise.all(IMAGE_URLS.map(function(u){
      return c.match(u).then(function(hit){
        if(hit) return;
        return caches.match(u).then(function(old){
          return old ? c.put(u, old) : c.add(u);
        });
      }).catch(function(){});
    }));
  });
}

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      /* Keep the current shell, the tile cache and the image cache; drop every older
         version. The tile cache deliberately survives a V bump — it is not shell, it is
         the areas the family has already primed, and wiping it on a content edit would
         silently un-prime their offline map with nothing on screen to explain why. The
         image cache survives for the reason above: its contents never go stale. */
      return Promise.all(keys.map(function(k){
        return (k === V || k === TILES || k === IMAGES) ? null : caches.delete(k);
      }));
    }).then(pruneImages).then(function(){ return self.clients.claim(); })
  );
});

/* The image cache is never wiped, so a shot dropped from IMAGE_URLS would otherwise sit
   in it for good. Done at activate, not install, so the old worker keeps every picture
   it might still be showing until the new one takes over. */
function pruneImages(){
  if(!IMAGES) return;
  return caches.open(IMAGES).then(function(c){
    return c.keys().then(function(keys){
      return Promise.all(keys.map(function(k){ return isImage(k.url) ? null : c.delete(k); }));
    });
  }).catch(function(){});
}

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
  if(req.method !== 'GET' || live(req.url) || media(req)) return;

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

  /* Immutable images: cache-first out of their own cache, and NO background refresh.
     The generic branch below would re-fetch each shot on every view and put a second
     copy into V — 5 MB of duplicates that die at the next bump. A miss (the install
     could not reach the host) is fetched once and kept. */
  if(isImage(req.url)){
    e.respondWith(
      caches.open(IMAGES).then(function(c){
        return c.match(req).then(function(hit){
          if(hit) return hit;
          return fetch(req).then(function(res){
            if(res && (res.status === 200 || res.type === 'opaque')){
              c.put(req, res.clone()).catch(function(){});
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

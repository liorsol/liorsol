/* node trips/sw-core.test.js
 *
 * The service worker is the one piece of these pages that fails invisibly: it runs on
 * a phone, in Albania or Umbria, with no console anyone will read. The behaviours below
 * cannot be exercised from the browser preview here (the in-app browser blocks the OSM
 * tile host), so they get checked directly instead. No framework, no deps.
 */
var fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');

/* --- a Cache API just real enough ------------------------------------------ */
function key(req){ return typeof req === 'string' ? req : req.url; }
function FakeCache(fetch){ this.entries = []; this.bodies = {}; this.fetch = fetch; }  // insertion-ordered, like the real thing
FakeCache.prototype.keys = function(){ return Promise.resolve(this.entries.slice()); };
FakeCache.prototype.delete = function(req){
  var u = key(req), i = this.entries.findIndex(function(k){ return k.url === u; });
  if(i > -1){ this.entries.splice(i, 1); delete this.bodies[u]; }
  return Promise.resolve(i > -1);
};
FakeCache.prototype.match = function(req){ return Promise.resolve(this.bodies[key(req)]); };
FakeCache.prototype.put = function(req, res){
  var u = key(req);
  this.delete(u);
  this.entries.push({url: u}); this.bodies[u] = res;
  return Promise.resolve();
};
FakeCache.prototype.add = function(req){
  var c = this;
  return c.fetch(req).then(function(res){
    if(res.status !== 200) throw new TypeError('add() refuses ' + res.status);
    return c.put(req, res);
  });
};
FakeCache.prototype.addAll = function(reqs){ return Promise.all(reqs.map(this.add, this)); };

function Res(url){ this.url = url; this.status = 200; this.type = 'basic'; }
Res.prototype.clone = function(){ return new Res(this.url); };

/* Evaluate a trip's real sw.js the way a browser would: the stub's own code first,
   then whatever it importScripts. That means the test covers the stub→core contract,
   not just the core in isolation. */
function loadWorker(stubPath, opts){
  opts = opts || {};
  var store = opts.store || {}, handlers = {}, imported = [];
  /* Every request the worker makes, as {url, cache}. No network by default; with
     opts.online every request answers 200 so an install can run end to end. */
  var fetched = [];
  function fetch(req){
    fetched.push({url: key(req), cache: typeof req === 'string' ? undefined : req.cache});
    return opts.online ? Promise.resolve(new Res(key(req)))
                       : Promise.reject(new Error('no network in the test'));
  }
  var caches = {
    open: function(name){ return Promise.resolve(store[name] || (store[name] = new FakeCache(fetch))); },
    keys: function(){ return Promise.resolve(Object.keys(store)); },
    delete: function(name){ var had = name in store; delete store[name]; return Promise.resolve(had); },
    match: function(req){                         // searches every cache, like the real one
      return Promise.resolve(Object.keys(store).map(function(n){ return store[n].bodies[key(req)]; })
        .filter(Boolean)[0]);
    }
  };
  var ctx = {
    self: {
      addEventListener: function(k, fn){ handlers[k] = fn; },
      skipWaiting: function(){ return Promise.resolve(); },
      clients: {claim: function(){ return Promise.resolve(); }},
      location: {href: 'https://liorsol.github.io/trips/' + path.basename(path.dirname(stubPath)) + '/sw.js'}
    },
    caches: caches,
    URL: URL,
    Request: function(u, o){ this.url = String(u); Object.assign(this, o || {}); },
    fetch: fetch,
    importScripts: function(rel){
      imported.push(rel);
      var abs = path.resolve(path.dirname(stubPath), rel);
      vm.runInContext(fs.readFileSync(abs, 'utf8'), ctx, {filename: abs});
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(stubPath, 'utf8'), ctx, {filename: stubPath});
  return {ctx: ctx, store: store, handlers: handlers, imported: imported, fetched: fetched, fetch: fetch};
}

function fire(w, type, ev){
  var waited = null;
  ev = Object.assign({waitUntil: function(p){ waited = p; }, respondWith: function(p){ waited = p; }}, ev);
  w.handlers[type](ev);
  return Promise.resolve(waited);
}

var TRIPS = fs.readdirSync(__dirname)
  .map(function(d){ return path.join(__dirname, d, 'sw.js'); })
  .filter(fs.existsSync);

assert.ok(TRIPS.length >= 2, 'expected at least two trip service workers, found ' + TRIPS.length);

function run(stubPath){
  var trip = path.basename(path.dirname(stubPath));
  var w = loadWorker(stubPath), ctx = w.ctx, store = w.store;

  /* 0. The stub→core contract. This is the failure mode the shared-core refactor
        introduced: a stub that forgets a config var, or stops importing the core,
        would register a worker that caches into "undefined" and serves nothing. */
  assert.strictEqual(typeof ctx.V, 'string', trip + ': stub must define V');
  assert.strictEqual(typeof ctx.TILES, 'string', trip + ': stub must define TILES');
  assert.ok(Array.isArray(ctx.CORE) && ctx.CORE.length, trip + ': stub must define a non-empty CORE');
  assert.ok(w.imported.indexOf('../sw-core.js') > -1, trip + ': stub must importScripts ../sw-core.js');
  assert.ok(ctx.V.indexOf(trip) === 0, trip + ": V should start with the trip name, got '" + ctx.V + "'");
  assert.strictEqual(ctx.TILES, trip + '-tiles', trip + ': TILES should be <trip>-tiles');
  /* Every precached path must be a real file, or install fails on the live site and
     the page silently loses offline. './' is the directory index. */
  ctx.CORE.forEach(function(rel){
    if(/^https?:/.test(rel)) return;
    var f = path.resolve(path.dirname(stubPath), rel === './' ? 'index.html' : rel);
    assert.ok(fs.existsSync(f), trip + ': CORE lists a file that does not exist — ' + rel);
  });
  assert.ok(typeof ctx.isTile === 'function', trip + ': core did not evaluate (isTile missing)');

  /* 1. Tile routing matches the real tile hosts and nothing else. --------------- */
  ['https://a.tile.openstreetmap.org/8/141/97.png',
   'https://b.tile.openstreetmap.org/12/2270/1571.png',
   'https://c.tile.openstreetmap.org/8/141/97.png',
   'https://tile.openstreetmap.org/8/141/97.png'
  ].forEach(function(u){ assert.strictEqual(ctx.isTile(u), true, 'should be a tile: ' + u); });

  ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
   'https://tiles.openstreetmap.org/8/141/97.png',            // note the s
   'https://d.tile.openstreetmap.org/8/141/97.png',           // only a, b, c exist
   'https://evil.example.com/x?u=//a.tile.openstreetmap.org/8/1/1.png',  // substring, not host
   'https://tile.openstreetmap.org.evil.example.com/8/1/1.png',
   'not a url'
  ].forEach(function(u){ assert.strictEqual(ctx.isTile(u), false, 'should NOT be a tile: ' + u); });

  /* 2. The live paths are never intercepted — a cached write would lose a comment,
        and a stale temperature is worse than no card. */
  ['https://liorsol-github-default-rtdb.europe-west1.firebasedatabase.app/italy2026.json',
   'https://api.open-meteo.com/v1/forecast?latitude=43',
   'https://open.er-api.com/v6/latest/EUR'
  ].forEach(function(u){ assert.strictEqual(ctx.live(u), true, 'must stay live: ' + u); });
  assert.strictEqual(ctx.live('https://example.com/restaurants.json'), false);

  /* 2b. Media is never intercepted either: a cached full 200 would be handed back for a
         byte-range request, which Safari reads as a broken stream — the hero clip stops. */
  [{url:'https://x/trips/italy-2026/assets/hero-umbria.mp4', destination:''},
   {url:'https://x/trips/albania-2026/assets/moving_image.mp4', destination:''},
   {url:'https://x/assets/clip.webm?v=2', destination:''},
   {url:'https://x/stream', destination:'video'}
  ].forEach(function(r){ assert.strictEqual(ctx.media(r), true, 'must bypass: ' + r.url); });
  [{url:'https://x/index.html', destination:'document'},
   {url:'https://x/assets/hero-umbria.jpg', destination:'image'},
   {url:'https://x/trip.js', destination:'script'}
  ].forEach(function(r){ assert.strictEqual(ctx.media(r), false, 'must be cached: ' + r.url); });

  /* 3. Activate keeps the shell AND the tile cache, drops every older version.
        Regression guard: wiping tiles on a V bump silently un-primes the offline map. */
  var keep = [ctx.V, ctx.TILES].concat(ctx.IMAGES ? [ctx.IMAGES] : []);
  keep.concat([trip + '-v0', 'something-else']).forEach(function(n){ store[n] = new FakeCache(); });

  return fire(w, 'activate').then(function(){
    assert.deepStrictEqual(Object.keys(store).sort(), keep.sort(),
      trip + ': activate must keep exactly the current shell + the tile cache' +
      (ctx.IMAGES ? ' + the image cache' : ''));

    /* 4. The tile cache stays bounded, evicting oldest first. ------------------- */
    var tiles = store[ctx.TILES];
    for(var i = 0; i < ctx.TILE_MAX + 250; i++) tiles.entries.push({url: 'tile-' + i});
    /* trimTiles only acts on every 60th call — drive it past one trigger */
    for(var n = 0; n < 60; n++) ctx.trimTiles();

    return new Promise(function(r){ setTimeout(r, 50); }).then(function(){
      assert.strictEqual(tiles.entries.length, ctx.TILE_MAX,
        trip + ': tile cache must be trimmed back to the cap, got ' + tiles.entries.length);
      assert.strictEqual(tiles.entries[0].url, 'tile-250',
        trip + ': the OLDEST tiles must be the ones evicted');
    });
  }).then(function(){ return images(stubPath); }).then(function(){
    console.log('  ✅ ' + trip + '  (V=' + ctx.V + ', ' + ctx.CORE.length + ' precached' +
      (ctx.IMAGES ? ', ' + ctx.IMAGE_URLS.length + ' immutable images' : '') + ')');
  });
}

/* 6. The immutable-image cache: the whole point is that a V bump costs no image bytes.
      Drives real install/activate/fetch events against one shared store, the way two
      successive worker versions share a phone's CacheStorage. */
function images(stubPath){
  var trip = path.basename(path.dirname(stubPath));
  var w = loadWorker(stubPath, {online: true}), ctx = w.ctx, store = w.store;
  function imageFetches(){
    return w.fetched.filter(function(f){ return ctx.IMAGE_URLS.indexOf(f.url) > -1; });
  }

  if(!ctx.IMAGES){
    /* Backward compatibility: a stub without IMAGES installs exactly as before — the
       shell cache and nothing else, and the fetch handler never takes the image path. */
    return fire(w, 'install').then(function(){
      assert.deepStrictEqual(Object.keys(store), [ctx.V], trip + ': no IMAGES → install must create only V');
      assert.strictEqual(ctx.isImage('https://liorsol.github.io/assets/x.webp'), false);
    });
  }

  var urls = Array.from(ctx.IMAGE_URLS);                 // out of the vm realm, for deepStrictEqual
  assert.strictEqual(ctx.IMAGES, trip + '-images', trip + ': IMAGES should be <trip>-images');
  assert.ok(urls.length, trip + ': IMAGES with an empty IMAGE_URLS');
  assert.strictEqual(new Set(urls).size, urls.length, trip + ': IMAGE_URLS has duplicates');
  urls.forEach(function(u){
    assert.ok(!ctx.media({url: u, destination: 'image'}), trip + ': media() would bypass ' + u);
    assert.ok(ctx.EXTRA.indexOf(u) < 0 && ctx.CORE.indexOf(u) < 0,
      trip + ': ' + u + ' is in IMAGE_URLS AND the V precache — it would be downloaded twice');
  });

  /* A phone that already has some shots in IMAGES, one more left in the previous V
     cache (the migration case), and none of the rest. */
  var have = urls.slice(0, 5), inOldV = urls[5], missing = urls.slice(6);
  store[ctx.IMAGES] = new FakeCache(w.fetch);
  have.forEach(function(u){ store[ctx.IMAGES].put(u, new Res(u)); });
  store[trip + '-v0'] = new FakeCache(w.fetch);
  store[trip + '-v0'].put(inOldV, new Res(inOldV));

  return fire(w, 'install').then(function(){
    var got = imageFetches();
    assert.deepStrictEqual(got.map(function(f){ return f.url; }).sort(), missing.slice().sort(),
      trip + ': install must fetch exactly the images missing from IMAGES (and not the one in the old V)');
    got.forEach(function(f){
      assert.notStrictEqual(f.cache, 'reload', trip + ': immutable images must not be fetched with cache:reload');
    });
    urls.forEach(function(u){
      assert.ok(store[ctx.IMAGES].bodies[u], trip + ': after install IMAGES must hold ' + u);
      assert.ok(!store[ctx.V].bodies[u], trip + ': ' + u + ' must not land in the V cache');
    });

    /* A shot dropped from the list since the last version: activate prunes it. */
    store[ctx.IMAGES].put('https://liorsol.github.io/assets/' + trip + '/prev/gone.webp', new Res('gone'));
    return fire(w, 'activate');
  }).then(function(){
    assert.ok(!(trip + '-v0' in store), trip + ': the old V must be gone after activate');
    assert.strictEqual(store[ctx.IMAGES].entries.length, urls.length,
      trip + ': activate must keep every listed image and prune the unlisted one');

    /* The V bump: the next version's worker, same phone. Zero image bytes. */
    var bumped = loadWorker(stubPath, {online: true, store: store});
    bumped.ctx.V = ctx.V + '-next';
    return fire(bumped, 'install').then(function(){ return fire(bumped, 'activate'); }).then(function(){
      var img = bumped.fetched.filter(function(f){ return urls.indexOf(f.url) > -1; });
      assert.deepStrictEqual(img, [], trip + ': a V bump must not re-download any image, got ' + img.length);
      assert.ok(!(ctx.V in store), trip + ': the previous V must be dropped');
      assert.strictEqual(store[ctx.IMAGES].entries.length, urls.length,
        trip + ': the image cache must survive the V bump intact');

      /* The page asking for a cached shot: answered from IMAGES, and no background
         refresh — the generic branch would re-fetch it and copy it into V. */
      var before = bumped.fetched.length;
      return fire(bumped, 'fetch', {request: {url: urls[0], method: 'GET', mode: 'no-cors', destination: 'image'}})
        .then(function(res){
          assert.ok(res && res.url === urls[0], trip + ': a cached image must be served from IMAGES');
          assert.strictEqual(bumped.fetched.length, before, trip + ': a cached image must not be re-fetched');
          assert.ok(!store[bumped.ctx.V].bodies[urls[0]], trip + ': a served image must not be copied into V');
        });
    });
  });
}

/* 5. A stub missing its config must fail LOUDLY at evaluation, not register a worker
      that caches into "undefined". */
function checkGuard(){
  var ctx = {self:{addEventListener:function(){}}, caches:{}, URL:URL, Request:function(){},
             fetch:function(){}, importScripts:function(){}};
  vm.createContext(ctx);
  assert.throws(function(){
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'sw-core.js'), 'utf8'), ctx);
  }, /must define V, TILES and CORE/, 'sw-core.js must refuse to load without its config');
  console.log('  ✅ sw-core.js refuses to load without V/TILES/CORE');

  /* Half an IMAGES config is refused just as loudly. */
  [{IMAGES: 'x-images'}, {IMAGE_URLS: ['https://x/a.webp']}].forEach(function(half){
    var c = Object.assign({self:{addEventListener:function(){}}, caches:{}, URL:URL, Request:function(){},
             fetch:function(){}, importScripts:function(){}, V:'x-v1', TILES:'x-tiles', CORE:['./']}, half);
    vm.createContext(c);
    assert.throws(function(){
      vm.runInContext(fs.readFileSync(path.join(__dirname, 'sw-core.js'), 'utf8'), c);
    }, /IMAGES and IMAGE_URLS go together/, 'sw-core.js must refuse ' + Object.keys(half)[0] + ' alone');
  });
  console.log('  ✅ sw-core.js refuses IMAGES without IMAGE_URLS and vice versa');
}

console.log('service workers:');
TRIPS.reduce(function(p, t){ return p.then(function(){ return run(t); }); }, Promise.resolve())
  .then(checkGuard)
  .then(function(){
    console.log('all checks passed (stub contract, tile routing, live + media bypass, cache retention, eviction cap, immutable images)');
  })
  .catch(function(e){ console.error('FAILED:', e.message); process.exit(1); });

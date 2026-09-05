/* node trips/sw-core.test.js
 *
 * The service worker is the one piece of these pages that fails invisibly: it runs on
 * a phone, in Albania or Umbria, with no console anyone will read. The behaviours below
 * cannot be exercised from the browser preview here (the in-app browser blocks the OSM
 * tile host), so they get checked directly instead. No framework, no deps.
 */
var fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');

/* --- a Cache API just real enough ------------------------------------------ */
function FakeCache(){ this.entries = []; }               // insertion-ordered, like the real thing
FakeCache.prototype.keys = function(){ return Promise.resolve(this.entries.slice()); };
FakeCache.prototype.delete = function(req){
  var i = this.entries.indexOf(req);
  if(i > -1) this.entries.splice(i, 1);
  return Promise.resolve(i > -1);
};

/* Evaluate a trip's real sw.js the way a browser would: the stub's own code first,
   then whatever it importScripts. That means the test covers the stub→core contract,
   not just the core in isolation. */
function loadWorker(stubPath){
  var store = {}, handlers = {}, imported = [];
  var caches = {
    open: function(name){ return Promise.resolve(store[name] || (store[name] = new FakeCache())); },
    keys: function(){ return Promise.resolve(Object.keys(store)); },
    delete: function(name){ var had = name in store; delete store[name]; return Promise.resolve(had); }
  };
  var ctx = {
    self: {
      addEventListener: function(k, fn){ handlers[k] = fn; },
      skipWaiting: function(){ return Promise.resolve(); },
      clients: {claim: function(){ return Promise.resolve(); }}
    },
    caches: caches,
    URL: URL,
    Request: function(u, o){ this.url = String(u); Object.assign(this, o || {}); },
    fetch: function(){ return Promise.reject(new Error('no network in the test')); },
    importScripts: function(rel){
      imported.push(rel);
      var abs = path.resolve(path.dirname(stubPath), rel);
      vm.runInContext(fs.readFileSync(abs, 'utf8'), ctx, {filename: abs});
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(stubPath, 'utf8'), ctx, {filename: stubPath});
  return {ctx: ctx, store: store, handlers: handlers, imported: imported, FakeCache: FakeCache};
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

  /* 3. Activate keeps the shell AND the tile cache, drops every older version.
        Regression guard: wiping tiles on a V bump silently un-primes the offline map. */
  store[ctx.V] = new FakeCache();
  store[ctx.TILES] = new FakeCache();
  store[trip + '-v0'] = new FakeCache();
  store['something-else'] = new FakeCache();

  var waited;
  w.handlers.activate({waitUntil: function(p){ waited = p; }});
  return waited.then(function(){
    assert.deepStrictEqual(Object.keys(store).sort(), [ctx.TILES, ctx.V].sort(),
      trip + ': activate must keep exactly the current shell + the tile cache');

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
      console.log('  ✅ ' + trip + '  (V=' + ctx.V + ', ' + ctx.CORE.length + ' precached)');
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
}

console.log('service workers:');
TRIPS.reduce(function(p, t){ return p.then(function(){ return run(t); }); }, Promise.resolve())
  .then(checkGuard)
  .then(function(){
    console.log('all checks passed (stub contract, tile routing, live bypass, cache retention, eviction cap)');
  })
  .catch(function(e){ console.error('FAILED:', e.message); process.exit(1); });

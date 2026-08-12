/* node sw.test.js
 *
 * The service worker is the one piece of this page that fails invisibly: it runs on a
 * phone, in Albania, with no console anyone will read. The three things below cannot be
 * exercised from the browser preview here (the in-app browser blocks the OSM tile host),
 * so they get checked directly instead. No framework, no deps.
 */
var fs = require('fs'), vm = require('vm'), assert = require('assert');

/* --- a Cache API just real enough ------------------------------------------ */
function FakeCache(){ this.entries = []; }               // insertion-ordered, like the real thing
FakeCache.prototype.keys = function(){ return Promise.resolve(this.entries.slice()); };
FakeCache.prototype.delete = function(req){
  var i = this.entries.indexOf(req);
  if(i > -1) this.entries.splice(i, 1);
  return Promise.resolve(i > -1);
};
var store = {};
var caches = {
  open: function(name){ return Promise.resolve(store[name] || (store[name] = new FakeCache())); },
  keys: function(){ return Promise.resolve(Object.keys(store)); },
  delete: function(name){ var had = name in store; delete store[name]; return Promise.resolve(had); }
};

var handlers = {};
var ctx = {
  self: {
    addEventListener: function(k, fn){ handlers[k] = fn; },
    skipWaiting: function(){ return Promise.resolve(); },
    clients: {claim: function(){ return Promise.resolve(); }}
  },
  caches: caches,
  URL: URL,
  Request: function(u, o){ this.url = String(u); Object.assign(this, o || {}); },
  fetch: function(){ return Promise.reject(new Error('no network in the test')); }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/sw.js', 'utf8'), ctx);

function run(){
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

  /* 2. Activate keeps the shell AND the tile cache, drops every older version.
        Regression guard: wiping tiles on a V bump silently un-primes the offline map. */
  store[ctx.V] = new FakeCache();
  store[ctx.TILES] = new FakeCache();
  store['albania-2026-v0'] = new FakeCache();
  store['something-else'] = new FakeCache();

  var waited;
  handlers.activate({waitUntil: function(p){ waited = p; }});
  return waited.then(function(){
    assert.deepStrictEqual(Object.keys(store).sort(), [ctx.TILES, ctx.V].sort(),
      'activate must keep exactly the current shell + the tile cache');

    /* 3. The tile cache stays bounded, evicting oldest first. ------------------- */
    var tiles = store[ctx.TILES];
    for(var i = 0; i < ctx.TILE_MAX + 250; i++) tiles.entries.push({url: 'tile-' + i});
    /* trimTiles only acts on every 60th call — drive it past one trigger */
    for(var n = 0; n < 60; n++) ctx.trimTiles();

    return new Promise(function(r){ setTimeout(r, 50); }).then(function(){
      assert.strictEqual(tiles.entries.length, ctx.TILE_MAX,
        'tile cache must be trimmed back to the cap, got ' + tiles.entries.length);
      assert.strictEqual(tiles.entries[0].url, 'tile-250', 'the OLDEST tiles must be the ones evicted');
      console.log('sw.js: all checks passed (tile routing, cache retention, eviction cap)');
    });
  });
}

run().catch(function(e){ console.error('FAILED:', e.message); process.exit(1); });

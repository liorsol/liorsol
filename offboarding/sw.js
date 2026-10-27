/* Service worker for the offboarding checklist. Scope is this directory only
   (a worker's default scope is its own folder, and GitHub Pages can't widen it),
   so nothing else on the site goes through it.

   Strategy: the page is network-first, so a content fix shows up on the next
   online open without a version bump; the cache is only the offline fallback.
   Icons, manifest and Google Fonts are cache-first. Bump V to drop old caches. */
var V = 'offboarding-2026-v2';
var CORE = ['index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(V).then(function (c) {
    return c.addAll(CORE.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function fonts(url) { return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'; }

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var local = url.origin === self.location.origin;
  if (!local && !fonts(url)) return;

  if (req.mode === 'navigate') {
    /* Network-first, but a weak signal shouldn't leave a blank screen: after 3s
       show the cached copy and let the fetch finish in the background. */
    var net = fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); e.waitUntil(caches.open(V).then(function (c) { return c.put('index.html', copy); })); }
      return res;
    });
    e.waitUntil(net.catch(function () {}));
    var slow = new Promise(function (resolve) { setTimeout(resolve, 3000); }).then(function () { return caches.match('index.html'); });
    e.respondWith(Promise.race([net.catch(function () { return caches.match('index.html'); }), slow.then(function (hit) { return hit || net; })]));
    return;
  }

  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); e.waitUntil(caches.open(V).then(function (c) { return c.put(req, copy); })); }
      return res;
    });
  }));
});

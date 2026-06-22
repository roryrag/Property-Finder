/* BrokerBuddy service worker — installable + offline.
   Bump CACHE to force clients onto a new app version. */
var CACHE = 'brokerbuddy-v1';
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon-180.png',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      // add each individually so one network failure doesn't abort the install
      return Promise.all(SHELL.map(function(u){ return c.add(new Request(u, {cache:'reload'})).catch(function(){}); }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(ks){ return Promise.all(ks.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); })); })
      .then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var isHTML = req.mode === 'navigate' || (req.headers.get('accept')||'').indexOf('text/html') !== -1;
  var isData = /repo\.json|sold\.json/.test(url.pathname);
  if (isHTML || isData) {
    // network-first: stay fresh online, fall back to cache offline
    e.respondWith(
      fetch(req).then(function(res){
        var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); });
        return res;
      }).catch(function(){
        return caches.match(req).then(function(m){ return m || caches.match('./index.html'); });
      })
    );
  } else {
    // cache-first for static assets (icons, fonts, CDN)
    e.respondWith(
      caches.match(req).then(function(m){
        return m || fetch(req).then(function(res){
          var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); });
          return res;
        });
      })
    );
  }
});

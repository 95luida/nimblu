// Tiene l'app disponibile anche senza connessione (solo quando è pubblicata in https).
var CACHE = 'nimblu-v27';
var FILES = ['./', 'index.html', 'brain.js', 'mascot.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }));
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});
// prima la rete (così prende gli aggiornamenti), poi la copia salvata se si è offline
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  // solo i file dell'app e le librerie dal CDN: i file del modello (GB) li gestisce già WebLLM, le API non vanno salvate
  var u = new URL(e.request.url);
  if (u.origin !== location.origin && !/(^|\.)(esm\.run|jsdelivr\.net)$/.test(u.hostname)) return;
  if (/\.mp4$/.test(u.pathname)) return; // il video lo gestisce il browser (richieste a pezzi)
  e.respondWith(fetch(e.request).then(function (r) {
    var copy = r.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return r;
  }).catch(function () { return caches.match(e.request); }));
});

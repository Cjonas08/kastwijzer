// Offline-ondersteuning: app-bestanden uit de cache, foto's van Unsplash bijhouden na het eerste laden.
const VERSION = 'kastwijzer-v5';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/db.js', 'js/model.js', 'js/analyze.js', 'js/match.js', 'js/seed.js', 'js/sync.js', 'js/config.js', 'js/figure.js', 'js/crop.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.endsWith('supabase.co')) return; // synchronisatie nooit uit de cache
  if (url.origin === location.origin) {
    // Eerst netwerk (zodat updates meteen binnenkomen), cache als terugval.
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request)));
  } else if (url.hostname === 'images.unsplash.com') {
    e.respondWith(caches.open(VERSION + '-img').then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
  }
});

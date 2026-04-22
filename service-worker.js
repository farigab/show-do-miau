const CACHE_NAME = 'showdo-miau-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/questions.json',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  globalThis.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(globalThis.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Offline-first for app shell and json
  if (ASSETS.includes(url.pathname) || url.pathname.endsWith('.json')) {
    event.respondWith(caches.match(req).then(resp => resp || fetch(req).then(r => {
      caches.open(CACHE_NAME).then(cache => cache.put(req, r.clone()));
      return r;
    }).catch(() => caches.match('/index.html'))));
    return;
  }

  // Otherwise try network then fallback to cache
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

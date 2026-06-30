const CACHE_NAME = 'lunch-check-shell-v20260630';
const APP_SHELL = [
  '/qr.html',
  '/scanner.html',
  '/CSS/style.css',
  '/JS/config.js',
  '/JS/qr_app.js',
  '/JS/scanner_app.js',
  '/img/icon.png',
  '/img/icon-192.png',
  '/img/icon-512.png',
  '/img/shareicon.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/qr.html')));
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      const copy = response.clone();
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      return response;
    }))
  );
});

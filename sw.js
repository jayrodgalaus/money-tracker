/* Cache a minimal offline shell and use fresh online assets when available.
   Query-string asset versions in index.html ensure upgrades bypass older service workers. */
const CACHE_NAME = 'money-tracker-shell-v7';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css?v=7',
  './js/app.js?v=7',
  './js/db.js?v=7',
  './js/bank-directory.js?v=7',
  './manifest.webmanifest',
  './icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('money-tracker-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Online-first avoids pinning old JS/CSS and keeps navigation up to date.
  // The cached app shell remains usable without an internet connection.
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          const cacheKey = request.mode === 'navigate' ? './index.html' : request;
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy))
          );
        }
        return response;
      })
      .catch(async () => {
        const cached = request.mode === 'navigate'
          ? await caches.match('./index.html')
          : await caches.match(request);
        if (cached) return cached;
        return Response.error();
      })
  );
});

/* The installed app is self-contained after one successful online visit.
   Versioned shell files are cached atomically; IndexedDB data is never cached here. */
const CACHE_NAME = 'money-tracker-shell-v11';
const BOOTSTRAP_URL = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css?v=10',
  './js/app.js?v=11',
  './js/db.js?v=10',
  './js/bank-directory.js?v=7',
  './manifest.webmanifest',
  './icons/icon.svg'
];
const SCOPE_URL = new URL(self.registration.scope);
const INDEX_URL = new URL('./index.html', SCOPE_URL);
const SHELL_URLS = new Set(APP_SHELL.map((path) => new URL(path, SCOPE_URL).href));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // All essential files must succeed before replacing the previous worker.
    await cache.addAll(APP_SHELL);
    // CDN styling is optional: local CSS keeps the app usable if the CDN is down.
    await cache.add(BOOTSTRAP_URL).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('money-tracker-shell-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function cacheFirst(request, cache, event) {
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    }
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const navigation = request.mode === 'navigate' &&
    url.origin === SCOPE_URL.origin && url.pathname.startsWith(SCOPE_URL.pathname);

  // This is the only third-party resource; cache it so styles survive offline.
  if (url.href !== BOOTSTRAP_URL && !navigation && !SHELL_URLS.has(url.href)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (!navigation) return cacheFirst(request, cache, event);

    // Network-first for HTML, without overwriting a coherent precached shell.
    // A new service worker installs the next complete set of versioned assets.
    try {
      return await fetch(request, { cache: 'no-cache' });
    } catch {
      return (await cache.match(INDEX_URL)) || Response.error();
    }
  })());
});

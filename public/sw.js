// Offline support. On install we cache the app shell and every asset it
// references, so the app works offline after a single visit. Pages are then
// fetched network-first so updates show up right away; other files are served
// from cache and refreshed in the background.

const CACHE = 'pinoy-prompt-v1';
const SHELL = ['./manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png'];

/** Fetch index.html and cache it along with the hashed JS/CSS it links to. */
async function cacheShell(cache) {
  const response = await fetch('./', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`index.html: ${response.status}`);
  const html = await response.clone().text();
  const assets = [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)].map((m) => m[1]);
  await cache.put('./', response);
  await cache.addAll([...SHELL, ...assets]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cacheShell));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only a good page replaces the offline copy; never a 404 or error page.
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put('./', copy)));
          }
          return response;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  // ignoreVary: module scripts send an Origin header that a cached "Vary: Origin" entry would otherwise miss.
  const cached = caches.match(request, { ignoreVary: true });
  const fresh = fetch(request).then(async (response) => {
    // 200 only: partial (206) responses, e.g. audio range requests, can't be cached.
    if (response.status === 200) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  });
  event.respondWith(cached.then((hit) => hit || fresh).catch(() => Response.error()));
  // Keep the worker alive until the background refresh has been cached.
  event.waitUntil(fresh.catch(() => {}));
});

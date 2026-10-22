// Offline support. On install we cache the app shell and every asset it
// references, so the app works offline after a single visit. Pages are then
// fetched network-first so updates show up right away; other files are served
// from cache and refreshed in the background.

const CACHE = 'pinoy-prompt-v3';
// Other caches the app keeps (like the pronunciation model) aren't ours to clear.
const isShellCache = (key) => /^pinoy-prompt-v\d+$/.test(key);
const SHELL = ['./manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png'];

/** Fetch index.html and cache it along with the hashed JS/CSS it links to. */
async function cacheShell(cache) {
  const response = await fetch('./', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`index.html: ${response.status}`);
  const html = await response.clone().text();
  const assets = [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)].map((m) => m[1]);
  await cache.put('./', response);
  await cache.addAll([...SHELL, ...assets]);
  // Fonts are linked only from the CSS, so pull their URLs out of each cached stylesheet.
  const fonts = [];
  for (const css of assets.filter((a) => a.endsWith('.css'))) {
    const base = new URL(css, self.location.href);
    const text = await (await cache.match(css)).text();
    for (const m of text.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)) fonts.push(new URL(m[1], base).href);
  }
  await cache.addAll([...new Set(fonts)]);
}

/** Recorded word clips, kept by the app (src/clip-cache.ts). Must match AUDIO_CACHE there. */
const AUDIO_CACHE = 'pinoy-prompt-audio-v1';

/** Kept by the app (src/model-cache.ts). Must match CACHE there. */
const MODEL_CACHE = 'pinoy-prompt-models-v1';

/**
 * Once the learner has downloaded the pronunciation model, keep the code that
 * runs it offline too. It's loaded on demand, so index.html doesn't list it;
 * the build's manifest does. Learners who never use speaking skip these 11 MB.
 */
async function cacheSpeech(cache) {
  if (!(await caches.has(MODEL_CACHE)) || (await (await caches.open(MODEL_CACHE)).keys()).length === 0) return;
  try {
    const manifest = await (await fetch('./asset-manifest.json', { cache: 'no-cache' })).json();
    const entry = manifest['src/phone-model.ts'];
    if (entry) await cache.addAll([entry.file, ...(entry.assets ?? [])].map((f) => `./${f}`));
  } catch {
    // Speaking will fetch them when it's next used online.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    await cacheShell(cache);
    await cacheSpeech(cache);
  }));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => isShellCache(k) && k !== CACHE).map((k) => caches.delete(k))))
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

  // Word clips are named by their sound, so a kept copy is always right; one not kept yet joins the others.
  if (/\/audio\/[^/]+\.mp3$/.test(new URL(request.url).pathname)) {
    event.respondWith(
      caches.match(request, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(request).then(async (response) => {
            if (response.status === 200) await (await caches.open(AUDIO_CACHE)).put(request, response.clone());
            return response;
          }),
      ),
    );
    return;
  }

  // ignoreVary: module scripts send an Origin header that a cached "Vary: Origin" entry would otherwise miss.
  const cached = caches.match(request, { ignoreVary: true });
  const refresh = () =>
    fetch(request).then(async (response) => {
      // 200 only: partial (206) responses, e.g. audio range requests, can't be cached.
      if (response.status === 200) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    });
  // Built assets have content hashes in their names, so a cached copy never goes stale.
  // Skipping the refresh matters for large ones like the speech model runtime.
  const hashed = new URL(request.url).pathname.includes('/assets/');
  const result = cached.then((hit) => (hit && hashed ? { hit } : { hit, fresh: refresh() }));
  event.respondWith(result.then(({ hit, fresh }) => hit || fresh).catch(() => Response.error()));
  // Keep the worker alive until the background refresh has been cached.
  event.waitUntil(result.then(({ fresh }) => fresh).catch(() => {}));
});

// Keeps every word clip on the device, so words play offline and without a
// wait. Run by the app rather than the service worker's install, as clips
// change with the deck while the worker's own file rarely does. Each clip is
// fetched on its own, so a dropped connection loses only that one, and the
// rest are fetched the next time the app opens.

/** Must match AUDIO_CACHE in public/sw.js. */
export const AUDIO_CACHE = 'pinoy-prompt-audio-v1';

/** Fetch the clips not yet kept, and drop kept ones no longer listed. Clip names change with their sound, so a kept one is never stale. */
export async function keepClipsOffline(urls: string[]): Promise<void> {
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(AUDIO_CACHE);
  const wanted = new Set(urls.map((u) => new URL(u, location.href).href));
  const kept = await cache.keys();
  for (const request of kept) if (!wanted.has(request.url)) await cache.delete(request);
  const have = new Set(kept.map((r) => r.url));
  for (const url of wanted) {
    if (have.has(url)) continue;
    try {
      const response = await fetch(url);
      if (response.ok) await cache.put(url, response);
    } catch {
      // Offline: the rest can wait for next time.
      return;
    }
  }
}

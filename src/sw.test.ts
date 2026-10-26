// public/sw.js is plain JavaScript outside the build, so it can't import the
// names it shares with the app. These checks stand in for that import: renaming
// a cache or moving the model's loader would otherwise quietly break offline use.

import { expect, it, vi } from 'vitest';
import worker from '../public/sw.js?raw';
import { AUDIO_CACHE } from './clip-cache';
import { CACHE as MODEL_CACHE } from './model-cache';

const sources = Object.keys(import.meta.glob('./**/*.ts'));

it('uses the cache names the app keeps clips and the speech model in', () => {
  expect(worker).toContain(`const AUDIO_CACHE = '${AUDIO_CACHE}';`);
  expect(worker).toContain(`const MODEL_CACHE = '${MODEL_CACHE}';`);
});

it("finds the speech model's runtime in the build manifest by a file that exists", () => {
  const entry = worker.match(/manifest\['(src\/[^']+)'\]/)?.[1];
  expect(sources).toContain(`./${entry!.slice('src/'.length)}`);
});

/** The worker run with stand-ins for its globals, at https://example.test/app/sw.js. */
function runWorker() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const put = vi.fn(async () => {});
  const self = {
    location: { href: 'https://example.test/app/sw.js', origin: 'https://example.test' },
    addEventListener: (type: string, listener: (event: unknown) => void) => (listeners[type] = listener),
    skipWaiting() {},
    clients: { claim: async () => {} },
  };
  const caches = { open: async () => ({ put }), match: async () => undefined };
  const fetch = async () => new Response('page');
  new Function('self', 'caches', 'fetch', worker)(self, caches, fetch);
  /** Navigate to `url`: whether the worker answered, once it has finished with it. */
  const navigate = async (url: string) => {
    const waits: Promise<unknown>[] = [];
    let answered = false;
    listeners.fetch({
      request: { method: 'GET', mode: 'navigate', url },
      respondWith: (p: Promise<unknown>) => ((answered = true), waits.push(p)),
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
    await Promise.all(waits);
    return answered;
  };
  return { navigate, put };
}

it("keeps only the app's own page as its offline copy, not the About page beside it", async () => {
  const sw = runWorker();
  expect(await sw.navigate('https://example.test/app/about')).toBe(false);
  expect(await sw.navigate('https://example.test/app/about.html')).toBe(false);
  expect(sw.put).not.toHaveBeenCalled();
  expect(await sw.navigate('https://example.test/app/')).toBe(true);
  expect(sw.put).toHaveBeenCalledWith('./', expect.any(Response));
});

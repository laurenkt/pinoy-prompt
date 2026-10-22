// The app keeps every word clip on the device, one fetch at a time, and drops ones no longer used.

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AUDIO_CACHE, keepClipsOffline } from './clip-cache';

let stored: Map<string, unknown>;
let opened: string[];
let fetched: string[];
let failAfter: number;

beforeEach(() => {
  stored = new Map();
  opened = [];
  fetched = [];
  failAfter = Infinity;
  vi.stubGlobal('location', { href: 'https://example.com/app/' });
  vi.stubGlobal('caches', {
    open: async (name: string) => {
      opened.push(name);
      return {
        keys: async () => [...stored.keys()].map((url) => ({ url })),
        delete: async (r: { url: string }) => stored.delete(r.url),
        put: async (url: string, response: unknown) => void stored.set(url, response),
      };
    },
  });
  vi.stubGlobal('fetch', async (url: string) => {
    if (fetched.length >= failAfter) throw new TypeError('offline');
    fetched.push(url);
    return { ok: true };
  });
});

afterEach(() => vi.unstubAllGlobals());

it('keeps every clip, in the cache the service worker reads from', async () => {
  await keepClipsOffline(['audio/a.mp3', 'audio/a-slow.mp3']);
  expect(opened).toEqual([AUDIO_CACHE]);
  expect([...stored.keys()]).toEqual(['https://example.com/app/audio/a.mp3', 'https://example.com/app/audio/a-slow.mp3']);
});

it('fetches only clips it lacks, and drops ones the app no longer plays', async () => {
  stored.set('https://example.com/app/audio/old.mp3', {});
  stored.set('https://example.com/app/audio/a.mp3', {});
  await keepClipsOffline(['audio/a.mp3', 'audio/b.mp3']);
  expect(fetched).toEqual(['https://example.com/app/audio/b.mp3']);
  expect([...stored.keys()].sort()).toEqual(['https://example.com/app/audio/a.mp3', 'https://example.com/app/audio/b.mp3']);
});

it('keeps what it fetched when the connection drops, and fetches the rest next time', async () => {
  failAfter = 1;
  await keepClipsOffline(['audio/a.mp3', 'audio/b.mp3', 'audio/c.mp3']);
  expect([...stored.keys()]).toEqual(['https://example.com/app/audio/a.mp3']);
  failAfter = Infinity;
  fetched = [];
  await keepClipsOffline(['audio/a.mp3', 'audio/b.mp3', 'audio/c.mp3']);
  expect(fetched).toEqual(['https://example.com/app/audio/b.mp3', 'https://example.com/app/audio/c.mp3']);
});

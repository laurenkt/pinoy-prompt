// Recorded clips play through the one shared AudioContext, and the built-in voice is only a fallback.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Decoded clips are kept between tests, so each test that counts fetches has its own word.
vi.mock('./clips.json', () => ({ default: { Salamat: 'salamat-1a2b', Oo: 'oo-3c4d', Paalam: 'paalam-5e6f' } }));

const { KEEP_DECODED, loadClip } = await import('./audio-engine');
const { clipUrl, lastStartDelay, play, speaking, stop } = await import('./speech');

interface FakeSource {
  playbackRate: { value: number };
  started: number | null;
  stopped: boolean;
  onended: (() => void) | null;
}

const sources: FakeSource[] = [];
const contexts: FakeContext[] = [];

class FakeContext {
  state = 'running';
  currentTime = 0;
  outputLatency = 0.02;
  baseLatency = 0.005;
  destination = {};
  constructor(public options?: AudioContextOptions) {
    contexts.push(this);
  }
  resume() {
    return Promise.resolve();
  }
  decodeAudioData() {
    return Promise.resolve({ duration: 1 });
  }
  createGain() {
    const param = { setValueAtTime() {}, linearRampToValueAtTime() {} };
    return { gain: param, connect: (to: unknown) => to };
  }
  createBufferSource() {
    const source: FakeSource & Record<string, unknown> = {
      buffer: null,
      playbackRate: { value: 1 },
      started: null,
      stopped: false,
      onended: null,
      connect: (to: unknown) => to,
      start: (at: number) => (source.started = at),
      stop: () => (source.stopped = true),
    };
    sources.push(source);
    return source;
  }
}

let fetched: string[];
let failing: Set<string>;

function stubSpeech() {
  const speech = {
    spoken: [] as { text: string }[],
    speaking: false,
    pending: false,
    paused: false,
    getVoices: () => [{ lang: 'fil-PH', name: 'Test' }],
    speak: (u: { text: string }) => speech.spoken.push(u),
    cancel() {},
    addEventListener() {},
  };
  vi.stubGlobal('speechSynthesis', speech);
  vi.stubGlobal('window', { speechSynthesis: speech });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  return speech;
}

beforeEach(() => {
  sources.length = 0;
  fetched = [];
  failing = new Set();
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return failing.has(url) ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  });
});

afterEach(() => {
  stop(true);
  vi.unstubAllGlobals();
});

describe('clips', () => {
  it('finds the clip made for a text, and its slow version', () => {
    expect(clipUrl({ tl: 'Salamat' })).toMatch(/audio\/salamat-1a2b\.m4a$/);
    expect(clipUrl({ tl: 'Salamat' }, true)).toMatch(/audio\/salamat-1a2b-slow\.m4a$/);
    expect(clipUrl({ tl: 'Hindi' })).toBeNull();
    expect(clipUrl({ tl: 'Hindi', audio: 'hindi.m4a' })).toMatch(/audio\/hindi\.m4a$/);
  });

  it("plays a word's clip through the one shared context instead of the built-in voice", async () => {
    const speech = stubSpeech();
    await play({ tl: 'Salamat' });
    await play({ tl: 'Salamat' }, true);
    expect(speech.spoken).toHaveLength(0);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].options?.latencyHint).toBe('interactive');
    expect(sources.map((s) => s.started !== null)).toEqual([true, true]);
    // The slow clip is already slow, so it isn't slowed again.
    expect(sources[1].playbackRate.value).toBe(1);
    expect(fetched.at(-1)).toMatch(/salamat-1a2b-slow\.m4a$/);
  });

  it('decodes a clip once and plays it again from memory', async () => {
    await play({ tl: 'Oo' });
    await play({ tl: 'Oo' });
    expect(fetched).toHaveLength(1);
    expect(sources).toHaveLength(2);
  });

  it('falls back to the built-in voice when the clip is missing', async () => {
    const speech = stubSpeech();
    failing.add(clipUrl({ tl: 'Paalam' })!);
    await play({ tl: 'Paalam' });
    expect(speech.spoken.map((u) => u.text)).toEqual(['Paalam']);
    expect(sources).toHaveLength(0);
  });

  it('uses the built-in voice for text with no clip', async () => {
    const speech = stubSpeech();
    await play({ tl: 'Hindi' });
    expect(fetched).toHaveLength(0);
    expect(speech.spoken.map((u) => u.text)).toEqual(['Hindi']);
  });

  it('is heard until it ends or is stopped', async () => {
    await play({ tl: 'Salamat' });
    expect(speaking()).toBe(true);
    sources[0].onended!();
    await Promise.resolve();
    expect(speaking()).toBe(false);
    await play({ tl: 'Salamat' });
    stop();
    expect(sources[1].stopped).toBe(true);
    expect(speaking()).toBe(false);
  });

  it("doesn't start a clip that was stopped while it loaded", async () => {
    const playing = play({ tl: 'Salamat' });
    stop();
    await playing;
    expect(sources).toHaveLength(0);
  });

  it('reports how long a clip took to be heard, including the output latency', async () => {
    await play({ tl: 'Salamat' });
    const ms = await lastStartDelay();
    expect(ms).toBeGreaterThanOrEqual(25);
    expect(ms).toBeLessThan(1000);
  });

  it('reports when the built-in voice starts, and nothing for a word that never played', async () => {
    const speech = stubSpeech();
    await play({ tl: 'Hindi' });
    const heard = lastStartDelay();
    (speech.spoken[0] as unknown as { onstart: () => void }).onstart();
    expect(await heard).toBeGreaterThanOrEqual(0);
    await play({ tl: 'Hindi' });
    const never = lastStartDelay();
    stop();
    expect(await never).toBeNull();
  });

  it('keeps only recent clips decoded', async () => {
    const urls = Array.from({ length: KEEP_DECODED + 1 }, (_, i) => `clip-${i}.m4a`);
    for (const url of urls) await loadClip(url);
    await loadClip(urls.at(-1)!);
    expect(fetched).toHaveLength(KEEP_DECODED + 1);
    await loadClip(urls[0]);
    expect(fetched).toHaveLength(KEEP_DECODED + 2);
  });
});

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

/** What state new contexts start in, and whether resume() can start them. */
let startState = 'running';

class FakeContext {
  state = startState;
  closed = false;
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
  close() {
    this.closed = true;
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
  startState = 'running';
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

  it("lets the built-in voice read a word when iOS won't start the context, rather than play nothing", async () => {
    // Outside a tap iOS leaves the context suspended, and resume() doesn't change that.
    startState = 'suspended';
    for (const c of contexts) c.state = 'suspended';
    const speech = stubSpeech();
    await play({ tl: 'Salamat' });
    expect(sources).toHaveLength(0);
    expect(speech.spoken.map((u) => u.text)).toEqual(['Salamat']);
  });

  it('makes a new context once the microphone has opened or closed, as the old one can play distorted', async () => {
    // No audio session, as before iOS 17: the microphone still changes the hardware rate.
    const track = { enabled: true, readyState: 'live', muted: false, stop() {} };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    await play({ tl: 'Salamat' });
    const before = contexts.at(-1)!;
    await play({ tl: 'Salamat' });
    expect(contexts.at(-1)).toBe(before);
    const { closeMicrophone, getMicrophone } = await import('./microphone');
    await getMicrophone();
    await play({ tl: 'Salamat' });
    expect(before.closed).toBe(true);
    const withMic = contexts.at(-1)!;
    expect(withMic).not.toBe(before);
    closeMicrophone();
    await play({ tl: 'Salamat' });
    expect(withMic.closed).toBe(true);
    expect(contexts.at(-1)).not.toBe(withMic);
  });

  it('uses the older webkitAudioContext where that is all there is', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', FakeContext);
    const speech = stubSpeech();
    await play({ tl: 'Salamat' });
    expect(speech.spoken).toHaveLength(0);
    expect(sources.at(-1)?.started).not.toBeNull();
  });

  it('counts a word as playing while its clip loads, so a screen moving on waits for it', async () => {
    const playing = play({ tl: 'Salamat' }, true);
    expect(speaking()).toBe(true);
    await playing;
    expect(speaking()).toBe(true);
    stop();
    expect(speaking()).toBe(false);
  });

  it('holds the silent track with a clip too, so it plays through the silent switch before iOS 17', async () => {
    // The only test with media elements, so the track speech.ts keeps is made here.
    const tracks: { paused: boolean }[] = [];
    vi.stubGlobal(
      'Audio',
      class {
        paused = true;
        constructor() {
          tracks.push(this);
        }
        play() {
          this.paused = false;
          return Promise.resolve();
        }
        pause() {
          this.paused = true;
        }
      },
    );
    const playing = play({ tl: 'Salamat' });
    // Started inside the tap, before the clip has loaded.
    expect(tracks).toHaveLength(1);
    expect(tracks[0].paused).toBe(false);
    await playing;
  });

  it('reports nothing for a word asked for in silent quiet mode', async () => {
    const { setMuted } = await import('./speech');
    await play({ tl: 'Salamat' });
    setMuted(true);
    await play({ tl: 'Salamat' });
    expect(await lastStartDelay()).toBeNull();
    setMuted(false);
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

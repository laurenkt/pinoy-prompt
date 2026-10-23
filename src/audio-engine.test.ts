// Recorded clips play through the one shared AudioContext, and the built-in voice is only a fallback.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Decoded clips are kept between tests, so each test that counts fetches has its own word.
vi.mock('./clips.json', () => ({ default: { Salamat: 'salamat-1a2b', Oo: 'oo-3c4d', Paalam: 'paalam-5e6f', 'Kumusta?': 'kumusta-7a8b' } }));

const { audioBusy, IDLE_SUSPEND_MS, KEEP_DECODED, loadClip, playLive } = await import('./audio-engine');
const { canPlay, chime, clickSamples, tick, clipUrl, lastStartDelay, play, preload, setMuted, speaking, stop, voiceQuality } = await import('./speech');

interface FakeSource {
  buffer: { duration: number } | null;
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
  sampleRate = 48000;
  outputLatency = 0.02;
  baseLatency = 0.005;
  destination = {};
  constructor(public options?: AudioContextOptions) {
    contexts.push(this);
  }
  resume() {
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  decodeAudioData() {
    return Promise.resolve({ duration: 1 });
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { sampleRate, duration: length / sampleRate, getChannelData: () => data };
  }
  createGain() {
    const param = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} };
    return { gain: param, connect: (to: unknown) => to, disconnect() {} };
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
  stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('clips', () => {
  it('finds the clip made for a text, and its slow version', () => {
    expect(clipUrl({ tl: 'Salamat' })).toMatch(/audio\/salamat-1a2b\.mp3$/);
    expect(clipUrl({ tl: 'Salamat' }, true)).toMatch(/audio\/salamat-1a2b-slow\.mp3$/);
    expect(clipUrl({ tl: 'Hindi' })).toBeNull();
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
    expect(fetched.at(-1)).toMatch(/salamat-1a2b-slow\.mp3$/);
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

  it('counts words as playable from clips alone, and says a recorded voice reads them', () => {
    expect(canPlay()).toBe(true);
    expect(voiceQuality()).toBe('recorded');
    vi.stubGlobal('AudioContext', undefined);
    expect(canPlay()).toBe(false);
    expect(voiceQuality()).toBe('none');
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

  it('lets go of the phone\'s audio once words stop, and takes it back on the next tap', async () => {
    vi.useFakeTimers();
    await play({ tl: 'Salamat' });
    const ctx = contexts.at(-1)!;
    sources.at(-1)!.onended!();
    await Promise.resolve();
    vi.advanceTimersByTime(IDLE_SUSPEND_MS - 1000);
    expect(ctx.state).toBe('running');
    // A word playing past the deadline keeps it.
    await play({ tl: 'Salamat' });
    vi.advanceTimersByTime(IDLE_SUSPEND_MS * 2);
    expect(ctx.state).toBe('running');
    stop();
    await Promise.resolve();
    vi.advanceTimersByTime(IDLE_SUSPEND_MS);
    expect(ctx.state).toBe('suspended');
    ctx.resume = () => ((ctx.state = 'running'), Promise.resolve());
    await play({ tl: 'Salamat' });
    expect(contexts.at(-1)).toBe(ctx);
    expect(sources.at(-1)!.started).not.toBeNull();
  });

  it('still lets go once idle after a context closed mid-word', async () => {
    vi.useFakeTimers();
    const track = { enabled: true, readyState: 'live', muted: false, stop() {} };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    const { closeMicrophone, getMicrophone } = await import('./microphone');
    const { playBuffer } = await import('./audio-engine');
    // Playing outside speech.ts, as the pronunciation results do, so nothing stops it.
    playBuffer({ duration: 1 } as AudioBuffer);
    // The microphone opening replaces the context the sound was playing on.
    await getMicrophone();
    await play({ tl: 'Salamat' });
    const ctx = contexts.at(-1)!;
    stop();
    await Promise.resolve();
    vi.advanceTimersByTime(IDLE_SUSPEND_MS);
    expect(ctx.state).toBe('suspended');
    closeMicrophone();
  });

  it('makes a new context when iOS left the old one interrupted, rather than going quiet', async () => {
    const speech = stubSpeech();
    await play({ tl: 'Salamat' });
    const before = contexts.at(-1)!;
    before.state = 'interrupted';
    await play({ tl: 'Salamat' });
    expect(before.closed).toBe(true);
    expect(contexts.at(-1)).not.toBe(before);
    expect(sources.at(-1)!.started).not.toBeNull();
    expect(speech.spoken).toHaveLength(0);
  });

  it('reports nothing for a word asked for while the sound is off', async () => {
    const { setMuted } = await import('./speech');
    await play({ tl: 'Salamat' });
    setMuted(true);
    await play({ tl: 'Salamat' });
    expect(await lastStartDelay()).toBeNull();
    setMuted(false);
  });

  it("loads a clip ahead without taking the audio session, so showing a card doesn't pause the learner's music", async () => {
    const audioSession = { type: 'auto' };
    vi.stubGlobal('navigator', { audioSession });
    const decodedBy: string[] = [];
    vi.stubGlobal(
      'OfflineAudioContext',
      class {
        decodeAudioData() {
          decodedBy.push('offline');
          return Promise.resolve({ duration: 1 });
        }
      },
    );
    const made = contexts.length;
    preload({ tl: 'Kumusta?' });
    await vi.waitFor(() => expect(decodedBy).toEqual(['offline']));
    expect(contexts.length).toBe(made);
    expect(audioSession.type).toBe('auto');
    await play({ tl: 'Kumusta?' });
    expect(fetched.filter((u) => u.includes('kumusta'))).toHaveLength(1);
    expect(sources.at(-1)?.started).not.toBeNull();
  });

  it('keeps only recent clips decoded', async () => {
    const urls = Array.from({ length: KEEP_DECODED + 1 }, (_, i) => `clip-${i}.mp3`);
    for (const url of urls) await loadClip(url);
    await loadClip(urls.at(-1)!);
    expect(fetched).toHaveLength(KEEP_DECODED + 1);
    await loadClip(urls[0]);
    expect(fetched).toHaveLength(KEEP_DECODED + 2);
  });
});

describe('the right-answer chime', () => {
  it('plays a short, quiet sound through the shared context', async () => {
    await chime();
    expect(contexts.filter((c) => !c.closed)).toHaveLength(1);
    expect(sources).toHaveLength(1);
    const buffer = sources[0].buffer as unknown as { duration: number; getChannelData(): Float32Array };
    expect(buffer.duration).toBeLessThan(0.5);
    const peak = buffer.getChannelData().reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThan(0.25);
  });

  it('holds back a word played with it until it has finished', async () => {
    void chime();
    await play({ tl: 'Salamat' });
    expect(sources[1].started).toBeGreaterThanOrEqual(sources[0].started! + sources[0].buffer!.duration);
  });

  it("doesn't hold back a word on a new context", async () => {
    // A call interrupted it, so the next use makes a new one, counting from 0 again.
    const old = contexts.at(-1)!;
    old.currentTime = 500;
    await chime();
    old.state = 'interrupted';
    await play({ tl: 'Salamat' });
    expect(sources.at(-1)!.started).toBeLessThan(0.1);
  });

  it('is silent in silent mode, and stops when it comes on', async () => {
    setMuted(true);
    await chime();
    setMuted(false);
    expect(sources).toHaveLength(0);
    await chime();
    setMuted(true);
    setMuted(false);
    expect(sources[0].stopped).toBe(true);
  });

  it("isn't left waiting to play on the next tap when iOS won't start the context", async () => {
    startState = 'suspended';
    for (const c of contexts) c.state = 'suspended';
    await chime();
    expect(sources).toHaveLength(0);
  });
});

describe('the tap sounds', () => {
  it('makes the click a short knock, not a ding: gone within a few hundredths of a second', () => {
    const rate = 48000;
    const click = clickSamples(rate);
    expect(click.length / rate).toBeLessThan(0.05);
    const peak = click.reduce((m: number, x: number) => Math.max(m, Math.abs(x)), 0);
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThan(0.11);
    // A ding rings on; this has died to a twentieth of its peak within 20 ms.
    const tail = click.subarray(Math.round(rate * 0.02)).reduce((m: number, x: number) => Math.max(m, Math.abs(x)), 0);
    expect(tail).toBeLessThan(peak / 20);
    expect(Math.abs(click[click.length - 1])).toBeLessThan(0.001);
  });

  it('plays both through the shared context, each of quick taps in turn, without fading their attack', async () => {
    for (const c of contexts) c.state = 'running';
    await new Promise((r) => setTimeout(r, 300));
    const ramps: number[] = [];
    const ctx = contexts.at(-1)!;
    const gain = ctx.createGain.bind(ctx);
    ctx.createGain = () => {
      const node = gain();
      node.gain.linearRampToValueAtTime = () => void ramps.push(1);
      return node;
    };
    tick('click');
    tick('thock');
    // The thock is a recording, decoded first.
    await vi.waitFor(() => expect(sources).toHaveLength(2));
    // It's inlined in the app, so it plays offline without a file of its own.
    expect(fetched.at(-1)).toMatch(/^data:audio\/mpeg;base64,/);
    expect(ramps).toHaveLength(0);
  });
});

describe('sounds made as they play', () => {
  it('play through the shared context, count as playing until stopped, then stop their sources after a fade', async () => {
    vi.useFakeTimers();
    const ended: number[] = [];
    const sound = playLive((ctx, t0) => {
      expect(ctx).toBe(contexts.at(-1));
      expect(t0).toBeGreaterThanOrEqual(ctx.currentTime);
      return { out: ctx.createGain() as unknown as AudioNode, end: (at) => ended.push(at) };
    });
    const ctx = contexts.at(-1)!;
    vi.advanceTimersByTime(IDLE_SUSPEND_MS * 2);
    expect(audioBusy(0)).toBe(true);
    expect(ctx.state).toBe('running');
    sound.stop();
    sound.stop();
    await sound.done;
    expect(ended).toHaveLength(1);
    expect(ended[0]).toBeGreaterThan(ctx.currentTime);
    expect(audioBusy(0)).toBe(false);
    vi.advanceTimersByTime(IDLE_SUSPEND_MS);
    expect(ctx.state).toBe('suspended');
  });
});

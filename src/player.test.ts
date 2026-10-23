// Holding a sound made in code: it starts at once, keeps going while held, and a quick tap is still heard.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { TAP_MS, webAudioPlayer } = await import('./player');

/** An AudioParam that takes any automation. */
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });

const contexts: FakeContext[] = [];

class FakeContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  stopped: number[] = [];
  constructor() {
    contexts.push(this);
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  node(extra: object = {}) {
    return { connect: (to: unknown) => to, disconnect() {}, ...extra };
  }
  createGain() {
    return this.node({ gain: param() });
  }
  createBiquadFilter() {
    return this.node({ type: '', frequency: param(), Q: param(), gain: param() });
  }
  createDynamicsCompressor() {
    return this.node({ threshold: param(), ratio: param() });
  }
  source() {
    return this.node({ start() {}, stop: (at: number) => this.stopped.push(at) });
  }
  createOscillator() {
    return { ...this.source(), frequency: param(), setPeriodicWave() {} };
  }
  createBufferSource() {
    return { ...this.source(), buffer: null, loop: false };
  }
  createPeriodicWave() {
    return {};
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', FakeContext);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('holding a sound', () => {
  it("can't hold a sound it can't make", () => {
    expect(webAudioPlayer().hold('ǃ', 'a', 0)).toBeNull();
  });

  it('plays until let go, then stops its sources', async () => {
    const held = webAudioPlayer().hold('ɛ', 'a', 0)!;
    const ctx = contexts.at(-1)!;
    const stops = ctx.stopped.length;
    vi.advanceTimersByTime(TAP_MS * 3);
    expect(ctx.stopped.length).toBe(stops);
    held.setMix(0.5);
    held.release();
    await held.done;
    expect(ctx.stopped.length).toBeGreaterThan(stops);
  });

  it('keeps a quick tap going for a moment, so it is heard', async () => {
    const held = webAudioPlayer().hold('m', 'n', 1)!;
    const ctx = contexts.at(-1)!;
    const stops = ctx.stopped.length;
    held.release();
    expect(ctx.stopped.length).toBe(stops);
    vi.advanceTimersByTime(TAP_MS);
    await held.done;
    expect(ctx.stopped.length).toBeGreaterThan(stops);
  });

  it('stops the last sound when another is held', async () => {
    const player = webAudioPlayer();
    const first = player.hold('s', 'ʃ', 0)!;
    const stops = contexts.at(-1)!.stopped.length;
    player.hold('a', 'a', 0);
    await first.done;
    expect(contexts.at(-1)!.stopped.length).toBeGreaterThan(stops);
  });

  it("starts, from the lift, a context a finger going down couldn't start, and plays a tap's length from there", async () => {
    webAudioPlayer().hold('a', 'a', 0)!.release();
    const ctx = contexts.at(-1)!;
    // A press on iOS: the context won't start from it.
    ctx.state = 'suspended';
    ctx.resume = () => Promise.resolve();
    const held = webAudioPlayer().hold('a', 'a', 0)!;
    vi.advanceTimersByTime(1000);
    const stops = ctx.stopped.length;
    let resumed = 0;
    ctx.resume = () => ((resumed++, (ctx.state = 'running')), Promise.resolve());
    held.release();
    expect(resumed).toBe(1);
    // Still the same context, not a new one.
    expect(contexts.at(-1)).toBe(ctx);
    vi.advanceTimersByTime(TAP_MS - 50);
    expect(ctx.stopped.length).toBe(stops);
    vi.advanceTimersByTime(100);
    await held.done;
    expect(ctx.stopped.length).toBeGreaterThan(stops);
  });
});

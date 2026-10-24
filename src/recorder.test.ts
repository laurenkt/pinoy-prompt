import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeMicrophone } from './microphone';
import { record, RecordError, resample, SIGNAL_WAIT_MS, toWav } from './recorder';

const sine = (hz: number, rate: number, seconds = 0.5) =>
  Float32Array.from({ length: rate * seconds }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));
/** RMS of the middle of a signal, away from the edges. */
const rms = (x: Float32Array) => {
  const mid = x.subarray(x.length / 4, (3 * x.length) / 4);
  return Math.sqrt(mid.reduce((s, v) => s + v * v, 0) / mid.length);
};

describe('resample', () => {
  it('keeps speech frequencies when going down from 48 kHz', () => {
    const out = resample(sine(1000, 48000), 48000);
    expect(out.length).toBe(8000);
    expect(rms(out)).toBeCloseTo(Math.SQRT1_2, 1);
  });

  it("filters out sound above 8 kHz instead of folding it into what's heard", () => {
    // 12 kHz would alias to 4 kHz with plain decimation.
    expect(rms(resample(sine(12000, 48000), 48000))).toBeLessThan(0.05);
  });

  it('handles 44.1 kHz and low-rate microphones', () => {
    expect(rms(resample(sine(500, 44100), 44100))).toBeCloseTo(Math.SQRT1_2, 1);
    const up = resample(sine(500, 8000), 8000);
    expect(up.length).toBe(8000);
    expect(rms(up)).toBeCloseTo(Math.SQRT1_2, 1);
  });
});

describe('a take as a WAV file', () => {
  it('is 16-bit mono at 16 kHz, with the samples clipped to range', async () => {
    const wav = toWav(new Float32Array([0, 1, -1, 2]));
    expect(wav.type).toBe('audio/wav');
    const data = new DataView(await wav.arrayBuffer());
    expect(String.fromCharCode(...new Uint8Array(await wav.slice(0, 4).arrayBuffer()))).toBe('RIFF');
    expect(data.getUint16(22, true)).toBe(1);
    expect(data.getUint32(24, true)).toBe(16000);
    expect(data.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => data.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32767, 32767]);
  });
});

/** A microphone stream whose track can be checked for being closed. */
function fakeStream() {
  const track = { enabled: true, muted: false, readyState: 'live' as MediaStreamTrackState, stop: () => (track.readyState = 'ended') };
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream };
}

/** The recorder's context: the test feeds the processor blocks, as the microphone would. */
class FakeRecorderContext {
  static last: FakeRecorderContext;
  state = 'running';
  sampleRate = 16000;
  destination = {};
  processor = { onaudioprocess: null as ((e: unknown) => void) | null, connect() {}, disconnect() {} };
  constructor() {
    FakeRecorderContext.last = this;
  }
  resume = async () => {};
  close = async () => {};
  createMediaStreamSource = () => ({ connect() {}, disconnect() {} });
  createScriptProcessor = () => this.processor;
  /** One block of 4096 samples at the given level (0 is exact silence, as a dead microphone gives). */
  feed(level: number) {
    const block = Float32Array.from({ length: 4096 }, (_, i) => (i % 2 ? level : -level));
    this.processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => block } });
  }
}

describe('a microphone that gives no sound', () => {
  let opened: ReturnType<typeof fakeStream>[];

  beforeEach(() => {
    vi.useFakeTimers();
    opened = [];
    const getUserMedia = vi.fn(async () => {
      const s = fakeStream();
      opened.push(s);
      return s.stream;
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('AudioContext', FakeRecorderContext);
  });

  afterEach(() => {
    closeMicrophone();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Let the recorder open the microphone and start listening. */
  const started = () => vi.advanceTimersByTimeAsync(0);

  it('keeps a stream that gives even faint hiss', async () => {
    const recording = record();
    await started();
    FakeRecorderContext.last.feed(0.0005);
    await vi.advanceTimersByTimeAsync(SIGNAL_WAIT_MS * 2);
    recording.stop();
    expect((await recording.audio).speech).toBe(false);
    expect(opened).toHaveLength(1);
  });

  it('opens the microphone afresh when it gives only exact silence, and records from the new one', async () => {
    const recording = record();
    await started();
    FakeRecorderContext.last.feed(0);
    await vi.advanceTimersByTimeAsync(SIGNAL_WAIT_MS);
    expect(opened).toHaveLength(2);
    expect(opened[0].track.readyState).toBe('ended');
    FakeRecorderContext.last.feed(0.2);
    recording.stop();
    expect((await recording.audio).speech).toBe(true);
  });

  it("says so, rather than that it didn't hear the learner, when the fresh stream is silent too", async () => {
    const recording = record();
    const failed = expect(recording.audio).rejects.toEqual(new RecordError('silent'));
    await started();
    // A context that never starts sends no blocks at all.
    await vi.advanceTimersByTimeAsync(SIGNAL_WAIT_MS * 2);
    await failed;
    expect(opened).toHaveLength(2);
    // Closed, so the next tap starts on a new stream.
    expect(opened[1].track.readyState).toBe('ended');
  });

  it("counts a stop over exact silence as a dead microphone, not as the learner saying nothing", async () => {
    const recording = record();
    const failed = expect(recording.audio).rejects.toEqual(new RecordError('silent'));
    await started();
    FakeRecorderContext.last.feed(0);
    await vi.advanceTimersByTimeAsync(600);
    recording.stop();
    await failed;
    // Closed, so the next take doesn't land on the same dead stream.
    expect(opened[0].track.readyState).toBe('ended');
  });

  it('says it is listening only once the microphone gives sound, and only once', async () => {
    const onListening = vi.fn();
    const recording = record({ onListening });
    await started();
    // Switching on: exact silence, so anything said now would be lost.
    FakeRecorderContext.last.feed(0);
    FakeRecorderContext.last.feed(0);
    expect(onListening).not.toHaveBeenCalled();
    FakeRecorderContext.last.feed(0.0005);
    expect(onListening).toHaveBeenCalledOnce();
    FakeRecorderContext.last.feed(0.2);
    expect(onListening).toHaveBeenCalledOnce();
    recording.stop();
    await recording.audio;
  });

  it('says it is listening only once the reopened microphone gives sound', async () => {
    const onListening = vi.fn();
    const recording = record({ onListening });
    await started();
    await vi.advanceTimersByTimeAsync(SIGNAL_WAIT_MS);
    expect(onListening).not.toHaveBeenCalled();
    FakeRecorderContext.last.feed(0.0005);
    expect(onListening).toHaveBeenCalledOnce();
    recording.cancel();
  });

  it('tells the learner to say it again once the microphone is reopened', async () => {
    const onRestart = vi.fn();
    const recording = record({ onRestart });
    await started();
    await vi.advanceTimersByTimeAsync(SIGNAL_WAIT_MS);
    expect(onRestart).toHaveBeenCalledOnce();
    recording.cancel();
  });

  it('lets the learner stop while the microphone is being reopened, and lets the new stream go', async () => {
    const recording = record();
    await started();
    FakeRecorderContext.last.feed(0);
    // The fresh stream takes a while, and the context needs resuming once it comes.
    let open: () => void = () => {};
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => (open = () => {
      const s = fakeStream();
      opened.push(s);
      resolve(s.stream);
    })));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    FakeRecorderContext.last.state = 'interrupted';
    FakeRecorderContext.last.resume = () => new Promise(() => {});
    await vi.advanceTimersByTimeAsync(SIGNAL_WAIT_MS);
    recording.stop();
    await expect(recording.audio).rejects.toEqual(new RecordError('silent'));
    open();
    await vi.advanceTimersByTimeAsync(0);
    expect(opened[1].track.enabled).toBe(false);
  });

  it('stops without waiting on a context that never resumes after the reopen', async () => {
    const recording = record();
    await started();
    const ctx = FakeRecorderContext.last;
    ctx.state = 'interrupted';
    let resumed: () => void = () => {};
    ctx.resume = () => new Promise<void>((r) => (resumed = r));
    const made = vi.spyOn(ctx, 'createMediaStreamSource');
    await vi.advanceTimersByTimeAsync(SIGNAL_WAIT_MS);
    recording.cancel();
    await recording.audio;
    resumed();
    await vi.advanceTimersByTimeAsync(0);
    // Nothing is wired up on the closed context.
    expect(made).not.toHaveBeenCalled();
  });

  it("doesn't reopen anything once the learner has stopped", async () => {
    const recording = record();
    await started();
    recording.stop();
    await recording.audio;
    await vi.advanceTimersByTimeAsync(SIGNAL_WAIT_MS * 2);
    expect(opened).toHaveLength(1);
  });
});

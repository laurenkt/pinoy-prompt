import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeMicrophone, getMicrophone, releaseMicrophone } from './microphone';
import { cancelRecording, record, RecordError, resample, SIGNAL_WAIT_MS, toWav, WARM_MS, warmRecorder } from './recorder';

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
  /** How many have been made. */
  static count = 0;
  state = 'running';
  sampleRate = 16000;
  destination = {};
  processor = { onaudioprocess: null as ((e: unknown) => void) | null, connect() {}, disconnect() {} };
  constructor() {
    FakeRecorderContext.count++;
    FakeRecorderContext.last = this;
  }
  resume = async () => {
    this.state = 'running';
  };
  suspend = async () => {
    this.state = 'suspended';
  };
  close = async () => {
    this.state = 'closed';
  };
  createMediaStreamSource = () => ({ connect() {}, disconnect() {} });
  createScriptProcessor = () => this.processor;
  createGain = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
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

  it("reports each block's level, whether it's speech, and the finer levels of its parts", async () => {
    const onLevel = vi.fn();
    const recording = record({ onLevel });
    await started();
    // Quiet then loud halves: speech as a block, though its first parts are only the room.
    const block = Float32Array.from({ length: 4096 }, (_, i) => (i < 2048 ? 0.001 : 0.1) * (i % 2 ? 1 : -1));
    FakeRecorderContext.last.processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => block } });
    const [level, speech, parts] = onLevel.mock.calls[0];
    expect(level).toBeCloseTo(Math.sqrt((0.001 ** 2 + 0.1 ** 2) / 2) * 8);
    expect(speech).toBe(true);
    expect(parts.map((p: number) => +p.toFixed(3))).toEqual([0.008, 0.008, 0.8, 0.8]);
    FakeRecorderContext.last.feed(0.001);
    expect(onLevel.mock.calls[1][1]).toBe(false);
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

describe('warming the microphone up ahead of a take', () => {
  let opened: ReturnType<typeof fakeStream>[];

  beforeEach(() => {
    vi.useFakeTimers();
    opened = [];
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          const s = fakeStream();
          opened.push(s);
          return s.stream;
        }),
      },
    });
    vi.stubGlobal('AudioContext', FakeRecorderContext);
  });

  afterEach(() => {
    cancelRecording();
    closeMicrophone();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** The microphone opened and switched off again, as a drill round holds it. */
  async function held() {
    releaseMicrophone(await getMicrophone());
    return opened[0].track;
  }

  it("never opens the microphone itself, so it can't ask for it", async () => {
    const before = FakeRecorderContext.count;
    expect(warmRecorder()).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(opened).toHaveLength(0);
    expect(FakeRecorderContext.count).toBe(before);
  });

  it('switches the held microphone on ahead of a take, and off again when cooled', async () => {
    const track = await held();
    expect(track.enabled).toBe(false);
    const warmth = warmRecorder()!;
    await vi.advanceTimersByTimeAsync(0);
    expect(track.enabled).toBe(true);
    expect(warmth.warm).toBe(true);
    const context = FakeRecorderContext.last;
    warmth.cool();
    expect(warmth.warm).toBe(false);
    expect(track.enabled).toBe(false);
    expect(context.state).toBe('suspended');
  });

  it('hands the warm microphone and context to the take, so it starts with sound and nothing switches off', async () => {
    const track = await held();
    const warmth = warmRecorder()!;
    await vi.advanceTimersByTimeAsync(0);
    const context = FakeRecorderContext.last;
    const made = FakeRecorderContext.count;
    const onListening = vi.fn();
    const recording = record({ onListening });
    // Cooling after the take adopted it does nothing.
    expect(warmth.warm).toBe(false);
    warmth.cool();
    expect(track.enabled).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeRecorderContext.count).toBe(made);
    context.feed(0.2);
    expect(onListening).toHaveBeenCalledOnce();
    recording.stop();
    expect((await recording.audio).speech).toBe(true);
    // The take's done: the microphone is off and the context rests for the next one.
    expect(track.enabled).toBe(false);
    expect(context.state).toBe('suspended');
    expect(opened).toHaveLength(1);
  });

  it('only warms a live stream, never opening another for a muted one', async () => {
    const track = await held();
    track.muted = true;
    expect(warmRecorder()).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(opened).toHaveLength(1);
  });

  it('gives up after a minute unused, so a question left up does not keep the microphone on', async () => {
    const track = await held();
    const warmth = warmRecorder()!;
    await vi.advanceTimersByTimeAsync(WARM_MS);
    expect(warmth.warm).toBe(false);
    expect(track.enabled).toBe(false);
  });

  it("doesn't keep the context past the stream it was made under", async () => {
    await held();
    warmRecorder()!.cool();
    const first = FakeRecorderContext.last;
    // The stream closes (the app was in the background a while) and a new one opens.
    closeMicrophone();
    releaseMicrophone(await getMicrophone());
    warmRecorder();
    expect(FakeRecorderContext.last).not.toBe(first);
    expect(first.state).toBe('closed');
  });

  it("doesn't rest the context under a newer take when a cancelled one finishes late", async () => {
    await held();
    const first = record();
    const context = FakeRecorderContext.last;
    // The first take waits on the context starting (iOS can be slow to), and is cancelled meanwhile.
    let started: () => void = () => {};
    context.state = 'suspended';
    context.resume = () => new Promise<void>((resolve) => (started = () => resolve(void (context.state = 'running'))));
    first.cancel();
    await vi.advanceTimersByTimeAsync(0);
    // The next tap starts it and records on it.
    context.resume = async () => void (context.state = 'running');
    const second = record();
    await vi.advanceTimersByTimeAsync(0);
    started();
    await first.audio;
    expect(context.state).toBe('running');
    second.cancel();
    await second.audio;
  });

  it('lets the microphone and context go when the screen is left', async () => {
    const track = await held();
    warmRecorder();
    await vi.advanceTimersByTimeAsync(0);
    const context = FakeRecorderContext.last;
    cancelRecording();
    expect(track.enabled).toBe(false);
    expect(context.state).toBe('closed');
  });
});

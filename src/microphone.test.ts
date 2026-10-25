import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALLOW_KEPT_MS, askMicrophone, closeMicrophone, dropMicrophone, endMicrophoneAsk, getMicrophone, microphoneAllowed, microphoneOpen, microphoneOpensQuietly, releaseMicrophone, REOPEN_QUIETLY_MS } from './microphone';

function fakeStream() {
  const track = {
    enabled: true,
    readyState: 'live' as MediaStreamTrackState,
    stop() {
      this.readyState = 'ended';
    },
  };
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream };
}

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
});

afterEach(() => {
  endMicrophoneAsk();
  closeMicrophone();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared microphone', () => {
  it('shares the open stream while something is using it', async () => {
    const first = await getMicrophone();
    const second = await getMicrophone();
    expect(second).toBe(first);
    expect(opened).toHaveLength(1);
    releaseMicrophone(first);
    expect(opened[0].track.readyState).toBe('live');
    releaseMicrophone(second);
  });

  it('closes the stream as soon as nothing is using it, so iOS leaves its call mode', async () => {
    releaseMicrophone(await getMicrophone());
    expect(opened[0].track.readyState).toBe('ended');
    expect(microphoneOpen()).toBe(false);
    await getMicrophone();
    expect(opened).toHaveLength(2);
  });

  it('asks once when two callers open it together', async () => {
    const [a, b] = await Promise.all([getMicrophone(), getMicrophone()]);
    expect(a).toBe(b);
    expect(opened).toHaveLength(1);
    releaseMicrophone(a);
    // Still in use by the other caller.
    expect(opened[0].track.readyState).toBe('live');
  });

  it('opens a new stream if the old one ended while in use', async () => {
    const mic = await getMicrophone();
    opened[0].track.stop();
    const again = await getMicrophone();
    expect(again).not.toBe(mic);
    expect(opened).toHaveLength(2);
  });
});

describe('shared microphone after an interruption', () => {
  it('opens a new stream when the old one was muted by the system', async () => {
    const mic = await getMicrophone();
    (opened[0].track as { muted?: boolean }).muted = true;
    expect(await getMicrophone()).not.toBe(mic);
    expect(opened).toHaveLength(2);
  });
});

describe('dropping a stream that gave no sound', () => {
  it('closes it, so the next caller gets a fresh one', async () => {
    const dead = await getMicrophone();
    dropMicrophone(dead);
    expect(opened[0].track.readyState).toBe('ended');
    const fresh = await getMicrophone();
    expect(fresh).not.toBe(dead);
  });

  it('leaves it open while something else is using it', async () => {
    const [a] = await Promise.all([getMicrophone(), getMicrophone()]);
    dropMicrophone(a);
    expect(opened[0].track.readyState).toBe('live');
  });
});

describe('asking for the microphone as a screen opens', () => {
  it('asks, then closes it straight away, leaving the Allow for later takes', async () => {
    expect(await askMicrophone()).toBe(true);
    expect(opened[0].track.readyState).toBe('ended');
    expect(microphoneAllowed()).toBe(true);
  });

  it('says the screen was left, rather than refused, when the learner says no after leaving', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => Promise.reject(new DOMException('no', 'NotAllowedError')) } });
    const asking = askMicrophone();
    endMicrophoneAsk();
    expect(await asking).toBe(false);
  });

  it('still says refused while the screen that asked is showing', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => Promise.reject(new DOMException('no', 'NotAllowedError')) } });
    await expect(askMicrophone()).rejects.toThrow();
  });

  it("says the screen was left when it was left while the phone was asking", async () => {
    const asking = askMicrophone();
    endMicrophoneAsk();
    expect(await asking).toBe(false);
    expect(opened[0].track.readyState).toBe('ended');
  });
});

describe('whether the browser would ask', () => {
  it('counts the Allow as kept while a stream is open and for a while after, as WebKit does', async () => {
    releaseMicrophone(await getMicrophone());
    expect(microphoneAllowed()).toBe(true);
    closeMicrophone();
    vi.advanceTimersByTime(ALLOW_KEPT_MS - 1000);
    expect(microphoneAllowed()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(microphoneAllowed()).toBe(false);
  });
});

describe('whether the microphone opens without asking, from outside a tap', () => {
  it('does for a minute after the last stream closed, then only from a tap, as WebKit asks', async () => {
    // Long after any earlier test's stream closed.
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    expect(microphoneOpensQuietly(true)).toBe(false);
    releaseMicrophone(await getMicrophone());
    expect(microphoneOpensQuietly(false)).toBe(true);
    vi.advanceTimersByTime(REOPEN_QUIETLY_MS);
    expect(microphoneOpensQuietly(false)).toBe(false);
    expect(microphoneOpensQuietly(true)).toBe(true);
    // While one is open it always does.
    await getMicrophone();
    expect(microphoneOpensQuietly(false)).toBe(true);
  });
});

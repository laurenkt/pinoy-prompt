import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALLOW_KEPT_MS, closeMicrophone, dropMicrophone, endMicrophoneHold, getMicrophone, holdMicrophone, IDLE_CLOSE_MS, microphoneAllowed, releaseMicrophone } from './microphone';

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
  endMicrophoneHold();
  closeMicrophone();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared microphone', () => {
  it('reuses the open stream instead of asking again', async () => {
    const first = await getMicrophone();
    releaseMicrophone(first);
    expect(opened[0].track.enabled).toBe(false);
    expect(opened[0].track.readyState).toBe('live');
    const second = await getMicrophone();
    expect(second).toBe(first);
    expect(opened).toHaveLength(1);
    expect(opened[0].track.enabled).toBe(true);
  });

  it('asks once when two callers open it together', async () => {
    const [a, b] = await Promise.all([getMicrophone(), getMicrophone()]);
    expect(a).toBe(b);
    expect(opened).toHaveLength(1);
    releaseMicrophone(a);
    // Still in use by the other caller.
    expect(opened[0].track.enabled).toBe(true);
  });

  it('closes the stream after a while unused', async () => {
    releaseMicrophone(await getMicrophone());
    vi.advanceTimersByTime(IDLE_CLOSE_MS);
    expect(opened[0].track.readyState).toBe('ended');
    await getMicrophone();
    expect(opened).toHaveLength(2);
  });

  it("doesn't close while in use, and opens a new stream if the old one ended", async () => {
    const mic = await getMicrophone();
    vi.advanceTimersByTime(IDLE_CLOSE_MS * 2);
    expect(opened[0].track.readyState).toBe('live');
    opened[0].track.stop();
    releaseMicrophone(mic);
    const again = await getMicrophone();
    expect(again).not.toBe(mic);
    expect(opened).toHaveLength(2);
  });
});

describe('shared microphone after an interruption', () => {
  it('opens a new stream when the old one was muted by the system', async () => {
    const mic = await getMicrophone();
    releaseMicrophone(mic);
    (opened[0].track as { muted?: boolean }).muted = true;
    expect(await getMicrophone()).not.toBe(mic);
    expect(opened).toHaveLength(2);
  });
});

describe('dropping a stream that gave no sound', () => {
  it('closes it, so the next caller gets a fresh one, and keeps a screen\'s hold', async () => {
    await holdMicrophone();
    const dead = await getMicrophone();
    dropMicrophone(dead);
    expect(opened[0].track.readyState).toBe('ended');
    const fresh = await getMicrophone();
    expect(fresh).not.toBe(dead);
    releaseMicrophone(fresh);
    vi.advanceTimersByTime(IDLE_CLOSE_MS * 2);
    expect(opened[1].track.readyState).toBe('live');
  });

  it('leaves it open while something else is using it', async () => {
    const [a] = await Promise.all([getMicrophone(), getMicrophone()]);
    dropMicrophone(a);
    expect(opened[0].track.readyState).toBe('live');
  });
});

describe('holding the microphone for a screen', () => {
  it('keeps it open, switched off, until the hold ends, then closes it once idle', async () => {
    await holdMicrophone();
    expect(opened[0].track.enabled).toBe(false);
    vi.advanceTimersByTime(IDLE_CLOSE_MS * 5);
    expect(opened[0].track.readyState).toBe('live');
    const mic = await getMicrophone();
    expect(mic).toBe(opened[0].stream);
    releaseMicrophone(mic);
    vi.advanceTimersByTime(IDLE_CLOSE_MS * 5);
    expect(opened[0].track.readyState).toBe('live');
    endMicrophoneHold();
    vi.advanceTimersByTime(IDLE_CLOSE_MS);
    expect(opened[0].track.readyState).toBe('ended');
  });

  it('says the screen was left, rather than refused, when the learner says no after leaving', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => Promise.reject(new DOMException('no', 'NotAllowedError')) } });
    const asking = holdMicrophone();
    endMicrophoneHold();
    expect(await asking).toBe(false);
  });

  it('still says refused while the screen that asked is showing', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => Promise.reject(new DOMException('no', 'NotAllowedError')) } });
    await expect(holdMicrophone()).rejects.toThrow();
  });

  it("isn't taken up by a screen left while the phone was asking", async () => {
    const asking = holdMicrophone();
    endMicrophoneHold();
    await asking;
    vi.advanceTimersByTime(IDLE_CLOSE_MS);
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

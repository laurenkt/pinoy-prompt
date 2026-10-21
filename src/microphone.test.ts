import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeMicrophone, getMicrophone, IDLE_CLOSE_MS, releaseMicrophone } from './microphone';

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

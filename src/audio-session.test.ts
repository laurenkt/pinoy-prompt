// Card audio plays through the iPhone's silent switch, except while the microphone holds the session.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeMicrophone, getMicrophone, releaseMicrophone } from './microphone';
import { play } from './speech';

let audioSession: { type: string };

beforeEach(() => {
  audioSession = { type: 'auto' };
  const track = { enabled: true, readyState: 'live', stop() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  vi.stubGlobal('navigator', { audioSession, mediaDevices: { getUserMedia: async () => stream } });
});

afterEach(() => {
  closeMicrophone();
  vi.unstubAllGlobals();
});

describe('audio session', () => {
  it('asks for playback, which ignores the silent switch, when a card plays', () => {
    void play({ tl: 'Salamat' });
    expect(audioSession.type).toBe('playback');
  });

  it('leaves the session to the microphone while it is open, and hands it back after', async () => {
    const mic = await getMicrophone();
    expect(audioSession.type).toBe('play-and-record');
    void play({ tl: 'Salamat' });
    expect(audioSession.type).toBe('play-and-record');
    releaseMicrophone(mic);
    closeMicrophone();
    expect(audioSession.type).toBe('auto');
    void play({ tl: 'Salamat' });
    expect(audioSession.type).toBe('playback');
  });

  it('does nothing where the browser has no audio session', async () => {
    vi.stubGlobal('navigator', {});
    await expect(play({ tl: 'Salamat' })).resolves.toBeUndefined();
  });

  it('hands the session back if the microphone is refused', async () => {
    vi.stubGlobal('navigator', { audioSession, mediaDevices: { getUserMedia: async () => Promise.reject(new Error('denied')) } });
    await expect(getMicrophone()).rejects.toThrow('denied');
    expect(audioSession.type).toBe('auto');
  });

  it("doesn't touch the session when closing a microphone that wasn't open", () => {
    void play({ tl: 'Salamat' });
    closeMicrophone();
    expect(audioSession.type).toBe('playback');
  });
});

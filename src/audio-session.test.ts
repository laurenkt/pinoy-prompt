// Card audio plays through the iPhone's silent switch, except while the microphone holds the session.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeMicrophone, getMicrophone, releaseMicrophone } from './microphone';
import { play, stop } from './speech';

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

  it('plays a looping silent track with the voice, so the silent switch lets it through, and stops it after', () => {
    const tracks: { src: string; loop: boolean; paused: boolean }[] = [];
    vi.stubGlobal(
      'Audio',
      class {
        loop = false;
        paused = true;
        constructor(public src: string) {
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
    void play({ tl: 'Salamat' });
    const silence = tracks.find((t) => t.src.startsWith('data:audio/wav'));
    expect(silence).toMatchObject({ loop: true, paused: false });
    stop();
    expect(silence!.paused).toBe(true);
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

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

// speech.ts keeps one silent track for good, so every test sees the tracks made so far.
const tracks: { src: string; loop: boolean; paused: boolean }[] = [];
const silentTrack = () => tracks.find((t) => t.src.startsWith('data:audio/wav'));

function stubAudio() {
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
}

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

  it('does not leave the silent track looping where there is no voice to play', () => {
    stubAudio();
    void play({ tl: 'Salamat' });
    expect(silentTrack()).toMatchObject({ loop: true, paused: true });
  });

  it('plays a looping silent track with the voice, so the silent switch lets it through, and stops it after', async () => {
    stubAudio();
    const spoken: { onend: (() => void) | null }[] = [];
    const speechSynthesis = {
      getVoices: () => [{ lang: 'fil-PH', name: 'Test' }],
      speak: (u: { onend: (() => void) | null }) => spoken.push(u),
      cancel() {},
      addEventListener() {},
    };
    vi.stubGlobal('speechSynthesis', speechSynthesis);
    vi.stubGlobal('window', { speechSynthesis });
    vi.stubGlobal('SpeechSynthesisUtterance', class { onend = null; constructor(public text: string) {} });
    const playing = play({ tl: 'Salamat' });
    const silence = silentTrack();
    expect(silence).toMatchObject({ loop: true, paused: false });
    await playing;
    spoken[0].onend!();
    expect(silence!.paused).toBe(true);
    void play({ tl: 'Salamat' });
    expect(silence!.paused).toBe(false);
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

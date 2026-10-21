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
  stop(true);
  vi.useRealTimers();
  closeMicrophone();
  vi.unstubAllGlobals();
});

// speech.ts keeps one silent track for good, so every test sees the tracks made so far.
const tracks: { src: string; loop: boolean; paused: boolean; plays: number }[] = [];
const silentTrack = () => tracks.find((t) => t.src.startsWith('data:audio/wav'));

function stubAudio() {
  vi.stubGlobal(
    'Audio',
    class {
      loop = false;
      paused = true;
      plays = 0;
      constructor(public src: string) {
        tracks.push(this);
      }
      play() {
        this.paused = false;
        this.plays++;
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
      }
    },
  );
}

function stubSpeech() {
  const speech = {
    spoken: [] as { onend: (() => void) | null }[],
    speaking: false,
    pending: false,
    paused: false,
    cancels: 0,
    getVoices: () => [{ lang: 'fil-PH', name: 'Test' }],
    speak: (u: { onend: (() => void) | null }) => speech.spoken.push(u),
    cancel: () => speech.cancels++,
    addEventListener() {},
  };
  vi.stubGlobal('speechSynthesis', speech);
  vi.stubGlobal('window', { speechSynthesis: speech });
  vi.stubGlobal('SpeechSynthesisUtterance', class { onend = null; constructor(public text: string) {} });
  return speech;
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
    vi.useFakeTimers();
    stubAudio();
    const speech = stubSpeech();
    const playing = play({ tl: 'Salamat' });
    const silence = silentTrack();
    expect(silence).toMatchObject({ loop: true, paused: false });
    await playing;
    speech.spoken[0].onend!();
    // Kept running between words, as restarting it delays the next one on iOS.
    vi.advanceTimersByTime(5_000);
    expect(silence!.paused).toBe(false);
    const plays = silence!.plays;
    void play({ tl: 'Salamat' });
    stop();
    void play({ tl: 'Salamat' });
    expect(silence!.plays).toBe(plays);
    stop();
    vi.advanceTimersByTime(15_000);
    expect(silence!.paused).toBe(true);
    void play({ tl: 'Salamat' });
    expect(silence!.paused).toBe(false);
    stop(true);
    expect(silence!.paused).toBe(true);
  });

  it("doesn't pause the silent track mid-word, or keep it for good while cards keep changing", async () => {
    vi.useFakeTimers();
    stubAudio();
    const speech = stubSpeech();
    await play({ tl: 'Salamat' });
    speech.speaking = true;
    vi.advanceTimersByTime(20_000);
    expect(silentTrack()!.paused).toBe(false);
    speech.speaking = false;
    for (let i = 0; i < 4; i++) {
      stop();
      vi.advanceTimersByTime(5_000);
    }
    expect(silentTrack()!.paused).toBe(true);
  });

  it('only cancels speech when something is playing or stuck, as Safari can drop the next word', async () => {
    stubAudio();
    const speech = stubSpeech();
    await play({ tl: 'Salamat' });
    expect(speech.cancels).toBe(0);
    speech.speaking = true;
    stop();
    expect(speech.cancels).toBe(1);
    speech.speaking = false;
    speech.paused = true;
    stop();
    expect(speech.cancels).toBe(2);
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

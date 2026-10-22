// Card clips play through the iPhone's silent switch (iOS 17+), except while the microphone holds the session.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeMicrophone, getMicrophone, releaseMicrophone } from './microphone';
import { play, stop } from './speech';

let audioSession: { type: string };

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  audioSession = { type: 'auto' };
  const track = { enabled: true, readyState: 'live', stop() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  vi.stubGlobal('navigator', { audioSession, mediaDevices: { getUserMedia: async () => stream } });
});

afterEach(() => {
  stop();
  closeMicrophone();
  vi.unstubAllGlobals();
});

/** Just enough of a context for a clip to start, so play() takes the recorded path. */
class FakeContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  resume = () => Promise.resolve();
  suspend = () => Promise.resolve();
  close = () => Promise.resolve();
  decodeAudioData = () => Promise.resolve({ duration: 1 });
  createGain = () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect: (to: unknown) => to });
  createBufferSource = () => ({ playbackRate: { value: 1 }, connect: (to: unknown) => to, start() {}, stop() {} });
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
  it('asks for playback, which ignores the silent switch, when a clip plays', () => {
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

  it('only cancels speech when something is playing or stuck, as Safari can drop the next word', async () => {
    const speech = stubSpeech();
    vi.stubGlobal('AudioContext', undefined);
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

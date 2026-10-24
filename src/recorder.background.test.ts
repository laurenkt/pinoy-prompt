// @vitest-environment happy-dom
// A warmed microphone counts as in use, which would keep microphone.ts from closing the stream in the background.

import { expect, it, vi } from 'vitest';

it('closes a warmed microphone and its context when the app is hidden', async () => {
  const track = { enabled: true, muted: false, readyState: 'live', stop: () => (track.readyState = 'ended') };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => stream }, configurable: true });
  let context: { state: string } | null = null;
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running';
      destination = {};
      constructor() {
        context = this;
      }
      resume = async () => {};
      suspend = async () => void (this.state = 'suspended');
      close = async () => void (this.state = 'closed');
      createMediaStreamSource = () => ({ connect() {}, disconnect() {} });
      createGain = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
    },
  );
  const { getMicrophone, releaseMicrophone, microphoneOpen } = await import('./microphone');
  const { warmRecorder } = await import('./recorder');
  releaseMicrophone(await getMicrophone());
  const warmth = warmRecorder()!;
  await Promise.resolve();
  await Promise.resolve();
  expect(track.enabled).toBe(true);
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(warmth.warm).toBe(false);
  expect(track.readyState).toBe('ended');
  expect(microphoneOpen()).toBe(false);
  expect(context!.state).toBe('closed');
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  vi.unstubAllGlobals();
});

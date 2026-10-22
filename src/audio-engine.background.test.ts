// @vitest-environment happy-dom
// A running context holds the phone's audio, so it's let go when the app goes into the background.

import { expect, it, vi } from 'vitest';

it('suspends the shared context when the app is hidden', async () => {
  const suspended: string[] = [];
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running';
      resume = () => Promise.resolve();
      suspend = () => {
        this.state = 'suspended';
        suspended.push('ctx');
        return Promise.resolve();
      };
    },
  );
  const { audioContext } = await import('./audio-engine');
  const ctx = audioContext();
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(ctx.state).toBe('suspended');
  expect(suspended).toHaveLength(1);
  vi.unstubAllGlobals();
});

// @vitest-environment happy-dom
// iOS can hand back a silent context after the app was in the background, so it's closed then and made again on the next tap.

import { expect, it, vi } from 'vitest';

it('closes the shared context when the app is hidden, and makes a new one when it is next used', async () => {
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running';
      resume = () => Promise.resolve();
      close = () => {
        this.state = 'closed';
        return Promise.resolve();
      };
    },
  );
  const { audioContext } = await import('./audio-engine');
  const ctx = audioContext();
  expect(audioContext()).toBe(ctx);
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(ctx.state).toBe('closed');
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  const next = audioContext();
  expect(next).not.toBe(ctx);
  expect(next.state).toBe('running');
  vi.unstubAllGlobals();
});

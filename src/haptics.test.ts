// @vitest-environment happy-dom
// A haptic tick: navigator.vibrate where there is one, else (iOS 18+) a hidden
// switch toggled from script, and nothing anywhere else.

import { afterEach, expect, it, vi } from 'vitest';
import { hapticsSupported, hapticTick } from './haptics';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (HTMLInputElement.prototype as { switch?: boolean }).switch;
  document.body.replaceChildren();
});

it('vibrates briefly where the browser can', () => {
  const vibrate = vi.fn(() => true);
  vi.stubGlobal('navigator', { ...navigator, vibrate });
  expect(hapticsSupported()).toBe(true);
  hapticTick();
  expect(vibrate).toHaveBeenCalledWith(4);
  expect(document.querySelector('input')).toBeNull();
});

it('toggles one hidden switch that nothing can focus or hear, where switches give a tap', () => {
  vi.stubGlobal('navigator', { ...navigator, vibrate: undefined });
  Object.defineProperty(HTMLInputElement.prototype, 'switch', { value: false, configurable: true, writable: true });
  expect(hapticsSupported()).toBe(true);
  hapticTick();
  const input = document.querySelector<HTMLInputElement>('input[switch]')!;
  expect(input.checked).toBe(true);
  expect(input.tabIndex).toBe(-1);
  expect(input.closest('label')?.getAttribute('aria-hidden')).toBe('true');
  hapticTick();
  expect(input.checked).toBe(false);
  expect(document.querySelectorAll('input[switch]')).toHaveLength(1);
});

it('does nothing anywhere else', () => {
  vi.stubGlobal('navigator', { ...navigator, vibrate: undefined });
  expect(hapticsSupported()).toBe(false);
  hapticTick();
  expect(document.body.children).toHaveLength(0);
});

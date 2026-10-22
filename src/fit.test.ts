// @vitest-environment happy-dom
// The page stops bouncing only while the screen fits (style.css, "fits").

import { afterEach, expect, it, vi } from 'vitest';
import { watchFit } from './fit';

let resized: (() => void) | null = null;
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(callback: () => void) {
      resized = callback;
    }
    observe() {}
  },
);

afterEach(() => document.documentElement.classList.remove('fits'));

function page(scrollHeight: number) {
  const el = document.documentElement;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  return el;
}

it('marks a screen that fits, and unmarks it when it grows past the fold', () => {
  const root = document.createElement('div');
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
  watchFit(root, page(844));
  expect(document.documentElement.classList.contains('fits')).toBe(true);

  // A wrong answer brings its memory hook, and the screen runs long.
  page(1000);
  resized!();
  expect(document.documentElement.classList.contains('fits')).toBe(false);
});

it('checks again when the window changes size', () => {
  const root = document.createElement('div');
  const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
  watchFit(root, page(844));
  expect(document.documentElement.classList.contains('fits')).toBe(false);
  height.mockReturnValue(900);
  window.dispatchEvent(new Event('resize'));
  expect(document.documentElement.classList.contains('fits')).toBe(true);
});

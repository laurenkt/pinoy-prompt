// @vitest-environment happy-dom
// Audio buttons light up while their word plays, so a silent tap is visible.

import { afterEach, expect, it, vi } from 'vitest';

let playing = false;
vi.mock('./speech', () => ({ speaking: () => playing }));

const { audioButton } = await import('./ui');

afterEach(() => {
  playing = false;
  vi.useRealTimers();
  document.body.replaceChildren();
});

it('lights a tapped button until its word ends, and only the one tapped last', () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] });
  const first = document.body.appendChild(audioButton(() => (playing = true)));
  const second = document.body.appendChild(audioButton(() => (playing = true), 'Play slowly', 'slow'));
  first.click();
  expect(first.classList.contains('playing')).toBe(true);
  second.click();
  expect(first.classList.contains('playing')).toBe(false);
  expect(second.classList.contains('playing')).toBe(true);
  vi.advanceTimersByTime(1000);
  expect(second.classList.contains('playing')).toBe(true);
  playing = false;
  vi.advanceTimersByTime(100);
  expect(second.classList.contains('playing')).toBe(false);
});

it('stays lit a moment for a word that takes a while to start', () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] });
  const button = document.body.appendChild(audioButton(() => {}));
  button.click();
  vi.advanceTimersByTime(200);
  expect(button.classList.contains('playing')).toBe(true);
  vi.advanceTimersByTime(400);
  expect(button.classList.contains('playing')).toBe(false);
});

// about.html is plain HTML outside the app's code, so it names by hand the phrases it plays and the screenshots it
// shows. These checks stand in for an import: a phrase without a clip would play the built-in voice instead.

import { expect, it } from 'vitest';
import page from '../../about.html?raw';
import clips from '../clips.json';
import { CENTS_PER_MINUTE } from '../openai';

it('has a recorded clip for every phrase it plays', () => {
  const phrases = [...page.matchAll(/data-say="([^"]+)"/g)].map((m) => m[1]);
  expect(phrases.length).toBeGreaterThan(0);
  expect(phrases.filter((tl) => !(tl in clips))).toEqual([]);
});

it('shows only screenshots that exist', () => {
  const files = Object.keys(import.meta.glob('./shots/*'));
  const shots = [...page.matchAll(/src="\.\/src\/about\/(shots\/[^"]+)"/g)].map((m) => `./${m[1]}`);
  expect(shots.length).toBeGreaterThan(0);
  expect(shots.filter((path) => !files.includes(path))).toEqual([]);
});

it("shows the coach judging the same take of the app's voice that it plays", async () => {
  // about.ts plays the first voice's "Walang anuman"; scripts/screenshots.mjs plays it to the coach for coach-right.
  const harness = (await import('../../scripts/screenshots.mjs?raw')).default;
  expect(harness).toContain(`coachTake(page, 'Walang anuman', 'public/audio/${clips['Walang anuman'][0]}.mp3')`);
  expect(harness).toContain(`coachTake(page, 'Walang anuman', 'src/about/walang-anuman-english.mp3')`);
  const script = (await import('./about.ts?raw')).default;
  expect(script).toContain(`clipUrl({ tl: 'Walang anuman' }, false, 0)`);
});

it('states the price a call costs as the app does', () => {
  // Chat and walk and talk, each priced by hand on the page.
  const prices = [...page.matchAll(/(\d+)¢ a minute/g)].map((m) => Number(m[1]));
  expect(prices.length).toBeGreaterThan(1);
  expect(prices.filter((cents) => cents !== CENTS_PER_MINUTE)).toEqual([]);
});

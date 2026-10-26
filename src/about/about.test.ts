// about.html is plain HTML outside the app's code, so it names by hand the phrases it plays and the screenshots it
// shows. These checks stand in for an import: a phrase without a clip would play the built-in voice instead.

import { expect, it } from 'vitest';
import page from '../../about.html?raw';
import clips from '../clips.json';

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

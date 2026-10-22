// public/sw.js is plain JavaScript outside the build, so it can't import the
// names it shares with the app. These checks stand in for that import: renaming
// a cache or moving the model's loader would otherwise quietly break offline use.

import { expect, it } from 'vitest';
import worker from '../public/sw.js?raw';
import { AUDIO_CACHE } from './clip-cache';
import { CACHE as MODEL_CACHE } from './model-cache';

const sources = Object.keys(import.meta.glob('./**/*.ts'));

it('uses the cache names the app keeps clips and the speech model in', () => {
  expect(worker).toContain(`const AUDIO_CACHE = '${AUDIO_CACHE}';`);
  expect(worker).toContain(`const MODEL_CACHE = '${MODEL_CACHE}';`);
});

it("finds the speech model's runtime in the build manifest by a file that exists", () => {
  const entry = worker.match(/manifest\['(src\/[^']+)'\]/)?.[1];
  expect(sources).toContain(`./${entry!.slice('src/'.length)}`);
});

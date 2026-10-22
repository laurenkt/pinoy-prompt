// Getting speaking's code in before a deploy can take it away.

import { beforeEach, expect, it, vi } from 'vitest';

const loadRuntime = vi.fn(async () => {});
vi.mock('./phone-model', () => ({ loadRuntime }));

let kept: boolean;

beforeEach(() => {
  loadRuntime.mockClear();
  vi.stubGlobal('caches', {
    has: async () => kept,
    open: async () => ({ match: async () => (kept ? new Response('model') : undefined) }),
  });
});

it("loads speaking's code as the app starts once the model is on the device", async () => {
  kept = true;
  const { keepSpeakingReady } = await import('./model-cache');
  await keepSpeakingReady();
  expect(loadRuntime).toHaveBeenCalledOnce();
});

it("leaves it alone for a learner who hasn't downloaded the model", async () => {
  kept = false;
  const { keepSpeakingReady } = await import('./model-cache');
  await keepSpeakingReady();
  expect(loadRuntime).not.toHaveBeenCalled();
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listen, STOP_GRACE_MS } from './listen';
import { FakeRecognition } from './test/fake-recognition';

let uninstall: () => void;
let refuseMic: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  uninstall = FakeRecognition.install();
  // A permission prompt that the test answers later.
  const getUserMedia = () =>
    new Promise((_, reject) => {
      refuseMic = () => reject(new DOMException('refused', 'NotAllowedError'));
    });
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});

afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

it('resolves empty when cancelled during the permission prompt, even if the mic is then refused', async () => {
  const listening = listen();
  listening.cancel();
  refuseMic!();
  await expect(listening.result).resolves.toEqual([]);
  expect(FakeRecognition.instances).toHaveLength(0);
});

it('leaves no timers behind once a recogniser that ends promptly is stopped', async () => {
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
  const listening = listen();
  await vi.advanceTimersByTimeAsync(0);
  FakeRecognition.latest.audioStart();
  listening.stop();
  await expect(listening.result).resolves.toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(STOP_GRACE_MS);
});

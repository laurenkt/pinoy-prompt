// @vitest-environment happy-dom
// Settings' Test voice says how long the word took to start, for checking audio lag on a phone.

import { afterEach, expect, it, vi } from 'vitest';
import type { App } from '../app';
import { stop } from '../speech';
import { emptyProgress } from '../store';
import { settingsScreen } from './settings';

afterEach(() => {
  stop();
  vi.unstubAllGlobals();
});

function fakeApp(): App {
  const now = Date.now();
  const progress = emptyProgress(now);
  return { progress, now: () => now, commit: () => {}, replaceProgress: () => {}, navigate: () => {}, onKey: () => {}, onBack: () => {} };
}

it('says how long the test word took to start, once it has', async () => {
  const spoken: { onstart: (() => void) | null }[] = [];
  const speech = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: () => [{ lang: 'fil-PH', name: 'Test' }],
    speak: (u: { onstart: (() => void) | null }) => spoken.push(u),
    cancel() {},
    addEventListener() {},
  };
  vi.stubGlobal('speechSynthesis', speech);
  window.speechSynthesis = speech as unknown as SpeechSynthesis;
  vi.stubGlobal('SpeechSynthesisUtterance', class { onstart = null; constructor(public text: string) {} });
  const root = settingsScreen(fakeApp());
  const readout = root.querySelector<HTMLElement>('.voice-lag')!;
  expect(readout.hidden).toBe(true);
  [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Test voice'))!.click();
  await vi.waitFor(() => expect(spoken).toHaveLength(1));
  spoken[0].onstart!();
  await vi.waitFor(() => expect(readout.hidden).toBe(false));
  expect(readout.textContent).toMatch(/^The word started \d+\.\d\d seconds after your tap\.$/);
});

// @vitest-environment happy-dom
// Settings' Test voice says how long the word took to start, for checking audio lag on a phone,
// its Tap sounds switch turns the button tick off, and the saved key shows what OpenAI has cost.

import { afterEach, expect, it, vi } from 'vitest';
import { addSpend, setApiKey } from '../openai';
import { stop, tickOnPress } from '../speech';
import { FakeAudioContext, ticks } from '../test/fake-audio';
import { h } from '../ui';
import { settingsScreen } from './settings';
import { fakeApp } from '../test/screen';

afterEach(() => {
  stop();
  vi.unstubAllGlobals();
});

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

it('turns tap sounds off and on again, and keeps the choice', async () => {
  // Past the test word above, which would count as the press's own sound.
  await new Promise((r) => setTimeout(r, 300));
  vi.stubGlobal('AudioContext', FakeAudioContext);
  ticks.count = 0;
  const app = fakeApp();
  const root = settingsScreen(app);
  const other = h('button', null, 'Next');
  const area = h('div', null, root, other);
  document.body.replaceChildren(area);
  tickOnPress(area);
  const toggle = [...root.querySelectorAll('label')].find((l) => l.textContent === 'Tap sounds')!.querySelector('input')!;
  expect(toggle.checked).toBe(true);
  toggle.click();
  expect(app.progress.settings.tapSounds).toBe(false);
  ticks.count = 0;
  other.click();
  expect(ticks.count).toBe(0);
  toggle.click();
  ticks.count = 0;
  other.click();
  expect(ticks.count).toBe(1);
});

it('shows the estimated OpenAI spend beside the saved key', () => {
  localStorage.clear();
  setApiKey('sk-proj-abcdefghijklmnopqrstuvwxyz0123');
  addSpend(0.004, new Date(2026, 8, 30).getTime());
  addSpend(1.234);
  const root = settingsScreen(fakeApp());
  const stats = [...root.querySelectorAll('.key-spend .stat')].map((s) => s.textContent);
  expect(stats).toEqual(['$1.23this month', '$1.24all time']);
  expect(root.textContent).toContain('An estimate');
  expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Forget key')).toBe(true);
  localStorage.clear();
});

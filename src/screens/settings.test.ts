// @vitest-environment happy-dom
// Settings' Test voice says how long the word took to start, for checking audio lag on a phone,
// its Tap sounds switch turns the button tick off, the saved key shows what OpenAI has cost, and the icon badge asks for notifications.

import { afterEach, expect, it, vi } from 'vitest';
import { addSpend, setApiKey } from '../openai';
import { stop, tickOnPress } from '../speech';
import { FakeAudioContext, ticks } from '../test/fake-audio';
import { h } from '../ui';
import { settingsScreen } from './settings';
import { fakeApp, flush } from '../test/screen';

afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  delete (navigator as { setAppBadge?: unknown }).setAppBadge;
  delete (navigator as { clearAppBadge?: unknown }).clearAppBadge;
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

it('offers the icon badge only in an installed app that can show one', () => {
  expect(settingsScreen(fakeApp()).textContent).not.toContain('App icon');
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }));
  Object.assign(navigator, { setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) });
  expect(settingsScreen(fakeApp()).textContent).toContain('App icon');
});

it('asks for notifications when the icon badge is turned on, and stays off if refused', async () => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }));
  Object.assign(navigator, { setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) });
  let answer = 'denied';
  const requestPermission = vi.fn(async () => answer);
  vi.stubGlobal('Notification', { permission: 'default', requestPermission });
  const app = fakeApp();
  const root = settingsScreen(app);
  const toggle = () => [...root.querySelectorAll('label.toggle')].find((l) => l.textContent?.includes('on the icon'))!.querySelector('input')!;
  toggle().checked = true;
  toggle().dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledOnce());
  await flush();
  expect(app.progress.settings.iconBadge).toBe(false);
  expect(toggle().checked).toBe(false);

  answer = 'granted';
  toggle().checked = true;
  toggle().dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(app.progress.settings.iconBadge).toBe(true));
  expect(toggle().checked).toBe(true);
});

it("leaves the icon badge off when it's switched off while the phone is still asking", async () => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }));
  Object.assign(navigator, { setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) });
  let answer!: (value: string) => void;
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: () => new Promise((r) => (answer = r)) });
  const app = fakeApp();
  const root = settingsScreen(app);
  const toggle = [...root.querySelectorAll('label.toggle')].find((l) => l.textContent?.includes('on the icon'))!.querySelector('input')!;
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change'));
  toggle.checked = false;
  toggle.dispatchEvent(new Event('change'));
  answer('granted');
  await flush();
  expect(app.progress.settings.iconBadge).toBe(false);
});

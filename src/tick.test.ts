// @vitest-environment happy-dom
// A soft tick for a button press, unless the press already makes a sound or the microphone is in use.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMicrophone, releaseMicrophone } from './microphone';
import { chime, play, setMuted, stop, tickOnPress } from './speech';
import { FakeAudioContext, chimes, ticks } from './test/fake-audio';
import { h } from './ui';

let root: HTMLElement;
const press = (b: HTMLElement) => b.click();

/** Past the moment in which a word or chime counts as the press's own sound. */
const settle = () => new Promise((r) => setTimeout(r, 300));

beforeEach(async () => {
  await settle();
  chimes.count = 0;
  ticks.count = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  root = h('div');
  document.body.replaceChildren(root);
  tickOnPress(root);
});
afterEach(() => {
  // Silent mode stops a chime too.
  setMuted(true);
  setMuted(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the tap sound', () => {
  it('ticks for a button press, not for a press elsewhere', () => {
    const button = h('button', null, h('span', null, 'Next'));
    const text = h('p', null, 'Words');
    root.append(button, text);
    press(button.firstElementChild as HTMLElement);
    press(text);
    expect(ticks.count).toBe(1);
  });

  it("doesn't tick when the press plays a word or the chime", async () => {
    vi.useFakeTimers();
    const word = h('button', { onclick: () => void play({ tl: 'Salamat' }) }, 'Play');
    const right = h('button', { onclick: () => void chime() }, 'Right');
    root.append(word, right);
    press(word);
    stop();
    // Long enough for nothing to be playing, still the same press.
    vi.advanceTimersByTime(100);
    press(right);
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks.count).toBe(0);
    expect(chimes.count).toBe(1);
  });

  it("doesn't tick for a button that opens the microphone, or while it's in use", async () => {
    const track = { enabled: true, readyState: 'live', muted: false, stop() {} };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    const record = h('button', { 'data-no-tap': true }, 'Tap and speak');
    const other = h('button', null, 'Skip');
    root.append(record, other);
    press(record);
    const mic = await getMicrophone();
    press(other);
    expect(ticks.count).toBe(0);
    releaseMicrophone(mic);
    press(other);
    expect(ticks.count).toBe(1);
  });

  it('is silent in silent mode', () => {
    const button = h('button', null, 'Next');
    root.append(button);
    setMuted(true);
    press(button);
    expect(ticks.count).toBe(0);
  });
});

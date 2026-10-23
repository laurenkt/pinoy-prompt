// @vitest-environment happy-dom
// A soft tick for a button press, unless the press already makes a sound or the microphone is in use.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioContext } from './audio-engine';
import { getMicrophone, releaseMicrophone } from './microphone';
import { webAudioPlayer } from './player';
import { growthChart } from './screens/growth-chart';
import { DAY_MS } from './srs';
import { DETENT_GAP_MS, chime, detents, play, readyDetents, setMuted, setTapSounds, stop, tickOnPress } from './speech';
import { FakeAudioContext, chimes, recorded, ticks } from './test/fake-audio';
import { h } from './ui';

let root: HTMLElement;
const press = (b: HTMLElement) => b.click();

/** Past the moment in which a word or chime counts as the press's own sound. */
const settle = () => new Promise((r) => setTimeout(r, 300));

beforeEach(async () => {
  await settle();
  chimes.count = 0;
  ticks.count = 0;
  recorded.count = 0;
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

  it('thocks for a big chunky button, and clicks for a pill', async () => {
    const big = h('button', { class: 'btn primary big' }, 'Next');
    const chip = h('button', { class: 'chip' }, 'Listen');
    root.append(big, chip);
    press(big);
    await vi.waitFor(() => expect(recorded.count).toBe(1));
    expect(ticks.count).toBe(0);
    press(chip);
    expect(ticks.count).toBe(1);
  });

  it('ticks for a section opening, a link, a checkbox and its label, once each', () => {
    const section = h('details', null, h('summary', null, h('span', null, 'Greetings')), h('p', null, 'Kumusta'));
    const link = h('a', { href: '#' }, 'platform.openai.com');
    const toggle = h('label', null, h('input', { type: 'checkbox' }), h('span', null, 'Tap sounds'));
    root.append(section, link, toggle);
    press(section.querySelector('span')!);
    press(link);
    press(toggle.querySelector('span')!);
    expect(ticks.count).toBe(3);
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

  it("doesn't tick when the press plays a sound on the results screen", () => {
    const player = webAudioPlayer();
    const yours = h('button', { onclick: () => player.playSlice(new Float32Array(4800), 48000, 0, 0.1) }, '▶ Yours');
    const target = h('button', { onclick: () => player.playUrl('/audio/a.mp3') }, '▶ Target');
    root.append(yours, target);
    press(yours);
    player.stop();
    press(target);
    player.stop();
    expect(ticks.count).toBe(0);
  });

  it('taps for a button that starts a call, before the call opens the microphone', async () => {
    const track = { enabled: true, readyState: 'live', muted: false, stop() {} };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    let mic: Promise<MediaStream> | null = null;
    const chat = h('button', { class: 'hub-btn big', 'data-tap': 'before', onclick: () => (mic = getMicrophone()) }, 'Chat');
    root.append(chat);
    press(chat);
    releaseMicrophone(await mic!);
    await vi.waitFor(() => expect(recorded.count).toBe(1));
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

describe('ticks for scrubbing across the chart', () => {
  /** A scrub's steps, each a gap apart. */
  async function scrub(step: (s: string | null) => void, steps: (string | null)[]): Promise<void> {
    for (const s of steps) {
      step(s);
      await new Promise((r) => setTimeout(r, DETENT_GAP_MS + 5));
    }
  }

  it('ticks, and taps on the phone where it can, at each new step but not where the drag starts', async () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const step = detents();
    // The context is running, as it is once the app has made any sound.
    tickOnPress(root);
    const button = h('button', null, 'Next');
    root.append(button);
    press(button);
    ticks.count = 0;
    await scrub(step, ['day 3', 'day 3', 'day 4', 'day 5', 'day 4', null, 'day 9']);
    expect(ticks.count).toBe(3);
    expect(vibrate).toHaveBeenCalledTimes(3);
  });

  it("stays a ratchet, not a buzz, when the finger moves fast", () => {
    const step = detents();
    for (const s of ['day 1', 'day 2', 'day 3', 'day 4', 'day 5']) step(s);
    expect(ticks.count).toBeLessThanOrEqual(1);
  });

  it('is off with Tap sounds, and silent in silent mode', async () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    setTapSounds(false);
    await scrub(detents(), ['day 1', 'day 2']);
    setTapSounds(true);
    expect(vibrate).not.toHaveBeenCalled();
    setMuted(true);
    await scrub(detents(), ['day 1', 'day 2']);
    expect(ticks.count).toBe(0);
    // Silent mode is about sound; the tap on the phone stays.
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('gets audio going as a scrub begins, so its steps tick', async () => {
    // Asleep after a while idle, or never started: only a touch may start it.
    const ctx = audioContext() as unknown as { state: string; resume: () => Promise<void> };
    ctx.state = 'suspended';
    ctx.resume = async () => void (ctx.state = 'running');
    readyDetents();
    await scrub(detents(), ['day 1', 'day 2']);
    expect(ticks.count).toBe(1);
  });

  it('clicks when the chart is tapped, both to look and to put it back on today', () => {
    const now = Date.now();
    const chart = growthChart(
      { since: now - 2 * DAY_MS, times: [now - DAY_MS, now], counts: { new: [1, 1], days: [0, 0], weeks: [0, 0], long: [0, 0] } },
      { new: h('span'), days: h('span'), weeks: h('span'), long: h('span') },
    );
    const frame = chart.querySelector<HTMLElement>('.growth-frame')!;
    frame.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;
    for (let i = 0; i < 2; i++) {
      frame.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, pointerType: 'touch' }));
      frame.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, pointerType: 'touch' }));
    }
    expect(ticks.count).toBe(2);
  });

  it("leaves audio alone for a touch on the chart that scrolls the page", () => {
    const now = Date.now();
    const chart = growthChart(
      { since: now - 2 * DAY_MS, times: [now - DAY_MS, now], counts: { new: [1, 1], days: [0, 0], weeks: [0, 0], long: [0, 0] } },
      { new: h('span'), days: h('span'), weeks: h('span'), long: h('span') },
    );
    const frame = chart.querySelector<HTMLElement>('.growth-frame')!;
    frame.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;
    const ctx = audioContext() as unknown as { state: string };
    ctx.state = 'suspended';
    const resume = vi.spyOn(ctx as unknown as AudioContext, 'resume');
    frame.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 50, pointerType: 'touch' }));
    frame.dispatchEvent(new PointerEvent('pointermove', { clientX: 102, clientY: 90, pointerType: 'touch' }));
    frame.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, clientY: 130, pointerType: 'touch' }));
    ctx.state = 'running';
    expect(resume).not.toHaveBeenCalled();
    frame.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'touch' }));
  });

  it("doesn't start audio for a drag, as iOS would only play it late", async () => {
    const step = detents();
    // Suspended after a while idle; a drag can't resume it.
    const ctx = audioContext() as unknown as { state: string };
    ctx.state = 'suspended';
    const resume = vi.spyOn(ctx as unknown as AudioContext, 'resume');
    await scrub(step, ['day 1', 'day 2', 'day 3']);
    ctx.state = 'running';
    expect(ticks.count).toBe(0);
    expect(resume).not.toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom
// The sound-by-sound breakdown: what opens when each part is tapped, and holding the slider either side of its middle to hear a sound.

import { beforeEach, describe, expect, it } from 'vitest';
import { coach } from '../coach';
import { compare, toPhones } from '../phonetics';
import { FakePlayer, fakeRecognition } from '../test/fake-speech';
import { BUTTON_VOLUME, loudness, resultView, spanOf, type Attempt } from './speak-result';

function attempt(text: string, heard: string[]): Attempt {
  const comparison = compare(toPhones(text), heard);
  const r = fakeRecognition(heard);
  return { text, comparison, tips: coach(text, comparison), heard, timing: r.timing, features: r.features, samples: new Float32Array(16000) };
}

let player: FakePlayer;
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T & HTMLElement>(sel)!;
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

function show(a: Attempt) {
  const view = resultView(a, { player });
  document.body.replaceChildren(view.el);
  return view;
}

beforeEach(() => {
  player = new FakePlayer();
});

describe('spanOf', () => {
  it('splits the recording halfway between sounds, and never shorter than 120 ms', () => {
    const timing = [
      { start: 0.2, end: 0.24 },
      { start: 0.3, end: 0.34 },
      { start: 0.6, end: 0.64 },
    ];
    expect(spanOf(timing, 1, 1)).toEqual({ start: 0.27, end: 0.47 });
    const first = spanOf(timing, 0, 1);
    expect(first.end - first.start).toBeGreaterThanOrEqual(0.12 - 1e-9);
  });
});

/** The slider's rail as 240px wide from x 0, as happy-dom lays nothing out. */
function layOut() {
  const rail = q('.slider-rail');
  rail.getBoundingClientRect = () => ({ left: 0, width: 240, top: 0, height: 40, right: 240, bottom: 40, x: 0, y: 0, toJSON() {} });
}
const pointer = (el: Element, type: string, clientX = 0) => el.dispatchEvent(new PointerEvent(type, { clientX, pointerId: 1, bubbles: true }));

describe('the breakdown', () => {
  it('marks each sound on the recording with what was heard, and starts on the one to work on', () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    expect(all('.ribbon-mark .mark-target').map((e) => e.textContent)).toEqual(['ŋ', 'a', 'j', 'o', 'n']);
    expect(all('.ribbon-mark .mark-heard').map((e) => e.textContent)).toEqual(['n', 'a', 'j', 'o', 'n']);
    expect(q('.ribbon-mark.selected .mark-target').textContent).toBe('ŋ');
    expect(q('.ribbon-mark.selected').getAttribute('aria-pressed')).toBe('true');
    expect(q('.sound-detail').textContent).toContain('ng as in "sing"');
    expect(q('.sound-detail').textContent).toContain('You said');
    expect(q('.sound-detail').textContent).toContain('Aim for');
  });

  it('has no second row of sound buttons to keep in step with the recording', () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    expect(document.querySelector('.sound-strip, .pair, .tile')).toBeNull();
  });

  it("opens a sound when it's tapped, without playing the chopped-out piece of the recording", () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    all('.ribbon-mark')[3].click();
    expect(q('.ribbon-mark.selected .mark-target').textContent).toBe('o');
    expect(player.calls).toEqual([]);
  });

  it('opens the sound that was tapped', () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    all('.ribbon-mark')[1].click();
    expect(q('.ribbon-mark.selected .mark-target').textContent).toBe('a');
    expect(all('.ribbon-mark.selected')).toHaveLength(1);
    expect(q('.sound-detail .detail-letters').textContent).toBe('“a”');
  });

  it('holds what you said left of the middle and the target right of it, until let go', () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    const slider = q('.sound-slider');
    expect(slider.getAttribute('role')).toBe('slider');
    expect(all('.slider-cap').map((c) => c.textContent)).toEqual(['n', 'ŋ']);
    layOut();
    pointer(slider, 'pointerdown', 0);
    expect(player.calls.at(-1)).toEqual({ kind: 'hold', sound: 'n', volume: 1 });
    expect(slider.classList).toContain('holding');
    expect(slider.getAttribute('aria-valuetext')).toBe('What you said, n, 100% loud');
    pointer(slider, 'pointerup', 0);
    expect(player.held!.released).toBe(true);
    expect(slider.classList).not.toContain('holding');
    // Back to the middle.
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    pointer(slider, 'pointerdown', 240);
    expect(player.calls.at(-1)).toEqual({ kind: 'hold', sound: 'ŋ', volume: 1 });
    expect(slider.getAttribute('aria-valuetext')).toBe('What to aim for, ŋ, 100% loud');
  });

  it('plays nothing in the middle, quietly just out of it, and louder further out', () => {
    show(attempt('salamat', ['s', 'ɛ', 'l', 'a', 'm', 'a', 't']));
    const slider = q('.sound-slider');
    layOut();
    const holds = player.calls.length;
    pointer(slider, 'pointerdown', 120);
    expect(player.calls.length).toBe(holds);
    expect(slider.getAttribute('aria-valuetext')).toBe('Silent');
    pointer(slider, 'pointermove', 150);
    const quiet = player.calls.at(-1) as { sound: string; volume: number };
    expect(quiet.sound).toBe('a');
    expect(quiet.volume).toBeLessThan(0.2);
    pointer(slider, 'pointermove', 200);
    pointer(slider, 'pointermove', 236);
    const [, louder, loudest] = player.held!.volumes;
    expect(louder).toBeGreaterThan(quiet.volume);
    expect(loudest).toBe(1);
    // Over to the other side: what was said, from quiet again.
    pointer(slider, 'pointermove', 90);
    expect(player.held!.released).toBe(false);
    const other = player.calls.at(-1) as { sound: string; volume: number };
    expect(other.sound).toBe('ɛ');
    expect(other.volume).toBeLessThan(0.2);
    pointer(slider, 'pointerup', 90);
  });

  it('holds a sound silent in the middle rather than letting it go, so wavering there never restarts it', () => {
    show(attempt('salamat', ['s', 'ɛ', 'l', 'a', 'm', 'a', 't']));
    const slider = q('.sound-slider');
    layOut();
    pointer(slider, 'pointerdown', 200);
    const holds = player.calls.length;
    pointer(slider, 'pointermove', 120);
    expect(player.held!.released).toBe(false);
    expect(player.held!.volumes.at(-1)).toBe(0);
    expect(slider.getAttribute('aria-valuetext')).toBe('Silent');
    pointer(slider, 'pointermove', 150);
    expect(player.calls.length).toBe(holds);
    expect(player.held!.volumes.at(-1)).toBeGreaterThan(0);
    pointer(slider, 'pointermove', 120);
    // Lifting, not the slide, lets it go.
    pointer(slider, 'pointerup', 120);
    expect(player.held!.released).toBe(true);
  });

  it("makes the ends of the slider loudest and the middle silent", () => {
    expect(loudness(0)).toBe(1);
    expect(loudness(1)).toBe(1);
    expect(loudness(0.5)).toBe(0);
    expect(loudness(0.3)).toBeCloseTo(loudness(0.7));
    expect(loudness(0.3)).toBeLessThan(loudness(0.2));
  });

  it('pulses the mark on the map for the sound being played', () => {
    show(attempt('salamat', ['s', 'ɛ', 'l', 'a', 'm', 'a', 't']));
    const heard = q('.chart-heard');
    const target = q('.chart-target');
    layOut();
    pointer(q('.sound-slider'), 'pointerdown', 10);
    expect(heard.classList).toContain('speaking');
    expect(target.classList).not.toContain('speaking');
    pointer(q('.sound-slider'), 'pointermove', 230);
    expect(heard.classList).not.toContain('speaking');
    expect(target.classList).toContain('speaking');
    pointer(q('.sound-slider'), 'pointerup', 230);
    expect(target.classList).not.toContain('speaking');
  });

  it('steps along from the keyboard, playing each step and saying where it is, and holds while space is down', () => {
    show(attempt('salamat', ['s', 'ɛ', 'l', 'a', 'm', 'a', 't']));
    const slider = q('.sound-slider');
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const step = player.calls.at(-1) as { sound: string; volume: number };
    expect(step.sound).toBe('a');
    expect(step.volume).toBeLessThan(0.2);
    expect(player.held!.released).toBe(true);
    expect(slider.getAttribute('aria-valuetext')).toMatch(/^What to aim for, a, \d+% loud$/);
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(player.calls.at(-1)).toEqual({ kind: 'hold', sound: 'a', volume: 1 });
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(player.held!.released).toBe(false);
    slider.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    expect(player.held!.released).toBe(true);
  });

  it('holds with space from the silent middle, then plays where the arrows take it until space is let go', () => {
    show(attempt('salamat', ['s', 'ɛ', 'l', 'a', 'm', 'a', 't']));
    const slider = q('.sound-slider');
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect((player.calls.at(-1) as { sound: string }).sound).toBe('ɛ');
    expect(player.held!.released).toBe(false);
    expect(slider.classList).toContain('holding');
    slider.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    expect(player.held!.released).toBe(true);
  });

  it('lets go of a held sound when another sound is opened', () => {
    show(attempt('salamat', ['s', 'ɛ', 'l', 'a', 'm', 'a', 't']));
    layOut();
    pointer(q('.sound-slider'), 'pointerdown', 0);
    all('.ribbon-mark')[0].click();
    expect(player.held!.released).toBe(true);
  });

  it('has one sound to hold when it was spot on, with no slider', () => {
    show(attempt('po', ['p', 'u']));
    q<HTMLButtonElement>('.mark-good').click();
    expect(document.querySelector('.sound-slider')).toBeNull();
    const hold = q('.hold-btn');
    expect(hold.textContent).toContain('p');
    pointer(hold, 'pointerdown');
    expect(player.calls.at(-1)).toEqual({ kind: 'hold', sound: 'p', volume: BUTTON_VOLUME });
    pointer(hold, 'pointerup');
    expect(player.held!.released).toBe(true);
  });

  it('has one sound to hold when it counts as right though written differently, and no "You said"', () => {
    // ng before b is just as right said m.
    show(attempt('ang bata', ['a', 'm', 'b', 'a', 't', 'a']));
    all('.ribbon-mark')[1].click();
    expect(q('.sound-detail').textContent).toContain('Spot on');
    expect(document.querySelector('.sound-slider, .end-heard')).toBeNull();
    pointer(q('.hold-btn'), 'pointerdown');
    expect(player.calls.at(-1)).toEqual({ kind: 'hold', sound: 'ŋ', volume: BUTTON_VOLUME });
  });

  it('says to leave out an added sound, and holds what was said', () => {
    show(attempt('Salamat', ['s', 'a', 'l', 'a', 'm', 'a', 't', 'o']));
    expect(q('.end-target').textContent).toContain('leave it out');
    pointer(q('.hold-btn'), 'pointerdown');
    expect(player.calls.at(-1)).toEqual({ kind: 'hold', sound: 'o', volume: BUTTON_VOLUME });
  });

  it("holds just the target when what was heard can't be made", () => {
    show(attempt('po', ['ǃ', 'o']));
    q<HTMLButtonElement>('.ribbon-mark').click();
    expect(document.querySelector('.sound-slider')).toBeNull();
    pointer(q('.hold-btn'), 'pointerdown');
    expect(player.calls.at(-1)).toEqual({ kind: 'hold', sound: 'p', volume: BUTTON_VOLUME });
  });

  it('draws vowels on the vowel map and consonants on the consonant map', () => {
    show(attempt('po', ['p', 'u']));
    q<HTMLButtonElement>('.mark-close').click();
    expect(q('.sound-chart').classList).toContain('chart-vowel');
    q<HTMLButtonElement>('.mark-good').click();
    expect(q('.sound-chart').classList).toContain('chart-consonant');
  });

  it('opens on an added sound that counts, saying to leave it out once, over the slider', () => {
    show(attempt('Salamat', ['s', 'a', 'l', 'a', 'm', 'a', 't', 'o']));
    expect(q('.ribbon-mark.selected').classList).toContain('mark-extra');
    expect(q('.mark-extra .mark-target').textContent).toBe('+');
    expect(q('.sound-detail').textContent).toMatch(/Added/);
    expect(q('.end-target').textContent).toContain('leave it out');
    expect(q('.sound-detail .detail-tip')).toBeNull();
    // The t itself was spot on, so it carries no correction.
    all('.ribbon-mark')[6].click();
    expect(q('.sound-detail').textContent).toContain('Spot on');
    expect(q('.sound-detail .detail-tip')).toBeNull();
  });

  it("leaves out a tip that only repeats what was said and what to aim for, but keeps one on how to say it", () => {
    show(attempt('salamat', ['s', 'ɛ', 'l', 'a', 'm', 'a', 't']));
    expect(q('.sound-detail').textContent).toContain('e as in "bed"');
    expect(q('.sound-detail .detail-tip')).toBeNull();
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    expect(q('.sound-detail .detail-tip').textContent).toContain('back of your tongue');
  });

  it("doesn't give one sound the advice meant for another spelled the same", () => {
    // The first a said as e (only says what was heard), the last as "uh" (advice on opening up).
    show(attempt('salamat', ['s', 'ɛ', 'l', 'a', 'm', 'ə', 't']));
    expect(q('.ribbon-mark.selected .mark-heard').textContent).toBe('ɛ');
    expect(q('.sound-detail .detail-tip')).toBeNull();
    all('.ribbon-mark')[5].click();
    expect(q('.sound-detail .detail-tip').textContent).toContain('Open your mouth wide');
  });

  it('only shows a tip on the sound that needs it, not on every sound spelled the same', () => {
    const a = attempt('Salamat', ['s', 'ɐ', 'l', 'a', 'm', 'a', 't']);
    show(a);
    expect(q('.sound-detail .detail-tip')).toBeTruthy();
    all('.ribbon-mark')[3].click();
    expect(q('.sound-detail').textContent).toContain('Spot on');
    expect(q('.sound-detail .detail-tip')).toBeNull();
  });

  it('puts missing sounds in a row side by side instead of on top of each other', () => {
    show(attempt('tatlo', ['t', 'a', 'o']));
    const gaps = all('.mark-gap');
    expect(gaps.map((g) => g.querySelector('.mark-target')!.textContent)).toEqual(['t', 'l']);
    expect(gaps.map((g) => g.style.getPropertyValue('--shift'))).toEqual(['-26px', '0px']);
  });

  it('marks a missing sound where it should have been, and holds the target there', () => {
    show(attempt('tatlo', ['t', 'a', 'l', 'o']));
    const gap = q<HTMLButtonElement>('.mark-missing.mark-gap');
    expect(gap.querySelector('.mark-target')!.textContent).toBe('t');
    expect(gap.querySelector('.mark-heard')!.textContent).toBe('–');
    gap.click();
    expect(q('.sound-detail').textContent).toContain('nothing here');
    expect(document.querySelector('.sound-slider')).toBeNull();
    pointer(q('.hold-btn'), 'pointerdown');
    expect(player.calls.at(-1)).toEqual({ kind: 'hold', sound: 't', volume: BUTTON_VOLUME });
  });

  it('plays the whole recording and stops audio when it goes away', () => {
    const view = show(attempt('Salamat', ['s', 'a', 'l', 'a', 'm', 'a', 't']));
    view.playWhole();
    expect(player.calls.at(-1)).toMatchObject({ kind: 'slice' });
    q<HTMLButtonElement>('.ribbon-mark').click();
    expect(player.calls.length).toBe(1);
    view.dispose();
    expect(player.stopped).toBeGreaterThan(0);
  });

});

// @vitest-environment happy-dom
// The sound-by-sound breakdown: what plays when each part is tapped.

import { beforeEach, describe, expect, it } from 'vitest';
import { coach } from '../coach';
import { compare, toPhones } from '../phonetics';
import { FakePlayer, fakeRecognition } from '../test/fake-speech';
import { referenceFor, resultView, spanOf, type Attempt } from './speak-result';
import { flush } from '../test/screen';

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

describe('the breakdown', () => {
  const button = (name: string) => all('.detail-actions button').find((b) => b.textContent === name)!;

  it('marks each sound on the recording with what was heard, and starts on the one to work on', () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    expect(all('.ribbon-mark .mark-target').map((e) => e.textContent)).toEqual(['ŋ', 'a', 'j', 'o', 'n']);
    expect(all('.ribbon-mark .mark-heard').map((e) => e.textContent)).toEqual(['n', 'a', 'j', 'o', 'n']);
    expect(q('.ribbon-mark.selected .mark-target').textContent).toBe('ŋ');
    expect(q('.ribbon-mark.selected').getAttribute('aria-pressed')).toBe('true');
    expect(q('.sound-detail').textContent).toContain('ng as in "sing"');
    expect(q('.sound-detail').textContent).toContain('You said');
  });

  it('has no second row of sound buttons to keep in step with the recording', () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    expect(document.querySelector('.sound-strip, .pair, .tile')).toBeNull();
  });

  it('plays your part when a sound is tapped, and the native speaker for the target', () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    q<HTMLButtonElement>('.mark-off').click();
    expect(player.calls.at(-1)).toMatchObject({ kind: 'slice' });
    const slice = player.calls.at(-1) as { from: number; to: number };
    // The first sound was heard at 0.2–0.24 s.
    expect(slice.from).toBeLessThanOrEqual(0.2);
    expect(slice.to).toBeGreaterThanOrEqual(0.24);
    button('▶ Target').click();
    expect(player.calls.at(-1)).toEqual({ kind: 'url', url: referenceFor('ŋ')!.url });
    button('▶ Yours').click();
    expect(player.calls.at(-1)).toEqual(slice);
  });

  it('opens the sound that was tapped', () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    all('.ribbon-mark')[1].click();
    expect(q('.ribbon-mark.selected .mark-target').textContent).toBe('a');
    expect(all('.ribbon-mark.selected')).toHaveLength(1);
    expect(q('.sound-detail .detail-letters').textContent).toBe('“a”');
  });

  it('plays yours then the target, moving your mark onto the target', async () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    button('▶ Both').click();
    await flush();
    await flush();
    expect(player.calls.map((c) => c.kind)).toEqual(['slice', 'url']);
    expect(q('.chart-heard').classList).toContain('arrived');
  });

  it('stops the sequence when something else is played during it', async () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    button('▶ Both').click();
    q<HTMLButtonElement>('.mark-off').click();
    await flush();
    await flush();
    expect(player.calls.map((c) => c.kind)).toEqual(['slice', 'slice']);
  });

  it('draws vowels on the vowel map and consonants on the consonant map', () => {
    show(attempt('po', ['p', 'u']));
    q<HTMLButtonElement>('.mark-close').click();
    expect(q('.sound-chart').classList).toContain('chart-vowel');
    q<HTMLButtonElement>('.mark-good').click();
    expect(q('.sound-chart').classList).toContain('chart-consonant');
  });

  it('opens on an added sound that counts, with the tip the coach gave for it', () => {
    const a = attempt('Salamat', ['s', 'a', 'l', 'a', 'm', 'a', 't', 'o']);
    const tip = a.tips.find((t) => t.letters.toLowerCase() === 't')!;
    expect(tip).toBeTruthy();
    show(a);
    expect(q('.ribbon-mark.selected').classList).toContain('mark-extra');
    expect(q('.mark-extra .mark-target').textContent).toBe('+');
    expect(q('.sound-detail').textContent).toMatch(/Added/);
    expect(q('.sound-detail').textContent).toContain(tip.text);
    // The t itself was spot on, so it carries no correction.
    all('.ribbon-mark')[6].click();
    expect(q('.sound-detail').textContent).toContain('Spot on');
    expect(q('.sound-detail .detail-tip')).toBeNull();
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

  it('marks a missing sound where it should have been, and plays that part', () => {
    show(attempt('tatlo', ['t', 'a', 'l', 'o']));
    const gap = q<HTMLButtonElement>('.mark-missing.mark-gap');
    expect(gap.querySelector('.mark-target')!.textContent).toBe('t');
    expect(gap.querySelector('.mark-heard')!.textContent).toBe('–');
    gap.click();
    expect(q('.sound-detail').textContent).toContain('nothing here');
    expect(player.calls.at(-1)).toMatchObject({ kind: 'slice' });
  });

  it('plays the whole recording and stops audio when it goes away', () => {
    const view = show(attempt('Salamat', ['s', 'a', 'l', 'a', 'm', 'a', 't']));
    view.playWhole();
    expect(player.calls.at(-1)).toMatchObject({ kind: 'slice' });
    q<HTMLButtonElement>('.ribbon-mark').click();
    expect(player.calls.length).toBe(2);
    view.dispose();
    expect(player.stopped).toBeGreaterThan(0);
  });

  it('has a native reference for every sound the deck uses, except the glottal catch', async () => {
    const { ALL_CARDS } = await import('../deck');
    const needed = new Set(ALL_CARDS.flatMap((c) => toPhones(c.tl).filter((p) => !p.optional).map((p) => p.ipa)));
    const missing = [...needed].filter((ipa) => !referenceFor(ipa));
    expect(missing).toEqual([]);
  });
});

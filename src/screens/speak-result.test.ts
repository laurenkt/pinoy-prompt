// @vitest-environment happy-dom
// The sound-by-sound breakdown: what plays when each part is tapped.

import { beforeEach, describe, expect, it } from 'vitest';
import { coach } from '../coach';
import { compare, toPhones } from '../phonetics';
import { FakePlayer, fakeRecognition } from '../test/fake-speech';
import { referenceFor, resultView, spanOf, type Attempt } from './speak-result';

function attempt(text: string, heard: string[]): Attempt {
  const comparison = compare(toPhones(text), heard);
  const r = fakeRecognition(heard);
  return { text, comparison, tips: coach(text, comparison), heard, timing: r.timing, features: r.features, samples: new Float32Array(16000) };
}

let player: FakePlayer;
const say = () => {};
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T & HTMLElement>(sel)!;
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const flush = () => new Promise((r) => setTimeout(r, 0));

function show(a: Attempt) {
  const view = resultView(a, { player, say });
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
  it('pairs each sound with what was heard, and starts on the one to work on', () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    expect(all('.pair .tile-target .tile-ipa').map((e) => e.textContent)).toEqual(['ŋ', 'a', 'j', 'o', 'n']);
    expect(all('.pair .tile-heard').map((e) => e.textContent)).toEqual(['n', 'a', 'j', 'o', 'n']);
    expect(q('.pair.selected .tile-target .tile-ipa').textContent).toBe('ŋ');
    expect(q('.sound-detail').textContent).toContain('ng as in "sing"');
    expect(q('.sound-detail').textContent).toContain('You said');
  });

  it('plays a native speaker for the target and your own recording for what you said', () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    q<HTMLButtonElement>('.pair-off .tile-target').click();
    expect(player.calls.at(-1)).toEqual({ kind: 'url', url: referenceFor('ŋ')!.url });
    q<HTMLButtonElement>('.pair-off .tile-heard').click();
    expect(player.calls.at(-1)).toMatchObject({ kind: 'slice' });
    const slice = player.calls.at(-1) as { from: number; to: number };
    // The first sound was heard at 0.2–0.24 s.
    expect(slice.from).toBeLessThanOrEqual(0.2);
    expect(slice.to).toBeGreaterThanOrEqual(0.24);
  });

  it('plays yours then the target, moving your mark onto the target', async () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    const both = all('.detail-actions button').find((b) => b.textContent === '▶ Yours, then the target')!;
    both.click();
    await flush();
    await flush();
    expect(player.calls.map((c) => c.kind)).toEqual(['slice', 'url']);
    expect(q('.chart-heard').classList).toContain('arrived');
  });

  it('stops the sequence when something else is played during it', async () => {
    show(attempt('ngayon', ['n', 'a', 'j', 'o', 'n']));
    const both = all('.detail-actions button').find((b) => b.textContent === '▶ Yours, then the target')!;
    both.click();
    q<HTMLButtonElement>('.pair-off .tile-heard').click();
    await flush();
    await flush();
    expect(player.calls.map((c) => c.kind)).toEqual(['slice', 'slice']);
  });

  it('draws vowels on the vowel map and consonants on the consonant map', () => {
    show(attempt('po', ['p', 'u']));
    q<HTMLButtonElement>('.pair-close .tile-heard').click();
    expect(q('.sound-chart').classList).toContain('chart-vowel');
    q<HTMLButtonElement>('.pair-good .tile-target').click();
    expect(q('.sound-chart').classList).toContain('chart-consonant');
  });

  it('shows a missing sound and an added one', () => {
    show(attempt('Salamat', ['s', 'a', 'l', 'a', 'm', 'a', 'p', 'o']));
    expect(all('.pair-extra').length).toBeGreaterThan(0);
    q<HTMLButtonElement>('.pair-extra .tile-heard').click();
    expect(q('.sound-detail').textContent).toMatch(/Added|extra/i);
    show(attempt('tatlo', ['t', 'a', 'l', 'o']));
    expect(q('.pair-missing .tile-missing')).toBeTruthy();
    q<HTMLButtonElement>('.pair-missing .tile-missing').click();
    expect(player.calls.at(-1)).toMatchObject({ kind: 'slice' });
  });

  it('plays the whole recording and stops audio when it goes away', () => {
    const view = show(attempt('Salamat', ['s', 'a', 'l', 'a', 'm', 'a', 't']));
    all('.ribbon-actions button')[0].click();
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

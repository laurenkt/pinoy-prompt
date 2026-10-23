// Single sounds made in code: which can be made, how a pair is played, and blending between them.

import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from './deck';
import { blend, canSynthesize, modeOf, specFor, syllableLength } from './phone-synth';
import { toPhones } from './phonetics';

describe('single sounds', () => {
  it('can make every sound the deck asks for', () => {
    const needed = new Set(ALL_CARDS.flatMap((c) => toPhones(c.tl).map((p) => p.ipa)));
    expect([...needed].filter((ipa) => !canSynthesize(ipa))).toEqual([]);
  });

  it('can make the sounds the recogniser commonly hears instead', () => {
    for (const ipa of ['ɪ', 'ʊ', 'ə', 'æ', 'ʌ', 'e', 'ɔ', 'oʊ', 'eɪ', 'pʰ', 'tʰ', 'g', 'ɡ', 'z', 'v', 'f', 'θ', 'ɹ', 'ɫ', 'q', 'x', 'aː']) {
      expect(canSynthesize(ipa), ipa).toBe(true);
    }
  });

  it("can't make a sound the mouth charts don't place", () => {
    expect(canSynthesize('ǃ')).toBe(false);
    expect(specFor('ǃ')).toBeNull();
  });

  it('holds two vowels, or two hissing sounds; anything else repeats with "a"', () => {
    expect(modeOf('ɛ', 'a')).toBe('vowel');
    expect(modeOf('s', 'ʃ')).toBe('hiss');
    expect(modeOf('n', 'ŋ')).toBe('syllable');
    expect(modeOf('h', 'h')).toBe('syllable');
    expect(modeOf('s', 't')).toBe('syllable');
    expect(modeOf('a', 'ŋ')).toBe('syllable');
  });

  it('places vowels as the chart does: ee high and front, ah low, oo back', () => {
    const [i, a, u] = ['i', 'a', 'u'].map((v) => specFor(v)!.vowel);
    // F1 rises as the tongue drops; F2 falls as it moves back.
    expect(a[0]).toBeGreaterThan(i[0] + 400);
    expect(i[1]).toBeGreaterThan(a[1]);
    expect(a[1]).toBeGreaterThan(u[1]);
  });

  it('tells apart sounds made in the same place by how they are made', () => {
    const [t, d, n, s] = ['t', 'd', 'n', 's'].map((c) => specFor(c)!);
    expect(t.voiceBar).toBe(0);
    expect(d.voiceBar).toBe(1);
    expect(n.murmur).toBe(1);
    expect(s.hiss).toBeGreaterThan(0);
    // ng is made further back than n.
    expect(specFor('ŋ')!.hum).not.toBe(n.hum);
  });

  it('blends every setting between two sounds, and is each sound at either end', () => {
    const e = specFor('ɛ')!;
    const a = specFor('a')!;
    expect(blend(e, a, 0)).toEqual(e);
    expect(blend(e, a, 1)).toEqual(a);
    const half = blend(e, a, 0.5);
    expect(half.vowel[0]).toBeCloseTo((e.vowel[0] + a.vowel[0]) / 2);
    expect(blend(e, a, 2)).toEqual(a);
  });

  it('repeats a syllable a couple of times a second', () => {
    for (const c of ['p', 'm', 's', 'h', 'l', 'w', 'ɾ', 'tʃ']) {
      const length = syllableLength(specFor(c)!);
      expect(length, c).toBeGreaterThan(0.25);
      expect(length, c).toBeLessThan(0.5);
    }
  });
});

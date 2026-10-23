// Single sounds made in code: which can be made, and how each is played.

import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from './deck';
import { canSynthesize, modeOf, specFor, syllableLength } from './phone-synth';
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

  it('holds a vowel or a hissing sound; anything else repeats with "a"', () => {
    expect(modeOf('ɛ')).toBe('vowel');
    expect(modeOf('s')).toBe('hiss');
    expect(modeOf('ʃ')).toBe('hiss');
    expect(modeOf('n')).toBe('syllable');
    expect(modeOf('h')).toBe('syllable');
    expect(modeOf('t')).toBe('syllable');
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

  it('repeats a syllable a couple of times a second', () => {
    for (const c of ['p', 'm', 's', 'h', 'l', 'w', 'ɾ', 'tʃ']) {
      const length = syllableLength(specFor(c)!);
      expect(length, c).toBeGreaterThan(0.25);
      expect(length, c).toBeLessThan(0.5);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { coach } from './coach';
import { ALL_CARDS } from './deck';
import { compare, soundDistance, toPhones } from './phonetics';

/** The required sounds, joined, for compact assertions. */
const sounds = (text: string) =>
  toPhones(text)
    .filter((p) => !p.optional)
    .map((p) => p.ipa)
    .join(' ');

describe('toPhones', () => {
  it('reads Tagalog spelling', () => {
    expect(sounds('Salamat')).toBe('s a l a m a t');
    expect(sounds('Kumusta?')).toBe('k u m u s t a');
    expect(sounds('Sige')).toBe('s i ɡ ɛ');
    expect(sounds('Masarap!')).toBe('m a s a ɾ a p');
  });

  it('treats "ng" as one sound, and "mga" as "maŋa"', () => {
    expect(sounds('Magandang gabi')).toBe('m a ɡ a n d a ŋ ɡ a b i');
    expect(sounds('ngayon')).toBe('ŋ a j o n');
    expect(sounds('Mga Numero')).toBe('m a ŋ a n u m ɛ ɾ o');
    expect(sounds('Ingles')).toBe('i ŋ ɡ l ɛ s');
  });

  it('says "sy" and "siy" before a vowel as "sh"', () => {
    expect(sounds('Pasensya na')).toBe('p a s ɛ n ʃ a n a');
    expect(sounds('siyam')).toBe('ʃ a m');
  });

  it('puts an optional catch before word-initial vowels and between vowels', () => {
    const oo = toPhones('Oo');
    expect(oo.map((p) => p.ipa)).toEqual(['ʔ', 'o', 'ʔ', 'o']);
    expect(oo.filter((p) => p.optional)).toHaveLength(2);
    expect(sounds('Paalam')).toBe('p a a l a m');
  });

  it('maps every sound back to its letters', () => {
    const text = 'Magandang umaga';
    const ng = toPhones(text).find((p) => p.ipa === 'ŋ')!;
    expect(text.slice(ng.from, ng.to)).toBe('ng');
  });

  it('covers every card in the deck', () => {
    for (const card of ALL_CARDS) {
      const phones = toPhones(card.tl);
      expect(phones.length, card.id).toBeGreaterThan(0);
      expect(phones.every((p) => p.ipa), card.id).toBe(true);
    }
  });
});

describe('soundDistance', () => {
  it('treats free variants as the same and o/u as a small slip', () => {
    expect(soundDistance('ɾ', 'r')).toBe(0);
    expect(soundDistance('ɛ', 'e')).toBe(0);
    expect(soundDistance('o', 'u')).toBeLessThan(0.4);
  });

  it('marks aspiration and gliding vowels as close, not right', () => {
    expect(soundDistance('p', 'pʰ')).toBeGreaterThan(0);
    expect(soundDistance('p', 'pʰ')).toBeLessThanOrEqual(0.4);
    expect(soundDistance('o', 'oʊ')).toBeGreaterThan(0);
    expect(soundDistance('o', 'oʊ')).toBeLessThanOrEqual(0.4);
  });

  it('marks different sounds as off', () => {
    expect(soundDistance('ŋ', 'n')).toBeGreaterThan(0.4);
    expect(soundDistance('a', 's')).toBe(1);
  });
});

describe('compare', () => {
  const ipa = (text: string) => toPhones(text).filter((p) => !p.optional).map((p) => p.ipa);

  it('scores a perfect attempt at 1', () => {
    const c = compare(toPhones('Salamat po'), ipa('Salamat po'));
    expect(c.score).toBe(1);
    expect(c.sounds.every((s) => s.verdict === 'good')).toBe(true);
  });

  it('finds the sound that was replaced', () => {
    const c = compare(toPhones('ngayon'), ['n', 'a', 'j', 'o', 'n']);
    expect(c.sounds[0]).toMatchObject({ verdict: 'off', heard: 'n' });
    expect(c.score).toBeLessThan(1);
  });

  it('finds missing and extra sounds', () => {
    const c = compare(toPhones('tatlo'), ['t', 'a', 'l', 'o', 'w']);
    expect(c.sounds.find((s) => s.verdict === 'missing')?.phone.ipa).toBe('t');
    expect(c.extra.map((e) => e.ipa)).toEqual(['w']);
  });

  it("doesn't penalise leaving out an optional catch", () => {
    expect(compare(toPhones('Oo'), ['o', 'o']).score).toBe(1);
  });
});

describe('coach', () => {
  it('explains "ng" when it comes out as "n"', () => {
    const text = 'ngayon';
    const [tip] = coach(text, compare(toPhones(text), ['n', 'a', 'j', 'o', 'n']));
    expect(tip.letters).toBe('ng');
    expect(tip.text).toContain('sing');
  });

  it('explains an English "r"', () => {
    const text = 'Masarap!';
    const [tip] = coach(text, compare(toPhones(text), ['m', 'a', 's', 'a', 'ɹ', 'a', 'p']));
    expect(tip.letters).toBe('r');
    expect(tip.text).toContain('butter');
  });

  it('explains aspirated stops and gliding vowels', () => {
    const text = 'po';
    expect(coach(text, compare(toPhones(text), ['pʰ', 'o']))[0].text).toContain('puff of air');
    expect(coach(text, compare(toPhones(text), ['p', 'oʊ']))[0].text).toContain('pure');
  });

  it('gives one tip per kind of mistake, at most two', () => {
    const text = 'Magandang umaga';
    const heard = ['m', 'ə', 'ɡ', 'a', 'n', 'd', 'a', 'n', 'u', 'm', 'ə', 'ɡ', 'ə'];
    const tips = coach(text, compare(toPhones(text), heard));
    expect(tips.map((t) => t.letters)).toEqual(['a', 'ng']);
    expect(tips[0].text).toContain('father');
  });

  it('puts sounds that were off before ones that were close', () => {
    const text = 'po ngayon';
    const tips = coach(text, compare(toPhones(text), ['pʰ', 'o', 'n', 'a', 'j', 'o', 'n']));
    expect(tips[0].letters).toBe('ng');
  });

  it('has nothing to say about a perfect attempt', () => {
    const text = 'Salamat';
    expect(coach(text, compare(toPhones(text), ['s', 'a', 'l', 'a', 'm', 'a', 't']))).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { stressLine } from './coach';
import { getCard } from './deck';
import { compare, toPhones } from './phonetics';
import type { Measure } from './prosody';
import { cardStress, hintSyllables, leanAgainst, leanedOn, measureStress, stressVerdict, SURE, UNJUDGED } from './stress';
import takes from './test/fixtures/stress-takes.json';

/** Sounds as heard, each [ms, Hz, dB], as clip-sounds.json and the fixture keep them. */
const unpack = (measured: number[][]): Measure => (i) => measured[i] && { length: measured[i][0] / 1000, pitch: measured[i][1], level: measured[i][2] };

/** A careful "salamat": each vowel heard, with how long, high and loud it was. */
function salamat(vowels: [number, number, number][]) {
  const heard = ['s', 'a', 'l', 'a', 'm', 'a', 't'];
  const comparison = compare(toPhones('Salamat'), heard);
  let v = 0;
  const prosody = unpack(heard.map((s) => (/a/.test(s) ? vowels[v++] : [60, 0, -30])));
  return { comparison, prosody };
}

describe('hintSyllables', () => {
  it('finds the stressed syllable in capitals', () => {
    expect(hintSyllables('sah-LAH-maht')).toEqual({ syllables: ['sah', 'LAH', 'maht'], stressed: 1 });
    expect(hintSyllables('poh')).toBeNull();
  });
});

describe('measureStress', () => {
  it('hears the second-to-last syllable leaned on when it is higher and longer', () => {
    const { comparison, prosody } = salamat([[80, 200, -14], [160, 260, -12], [90, 190, -16]]);
    const stress = measureStress('Salamat', 'sah-LAH-maht', comparison, prosody)!;
    expect(stress.lean).toBeGreaterThan(SURE);
    expect(leanAgainst(stress)).toBeLessThan(0);
    expect(leanedOn(stress)).toBe(1);
    expect(stressVerdict(stress)).toBe('good');
    expect(stressLine(stress)).toBe('Stress: you leaned on LAH.');
  });

  it('hears the last syllable leaned on when it is the higher and longer one', () => {
    const { comparison, prosody } = salamat([[80, 200, -14], [80, 190, -16], [170, 270, -11]]);
    const stress = measureStress('Salamat', 'sah-LAH-maht', comparison, prosody)!;
    expect(leanAgainst(stress)).toBeGreaterThan(SURE);
    expect(leanedOn(stress)).toBe(2);
    expect(stressVerdict(stress)).toBe('off');
    expect(stressLine(stress)).toBe('Stress: lean on LAH, not MAHT.');
    expect(stress.heardAt).toEqual([3, 5]);
  });

  it('calls a lean the other way that it isn\'t sure of nearly right', () => {
    // LAH a touch higher and longer than MAHT, but less than the voices make it: a final syllable said alone is drawn
    // out, so this still leans on MAHT, though not by enough to say so.
    const { comparison, prosody } = salamat([[80, 200, -14], [130, 218, -13], [100, 200, -13]]);
    const stress = measureStress('Salamat', 'sah-LAH-maht', comparison, prosody)!;
    expect(leanAgainst(stress)).toBeGreaterThan(0);
    expect(leanAgainst(stress)).toBeLessThanOrEqual(SURE);
    expect(stressVerdict(stress)).toBe('close');
    expect(stressLine(stress)).toBe('Stress: nearly, lean on LAH more.');
  });

  it("doesn't judge a phrase, a missing vowel, or an attempt said another way", () => {
    const { comparison, prosody } = salamat([[80, 200, -14], [80, 190, -16], [170, 270, -11]]);
    expect(measureStress('Salamat po', 'sah-LAH-maht poh', comparison, prosody)).toBeNull();
    const missing = compare(toPhones('Salamat'), ['s', 'a', 'l', 'a', 'm', 't']);
    expect(measureStress('Salamat', 'sah-LAH-maht', missing, prosody)).toBeNull();
    const card = { id: 'kumusta', tl: 'Kumusta?', hint: 'koo-moos-TAH' };
    expect(cardStress(card, 'Kamusta?', compare(toPhones('Kamusta?'), []), () => undefined)).toBeNull();
    // A whispered vowel has no pitch to compare.
    const whispered = salamat([[80, 200, -14], [80, 0, -16], [170, 270, -11]]);
    expect(measureStress('Salamat', 'sah-LAH-maht', whispered.comparison, whispered.prosody)).toBeNull();
  });

  it('counts e among the vowels', () => {
    const comparison = compare(toPhones('kape'), ['k', 'a', 'p', 'ɛ']);
    const stress = measureStress('kape', 'kah-PEH', comparison, unpack([[60, 0, -30], [80, 190, -16], [60, 0, -30], [170, 270, -11]]));
    expect(stress?.expected).toBe(1);
    expect(leanAgainst(stress!)).toBeLessThan(0);
  });
});

describe('leanedOn', () => {
  it('agrees with the verdict when it could go either way', () => {
    const stress = { syllables: ['sah', 'LAH', 'maht'], expected: 1, differences: { length: 0, pitch: 0, level: 0 }, lean: 0, heardAt: [3, 5] as [number, number] };
    expect(stressVerdict(stress)).toBe('good');
    expect(leanedOn(stress)).toBe(1);
  });
});

describe('takes said with the stress moved on purpose', () => {
  // The app's voices, asked to say words with the hint's stress and with it on the other syllable.
  const judged = takes
    .filter((t) => !UNJUDGED.has(t.card))
    .map((t) => {
      const card = getCard(t.card)!;
      const stress = cardStress(card, card.tl, compare(toPhones(card.tl), t.sounds), unpack(t.prosody));
      return { ...t, tip: stress !== null && stressVerdict(stress) === 'off' };
    });
  const share = (kind: string) => {
    const these = judged.filter((t) => t.stress === kind);
    return these.filter((t) => t.tip).length / these.length;
  };

  it('are mostly caught', () => {
    expect(judged.filter((t) => t.stress === 'moved').length).toBeGreaterThan(50);
    expect(share('moved')).toBeGreaterThanOrEqual(0.5);
  });

  it('said the right way, hardly ever draw a tip', () => {
    expect(share('right')).toBeLessThanOrEqual(0.1);
  });
});

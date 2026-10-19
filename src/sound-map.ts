// Where each sound sits in the mouth, for drawing what the learner said next
// to what the card wanted. Vowels go on the usual vowel chart (tongue front to
// back, high to low); consonants on a grid of where and how they're made.

import { baseSound, isGlidingVowel } from './phonetics';

/**
 * Vowel chart position: x from the front (0) to the back (1) of the mouth at
 * that height, y from tongue high (0) to low (1). The chart narrows toward the
 * bottom, as the mouth does, so x is relative to its width at that height.
 */
const VOWELS: Record<string, [number, number]> = {
  i: [0.05, 0.03],
  ɨ: [0.5, 0.03],
  u: [0.95, 0.03],
  ɪ: [0.2, 0.17],
  ʊ: [0.78, 0.17],
  e: [0.06, 0.36],
  o: [0.94, 0.36],
  ə: [0.5, 0.52],
  ɛ: [0.08, 0.68],
  ʌ: [0.8, 0.68],
  ɔ: [0.94, 0.68],
  æ: [0.1, 0.86],
  ɐ: [0.48, 0.84],
  a: [0.3, 0.97],
  ɑ: [0.94, 0.97],
};

export const PLACES = ['Lips', 'Teeth', 'Roof', 'Back', 'Throat'] as const;
export const MANNERS = ['Stop', 'Nasal', 'Tap', 'Hiss', 'Lateral', 'Glide'] as const;

/** Consonant grid position: [place column, manner row]. */
const CONSONANTS: Record<string, [number, number]> = {
  p: [0, 0],
  b: [0, 0],
  t: [1, 0],
  d: [1, 0],
  k: [3, 0],
  ɡ: [3, 0],
  q: [3.6, 0],
  ʔ: [4, 0],
  m: [0, 1],
  n: [1, 1],
  ɲ: [2, 1],
  ŋ: [3, 1],
  ɾ: [1, 2],
  r: [1, 2],
  f: [0, 3],
  v: [0, 3],
  θ: [0.6, 3],
  ð: [0.6, 3],
  s: [1, 3],
  z: [1, 3],
  ʃ: [2, 3],
  ʒ: [2, 3],
  tʃ: [2, 3],
  dʒ: [2, 3],
  x: [3, 3],
  ɣ: [3, 3],
  ʁ: [3.6, 3],
  h: [4, 3],
  l: [1, 4],
  ɫ: [1.4, 4],
  w: [0, 5],
  ɹ: [1, 5],
  j: [2, 5],
};

export type Place =
  | { chart: 'vowel'; x: number; y: number }
  | { chart: 'consonant'; place: number; manner: number }
  | { chart: 'none' };

/** Where a sound goes on its chart. Gliding vowels sit where they start. */
export function placeOf(ipa: string): Place {
  let base = baseSound(ipa).replace('ʰ', '');
  if (isGlidingVowel(base)) base = base[0];
  const vowel = VOWELS[base];
  if (vowel) return { chart: 'vowel', x: vowel[0], y: vowel[1] };
  const consonant = CONSONANTS[base];
  if (consonant) return { chart: 'consonant', place: consonant[0], manner: consonant[1] };
  return { chart: 'none' };
}

/** A sound described for someone who doesn't read IPA. */
const NAMES: Record<string, string> = {
  a: 'a as in "father"',
  ɑ: 'a far back, as in "spa"',
  æ: 'a as in "cat"',
  ʌ: 'u as in "cup"',
  ə: 'the "uh" in "about"',
  ɐ: 'a short "uh"',
  ɛ: 'e as in "bed"',
  e: 'e as in "bed"',
  ɪ: 'i as in "sit"',
  i: 'ee as in "see"',
  ɨ: 'a middle "ee"',
  o: 'o as in "more", without a glide',
  ɔ: 'o as in "thought"',
  ʊ: 'oo as in "book"',
  u: 'oo as in "food"',
  p: 'p, no puff of air',
  b: 'b',
  t: 't, tongue on the teeth',
  d: 'd',
  k: 'k, no puff of air',
  ɡ: 'g as in "go"',
  q: 'k made far back',
  ʔ: 'a catch in the throat, as in "uh-oh"',
  m: 'm',
  n: 'n',
  ɲ: 'ny as in "canyon"',
  ŋ: 'ng as in "sing"',
  ɾ: 'a quick tapped r',
  r: 'a rolled r',
  ɹ: 'an English r',
  f: 'f',
  v: 'v',
  s: 's',
  z: 'z',
  ʃ: 'sh',
  ʒ: 'the s in "measure"',
  tʃ: 'ch',
  dʒ: 'j as in "jam"',
  h: 'h',
  x: 'a rough h, as in "loch"',
  l: 'l',
  w: 'w',
  j: 'y as in "yes"',
};

export function soundName(ipa: string): string {
  const base = baseSound(ipa);
  const aspirated = base.includes('ʰ');
  const plain = base.replace('ʰ', '');
  if (isGlidingVowel(plain)) return `${NAMES[plain[0]]?.split(',')[0] ?? plain[0]}, gliding like English "go" or "day"`;
  const name = NAMES[plain] ?? `"${plain}"`;
  return aspirated ? `${name.split(',')[0]} with a puff of air` : name;
}

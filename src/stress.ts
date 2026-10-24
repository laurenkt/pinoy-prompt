// Which syllable of a word a spoken attempt leaned on. Tagalog stress falls on
// one of a word's last two syllables, and is heard as that syllable's vowel
// being higher, longer and louder than the other's, so the two are compared:
// pitch (in semitones), length and loudness, each heard sound measured by
// src/prosody.ts. The weights were fitted on every card's clips and on takes
// said with the stress moved on purpose; see the README's "Stress".
//
// Only single words are judged. In a phrase, the sentence's own rise and fall
// outweighs each word's stress.

import type { Card } from './deck';
import { isVowelSound, type Comparison } from './phonetics';
import type { Measure } from './prosody';

/** How each difference between the last two syllables (second-to-last over last) counts towards "second-to-last". */
const WEIGHTS = { bias: -1.36, length: 1.37, pitch: 1.52, level: 0.56 };
/**
 * How sure it must be, in log odds, that the attempt leaned on the other syllable before saying so. Set so takes said
 * with the stress moved are mostly caught (src/stress.test.ts) and hardly any said as the card's clips are.
 */
export const SURE = 1;

/**
 * Words whose own clips don't all measure the way their hint says, so a learner who says them like the clips could be
 * told otherwise: mostly ones the voices say with little between the two syllables, often final-stress words said
 * gently. Never judged. Kept in step with the clips by src/spoken.test.ts.
 */
export const UNJUDGED = new Set<string>([
  'anim', 'apatnapu', 'apo', 'asukal', 'ayoko', 'bagyo', 'bangko', 'barya', 'baso', 'bumaba', 'dalawampu', 'gusto',
  'hindi', 'ingat', 'kahapon', 'kailangan', 'kainan', 'kulay', 'kumain', 'kumusta', 'labindalawa', 'labing-isa',
  'labinlima', 'lalaki', 'lima', 'linggo', 'mabaho', 'maghintay', 'magluto', 'magpahinga', 'magsalita', 'magtrabaho',
  'malapit', 'maligo', 'mamaya', 'mangga', 'masaya', 'matulog', 'ninong', 'paalam', 'paaralan', 'panganay', 'pero',
  'pula', 'pumunta', 'sabihin', 'sige', 'sunog', 'tag-init', 'tag-ulan', 'tanghalian', 'tatlumpu', 'tayo', 'teka',
  'tinapay', 'tinidor', 'tubig', 'uminom',
]);

/** A pronunciation hint's syllables, and which is stressed (written in capitals), if exactly one is. */
export function hintSyllables(hint: string): { syllables: string[]; stressed: number } | null {
  const syllables = hint.split('-').filter(Boolean);
  const stressed = syllables.flatMap((s, i) => (/[A-Z]/.test(s) && s === s.toUpperCase() ? [i] : []));
  return stressed.length === 1 ? { syllables, stressed: stressed[0] } : null;
}

export interface Stress {
  /** The hint's syllables. */
  syllables: string[];
  /** Which one the card stresses. */
  expected: number;
  /** How the second-to-last syllable compared with the last: length (log ratio), pitch and loudness (per 6 semitones, per 6 dB). */
  differences: { length: number; pitch: number; level: number };
  /** Log odds that the attempt leaned on the second-to-last syllable rather than the last. */
  lean: number;
}

/**
 * How a single-word attempt was stressed, against its hint, or null where it can't be told: a phrase, a hint
 * stressing an earlier syllable, or either of the last two vowels not heard clearly or with no pitch to compare.
 */
export function measureStress(text: string, hint: string, comparison: Comparison, measure: Measure): Stress | null {
  if (!/^[a-zñ'-]+$/i.test(text.replace(/[?!.,]/g, '').trim()) || /\s/.test(hint.trim())) return null;
  const parsed = hintSyllables(hint.trim());
  if (!parsed) return null;
  const { syllables, stressed } = parsed;
  const n = syllables.length;
  const vowels = comparison.sounds.filter((r) => isVowelSound(r.phone.ipa));
  if (n < 2 || stressed < n - 2 || vowels.length !== n) return null;
  const [before, last] = vowels.slice(-2).map((r) => (r.heardAt !== undefined && (r.verdict === 'good' || r.verdict === 'close') ? measure(r.heardAt) : undefined));
  if (!before?.pitch || !last?.pitch) return null;
  const length = Math.log(Math.max(before.length, 0.01) / Math.max(last.length, 0.01));
  const pitch = (12 * Math.log2(before.pitch / last.pitch)) / 6;
  const level = (before.level - last.level) / 6;
  const lean = WEIGHTS.bias + WEIGHTS.length * length + WEIGHTS.pitch * pitch + WEIGHTS.level * level;
  return { syllables, expected: stressed, differences: { length, pitch, level }, lean };
}

/** How sure it is that the attempt leaned on the other syllable than the card stresses (above SURE: say so). */
export function leanAgainst(stress: Stress): number {
  return stress.expected === stress.syllables.length - 2 ? -stress.lean : stress.lean;
}

/** The stress of an attempt at a card, when the card is one that's judged and the attempt was said as its main spelling. */
export function cardStress(card: Pick<Card, 'id' | 'tl' | 'hint'>, text: string, comparison: Comparison, measure: Measure): Stress | null {
  if (!card.hint || text !== card.tl || UNJUDGED.has(card.id)) return null;
  return measureStress(text, card.hint, comparison, measure);
}

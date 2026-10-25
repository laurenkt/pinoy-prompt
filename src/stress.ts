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
 * How far inside the line every clip of a judged word must sit, in log odds. Native takes of one word vary by about
 * this much between them (src/spoken.test.ts measures it), so a learner who copies a clip that sits right by the
 * line could still be told otherwise. Kept this far in, saying a word like whichever of its clips sits nearest the
 * line trips the tip about one time in fifty, and most clips sit further in than that.
 */
export const CLIP_MARGIN = 1;

/**
 * Words whose own clips don't all measure the way their hint says, by CLIP_MARGIN, so a learner who says them like the
 * clips could be told otherwise: mostly ones the voices say with little between the two syllables, often final-stress
 * words said gently. Never judged. Kept in step with the clips by src/spoken.test.ts.
 */
export const UNJUDGED = new Set<string>([
  'akala', 'akin', 'ako', 'anak', 'anim', 'apatnapu', 'apo', 'araw', 'aso', 'asukal', 'ate', 'ayoko', 'babae',
  'baboy', 'bagay', 'bagyo', 'bakit', 'bangko', 'bansa', 'barya', 'baso', 'basta', 'bawat', 'beses', 'biyernes',
  'buhay', 'buksan', 'bumaba', 'bumalik', 'bumili', 'dahilan', 'dalawampu', 'dilaw', 'dito', 'dumating', 'gamot',
  'gatas', 'gulay', 'gusto', 'habang', 'hatinggabi', 'heto', 'hindi', 'ingat', 'isa', 'isda', 'iyo', 'kahapon',
  'kahit', 'kaibigan', 'kailangan', 'kainan', 'kalahati', 'kaliwa', 'kanan', 'kanin', 'kasalanan', 'kasi', 'kaya',
  'kayo', 'kaysa', 'kilala', 'kulay', 'kumain', 'kumusta', 'kunin', 'kutsara', 'labindalawa', 'labing-isa',
  'labinlima', 'lalaki', 'lima', 'limampu', 'linggo', 'loob', 'lugar', 'lunes', 'maaraw', 'mabagal', 'mabaho',
  'madali', 'maganda', 'maghintay', 'magluto', 'magnanakaw', 'magpahinga', 'magsalita', 'magtrabaho', 'magulang',
  'mahirap', 'makinig', 'malapit', 'mali', 'maligo', 'malungkot', 'mamaya', 'mangga', 'manok', 'marami', 'masama',
  'masaya', 'masyado', 'matanda', 'matulog', 'meron', 'minsan', 'mula', 'mundo', 'nakalimutan', 'namin', 'nanay',
  'nasaan', 'natin', 'nila', 'ninang', 'ninong', 'oo', 'opo', 'ospital', 'paalam', 'paaralan', 'pagkain',
  'pagkatapos', 'pakiusap', 'pala', 'palengke', 'paliparan', 'pamangkin', 'panganay', 'pangit', 'parang', 'pare',
  'pareho', 'pero', 'pinsan', 'pinto', 'pito', 'pula', 'pumasok', 'pumunta', 'puso', 'puti', 'sabi', 'sabihin',
  'saging', 'sandali', 'sarili', 'selpon', 'sige', 'siguro', 'sila', 'simbahan', 'sino', 'sukli', 'sunog', 'tag-init',
  'tag-ulan', 'takot', 'tanghalian', 'tao', 'tapos', 'tatay', 'tatlumpu', 'tayo', 'teka', 'tinapay', 'tindahan',
  'tinidor', 'tita', 'totoo', 'trapik', 'tubig', 'tulong', 'ulit', 'umaga', 'umalis', 'uminom', 'umuulan', 'wala',
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
  /** Which heard sounds the last two vowels were. */
  heardAt: [number, number];
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
  const heardAt = vowels.slice(-2).map((r) => (r.verdict === 'good' || r.verdict === 'close' ? r.heardAt : undefined));
  if (heardAt[0] === undefined || heardAt[1] === undefined) return null;
  const [before, last] = heardAt.map((i) => measure(i!));
  if (!before?.pitch || !last?.pitch) return null;
  const length = Math.log(Math.max(before.length, 0.01) / Math.max(last.length, 0.01));
  const pitch = (12 * Math.log2(before.pitch / last.pitch)) / 6;
  const level = (before.level - last.level) / 6;
  const lean = WEIGHTS.bias + WEIGHTS.length * length + WEIGHTS.pitch * pitch + WEIGHTS.level * level;
  return { syllables, expected: stressed, differences: { length, pitch, level }, lean, heardAt: [heardAt[0], heardAt[1]] };
}

/** How sure it is that the attempt leaned on the other syllable than the card stresses (above SURE: say so). */
export function leanAgainst(stress: Stress): number {
  return stress.expected === stress.syllables.length - 2 ? -stress.lean : stress.lean;
}

/** Which syllable the attempt leaned on: the second-to-last or the last. */
export function leanedOn(stress: Stress): number {
  const other = stress.expected === stress.syllables.length - 1 ? stress.expected - 1 : stress.expected + 1;
  return leanAgainst(stress) > 0 ? other : stress.expected;
}

/** How the attempt's stress came out: leaned the card's way, the other way but not surely (close), or surely (off). */
export function stressVerdict(stress: Stress): 'good' | 'close' | 'off' {
  const against = leanAgainst(stress);
  return against > SURE ? 'off' : against > 0 ? 'close' : 'good';
}

/** The stress of an attempt at a card, when the card is one that's judged and the attempt was said as its main spelling. */
export function cardStress(card: Pick<Card, 'id' | 'tl' | 'hint'>, text: string, comparison: Comparison, measure: Measure): Stress | null {
  if (!card.hint || text !== card.tl || UNJUDGED.has(card.id)) return null;
  return measureStress(text, card.hint, comparison, measure);
}

// Turns a sound-by-sound comparison into plain-language coaching: which
// letters to work on, and a tip for the most useful thing to fix first.

import { baseSound, isGlidingVowel, type Comparison, type SoundResult } from './phonetics';
import { stressVerdict, type Stress } from './stress';

/** How each sound is described to a learner, by example. */
const DESCRIBE: Record<string, string> = {
  a: '"a" as in "father"',
  ɛ: '"e" as in "bed"',
  e: '"e" as in "bed"',
  i: '"ee" as in "see"',
  o: '"o" as in "more"',
  u: '"oo" as in "food"',
  ə: '"uh"',
  ʌ: '"u" as in "cup"',
  æ: '"a" as in "cat"',
  ɪ: '"i" as in "sit"',
  ʊ: '"oo" as in "book"',
  ŋ: '"ng" as in "sing"',
  ɾ: 'a quick tapped "r"',
  ɹ: 'an English "r"',
  ʔ: 'the catch in "uh-oh"',
  ʃ: '"sh"',
  tʃ: '"ch"',
  dʒ: '"j"',
  j: '"y"',
  ɲ: '"ny" as in "canyon"',
  ɡ: '"g" as in "go"',
};

export function describeSound(ipa: string): string {
  const base = baseSound(ipa).replace('ʰ', '');
  if (isGlidingVowel(base)) return `"${base}" (gliding, like English "go" or "day")`;
  return DESCRIBE[base] ?? `"${base}"`;
}

export interface Tip {
  /** The letters the tip is about, as written on the card. */
  letters: string;
  text: string;
  /** Where in the text the sounds it's about start (Phone.from): the same tip can cover several. */
  at: number[];
  /** Says only what was heard and what to aim for, with no advice on how: a breakdown that shows both already can leave it out. */
  plain?: boolean;
}

const STOPS = 'ptk';

/** One tip for one problem sound, or null if there's nothing specific to say. */
function tipFor(r: SoundResult, letters: string): Omit<Tip, 'letters' | 'at'> | null {
  const advice = adviceFor(r, letters);
  if (advice) return { text: advice };
  const want = r.phone.ipa;
  const alternatives = (r.phone.also ?? []).filter(Boolean);
  if (r.verdict === 'missing') return { text: `We didn't hear the ${describeSound(want)} sound for "${letters}".`, plain: true };
  if (r.heard) {
    const aim = [...new Set([want, ...alternatives.filter((a) => a !== 'æ')].map(describeSound))].join(' or ');
    // Naming another way that's just as right says more than the labels over the slider do.
    return { text: `"${letters}" sounded like ${describeSound(r.heard)}. Aim for ${aim}.`, plain: !aim.includes(' or ') };
  }
  return null;
}

/** How to make a sound that came out wrong, for the mistakes that have a known fix. */
function adviceFor(r: SoundResult, letters: string): string | null {
  const want = r.phone.ipa;
  const heard = r.heard ? baseSound(r.heard) : '';
  const alternatives = (r.phone.also ?? []).filter(Boolean);
  if (want === 'ŋ' && alternatives.length > 0) {
    return `"ng" blends into the next sound here, so say it as "ng" or "${alternatives.join('" or "')}"${heard ? `, not ${describeSound(heard)}` : ''}.`;
  }
  if (want === 'ŋ') {
    return `"ng" is a single sound, like the end of "sing". Hold the back of your tongue up and hum it${r.phone.from === 0 ? ', even at the start of a word' : ''}.`;
  }
  if (want === 'ɾ') {
    return 'Tap the "r" once with the tip of your tongue, like the "tt" in American "butter". Don\'t curl it like an English "r".';
  }
  if (STOPS.includes(want) && heard.includes('ʰ')) {
    return `Say "${letters}" without a puff of air, like the "${want}" in "s${want}in" rather than "${want}in".`;
  }
  if (want === 'o' && isGlidingVowel(heard)) {
    return 'Keep the "o" pure and steady, with rounded lips. Don\'t let it slide into "w" like English "go".';
  }
  if ((want === 'ɛ' || want === 'e') && isGlidingVowel(heard)) {
    return 'Keep the "e" short and open, like "bed". Don\'t let it slide into "ay" like English "day".';
  }
  return null;
}

/** Up to `max` tips, most important first: sounds that were off or missing before ones that were close. Each covers every sound it fits. */
export function coach(text: string, comparison: Comparison, max = 2): Tip[] {
  const rank = { missing: 0, off: 0, close: 1, good: 2 } as const;
  const problems = comparison.sounds
    .filter((r) => r.verdict !== 'good' && !r.phone.optional)
    .sort((a, b) => rank[a.verdict] - rank[b.verdict]);
  const tips: Tip[] = [];
  for (const r of problems) {
    const letters = text.slice(r.phone.from, r.phone.to);
    const tip = tipFor(r, letters);
    // One tip per kind of sound is plenty. Past `max`, a later sound can still share one, so the breakdown shows it there too.
    const same = tip && tips.find((t) => t.text === tip.text);
    if (same) same.at.push(r.phone.from);
    else if (tip && tips.length < max) tips.push({ letters, at: [r.phone.from], ...tip });
  }
  const added = comparison.extra.find((e) => e.counts);
  if (added && tips.length < max) {
    // Point at the written sound the extra one came after (or before, at the start).
    const written = comparison.sounds.map((r) => r.phone).filter((p) => p.to > p.from);
    const after = written.filter((p) => comparison.sounds.findIndex((r) => r.phone === p) < added.before).pop();
    const anchor = after ?? written[0];
    const letters = anchor ? text.slice(anchor.from, anchor.to) : '';
    const where = after ? 'after' : 'before';
    tips.push({ letters, at: anchor ? [anchor.from] : [], text: `There was an extra ${describeSound(added.ipa)} sound ${where} "${letters}". Leave it out.`, plain: true });
  }
  return tips;
}

/** The one of the last two syllables the card doesn't stress, in capitals as it was leaned on. */
const otherSyllable = ({ syllables, expected }: Stress) => syllables[expected === syllables.length - 1 ? expected - 1 : expected + 1].toUpperCase();

/**
 * How an attempt's stress came out, in a line: what it leaned on, or what to lean on instead. Kept apart from the
 * sound tips, as stress never changes the score, though Speak fails a word whose stress is off.
 */
export function stressLine(stress: Stress): string {
  const aim = stress.syllables[stress.expected];
  const verdict = stressVerdict(stress);
  if (verdict === 'good') return `Stress: you leaned on ${aim}.`;
  if (verdict === 'close') return `Stress: nearly, lean on ${aim} more.`;
  return `Stress: lean on ${aim}, not ${otherSyllable(stress)}.`;
}

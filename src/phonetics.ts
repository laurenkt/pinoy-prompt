// Tagalog spelling to sounds, and comparing the sounds a learner made with the
// sounds a card should have. Kept free of DOM and model code so it can be unit
// tested; the phone recogniser that produces "heard" sounds lives elsewhere.
//
// Sounds are written in broad IPA. Tagalog spelling is close to phonemic, so a
// handful of rules covers the deck: "ng" is one sound (ŋ), "mga" is "maŋa",
// vowels next to each other have a catch between them (ʔ, as in "sa-an"), and
// loanword letters (c, f, v, z...) map to their Tagalog sounds.

export interface Phone {
  /** The sound, in IPA. */
  ipa: string;
  /** The letters it comes from: text.slice(from, to). */
  from: number;
  to: number;
  /** Fine to leave out, e.g. the glottal catch before a word-initial vowel. */
  optional?: boolean;
}

const VOWELS = 'aeiou';
const isVowel = (ch: string | undefined) => ch !== undefined && VOWELS.includes(ch);
const isLetter = (ch: string | undefined) => ch !== undefined && /[a-zñ]/.test(ch);

/** Single letters and their sounds. */
const LETTERS: Record<string, string> = {
  a: 'a',
  e: 'ɛ',
  i: 'i',
  o: 'o',
  u: 'u',
  b: 'b',
  c: 'k',
  d: 'd',
  f: 'p',
  g: 'ɡ',
  h: 'h',
  j: 'dʒ',
  k: 'k',
  l: 'l',
  m: 'm',
  n: 'n',
  ñ: 'ɲ',
  p: 'p',
  q: 'k',
  r: 'ɾ',
  s: 's',
  t: 't',
  v: 'b',
  w: 'w',
  x: 'ks',
  y: 'j',
  z: 's',
};

/** Expected sounds for a card's Tagalog text, mapped back to its letters. */
export function toPhones(text: string): Phone[] {
  const lower = text.toLowerCase().normalize('NFC');
  const phones: Phone[] = [];
  const push = (ipa: string, from: number, to: number, optional = false) =>
    phones.push(optional ? { ipa, from, to, optional } : { ipa, from, to });

  let i = 0;
  while (i < lower.length) {
    const ch = lower[i];
    if (!isLetter(ch)) {
      i++;
      continue;
    }
    const wordStart = i === 0 || !isLetter(lower[i - 1]);
    const next = lower[i + 1];

    // "mga" (plural marker) is said "maŋa".
    if (wordStart && lower.startsWith('mga', i) && !isLetter(lower[i + 3])) {
      push('m', i, i + 1);
      push('a', i, i + 1);
      push('ŋ', i + 1, i + 3);
      push('a', i + 2, i + 3);
      i += 3;
      continue;
    }
    // A vowel starting a word, or following another vowel, begins with a catch in the throat.
    if (isVowel(ch)) {
      const prev = lower[i - 1];
      if (wordStart) push('ʔ', i, i + 1, true);
      else if (isVowel(prev)) push('ʔ', i, i + 1, true);
      push(LETTERS[ch], i, i + 1);
      i++;
      continue;
    }
    if (ch === 'n' && next === 'g') {
      push('ŋ', i, i + 2);
      // In loanwords like "Ingles", a consonant after "ng" keeps the g.
      const after = lower[i + 2];
      if (isLetter(after) && !isVowel(after)) push('ɡ', i + 1, i + 2);
      i += 2;
      continue;
    }
    if ((ch === 't' && next === 's') || (ch === 'c' && next === 'h')) {
      push('tʃ', i, i + 2);
      i += 2;
      continue;
    }
    // "sy" and "siy" before a vowel are said "sh": pasensya, siyam.
    if (ch === 's' && next === 'y' && isVowel(lower[i + 2])) {
      push('ʃ', i, i + 2);
      i += 2;
      continue;
    }
    if (ch === 's' && next === 'i' && lower[i + 2] === 'y' && isVowel(lower[i + 3])) {
      push('ʃ', i, i + 3);
      i += 3;
      continue;
    }
    if (ch === 'q' && next === 'u') {
      push('k', i, i + 2);
      i += 2;
      continue;
    }
    // Doubled consonants are said once.
    if (ch === next) {
      push(LETTERS[ch], i, i + 2);
      i += 2;
      continue;
    }
    for (const sound of LETTERS[ch] === 'ks' ? ['k', 's'] : [LETTERS[ch]]) push(sound, i, i + 1);
    i++;
  }
  return phones;
}

// --- Reading the recogniser's output ----------------------------------------

/** Marks the recogniser writes as separate tokens that belong to the sound before them. */
const MODIFIERS = new Set(['ʰ', 'ʲ', 'ʷ', 'ː', 'ˠ', 'ˤ', '˞', 'ʼ', '\u0303', '\u031a', '\u0325', '\u0329', '\u032a', '\u0334', '\u033a']);
const AFFRICATES: Record<string, string> = { 'tʃ': 'tʃ', 'dʒ': 'dʒ' };

/** English-style glides the recogniser writes as two vowels, joined so they can be coached: "go" (oʊ), "day" (eɪ). */
const GLIDES = new Set(['oʊ', 'ɔʊ', 'eɪ', 'ɛɪ']);

/**
 * Turn the recogniser's tokens (one symbol each) into sounds: modifiers like
 * ʰ and ː join the sound before them, t+ʃ and d+ʒ join into one, o+ʊ and e+ɪ
 * within a word join into a gliding vowel, word breaks and special tokens are
 * dropped, and ASCII g becomes IPA ɡ.
 */
export function groupTokens(tokens: string[]): string[] {
  const sounds: string[] = [];
  // Index of the first sound in the current word, so glides don't join across a word break.
  let wordStart = 0;
  for (const raw of tokens) {
    if (raw === '▁') wordStart = sounds.length;
    if (!raw || raw === '▁' || raw.startsWith('<')) continue;
    const token = raw === 'g' ? 'ɡ' : raw;
    const last = sounds[sounds.length - 1];
    const inWord = sounds.length > wordStart;
    if (MODIFIERS.has(token) && last !== undefined) sounds[sounds.length - 1] = last + token;
    else if (last !== undefined && AFFRICATES[last + token]) sounds[sounds.length - 1] = AFFRICATES[last + token];
    else if (inWord && GLIDES.has(last + token)) sounds[sounds.length - 1] = last + token;
    else sounds.push(token);
  }
  return sounds;
}

// --- Comparing sounds ---------------------------------------------------------

interface Features {
  kind: 'vowel' | 'consonant';
  /** Consonants: place of articulation. Vowels: front, central or back. */
  place: string;
  /** Consonants: stop, nasal... Vowels: high, mid or low. */
  manner: string;
  voiced?: boolean;
}

const FEATURES: Record<string, Features> = {
  a: { kind: 'vowel', place: 'central', manner: 'low' },
  ɑ: { kind: 'vowel', place: 'back', manner: 'low' },
  æ: { kind: 'vowel', place: 'front', manner: 'low' },
  ʌ: { kind: 'vowel', place: 'back', manner: 'mid' },
  ə: { kind: 'vowel', place: 'central', manner: 'mid' },
  ɛ: { kind: 'vowel', place: 'front', manner: 'mid' },
  e: { kind: 'vowel', place: 'front', manner: 'mid' },
  ɪ: { kind: 'vowel', place: 'front', manner: 'high' },
  i: { kind: 'vowel', place: 'front', manner: 'high' },
  o: { kind: 'vowel', place: 'back', manner: 'mid' },
  ɔ: { kind: 'vowel', place: 'back', manner: 'mid' },
  ʊ: { kind: 'vowel', place: 'back', manner: 'high' },
  u: { kind: 'vowel', place: 'back', manner: 'high' },
  p: { kind: 'consonant', place: 'lips', manner: 'stop', voiced: false },
  b: { kind: 'consonant', place: 'lips', manner: 'stop', voiced: true },
  t: { kind: 'consonant', place: 'teeth', manner: 'stop', voiced: false },
  d: { kind: 'consonant', place: 'teeth', manner: 'stop', voiced: true },
  k: { kind: 'consonant', place: 'velum', manner: 'stop', voiced: false },
  ɡ: { kind: 'consonant', place: 'velum', manner: 'stop', voiced: true },
  ʔ: { kind: 'consonant', place: 'throat', manner: 'stop', voiced: false },
  m: { kind: 'consonant', place: 'lips', manner: 'nasal', voiced: true },
  n: { kind: 'consonant', place: 'teeth', manner: 'nasal', voiced: true },
  ɲ: { kind: 'consonant', place: 'palate', manner: 'nasal', voiced: true },
  ŋ: { kind: 'consonant', place: 'velum', manner: 'nasal', voiced: true },
  s: { kind: 'consonant', place: 'teeth', manner: 'fricative', voiced: false },
  z: { kind: 'consonant', place: 'teeth', manner: 'fricative', voiced: true },
  ʃ: { kind: 'consonant', place: 'palate', manner: 'fricative', voiced: false },
  h: { kind: 'consonant', place: 'throat', manner: 'fricative', voiced: false },
  tʃ: { kind: 'consonant', place: 'palate', manner: 'affricate', voiced: false },
  dʒ: { kind: 'consonant', place: 'palate', manner: 'affricate', voiced: true },
  l: { kind: 'consonant', place: 'teeth', manner: 'lateral', voiced: true },
  ɾ: { kind: 'consonant', place: 'teeth', manner: 'tap', voiced: true },
  r: { kind: 'consonant', place: 'teeth', manner: 'trill', voiced: true },
  ɹ: { kind: 'consonant', place: 'teeth', manner: 'approximant', voiced: true },
  w: { kind: 'consonant', place: 'lips', manner: 'glide', voiced: true },
  j: { kind: 'consonant', place: 'palate', manner: 'glide', voiced: true },
};

/** Sounds Tagalog speakers treat as the same, so they never count against the learner. */
const SAME: [string, string][] = [
  ['ɛ', 'e'],
  ['o', 'ɔ'],
  ['a', 'ɑ'],
  ['ɾ', 'r'],
  ['ɲ', 'nj'],
];

/** Strip length marks, ties and diacritics other than aspiration, so model output compares cleanly. */
export function baseSound(ipa: string): string {
  return ipa.replace(/[ːˑ͡‿̪̥̬̃̚]/g, '');
}

const isAspirated = (ipa: string) => ipa.includes('ʰ');

/** Two vowel symbols, the second a glide: oʊ, eɪ, aɪ... */
export function isGlidingVowel(ipa: string): boolean {
  return ipa.length === 2 && FEATURES[ipa[0]]?.kind === 'vowel' && 'ʊɪuiwj'.includes(ipa[1]);
}

/** 0 for the same sound up to 1 for unrelated sounds. */
export function soundDistance(expected: string, heard: string): number {
  const a = baseSound(expected);
  const b = baseSound(heard).replace('ʰ', '');
  if (a === b) return isAspirated(heard) ? 0.3 : 0;
  // A vowel that glides into another, like English "go" (oʊ) or "day" (eɪ): close, but worth a tip.
  if (isGlidingVowel(b) && FEATURES[a]?.kind === 'vowel') return Math.min(1, soundDistance(a, b[0]) + 0.3);
  if (SAME.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return 0;
  // In Tagalog o/u and e/i swap freely in many words, so those are only a small slip.
  if ((a === 'o' && b === 'u') || (a === 'u' && b === 'o') || (a === 'ɛ' && b === 'i') || (a === 'i' && b === 'ɛ')) return 0.35;
  const fa = FEATURES[a];
  const fb = FEATURES[b];
  if (!fa || !fb) return 1;
  if (fa.kind !== fb.kind) return 1;
  let d = 0.25;
  if (fa.place !== fb.place) d += 0.3;
  if (fa.manner !== fb.manner) d += 0.3;
  if (fa.voiced !== fb.voiced) d += 0.15;
  return Math.min(1, d);
}

export type SoundVerdict = 'good' | 'close' | 'off' | 'missing';

export interface SoundResult {
  phone: Phone;
  verdict: SoundVerdict;
  /** What was heard in its place, if anything. */
  heard?: string;
}

export interface Comparison {
  sounds: SoundResult[];
  /**
   * Sounds heard that the card doesn't have, with the index of the expected sound they came before.
   * `counts` is false for harmless ones: a glottal catch, or a short "uh" as a final consonant is released.
   */
  extra: { ipa: string; before: number; counts: boolean }[];
  /** 0–1: share of the card's sounds that were said well (close counts half). */
  score: number;
}

const DELETE = 1;
const INSERT = 0.7;
const CLOSE = 0.4;
const EXTRA_WEIGHT = 0.5;
/** Sounds a speaker (or the recogniser) adds at the very end without it being a mistake: a breath, a released consonant. */
const TRAILING = new Set(['h', 'ə', 'ɨ', 'ɐ', 'ʔ']);

const isVowelSound = (ipa: string | undefined) => ipa !== undefined && FEATURES[baseSound(ipa)[0]]?.kind === 'vowel';

/** Whether an added sound is a natural part of speech rather than a mistake. */
function harmless(heard: string[], index: number): boolean {
  const ipa = baseSound(heard[index]);
  if (ipa === 'ʔ') return true;
  if (index === heard.length - 1 && TRAILING.has(ipa)) return true;
  // The y or w glide that joins two vowels, as in "kain" said "kayin".
  return (ipa === 'j' || ipa === 'w') && isVowelSound(heard[index - 1]) && isVowelSound(heard[index + 1]);
}

/** Line up what was heard with what was expected (weighted edit distance) and judge each sound. */
export function compare(expected: Phone[], heard: string[]): Comparison {
  const n = expected.length;
  const m = heard.length;
  const deleteCost = (p: Phone) => (p.optional ? 0 : DELETE);
  // cost[i][j]: best cost of matching expected[0..i) with heard[0..j).
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const step: ('sub' | 'del' | 'ins')[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill('sub'));
  for (let i = 1; i <= n; i++) {
    cost[i][0] = cost[i - 1][0] + deleteCost(expected[i - 1]);
    step[i][0] = 'del';
  }
  for (let j = 1; j <= m; j++) {
    cost[0][j] = cost[0][j - 1] + INSERT;
    step[0][j] = 'ins';
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = cost[i - 1][j - 1] + soundDistance(expected[i - 1].ipa, heard[j - 1]);
      const del = cost[i - 1][j] + deleteCost(expected[i - 1]);
      const ins = cost[i][j - 1] + INSERT;
      const best = Math.min(sub, del, ins);
      cost[i][j] = best;
      step[i][j] = best === sub ? 'sub' : best === del ? 'del' : 'ins';
    }
  }

  const sounds: SoundResult[] = [];
  const extra: Comparison['extra'] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const s = step[i][j];
    if (s === 'sub' && i > 0 && j > 0) {
      const d = soundDistance(expected[i - 1].ipa, heard[j - 1]);
      const verdict: SoundVerdict = d === 0 ? 'good' : d <= CLOSE ? 'close' : 'off';
      sounds.unshift(verdict === 'good' ? { phone: expected[i - 1], verdict } : { phone: expected[i - 1], verdict, heard: heard[j - 1] });
      i--;
      j--;
    } else if (s === 'del' && i > 0) {
      sounds.unshift({ phone: expected[i - 1], verdict: expected[i - 1].optional ? 'good' : 'missing' });
      i--;
    } else {
      extra.unshift({ ipa: heard[j - 1], before: i, counts: !harmless(heard, j - 1) });
      j--;
    }
  }

  const counted = sounds.filter((s) => !s.phone.optional);
  const points = counted.reduce((sum, s) => sum + (s.verdict === 'good' ? 1 : s.verdict === 'close' ? 0.5 : 0), 0);
  // Each added sound counts against the attempt as half a sound to get right: a slip, but recognisers add the odd stray one.
  const added = extra.filter((e) => e.counts).length * EXTRA_WEIGHT;
  return { sounds, extra, score: counted.length ? points / (counted.length + added) : 0 };
}

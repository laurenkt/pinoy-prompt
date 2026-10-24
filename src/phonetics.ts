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
  /**
   * Other ways of saying it that are just as right, from the sound next to it:
   * "ng" before p or b is said m. An empty string means it can merge into the
   * next sound and disappear ("ang mga" said "amga").
   */
  also?: string[];
  /** Other ways of saying it that are nearly right here, though not elsewhere: "ng" said n at the start of a word. */
  nearly?: string[];
  /** Only fine to leave out when the sound before it was said one of its `also` ways ("ay" said "e", not "a"). */
  dropsAfterAlso?: boolean;
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

/**
 * In running speech "ng" takes the place of the consonant after it, within a
 * word or across a space: m before p, b and m; n before t, d, s, l and n. Before
 * the same nasal it can merge away completely.
 */
function assimilated(lower: string, at: number): string[] | undefined {
  let k = at;
  while (k < lower.length && (lower[k] === ' ' || lower[k] === '-')) k++;
  const following = lower[k];
  if (following === 'p' || following === 'b') return ['m'];
  if (following === 'm') return ['m', ''];
  if (following && 'tdsl'.includes(following)) return ['n'];
  if (following === 'n' && lower[k + 1] !== 'g') return ['n', ''];
  return undefined;
}

/** s, d, t and n run into a y after them in everyday speech: "siya" said "sha", "diyan" "jan", "tiyak" "chak", "niyo" "nyo". */
const BLENDS: Record<string, string> = { s: 'ʃ', d: 'dʒ', t: 'tʃ', n: 'ɲ' };

/** Let s, d, t or n and the y after it in the same word (with an iy's vowel left out) be said as the one sound they blend into. */
function blendGlides(phones: Phone[], text: string): void {
  phones.forEach((p, k) => {
    const blend = BLENDS[p.ipa];
    if (!blend || p.also) return;
    let y = k + 1;
    if (phones[y]?.optional && phones[y].ipa === 'i') y++;
    const glide = phones[y];
    if (glide?.ipa !== 'j' || glide.also || /[^a-zñ]/.test(text.slice(p.to, glide.from))) return;
    p.also = [blend];
    glide.also = [''];
    glide.dropsAfterAlso = true;
  });
}

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
      // Not spelled, and often swallowed in quick speech ("mŋa").
      push('a', i + 1, i + 1, true);
      push('ŋ', i + 1, i + 3);
      push('a', i + 2, i + 3);
      i += 3;
      continue;
    }
    // The particle "ng" is said "nang".
    if (wordStart && lower.startsWith('ng', i) && !isLetter(lower[i + 2]) && lower[i - 1] !== "'" && lower[i - 1] !== '’') {
      push('n', i, i + 1);
      // Not spelled, and often swallowed in quick speech.
      push('a', i + 1, i + 1, true);
      push('ŋ', i + 1, i + 2);
      const also = assimilated(lower, i + 2);
      if (also) phones[phones.length - 1].also = also;
      i += 2;
      continue;
    }
    // "ay" and "may" are often said "e" and "me" in everyday speech.
    if (ch === 'a' && next === 'y' && !isLetter(lower[i + 2]) && (wordStart || (lower[i - 1] === 'm' && (i === 1 || !isLetter(lower[i - 2]))))) {
      if (wordStart) push('ʔ', i, i + 1, true);
      push('a', i, i + 1);
      phones[phones.length - 1].also = ['e', 'æ'];
      push('j', i + 1, i + 2);
      phones[phones.length - 1].also = [''];
      phones[phones.length - 1].dropsAfterAlso = true;
      i += 2;
      continue;
    }
    // "iy" and "uw" after a consonant are often said without their vowel: "diyan" as "dyan", "puwede" as "pwede".
    if ((ch === 'i' && next === 'y') || (ch === 'u' && next === 'w')) {
      const before = lower[i - 1];
      if (!wordStart && isLetter(before) && !isVowel(before) && isVowel(lower[i + 2])) {
        push(LETTERS[ch], i, i + 1, true);
        i++;
        continue;
      }
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
      // At the start of a word the recogniser often hears even a native speaker's "ng" as n ("ngayon" as "nayon").
      if (wordStart) phones[phones.length - 1].nearly = ['n'];
      // In loanwords like "Ingles", l or r after "ng" keeps the g (and the ng stays ng before it).
      const after = lower[i + 2];
      if (after === 'l' || after === 'r') push('ɡ', i + 1, i + 2);
      else {
        const also = assimilated(lower, i + 2);
        if (also) phones[phones.length - 1].also = also;
      }
      i += 2;
      continue;
    }
    if ((ch === 't' && next === 's') || (ch === 'c' && next === 'h')) {
      push('tʃ', i, i + 2);
      i += 2;
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
    // A g before p, t, k or s loses its voice, as in "nagtuon" said "naktuon".
    if (ch === 'g' && 'ptks'.includes(lower[i + 1] ?? '-')) phones[phones.length - 1].also = ['k'];
    i++;
  }
  blendGlides(phones, lower);
  return phones;
}

// --- Reading the recogniser's output ----------------------------------------

/** Marks the recogniser writes as separate tokens that belong to the sound before them. */
const MODIFIERS = new Set(['ʰ', 'ʲ', 'ʷ', 'ː', 'ˠ', 'ˤ', '˞', 'ʼ', '\u0303', '\u031a', '\u0325', '\u0329', '\u032a', '\u0334', '\u033a']);
const AFFRICATES: Record<string, string> = { 'tʃ': 'tʃ', 'dʒ': 'dʒ' };

/** English-style glides the recogniser writes as two vowels, joined so they can be coached: "go" (oʊ), "day" (eɪ). */
const GLIDES = new Set(['oʊ', 'ɔʊ', 'eɪ', 'ɛɪ']);

/** A recogniser token that is a sound on its own (ASCII g as IPA ɡ), or null for a modifier, word break or special token. */
export function soundToken(raw: string): string | null {
  if (!raw || raw === '▁' || raw.startsWith('<') || MODIFIERS.has(raw)) return null;
  return raw === 'g' ? 'ɡ' : raw;
}

/** A recogniser token with when it was heard, in seconds. */
export interface TimedToken {
  token: string;
  start: number;
  end: number;
}

/** A sound heard, with when: seconds from the start of the recording. */
export interface TimedSound {
  sound: string;
  start: number;
  end: number;
}

/**
 * Turn the recogniser's tokens (one symbol each) into sounds: modifiers like
 * ʰ and ː join the sound before them, t+ʃ and d+ʒ join into one, o+ʊ and e+ɪ
 * within a word join into a gliding vowel, word breaks and special tokens are
 * dropped, and ASCII g becomes IPA ɡ. Joined sounds span all their tokens.
 */
export function groupTimed(tokens: TimedToken[]): TimedSound[] {
  const sounds: TimedSound[] = [];
  // Index of the first sound in the current word, so glides don't join across a word break.
  let wordStart = 0;
  for (const { token: raw, start, end } of tokens) {
    if (raw === '▁') wordStart = sounds.length;
    const last = sounds[sounds.length - 1];
    // A modifier joins the sound before it; with none (the recording starts on it) it's dropped.
    const token = MODIFIERS.has(raw) && last ? raw : soundToken(raw);
    if (!token) continue;
    const inWord = sounds.length > wordStart;
    const join = (sound: string) => (sounds[sounds.length - 1] = { sound, start: last.start, end: Math.max(last.end, end) });
    // An r-coloured vowel (the "er" in English "number") is the vowel then an r.
    if (last && token === '˞') sounds.push({ sound: 'ɹ', start, end });
    else if (last && MODIFIERS.has(token)) join(last.sound + token);
    else if (last && AFFRICATES[last.sound + token]) join(AFFRICATES[last.sound + token]);
    else if (last && inWord && GLIDES.has(last.sound + token)) join(last.sound + token);
    else sounds.push({ sound: token, start, end });
  }
  return sounds;
}

/** groupTimed for tokens without timing. */
export function groupTokens(tokens: string[]): string[] {
  return groupTimed(tokens.map((token) => ({ token, start: 0, end: 0 }))).map((s) => s.sound);
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
  ɐ: { kind: 'vowel', place: 'central', manner: 'low' },
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
  x: { kind: 'consonant', place: 'velum', manner: 'fricative', voiced: false },
  ɣ: { kind: 'consonant', place: 'velum', manner: 'fricative', voiced: true },
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
  ['a', 'ɐ'],
  ['ɾ', 'r'],
  ['ɲ', 'nj'],
  // The recogniser often writes a Tagalog k said far back in the mouth as q.
  ['k', 'q'],
];

/**
 * Ways native speakers say a sound that are just as right, from region to region and in everyday speech,
 * so they count as said well: o and u, and e and i, swap freely in many words; an unstressed a relaxes
 * towards "uh"; r and d swap between vowels (marami, madami); f and v are said p and b; s can be voiced; and k
 * and g can soften between vowels.
 */
const VARIANTS: [string, string][] = [
  ['o', 'u'],
  ['ɛ', 'i'],
  ['e', 'i'],
  ['i', 'ɪ'],
  ['ɛ', 'ɪ'],
  ['e', 'ɪ'],
  ['u', 'ʊ'],
  ['o', 'ʊ'],
  ['a', 'ə'],
  ['a', 'ʌ'],
  ['a', 'æ'],
  ['ɾ', 'd'],
  ['p', 'f'],
  ['b', 'v'],
  ['s', 'z'],
  // Between vowels k and g can soften ("bakit" said "baxit").
  ['k', 'x'],
  ['ɡ', 'ɣ'],
];
/** How far a variant is from the sound as written: close enough to count as said well. */
export const VARIANT = 0.15;
/** How far a nearly right sound is from the one written: close, so half right. */
const NEARLY = 0.35;
/** Sounds some speakers swap, by region or in quick speech, that are still nearly right. */
const NEAR: [string, string][] = [
  ['l', 'ɾ'],
  // An English r, as many speakers use in English words said in Tagalog ("number").
  ['ɹ', 'ɾ'],
];
const GLIDE_VOWELS: [string, string][] = [
  ['j', 'i'],
  ['w', 'u'],
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

/** Distances already worked out, as every attempt (and every clip in the tests) asks for the same few pairs. */
const distances = new Map<string, Map<string, number>>();

/** 0 for the same sound up to 1 for unrelated sounds. */
export function soundDistance(expected: string, heard: string): number {
  let from = distances.get(expected);
  if (!from) distances.set(expected, (from = new Map()));
  let d = from.get(heard);
  if (d === undefined) from.set(heard, (d = distanceBetween(expected, heard)));
  return d;
}

function distanceBetween(expected: string, heard: string): number {
  const a = baseSound(expected);
  const b = baseSound(heard).replace('ʰ', '');
  if (a === b) return isAspirated(heard) ? 0.3 : 0;
  // A vowel that glides into another, like English "go" (oʊ) or "day" (eɪ): close, but worth a tip.
  if (isGlidingVowel(b) && FEATURES[a]?.kind === 'vowel') return Math.min(1, distanceBetween(a, b[0]) + 0.3);
  if (SAME.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return isAspirated(heard) ? 0.3 : 0;
  if (VARIANTS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return isAspirated(heard) ? 0.3 : VARIANT;
  if (NEAR.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return NEARLY;
  // A glide and its vowel (y and i, w and u) are hard to tell apart.
  if (GLIDE_VOWELS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return 0.3;
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
  /** Index of the heard sound lined up with this one, if any (whatever the verdict). */
  heardAt?: number;
  /** 0–1: how close what was heard is to this sound (1 is spot on, 0 is missing or unrelated). */
  closeness: number;
}

export interface Comparison {
  sounds: SoundResult[];
  /**
   * Sounds heard that the card doesn't have, with the index of the expected sound they came before.
   * `counts` is false for harmless ones: a glottal catch, or a short "uh" as a final consonant is released.
   */
  extra: { ipa: string; before: number; counts: boolean; at: number }[];
  /** 0–1: share of the card's sounds that were said well (close counts half). */
  score: number;
}

const DELETE = 1;
const INSERT = 0.7;
const CLOSE = 0.4;
const EXTRA_WEIGHT = 0.5;
/** Added to a sound's distance when it matched one the recogniser nearly wrote rather than the one it did. */
const RUNNER_UP = 0.1;
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
export function compare(expected: Phone[], heard: string[], runnersUp: string[][] = []): Comparison {
  const n = expected.length;
  const m = heard.length;
  const mayDrop = (p: Phone) => p.optional || p.also?.includes('') === true;
  const deleteCost = (p: Phone) => (mayDrop(p) ? 0 : DELETE);
  const toSound = (p: Phone, h: string) => {
    let d = soundDistance(p.ipa, h);
    for (const alt of p.also ?? []) if (alt) d = Math.min(d, soundDistance(alt, h));
    if (p.nearly?.includes(baseSound(h))) d = Math.min(d, NEARLY);
    return d;
  };
  // A sound the recogniser nearly wrote instead is as good as heard, less a little for the doubt.
  const near: number[][] = expected.map((p) =>
    heard.map((h, at) => {
      let d = toSound(p, h);
      for (const alt of runnersUp[at] ?? []) d = Math.min(d, toSound(p, alt) + RUNNER_UP);
      return d;
    }),
  );
  // cost[i * w + j]: best cost of matching expected[0..i) with heard[0..j), and the step that got there.
  const w = m + 1;
  const cost = new Float64Array((n + 1) * w);
  const step = new Uint8Array((n + 1) * w);
  const SUB = 0;
  const DEL = 1;
  const INS = 2;
  for (let i = 1; i <= n; i++) {
    cost[i * w] = cost[(i - 1) * w] + deleteCost(expected[i - 1]);
    step[i * w] = DEL;
  }
  for (let j = 1; j <= m; j++) {
    cost[j] = cost[j - 1] + INSERT;
    step[j] = INS;
  }
  for (let i = 1; i <= n; i++) {
    const dropCost = deleteCost(expected[i - 1]);
    for (let j = 1; j <= m; j++) {
      const sub = cost[(i - 1) * w + j - 1] + near[i - 1][j - 1];
      const del = cost[(i - 1) * w + j] + dropCost;
      const ins = cost[i * w + j - 1] + INSERT;
      const best = Math.min(sub, del, ins);
      cost[i * w + j] = best;
      step[i * w + j] = best === sub ? SUB : best === del ? DEL : INS;
    }
  }

  const sounds: SoundResult[] = [];
  /** Expected sounds that were said one of their `also` ways. */
  const viaAlso = new Set<Phone>();
  const dropped = new Set<Phone>();
  /** Heard positions lined up with an expected sound, and those of added sounds. */
  const matchedAt = new Set<number>();
  const extra: Comparison['extra'] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const s = step[i * w + j];
    if (s === SUB && i > 0 && j > 0) {
      const d = near[i - 1][j - 1];
      if (toSound(expected[i - 1], heard[j - 1]) < soundDistance(expected[i - 1].ipa, heard[j - 1])) viaAlso.add(expected[i - 1]);
      matchedAt.add(j - 1);
      const verdict: SoundVerdict = d <= VARIANT ? 'good' : d <= CLOSE ? 'close' : 'off';
      const result: SoundResult = { phone: expected[i - 1], verdict, heardAt: j - 1, closeness: Math.max(0, 1 - d) };
      if (verdict !== 'good') result.heard = heard[j - 1];
      sounds.unshift(result);
      i--;
      j--;
    } else if (s === DEL && i > 0) {
      dropped.add(expected[i - 1]);
      const fine = mayDrop(expected[i - 1]);
      sounds.unshift({ phone: expected[i - 1], verdict: fine ? 'good' : 'missing', closeness: fine ? 1 : 0 });
      i--;
    } else {
      extra.unshift({ ipa: heard[j - 1], before: i, counts: !harmless(heard, j - 1), at: j - 1 });
      j--;
    }
  }

  // A vowel written twice is a long vowel (Tagalog marks stress with length): one
  // repeat per vowel said is fine, but a vowel dragged on or stuttered still counts.
  const lengthened = new Set<number>();
  extra.forEach((e, k) => {
    const at = e.at;
    const ipa = baseSound(e.ipa);
    if (!e.counts || !isVowelSound(ipa)) return;
    const twin = [at - 1, at + 1].find((n) => matchedAt.has(n) && !lengthened.has(n) && baseSound(heard[n]) === ipa);
    if (twin === undefined) return;
    lengthened.add(twin);
    extra[k] = { ...e, counts: false };
  });

  // "ay" may lose its y only when said "e", and "diyan" only when said "jan": said "a" or "d", the y still has to be there.
  sounds.forEach((r, k) => {
    // The sound it blends with, past an iy's vowel that may be left out.
    let b = k - 1;
    while (b >= 0 && sounds[b].phone.optional && sounds[b].phone.ipa === 'i') b--;
    const before = sounds[b];
    if (r.phone.dropsAfterAlso && dropped.has(r.phone) && before && !viaAlso.has(before.phone)) {
      sounds[k] = { phone: r.phone, verdict: 'missing', closeness: 0 };
    }
  });

  const counted = sounds.filter((s) => !s.phone.optional);
  const points = counted.reduce((sum, s) => sum + (s.verdict === 'good' ? 1 : s.verdict === 'close' ? 0.5 : 0), 0);
  // Each added sound counts against the attempt as half a sound to get right: a slip, but recognisers add the odd stray one.
  // A sound that may be left out but came out as a different one (a catch heard as t) is one added too.
  const added = (extra.filter((e) => e.counts).length + sounds.filter((s) => s.phone.optional && s.verdict === 'off').length) * EXTRA_WEIGHT;
  return { sounds, extra, score: counted.length ? points / (counted.length + added) : 0 };
}

// --- How likely the recording is the card -----------------------------------

/**
 * What the recogniser thought at each moment it listened (one output step, about 40 ms): each sound it
 * thought at least ODDS_KEPT likely then, and how likely. The rest of each moment is silence or a gap
 * between sounds.
 */
export type Odds = [string, number][][];
export const ODDS_KEPT = 0.01;
/** How likely a sound counts as when the recogniser didn't keep it: rarer than anything it did. */
const UNLIKELY = 0.001;

/** Odds as one line of text, for scripts/generate-audio.mjs to keep in src/clip-sounds.json: "p194 d51|ɛ543 e323|...", in thousandths. */
export function packOdds(odds: Odds): string {
  return odds.map((moment) => moment.map(([sound, p]) => `${sound}${Math.round(p * 1000)}`).join(' ')).join('|');
}

export function unpackOdds(packed: string): Odds {
  return packed.split('|').map((moment) => (moment ? moment.split(' ').map((s) => [s.replace(/\d+$/, ''), Number(s.match(/\d+$/)![0]) / 1000]) : []));
}

/** What one expected sound can be heard as, at one place in the alignment: a whole sound or one half of a tʃ or dʒ. */
interface Slot {
  ways: string[];
  optional: boolean;
}

/** The expected sounds as the recogniser writes them: tʃ and dʒ as two symbols each. */
function slotsFor(phones: Phone[]): Slot[] {
  return phones.flatMap((p) => {
    const ways = [p.ipa, ...(p.also ?? [])].filter(Boolean);
    // A y that may go only when the sound before it blends with it ("jan" for diyan) stays: the alignment can't
    // tell which way that sound was said, and "dan" isn't diyan. The blended way is still judged by compare.
    const optional = !!p.optional || (p.also?.includes('') === true && !p.dropsAfterAlso);
    const halves = ways.map((w) => (w === 'tʃ' || w === 'dʒ' ? [...w] : [w]));
    if (halves.length === 1 && halves[0].length === 2) return halves[0].map((half) => ({ ways: [half], optional }));
    return [{ ways: [...new Set(halves.flat())], optional }];
  });
}

/**
 * How likely it is that the recording is the expected sounds (or the ways native speakers say them),
 * against what the recogniser thought most likely at each moment: 0 when it's just what it heard, lower
 * the less likely, per sound expected. Unlike the sounds it wrote down, this keeps what it only half
 * heard: a first p or k it was torn on (Tagalog's are said without a puff of air) still counts.
 */
export function likelihood(expected: Phone[], odds: Odds): number {
  const slots = slotsFor(expected);
  const steps = odds.length;
  if (!steps || !slots.length) return -Infinity;
  const accepts = (slot: Slot, sound: string) => slot.ways.some((w) => soundDistance(w, sound) <= VARIANT);
  const gap = (moment: [string, number][]) => Math.max(UNLIKELY, 1 - moment.reduce((sum, [, p]) => sum + p, 0));
  const chance = (slot: Slot, moment: [string, number][]) => Math.max(UNLIKELY, moment.reduce((sum, [sound, p]) => (accepts(slot, sound) ? sum + p : sum), 0));
  // Best path through slot states (odd) and gaps between them (even), as CTC aligns: a gap may be skipped
  // between two different slots, and an optional slot (with its gap) may be skipped entirely.
  const states = 2 * slots.length + 1;
  const from = Array.from({ length: states }, (_, s) => {
    const before = new Set([s, s - 1]);
    if (s % 2 === 1) before.add(s - 2);
    // Over optional slots just before this state (for a gap, its own slot too): from the gap before one, or the slot before that.
    for (let k = s % 2 === 1 ? (s - 3) / 2 : s / 2 - 1; k >= 0 && slots[k].optional; k--) {
      before.add(2 * k);
      before.add(2 * k - 1);
    }
    return [...before].filter((q) => q >= 0);
  });
  const startAt = new Set([0, 1]);
  for (let k = 0; k < slots.length && slots[k].optional; k++) [2 * k + 2, 2 * k + 3].forEach((s) => startAt.add(s));
  let best = new Float64Array(states).fill(-Infinity);
  const emit = (t: number, s: number) => Math.log(s % 2 === 0 ? gap(odds[t]) : chance(slots[(s - 1) >> 1], odds[t]));
  for (const s of startAt) if (s < states) best[s] = emit(0, s);
  for (let t = 1; t < steps; t++) {
    const next = new Float64Array(states).fill(-Infinity);
    for (let s = 0; s < states; s++) {
      let b = -Infinity;
      for (const q of from[s]) b = Math.max(b, best[q]);
      if (b > -Infinity) next[s] = b + emit(t, s);
    }
    best = next;
  }
  // Ending on the last slot or the gap after it, or before optional slots at the end.
  let end = Math.max(best[states - 1], best[states - 2]);
  for (let k = slots.length - 1; k >= 0 && slots[k].optional; k--) end = Math.max(end, best[2 * k], best[2 * k - 1] ?? -Infinity);
  // What the recogniser thought most likely at each moment, gap or sound.
  const free = odds.reduce((sum, moment) => sum + Math.log(Math.max(gap(moment), ...moment.map(([, p]) => p))), 0);
  const counted = expected.filter((p) => !p.optional).length || 1;
  return (end - free) / counted;
}

/**
 * At or above this score an attempt counts as right: clearly understood and
 * fairly natural, not native-perfect. A sound said well (or one of the ways
 * native speakers say it) scores 1 and a nearly there one half, so a phrase can
 * pass with about one sound in ten off (from 10 sounds one, from 20 two: in
 * context a listener still gets it), and any word with one sound in five nearly
 * there. A short word with a sound off, which can turn it into another word,
 * still needs another go.
 */
export const PASS = 0.9;
/**
 * The recogniser often doesn't write down a sound it heard, above all a first p, t or k (Tagalog's have no puff
 * of air), so an attempt that is LIKELY to be the card (`likelihood`) passes from ROUGHLY, as long as most of
 * what it wrote down matches: a different word, even one a sound away, still fails. Set so every card's own
 * clips pass (src/spoken.test.ts).
 */
export const ROUGHLY = 0.7;
export const LIKELY = -1;

/** What the recogniser made of an attempt, as Speak judges it: see Recognition in phone-model.ts. */
export interface Heard {
  sounds: string[];
  runnersUp?: string[][];
  odds?: Odds;
}

/** A comparison, with how likely the recording is the text (when the recogniser's odds are known). */
export type Judged = Comparison & { likely?: number };

/** Judge what was heard against the closest of a card's accepted spellings (Kumusta, Kamusta). */
export function judge(texts: string[], heard: Heard): { text: string; comparison: Judged } {
  return texts
    .map((text) => {
      const phones = toPhones(text);
      const comparison: Judged = compare(phones, heard.sounds, heard.runnersUp);
      // Only needed where it decides the attempt, and the slowest part of judging it.
      if (heard.odds?.length && comparison.score >= ROUGHLY && comparison.score < PASS) comparison.likely = likelihood(phones, heard.odds);
      return { text, comparison };
    })
    .reduce((best, next) => (rank(next.comparison) > rank(best.comparison) ? next : best));
}

/** Right before not, then by score. */
const rank = (c: Judged) => (passes(c) ? 1 : 0) + c.score / 2;

/** True when the attempt was good enough to count as right. */
export function passes(comparison: Judged): boolean {
  return comparison.score >= PASS || (comparison.score >= ROUGHLY && (comparison.likely ?? -Infinity) >= LIKELY);
}

// --- Checking recorded clips ------------------------------------------------

/**
 * How English reads a g before e or i ("gem", "giant"), which Tagalog never does.
 * The recogniser also hears a soft g as d at times: it heard both "jising" and
 * "dising" in one clip at two speeds, while every hard g in the deck came out ɡ.
 */
const SOFT_G = new Set(['dʒ', 'ʒ', 'dʑ', 'ʑ', 'd']);

/**
 * Letters a recording said the English way rather than the Tagalog way, for
 * scripts/generate-audio.mjs to reject a take: a voice that sees "Gising" can
 * read it like "giant". Tagalog g is always hard, as in "go".
 */
export function englishReadings(text: string, heard: string[]): { letters: string; heard: string }[] {
  const spelled = text.toLowerCase().normalize('NFC');
  const { sounds, extra } = compare(toPhones(spelled), heard);
  return sounds.flatMap(({ phone, verdict, heard: said }, k) => {
    if (phone.ipa !== 'ɡ' || verdict === 'good' || !/[ei]/.test(spelled[phone.to] ?? '')) return [];
    // A sound so far off can instead be lined up with the vowel after a missing g, or as an added one beside it.
    const near = [...extra.filter((e) => e.before === k || e.before === k + 1).map((e) => e.ipa), verdict === 'missing' ? sounds[k + 1]?.heard : undefined];
    const candidates = [said, ...near];
    const soft = candidates.find((ipa) => ipa !== undefined && SOFT_G.has(baseSound(ipa)));
    return soft ? [{ letters: text.normalize('NFC').slice(phone.from, phone.to + 1), heard: soft }] : [];
  });
}

/**
 * The first sound of a recording's text, if the recording doesn't start with it, for scripts/generate-audio.mjs to
 * reject a take: the voice model often starts a take a moment into its first word, so "Kailan" comes out "ailan"
 * and "Pabili" "abili", the consonant gone. A vowel at the start is left to the take's own check for that
 * (`cut` in scripts/clip-edges.mjs), and a first sound heard as a near one (k as g) still counts as said.
 */
export function lostFirstSound(text: string, heard: string[]): { letters: string; heard: string } | null {
  const spelled = text.toLowerCase().normalize('NFC');
  const [first, second] = compare(toPhones(spelled), heard).sounds;
  if (!first || isVowelSound(first.phone.ipa) || first.verdict === 'good' || first.verdict === 'close') return null;
  // A stop before another consonant (the p of "Psst") is barely sounded at all.
  if (second && !isVowelSound(second.phone.ipa)) return null;
  return { letters: text.normalize('NFC').slice(first.phone.from, first.phone.to), heard: first.heard ?? 'nothing' };
}

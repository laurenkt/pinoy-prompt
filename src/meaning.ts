// Checking a meaning the learner typed (or dictated) against a card's English.
// It's judged on meaning, not spelling: typos, word order, contractions, "a"
// and "the", and digits for numbers don't matter. Anything this can't match
// may still be right in other words, so it goes to OpenAI when the learner has
// a key, and the learner can always say they had it. The answer has to be in
// English: saying the Tagalog back means the same, but isn't an answer.

import { VOCAB, type Card } from './deck';

/** Asks whether `answer` means the same as the card, or null when it can't be asked. */
export type MeaningJudge = (answer: string, card: Card) => Promise<boolean | null>;

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** Same meaning, said another way. Applied to whole words, before splitting. */
const SAME: [RegExp, string][] = [
  [/\b(thanks|thx|ty)\b/g, 'thank you'],
  [/\bok\b/g, 'okay'],
  [/\b(hi|hey)\b/g, 'hello'],
  [/\bhow do you do\b/g, 'hello'],
  [/\b(bye|good bye)\b/g, 'goodbye'],
  [/\bo ?clock\b/g, 'oclock'],
  [/\bcannot\b/g, 'can not'],
  [/\ba (hundred|thousand)\b/g, 'one $1'],
  // Contractions typed without the apostrophe.
  [/\bim\b/g, 'i am'],
  [/\b(do|does|did|is|are|was|were|has|have|could|would|should)nt\b/g, '$1 not'],
  [/\bcant\b/g, 'can not'],
  [/\bwont\b/g, 'will not'],
  // Not "were", which is a word of its own.
  [/\b(you|they)re\b/g, '$1 are'],
  [/\b(what|where|that|there|it)s\b/g, '$1 is'],
  [/\bu\b/g, 'you'],
];

/** Words that carry no meaning of their own here. */
const FILLER = new Set(['a', 'an', 'the', 'is', 'are', 'am', 'do', 'does', 'please']);

/**
 * The helping verb a wording leans on, if any: "are" and "do" are filler on
 * their own, but "how do you" asks something else than "how are you", so an
 * answer using one can't match a meaning using the other.
 */
function helper(list: string[]): 'be' | 'do' | null {
  for (const w of list) {
    if (w === 'is' || w === 'are' || w === 'am') return 'be';
    if (w === 'do' || w === 'does') return 'do';
  }
  return null;
}

/** A wording's meaningful words, with the helping verb it leans on. */
interface Wording {
  words: string[];
  helper: 'be' | 'do' | null;
}

function wording(text: string): Wording {
  // A helping verb counts only when it's written out: "what's this mean" is "what does this mean" as often as "what is".
  const written = text.replace(/['’]s\b/gi, '').replace(/\b(what|where|that|there|it)s\b/gi, '$1');
  return { words: meaningful(words(text)), helper: helper(words(written)) };
}

/** Lower case words, with contractions, digits and common shorthands spelled out. */
export function words(text: string): string[] {
  let s = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`]/g, "'");
  s = s
    .replace(/\bcan't\b/g, 'can not')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/n't\b/g, ' not')
    .replace(/'m\b/g, ' am')
    .replace(/'re\b/g, ' are')
    .replace(/'s\b/g, ' is')
    .replace(/'ll\b/g, ' will')
    .replace(/'ve\b/g, ' have')
    .replace(/'d\b/g, ' would')
    .replace(/o'clock/g, 'oclock')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b\d+\b/g, (n) => NUMBERS[Number(n)] ?? n);
  for (const [from, to] of SAME) s = s.replace(from, to);
  return s.split(' ').filter(Boolean);
}

/** The words that matter; all of them when every one is filler ("the"). */
function meaningful(list: string[]): string[] {
  // "To ride" is "ride": the "to" in front of a doing word adds nothing.
  const kept = list.filter((w, i) => !FILLER.has(w) && !(i === 0 && w === 'to' && list.length > 1));
  return kept.length ? kept : list;
}

/**
 * The meanings a card accepts, as words: each "/" alternative, without its
 * notes in brackets, plus a number in brackets. "Yes (polite)" accepts "yes";
 * "twenty (20)" accepts "twenty" and "20". Notes come off before the split,
 * so "(makes a yes/no question)" has no meaning to type.
 */
export function meanings(card: Card): string[][] {
  return wordings(card).map((alt) => alt.words);
}

/** Each card's wordings, worked out once: the deck doesn't change. */
const cardWordings = new WeakMap<Card, Wording[]>();

function wordings(card: Card): Wording[] {
  let found = cardWordings.get(card);
  if (!found) cardWordings.set(card, (found = wordingsOf(card)));
  return found;
}

function wordingsOf(card: Card): Wording[] {
  const numbers = [...card.en.matchAll(/\(([\d,]+)\)/g)].map((m) => m[1]);
  return [...card.en.replace(/\([^)]*\)/g, ' ').split('/'), ...numbers].map(wording).filter((alt) => alt.words.length > 0);
}

/** Whether a card can be answered by typing its meaning. Not one that only has a note, like "(makes a word plural)". */
export function canTypeMeaning(card: Card): boolean {
  return meanings(card).length > 0;
}

/** A number, in digits or words ("eighty", "fourth"): one letter changes which, so it is never a typo. */
function isNumber(w: string): boolean {
  return /^\d/.test(w) || NUMBER_WORD.test(w);
}

const NUMBER_WORD =
  /^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(thir|four|fif|six|seven|eigh|nine)teen|(twen|thir|for|fif|six|seven|eigh|nine)ty|hundred|thousand|million|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|twelfth|(twen|thir|for|fif|six|seven|eigh|nine)tieth|hundredth|thousandth)s?$/;

/** Edits between two words, a swapped pair of letters counting as one. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

let deckWords: Set<string> | undefined;

/** Every word the deck's meanings use. One of these is meant as written, not a typo for another. */
function knownWords(): Set<string> {
  deckWords ??= new Set(VOCAB.flatMap((card) => words(card.en)));
  return deckWords;
}

/**
 * Whether a typed word is the card's word: the same, a plural, or a typo (one
 * letter wrong, missing, extra or swapped, two in a long word). A typo rarely
 * hits the first letter, so that has to match, and a word the deck uses
 * elsewhere is never a typo: "three" isn't "there", nor "grandmother" "grandfather".
 */
function sameWord(typed: string, word: string): boolean {
  if (typed === word) return true;
  const stem = (w: string) => (w.length > 3 ? w.replace(/s$/, '') : w);
  if (stem(typed) === stem(word)) return true;
  if (typed[0] !== word[0] || knownWords().has(typed) || isNumber(typed) || isNumber(word)) return false;
  const shorter = Math.min(typed.length, word.length);
  const allowed = shorter >= 8 ? 2 : shorter >= 4 ? 1 : 0;
  return allowed > 0 && distance(typed, word) <= allowed;
}

/**
 * Whether the answer plainly says what the card means, checked on the device.
 * Every word that matters has to be there and nothing else added, so "good
 * evening" isn't taken for "good morning". False means "not sure", not "wrong".
 */
export function matchesMeaning(answer: string, card: Card): boolean {
  // "He or she", "house / home": every meaning given has to be one of the card's.
  const parts = answer.replace(/\([^)]*\)/g, ' ').split(/\/|\bor\b/i).map(wording).filter((part) => part.words.length > 0);
  if (parts.length === 0) return false;
  const alts = wordings(card);
  return parts.every((given) =>
    alts.some(
      (alt) =>
        !(given.helper && alt.helper && given.helper !== alt.helper) &&
        alt.words.every((w) => given.words.some((g) => sameWord(g, w))) &&
        given.words.every((g) => alt.words.some((w) => sameWord(g, w))),
    ),
  );
}

/** Respect words that can go with any Tagalog said back. */
const RESPECT = ['po', 'ho', 'pong', 'hong'];

/** Each card's Tagalog words, worked out once. */
const cardTagalog = new WeakMap<Card, Set<string>>();

function tagalogOf(card: Card): Set<string> {
  let found = cardTagalog.get(card);
  if (!found) cardTagalog.set(card, (found = new Set([card.tl, ...(card.accept ?? [])].flatMap(words))));
  return found;
}

/**
 * Whether the answer is the card's Tagalog said back ("salamat", "Salamat po",
 * an accepted spelling), not its meaning in English. It means the same, but
 * the question asks for the English, so it's never right. An answer needs a
 * word that's only Tagalog to count: "okay" for "Okay lang ako" is English,
 * and may still be right in other words.
 */
export function repeatsTagalog(answer: string, card: Card): boolean {
  const tagalog = tagalogOf(card);
  const list = words(answer).filter((w) => !RESPECT.includes(w));
  return list.length > 0 && list.every((w) => tagalog.has(w)) && list.some((w) => !knownWords().has(w));
}

/**
 * Judge a typed meaning: on the device first, then by `ask` when that can't
 * match it. Without an answer from `ask` (no key, offline, an error), the
 * device's answer stands; a failed ask is noted, so the learner knows why.
 */
export async function judgeMeaning(answer: string, card: Card, ask: MeaningJudge | null): Promise<Verdict> {
  if (!answer.trim()) return { right: false };
  if (matchesMeaning(answer, card)) return { right: true };
  // Not asked: OpenAI would see that it means the same.
  if (repeatsTagalog(answer, card)) return { right: false };
  if (!ask) return { right: false };
  try {
    return { right: (await ask(answer, card)) ?? false };
  } catch (e) {
    return { right: false, failure: e };
  }
}

export interface Verdict {
  right: boolean;
  /** Why OpenAI couldn't answer when it was asked, so only the device's check counted. */
  failure?: unknown;
}

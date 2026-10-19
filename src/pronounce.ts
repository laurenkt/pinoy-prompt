// Decides whether what the speech recogniser heard matches the card.
// Kept free of DOM code so it can be unit tested.
//
// Recognisers return text, not sounds, and Tagalog spelling varies: o/u and
// e/i are often interchangeable, loanwords swing between Spanish and Filipino
// spellings, and numbers may come back as digits. So both sides are folded to
// a rough phonetic spelling before they are compared.

/** Score (0–1) at or above which an attempt passes. */
export const PASS = 0.8;
/** Score at or above which a miss is "almost". */
export const CLOSE = 0.6;
/** Score at or above which a single word counts as said. */
const WORD_OK = 0.75;

const NUMBERS = new Map(Object.entries({
  '1': 'isa',
  '2': 'dalawa',
  '3': 'tatlo',
  '4': 'apat',
  '5': 'lima',
  '6': 'anim',
  '7': 'pito',
  '8': 'walo',
  '9': 'siyam',
  '10': 'sampu',
}));

/** Lowercase words with accents and punctuation removed. Hyphens split words. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => NUMBERS.get(w) ?? w);
}

/** A rough phonetic spelling of one word, so spelling variants compare equal. */
export function fold(word: string): string {
  return word
    .replace(/qu/g, 'k')
    .replace(/c/g, 'k')
    .replace(/f/g, 'p')
    .replace(/v/g, 'b')
    .replace(/z/g, 's')
    .replace(/j/g, 'h')
    // "siyam"/"syam", "pasensiya"/"pasensya", "buwan"/"bwan".
    .replace(/([^aeiou])iy/g, '$1y')
    .replace(/([^aeiou])uw/g, '$1w')
    .replace(/u/g, 'o')
    .replace(/e/g, 'i')
    .replace(/(.)\1+/g, (m, ch: string) => (ch === 'o' || ch === 'a' || ch === 'i' ? m : ch));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** 1 for identical strings, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

export interface WordMark {
  text: string;
  ok: boolean;
}

export interface Verdict {
  /** Overall match, 0–1. */
  score: number;
  pass: boolean;
  close: boolean;
  /** The recogniser's text that matched best, or '' if nothing was heard. */
  heard: string;
  /** The target's words, each marked as said or missed. */
  marks: WordMark[];
}

/** The target as written, split into the words shown to the learner. */
function shownWords(target: string): string[] {
  return target.split(/\s+/).filter((w) => words(w).length > 0);
}

function scoreAgainst(target: string, heard: string): { score: number; marks: WordMark[] } {
  const targetWords = shownWords(target);
  const heardFolded = words(heard).map(fold);
  const heardJoined = heardFolded.join('');
  // Compare without spaces: recognisers split and join words unpredictably.
  const score = similarity(words(target).map(fold).join(''), heardJoined);
  const marks = targetWords.map((text) => {
    const folded = words(text).map(fold).join('');
    const ok =
      heardFolded.some((h) => similarity(folded, h) >= WORD_OK) || (folded.length >= 3 && heardJoined.includes(folded));
    return { text, ok };
  });
  return { score, marks };
}

/**
 * Judge an attempt. `targets` are accepted spellings (the card's Tagalog first);
 * `heard` are the recogniser's alternatives, best guess first.
 */
export function judge(targets: string[], heard: string[]): Verdict {
  let best: Verdict | null = null;
  let bestTarget = '';
  for (const h of heard) {
    for (const target of targets) {
      const { score, marks } = scoreAgainst(target, h);
      if (!best || score > best.score) {
        best = { score, pass: score >= PASS, close: score >= CLOSE, heard: h, marks };
        bestTarget = target;
      }
    }
  }
  if (best) {
    // Always show the card's own wording, even when another accepted spelling matched.
    if (bestTarget !== targets[0]) {
      const matched = best.marks;
      const shown = shownWords(targets[0]);
      // Carry the marks over word for word when the spellings line up; otherwise re-mark against the card.
      best.marks =
        shown.length === matched.length
          ? shown.map((text, i) => ({ text, ok: matched[i].ok }))
          : scoreAgainst(targets[0], best.heard).marks;
    }
    return best;
  }
  const marks = shownWords(targets[0] ?? '').map((text) => ({ text, ok: false }));
  return { score: 0, pass: false, close: false, heard: '', marks };
}

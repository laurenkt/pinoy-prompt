// Talk: a spoken conversation in English with the learner's Tagalog mixed in.
// What gets mixed in comes from their memory: every word they have met is used
// in Tagalog, and at most one new word from the deck joins each conversation.
// The app spots those words in the transcript of what the AI says, so the
// learner can tap one to hear it and see its meaning.

import { getCard, isVocab, LEARN_ORDER, UNITS, type Card, type Unit } from './deck';
import { STRENGTHS, strengthOf, type Strength } from './memory';
import type { Progress } from './progress-schema';

export interface KnownWord {
  card: Card;
  strength: Strength;
}

export interface TalkPlan {
  /** What to talk about; null lets the conversation wander. */
  topic: Unit | null;
  /** Every word met so far, firmest first. */
  known: KnownWord[];
  /** One word not met yet, brought in during the chat; null once the deck is done. */
  newWord: Card | null;
}

/** Firmest first. */
const ORDER: Strength[] = STRENGTHS.map((s) => s.id).reverse();

/** Topics with at least one word the learner has met. */
export function talkTopics(progress: Progress): Unit[] {
  return UNITS.filter((u) => u.cards.some((c) => progress.cards[c.id]));
}

export function talkPlan(progress: Progress, topicId: string | null): TalkPlan {
  const topic = UNITS.find((u) => u.id === topicId) ?? null;
  const known = Object.entries(progress.cards)
    .map(([id, state]) => ({ card: getCard(id), strength: strengthOf(state) }))
    // Guides (patterns, sounds, know-how) aren't words to drop into a sentence.
    .filter((k): k is KnownWord => k.card !== undefined && isVocab(k.card))
    .sort((a, b) => ORDER.indexOf(a.strength) - ORDER.indexOf(b.strength));
  const unseen = (c: Card) => !progress.cards[c.id];
  // The most useful word not met yet, from the topic if there is one.
  const next = LEARN_ORDER.map(getCard).filter((c): c is Card => c !== undefined && isVocab(c) && unseen(c));
  const newWord = next.find((c) => topic?.cards.includes(c)) ?? next[0] ?? null;
  return { topic, known, newWord };
}

function list(words: KnownWord[]): string {
  return words.map((w) => `${w.card.tl} (${w.card.en})`).join('; ');
}

/** The AI's instructions for a conversation. */
export function talkInstructions(plan: TalkPlan): string {
  const firm = plan.known.filter((w) => w.strength === 'long' || w.strength === 'weeks');
  const settling = plan.known.filter((w) => w.strength === 'days');
  const fresh = plan.known.filter((w) => w.strength === 'new');
  const lines = [
    'You are a friendly Filipino conversation partner. The learner is an English speaker learning beginner Tagalog. This is a spoken conversation.',
    plan.topic
      ? `Talk about everyday situations around this topic: ${plan.topic.title}.`
      : 'Talk about everyday things, like how their day is going, food, family or plans.',
    'Speak English, but use Tagalog for the words and phrases listed below, every time one fits naturally. The more of them you use, the better. Spell or say them exactly as listed. Use no other Tagalog.',
  ];
  if (firm.length) lines.push(`Words they know well: ${list(firm)}.`);
  if (settling.length) lines.push(`Words they know, still settling: ${list(settling)}.`);
  if (fresh.length) {
    lines.push(
      `Words they met in the last day or so: ${list(fresh)}. Say the English meaning straight after one of these the first time you use it.`,
    );
  }
  if (plan.newWord) {
    lines.push(
      `Bring in one new word during the conversation: ${plan.newWord.tl} (${plan.newWord.en}). Use it in a sentence where its meaning is clear, say the English meaning straight after it, and use it again later if it fits.`,
    );
  }
  lines.push(
    'Keep each turn to one to three short sentences, and end with a question or something easy to answer, so they can reply using their Tagalog.',
    'They may answer in English, Tagalog or a mix. If their Tagalog has a mistake, do not point it out; just use the right form naturally in your reply.',
    'Say Tagalog words slowly and clearly. Start by greeting them in Tagalog.',
    'No scores, praise for every reply, or talk of streaks or progress.',
  );
  return lines.join('\n');
}

/** A piece of the AI's text: plain, or a Tagalog word the learner can tap. */
export type Segment = { text: string } | { text: string; card: Card; strength: Strength | 'unseen' };

const fold = (s: string) => s.toLowerCase().normalize('NFC');
/** Letters and the hyphens inside words; everything else is punctuation. */
const WORD = /^([^\p{L}]*)([\p{L}][\p{L}'’-]*[\p{L}]|[\p{L}])?([^\p{L}]*)$/u;

/**
 * Deck words that are also everyday English ("at noon", "I ate", "Lima, Peru"). In a
 * conversation that's mostly English they'd be marked wrongly more often than
 * rightly, so they aren't marked at all.
 */
const ENGLISH_LOOKALIKES = new Set(['at', 'ate', 'lima']);

interface Phrase {
  words: string[];
  card: Card;
  strength: Strength | 'unseen';
}

const phraseCache = new WeakMap<TalkPlan, Phrase[]>();

function phrases(plan: TalkPlan): Phrase[] {
  const cached = phraseCache.get(plan);
  if (cached) return cached;
  const out: Phrase[] = [];
  const add = (card: Card, strength: Strength | 'unseen') => {
    for (const spelling of [card.tl, ...(card.accept ?? [])]) {
      const words = spelling.split(/\s+/).map((w) => fold(w.match(WORD)?.[2] ?? '')).filter(Boolean);
      if (words.length && !(words.length === 1 && ENGLISH_LOOKALIKES.has(words[0]))) out.push({ words, card, strength });
    }
  };
  for (const k of plan.known) add(k.card, k.strength);
  if (plan.newWord) add(plan.newWord, 'unseen');
  // Longest first, so "Maraming salamat" wins over "salamat".
  out.sort((a, b) => b.words.length - a.words.length);
  phraseCache.set(plan, out);
  return out;
}

/** Split the AI's text into plain runs and the deck's Tagalog words and phrases. */
export function findWords(text: string, plan: TalkPlan): Segment[] {
  const all = phrases(plan);
  // Alternating spaces and words; each word keeps its punctuation.
  const tokens = text.split(/(\s+)/);
  const core = tokens.map((t, i) => (i % 2 === 0 ? (t.match(WORD) ?? ['', t, '', '']) : null));
  const segments: Segment[] = [];
  let plain = '';
  let i = 0;
  while (i < tokens.length) {
    const match = i % 2 === 0 && core[i]?.[2] ? all.find((p) => p.words.every((w, j) => fold(core[i + j * 2]?.[2] ?? '') === w)) : undefined;
    if (!match) {
      plain += tokens[i];
      i++;
      continue;
    }
    const last = i + (match.words.length - 1) * 2;
    // Punctuation before the first word and after the last stays plain.
    const [, lead] = core[i]!;
    const [, , lastWord, trail] = core[last]!;
    const middle = tokens.slice(i, last).join('').slice(lead.length);
    plain += lead;
    if (plain) segments.push({ text: plain });
    segments.push({ text: middle + lastWord, card: match.card, strength: match.strength });
    plain = trail;
    i = last + 1;
  }
  if (plain) segments.push({ text: plain });
  return segments;
}

/** A turn of the call's transcript, timed in ms from the start of the call. */
export interface SpokenTurn {
  who: 'you' | 'ai';
  text: string;
  start: number;
  end: number;
}

/** A pause longer than this between two pieces from one speaker starts a new turn. */
export const TURN_GAP_MS = 1500;
/** A gap this long between pieces is a pause between words, not a word split in two. */
const WORD_GAP_MS = 300;

/**
 * Add a piece of transcript to the turns, which are kept in the order they
 * were spoken. A piece continues its speaker's latest turn unless there was a
 * pause or the other speaker started talking since, so a late piece of the
 * learner's speech doesn't split the AI's reply, and a quick answer doesn't
 * land above the question it answers.
 * Returns the index of the turn that changed, and whether it is new.
 */
export function addPiece(turns: SpokenTurn[], who: SpokenTurn['who'], text: string, start: number, end: number): { index: number; added: boolean } {
  let index = turns.length - 1;
  while (index >= 0 && turns[index].who !== who) index--;
  const last = turns[index];
  const interrupted = turns.some((t) => t.who !== who && last && t.start >= last.end && t.start <= start);
  if (last && !interrupted && start - last.end <= TURN_GAP_MS) {
    // Pieces split mid-word run on; after a pause, words need a space between them.
    const space = start - last.end >= WORD_GAP_MS && !/\s$/.test(last.text) && !/^\s/.test(text) ? ' ' : '';
    last.text += space + text;
    last.end = Math.max(last.end, end);
    return { index, added: false };
  }
  let at = turns.length;
  while (at > 0 && turns[at - 1].start > start) at--;
  turns.splice(at, 0, { who, text: text.trimStart(), start, end });
  return { index: at, added: true };
}

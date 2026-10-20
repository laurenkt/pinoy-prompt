// Talk: a conversation in English with the learner's Tagalog mixed in. What
// gets mixed in comes from their memory: every word they have met is used in
// Tagalog, and at most one new word from the deck joins each chat. The AI
// writes the words; the app spots them in what it says, so the learner can tap
// one to hear it and see its meaning.

import { ALL_CARDS, getCard, UNITS, type Card, type Unit } from './deck';
import { strengthOf, type Strength } from './memory';
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

const ORDER: Strength[] = ['long', 'weeks', 'days', 'new'];

/** Topics with at least one word the learner has met. */
export function talkTopics(progress: Progress): Unit[] {
  return UNITS.filter((u) => u.cards.some((c) => progress.cards[c.id]));
}

export function talkPlan(progress: Progress, topicId: string | null): TalkPlan {
  const topic = UNITS.find((u) => u.id === topicId) ?? null;
  const known = Object.entries(progress.cards)
    .map(([id, state]) => ({ card: getCard(id), strength: strengthOf(state) }))
    .filter((k): k is KnownWord => k.card !== undefined)
    .sort((a, b) => ORDER.indexOf(a.strength) - ORDER.indexOf(b.strength));
  const unseen = (c: Card) => !progress.cards[c.id];
  const newWord = topic?.cards.find(unseen) ?? ALL_CARDS.find(unseen) ?? null;
  return { topic, known, newWord };
}

/** How the AI talks with the learner: typed messages or a spoken call. */
export type TalkMode = 'text' | 'voice';

function list(words: KnownWord[]): string {
  return words.map((w) => `${w.card.tl} (${w.card.en})`).join('; ');
}

/** The AI's instructions for a conversation. */
export function talkInstructions(plan: TalkPlan, mode: TalkMode): string {
  const firm = plan.known.filter((w) => w.strength === 'long' || w.strength === 'weeks');
  const settling = plan.known.filter((w) => w.strength === 'days');
  const fresh = plan.known.filter((w) => w.strength === 'new');
  const voice = mode === 'voice';
  const lines = [
    `You are a friendly Filipino conversation partner. The learner is an English speaker learning beginner Tagalog. ${voice ? 'This is a spoken conversation.' : 'This is a text chat.'}`,
    plan.topic
      ? `Talk about everyday situations around this topic: ${plan.topic.title}.`
      : 'Talk about everyday things, like how their day is going, food, family or plans.',
    'Speak English, but use Tagalog for the words and phrases listed below, every time one fits naturally. The more of them you use, the better. Spell or say them exactly as listed. Use no other Tagalog.',
  ];
  if (firm.length) lines.push(`Words they know well: ${list(firm)}.`);
  if (settling.length) lines.push(`Words they know, still settling: ${list(settling)}.`);
  if (fresh.length) {
    lines.push(
      `Words they met in the last day or so: ${list(fresh)}.${voice ? ' Say the English meaning straight after one of these the first time you use it.' : ''}`,
    );
  }
  if (plan.newWord) {
    lines.push(
      `Bring in one new word during the conversation: ${plan.newWord.tl} (${plan.newWord.en}). Use it in a sentence where its meaning is clear${voice ? ', say the English meaning straight after it,' : ''} and use it again later if it fits.`,
    );
  }
  lines.push(
    'Keep each turn to one to three short sentences, and end with a question or something easy to answer, so they can reply using their Tagalog.',
    'They may answer in English, Tagalog or a mix. If their Tagalog has a mistake, do not point it out; just use the right form naturally in your reply.',
    voice
      ? 'Say Tagalog words slowly and clearly. Start by greeting them in Tagalog.'
      : 'Write plain text with no markdown, emoji or translations in brackets; the app shows meanings. Start by greeting them in Tagalog.',
    'No scores, praise for every reply, or talk of streaks or progress.',
  );
  return lines.join('\n');
}

/** A piece of the AI's text: plain, or a Tagalog word the learner can tap. */
export type Segment = { text: string } | { text: string; card: Card; strength: Strength | 'unseen' };

const fold = (s: string) => s.toLowerCase().normalize('NFC');
/** Letters and the hyphens inside words; everything else is punctuation. */
const WORD = /^([^\p{L}]*)([\p{L}][\p{L}'’-]*[\p{L}]|[\p{L}])?([^\p{L}]*)$/u;

interface Phrase {
  words: string[];
  card: Card;
  strength: Strength | 'unseen';
}

function phrases(plan: TalkPlan): Phrase[] {
  const out: Phrase[] = [];
  const add = (card: Card, strength: Strength | 'unseen') => {
    for (const spelling of [card.tl, ...(card.accept ?? [])]) {
      const words = spelling.split(/\s+/).map((w) => fold(w.match(WORD)?.[2] ?? '')).filter(Boolean);
      if (words.length) out.push({ words, card, strength });
    }
  };
  for (const k of plan.known) add(k.card, k.strength);
  if (plan.newWord) add(plan.newWord, 'unseen');
  // Longest first, so "Maraming salamat" wins over "salamat".
  return out.sort((a, b) => b.words.length - a.words.length);
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

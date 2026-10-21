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

/** A word from the learner's own list to show the mix with, so the example brings in no other Tagalog. */
function example(plan: TalkPlan): string {
  const card = plan.known[0]?.card ?? plan.newWord;
  return card ? `"${card.tl}" (${card.en})` : 'a word';
}

/** What a stuck learner might be offered: a known greeting if there is one, so the example reads naturally. */
function stuckExample(plan: TalkPlan): string {
  const known = plan.known.map((k) => k.card);
  const card = known.find((c) => /^(magandang|kumusta)/i.test(c.tl)) ?? known[0] ?? plan.newWord;
  return card ? `${card.tl.replace(/[.!?]+$/, '')}, ${card.en.toLowerCase().replace(/[.!?]+$/, '')}` : 'Salamat, thank you';
}

/** How much Tagalog to mix in: more as the learner knows more. */
export function mixLevel(known: number): string {
  if (known < 20) return 'at most one Tagalog word or phrase in a sentence, where one fits; plain English sentences are fine';
  if (known < 60) return 'up to two or three Tagalog words or phrases in a sentence';
  return 'the listed Tagalog wherever it fits, but keep most of each sentence English';
}

/**
 * The AI's instructions for a call, laid out as OpenAI's GPT-Live prompting
 * guide recommends. The conversation is in English with the learner's Tagalog
 * swapped in, like the Taglish many Filipinos speak, so the instructions say
 * plainly which language to speak and that no other Tagalog is wanted.
 */
export function talkInstructions(plan: TalkPlan): string {
  const firm = plan.known.filter((w) => w.strength === 'long' || w.strength === 'weeks');
  const settling = plan.known.filter((w) => w.strength === 'days');
  const fresh = plan.known.filter((w) => w.strength === 'new');
  const lines = [
    'You are a friendly Filipino friend helping an English speaker practise beginner Tagalog in a relaxed spoken chat. Speak warmly, at an unhurried pace.',
    '',
    'Language: speak English. Mix in Tagalog the way Taglish speakers do, but only the Tagalog listed below: every sentence is an English sentence with some of those words or phrases in place of the English.',
    `Use ${mixLevel(plan.known.length)}.`,
    'A listed phrase counts as one swap. Apart from short listed greetings and replies, never say a whole sentence in Tagalog. Keep speaking English even if the learner uses Tagalog, unless they ask you to switch.',
    `For example, with ${example(plan)} on the list, say an English sentence with it in place of its English meaning.`,
    'Only use a Tagalog word where it means exactly what that spot in the sentence needs. Never tack one onto the end of a sentence or question just to fit it in; a plain English sentence is better than a misplaced word.',
    '',
  ];
  if (firm.length) lines.push(`Tagalog they know well, use it freely: ${list(firm)}.`);
  if (settling.length) lines.push(`Tagalog they know but are still settling: ${list(settling)}.`);
  if (fresh.length) lines.push(`Tagalog they met in the last day or so; say the English meaning straight after it the first time: ${list(fresh)}.`);
  if (plan.newWord) {
    lines.push(
      `One new word to bring in during the call: ${plan.newWord.tl} (${plan.newWord.en}). Use it in a sentence where its meaning is clear, say the English meaning straight after it, and use it again later if it fits.`,
    );
  }
  lines.push(
    'Use no other Tagalog. Say Tagalog words slowly and clearly.',
    '',
    plan.topic
      ? `Talk about everyday situations around this topic: ${plan.topic.title}.`
      : 'Talk about everyday things, like how their day is going, food, family or plans.',
    'Keep each turn to one to three short sentences, and end with a question or something easy to answer, so they can reply using their Tagalog.',
    'They may answer in English, Tagalog or a mix. If their Tagalog has a small mistake, do not dwell on it; use the right form in your reply if it is on the list, otherwise reply in English.',
    '',
    `When they are stuck, help before moving on. They are stuck if they hesitate or trail off, say "um" or "something" in place of a word, start a Tagalog phrase and can't finish it, use an English word where a listed Tagalog one fits, or ask how to say something. Then briefly offer the Tagalog from the list for what they were trying to say, with its meaning (for example: "You could say ${stuckExample(plan)}."), invite them to try it, and wait. If they try it, carry on warmly. If nothing on the list fits, give the simple English and carry on. Never brush a stuck moment off with "that works" or similar.`,
    'No scores, praise for every reply, or talk of streaks or progress.',
    '',
    'Backchannel policy: Use light backchannels. Acknowledge naturally without competing with the main response.',
    '',
    'Interruption policy: Stop speaking when the learner interrupts. Listen to what they say.',
    '',
    'Delegation policy:',
    'Backend tools:',
    '- None.',
    '',
    'Generate <|SpawnThinking|> when:',
    '- Never. There is no backend; answer everything yourself.',
    '',
    'Do not generate <|SpawnThinking|> when:',
    '- Any request. Reply from the conversation.',
  );
  return lines.join('\n');
}

/** What the AI is asked to open the call with: in English, with a Tagalog greeting if the learner knows one. */
export function talkGreeting(plan: TalkPlan): string {
  const about = plan.topic ? ` about ${plan.topic.title.toLowerCase()}` : '';
  return `Greet the learner now in English, using a Tagalog greeting from the list if there is one. Ask one easy question${about}, in English with a Tagalog word or two from the list. Then pause and listen.`;
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

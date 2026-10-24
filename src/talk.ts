// Talk: a spoken conversation in English with the learner's Tagalog mixed in.
// What gets mixed in comes from their memory: any word they have met may be
// said in Tagalog where it fits what is being said, and at most one new word
// from the deck joins each conversation. The words are a limit on which Tagalog
// to use, never a list to get through: a conversation that bends to fit a word
// sounds wrong and teaches the word badly.
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

/** A card for the instructions, with its stress guide: OpenAI's prompting guide asks for pronunciations that matter to be spelled out. */
function say(card: Card): string {
  return `${card.tl} (${card.en})${card.hint ? `, said ${card.hint}` : ''}`;
}

function list(words: KnownWord[]): string {
  return words.map((w) => say(w.card)).join('; ');
}

/** The learner's own time zone, such as "Europe/London"; undefined if the browser won't say. */
function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** The part of the day an hour falls in, as a greeting would see it. */
export function partOfDay(hour: number): string {
  if (hour < 5) return 'late at night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

/**
 * The learner's local day and time, so the AI greets them for the right part
 * of the day. Their time zone stands in for where they are; the app never asks
 * for their location.
 */
export function timeContext(now: Date, timeZone = localTimeZone()): string {
  const options = { timeZone } as const;
  const when = new Intl.DateTimeFormat('en-GB', { ...options, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { ...options, hour: 'numeric', hourCycle: 'h23' }).format(now));
  const zone = timeZone ? ` (their time zone is ${timeZone})` : '';
  return `For the learner it is ${partOfDay(hour)}: ${when}${zone}. Fit greetings and small talk to that time of day; never wish them a good morning, afternoon or evening at the wrong time.`;
}

/** A word from the learner's own list to show the mix with, so the example brings in no other Tagalog. */
function example(plan: TalkPlan): string {
  const card = plan.known[0]?.card ?? plan.newWord;
  return card ? `"${card.tl}" (${card.en})` : 'a word';
}

/**
 * A worked example of helping a stuck learner, from their own firmest everyday
 * word, or null if they know none. Only the first meaning is kept, so a voice
 * model isn't handed slashes or a question mark to read out.
 */
export function stuckExample(plan: TalkPlan): string | null {
  const known = plan.known.map((k) => k.card);
  const card = known.find((c) => c.kind === 'word') ?? known[0];
  if (!card) return null;
  const tl = card.tl.replace(/[.!?]+$/, '');
  const en = card.en.split('/')[0].trim().replace(/[.!?]+$/, '');
  // Lower-case the first letter for the middle of a sentence, but keep "I" and "I'm".
  const meaning = /^I\b/.test(en) ? en : en.charAt(0).toLowerCase() + en.slice(1);
  return `${tl}, ${meaning}`;
}

/** The most Tagalog to mix in: more as the learner knows more. A ceiling, never a target. */
export function mixLevel(known: number): string {
  if (known < 20) return 'at most one Tagalog word or phrase in a sentence';
  if (known < 60) return 'at most two or three Tagalog words or phrases in a sentence';
  return 'at most a few Tagalog words or phrases in a sentence, keeping most of each sentence English';
}

/**
 * The AI's instructions for a call, laid out as OpenAI's GPT-Live prompting
 * guide recommends. The conversation is in English with the learner's Tagalog
 * swapped in, like the Taglish many Filipinos speak, so the instructions say
 * plainly which language to speak and that no other Tagalog is wanted, unless
 * the learner asks how to say something: then they just get the answer.
 */
export function talkInstructions(plan: TalkPlan, now: Date, timeZone?: string): string {
  const firm = plan.known.filter((w) => w.strength === 'long' || w.strength === 'weeks');
  const settling = plan.known.filter((w) => w.strength === 'days');
  const fresh = plan.known.filter((w) => w.strength === 'new');
  const stuck = stuckExample(plan);
  const lines = [
    'You are a friendly Filipino friend from Manila helping an English speaker practise beginner Tagalog in a relaxed spoken chat. Speak warmly, at an unhurried pace.',
    '',
    timeContext(now, timeZone),
    '',
    'Accent: keep a natural Filipino accent the whole call, in English as well as Tagalog, the way someone from Manila speaks Taglish. Never switch to an American accent.',
    'Say every Tagalog word as a native Manila speaker would, not with English sounds: pure vowels a, e, i, o, u, never softened to "uh"; ng as one sound, even at the start of a word; a light tapped r; and, where a word has a guide after it, the stress that guide shows in capitals. Never say the guides themselves aloud.',
    '',
    'Language: speak English. Mix in Tagalog the way Taglish speakers do, but only the Tagalog listed below (the one exception is when they ask how to say something): a Tagalog word or phrase stands in for its English meaning inside an English sentence.',
    'Say what you would naturally say first, then use a listed word only where that sentence already needs its meaning. The list is the Tagalog you may use, not a list to get through: you do not need to use every word, or any particular word, and many sentences will have no Tagalog at all. Never steer the conversation, pick a topic or ask a question just to make room for a word.',
    `Use ${mixLevel(plan.known.length)}; that is a limit, not a target.`,
    'A listed phrase counts as one swap. Apart from short listed greetings and replies, never say a whole sentence in Tagalog. Keep speaking English even if the learner uses Tagalog, unless they ask you to switch.',
    `For example, with ${example(plan)} on the list, say it in place of its English meaning when you are talking about that anyway.`,
    'Only use a Tagalog word where it means exactly what that spot in the sentence needs. Never tack one onto the end of a sentence or question just to fit it in; a plain English sentence is better than a misplaced word.',
    '',
  ];
  if (firm.length) lines.push(`Tagalog they know well: ${list(firm)}.`);
  if (settling.length) lines.push(`Tagalog they know but are still settling: ${list(settling)}.`);
  if (fresh.length) lines.push(`Tagalog they met in the last day or so; say the English meaning straight after it the first time: ${list(fresh)}.`);
  if (plan.newWord) {
    lines.push(
      `One new word they could pick up during the call: ${say(plan.newWord)}. Bring it in only if the conversation reaches a moment that needs its meaning; if none comes, leave it out. When you use it, make its meaning clear from the sentence, say the English meaning straight after it, and use it again later only if it fits.`,
    );
  }
  lines.push(
    'Use no other Tagalog, except when the learner asks how to say something (see below). Say Tagalog words slowly and clearly.',
    '',
    plan.topic
      ? `Talk about everyday situations around this topic: ${plan.topic.title}.`
      : 'Talk about everyday things, like how their day is going, food, family or plans.',
    'Keep each turn to one to three short sentences, and end with a question or something easy to answer, so the conversation keeps going.',
    'They may answer in English, Tagalog or a mix; English answers are fine. If their Tagalog has a mistake, do not point it out; use the right form in your reply if it is on the list, otherwise reply in English.',
    '',
    'When they are stuck, help before moving on. They are stuck if they stop partway through and do not finish, or put "um", "something" or similar where a word should go and leave it there. Give them a moment to think first. Then, in one short sentence, offer the listed Tagalog for what they meant, with its meaning' +
      (stuck ? ` (for example: "You could say: ${stuck}.")` : '') +
      ', ask them to try it, and wait. When they try, just carry on the conversation. If nothing on the list fits, put it simply in English and carry on. Do not skip past a stuck moment.',
    'When they ask how to say something ("how do I say cereal?", "what\'s the word for tired?", "Paano sabihin ito sa Tagalog?"), always just tell them: if it is on the list, give that; otherwise give the everyday Tagalog a Manila speaker would use. Say it slowly with its English meaning, ask them to try it, and wait; when they try, carry on the conversation. Never refuse, deflect, or say it is not in their words. If Filipinos normally just use the English word (as with cereal), say so. If they ask for a whole sentence, give the whole sentence in Tagalog; this overrides the limits on how much Tagalog to use. After that, they may use the word they asked for, and you may use it again in this call too.',
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
  return `Greet the learner now in English, for their time of day, using a Tagalog greeting from the list if one fits that time. Ask one easy question${about} in English, with a listed Tagalog word only where one fits. Then pause and listen.`;
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

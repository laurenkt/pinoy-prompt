// Builds a study session and tracks it as the learner works through it.
// Kept free of DOM code so it can be unit tested.

import { LEARN_ORDER, VOCAB, closeInMeaning, getCard, isVocab, type Card, type CardKind, type Drill } from './deck';
import { recallChance } from './memory';
import { DAY_MS, isDue, type CardState } from './srs';
import type { Progress } from './store';

export type StepKind = 'new' | 'review';

export interface Step {
  cardId: string;
  kind: StepKind;
  /** How to ask it; the session picks one when it's left out. */
  format?: Format;
}

/** How far back in the queue a missed card is re-inserted. */
const REQUEUE_GAP = 3;

export function isIntroduced(progress: Progress, cardId: string): boolean {
  return cardId in progress.cards;
}

export function dueCards(progress: Progress, now: number): string[] {
  return Object.entries(progress.cards)
    // Skip progress for cards since removed from the deck.
    .filter(([id, state]) => isDue(state, now) && getCard(id))
    .sort(([, a], [, b]) => a.due - b.due)
    .map(([id]) => id);
}

export function newCardsLeftToday(progress: Progress): number {
  return Math.max(0, progress.settings.dailyNew - progress.today.newCount);
}

/** Guides (patterns, sounds and so on) wait until the learner has met this many cards. */
export const GUIDE_START = 8;
/** Patterns are grammar, so they wait longer. */
export const PATTERN_START = 20;

/** At most one guide in this many new cards: sparse at first, a little more often once there is more to build on. */
export function guideEvery(met: number): number {
  return met >= 100 ? 4 : 6;
}

/**
 * A card has settled once it has been remembered at least a day after it was
 * met. A card forgotten later and relearned still counts: it was remembered once.
 */
export function settled(progress: Progress, id: string): boolean {
  const state = progress.cards[id];
  return !!state && state.interval >= 1 && (state.reps >= 2 || state.lapses > 0);
}

/** How many cards in the deck the learner hasn't met, guides that aren't ready yet included. */
export function unmetCount(progress: Progress): number {
  return LEARN_ORDER.filter((id) => getCard(id) && !isIntroduced(progress, id)).length;
}

/**
 * The next cards to introduce, most useful first (see LEARN_ORDER). A guide
 * waits until the cards it builds on have settled, the learner has met enough
 * cards, and enough new cards have come since the last guide; then it comes in
 * at the first chance.
 */
export function upcomingNewCards(progress: Progress, limit: number): string[] {
  const met = Object.entries(progress.cards)
    .filter(([id]) => getCard(id))
    .sort(([, a], [, b]) => a.introduced - b.introduced);
  let count = met.length;
  let lastGuide = -1;
  met.forEach(([id], i) => {
    if (!isVocab(getCard(id)!)) lastGuide = i;
  });
  let sinceGuide = lastGuide === -1 ? Infinity : met.length - 1 - lastGuide;

  // Once every word is met, there is nothing left to space guides out with.
  const ready = (card: Card) =>
    count >= (card.kind === 'pattern' ? PATTERN_START : GUIDE_START) &&
    (sinceGuide >= guideEvery(count) - 1 || i >= unmet.length) &&
    (card.needs ?? []).every((id) => settled(progress, id));

  const unmet = LEARN_ORDER.map(getCard).filter((c): c is Card => !!c && !isIntroduced(progress, c.id));
  /** Guides reached in the order but not ready yet, still in order. */
  const waiting: Card[] = [];
  const result: string[] = [];
  let i = 0;
  while (result.length < limit) {
    while (i < unmet.length && !isVocab(unmet[i])) waiting.push(unmet[i++]);
    const guide = waiting.find(ready);
    if (guide) {
      waiting.splice(waiting.indexOf(guide), 1);
      sinceGuide = 0;
    } else if (i < unmet.length) {
      sinceGuide++;
    } else {
      break;
    }
    count++;
    result.push((guide ?? unmet[i++]).id);
  }
  return result;
}

/** How a card is asked. One memory per card: these are different ways of testing it, not separate things to learn. */
export type Format =
  /** See the Tagalog, pick the meaning. */
  | 'read'
  /** Hear the Tagalog, pick the meaning. */
  | 'listen'
  /** See the English, pick the Tagalog. */
  | 'recall'
  /** See the Tagalog, remember the meaning, rate yourself. */
  | 'remember'
  /** Hear the Tagalog, remember the meaning, rate yourself. */
  | 'hear'
  /** See the English, come up with the Tagalog, rate yourself. */
  | 'produce'
  /** A guide: answer one of its questions, often filling a gap in a sentence. */
  | 'gap'
  /** A pattern: put a sentence's words in order, from the English. */
  | 'build'
  /** A guide: think of the answer to one of its questions, then rate yourself. */
  | 'think';

/** What this device can do, which decides the formats on offer. */
export interface Abilities {
  listen: boolean;
}

/**
 * Words still being learned get a multiple-choice check. Learned words are
 * self-rated, because a lucky guess would push a word weeks out; they move from
 * reading and hearing to producing the Tagalog from the English as they hold.
 */
export function pickFormat(state: CardState, can: Abilities, random: () => number = Math.random, kind: CardKind = 'word'): Format {
  if (kind === 'pattern') return state.interval < 1 ? 'gap' : random() < 0.5 ? 'build' : 'think';
  if (kind !== 'word' && kind !== 'phrase') return state.interval < 1 ? 'gap' : 'think';
  if (state.interval < 1) return 'read';
  const formats: Format[] = state.interval < 7 ? ['remember'] : ['remember', 'produce', 'produce'];
  if (can.listen) formats.push('hear');
  return formats[Math.floor(random() * formats.length)];
}

/** New cards wait while this many cards are still being learned (just met, or just forgotten). */
export const MAX_LEARNING = 3;
/** A card shown in the last few steps isn't shown again yet, so a miss gets a short gap. */
const RECENT_GAP = 3;

export function learningCount(progress: Progress): number {
  return Object.entries(progress.cards).filter(([id, state]) => state.interval < 1 && getCard(id)).length;
}

/**
 * Words to study now: everything due, weakest first, then words still being
 * learned that aren't quite due (they're due again within a minute anyway).
 */
export function studyQueue(progress: Progress, now: number): string[] {
  return Object.entries(progress.cards)
    .filter(([id, state]) => (isDue(state, now) || state.interval < 1) && getCard(id))
    .map(([id, state]) => ({ id, early: !isDue(state, now), recall: recallChance(state, now) }))
    .sort((a, b) => Number(a.early) - Number(b.early) || a.recall - b.recall)
    .map(({ id }) => id);
}

/**
 * The next step of open-ended study. In order:
 * 1. Due reviews, weakest first.
 * 2. A new word, but only once nothing is due, few words are still being
 *    learned, and the daily new-word rate allows it.
 * Null once caught up: practice beyond that is Drills' (see pickDrillCard).
 * `recent` is the cards shown this session, latest last.
 */
export function nextStudyStep(progress: Progress, now: number, recent: string[], can: Abilities, random: () => number = Math.random): Step | null {
  const shownRecently = new Set(recent.slice(-RECENT_GAP));
  const last = recent[recent.length - 1];
  const reviewOf = (id: string): Step => ({ cardId: id, kind: 'review', format: pickFormat(progress.cards[id], can, random, getCard(id)!.kind) });
  // A full gap when there's enough to fill it; otherwise just not the same card twice running.
  const queue = studyQueue(progress, now);
  const review = queue.find((id) => !shownRecently.has(id)) ?? queue.find((id) => id !== last);
  if (review) return reviewOf(review);

  if (newCardsLeftToday(progress) > 0 && learningCount(progress) < MAX_LEARNING) {
    const [fresh] = upcomingNewCards(progress, 1);
    if (fresh) return { cardId: fresh, kind: 'new', format: isVocab(getCard(fresh)!) ? 'read' : 'gap' };
  }
  // Nothing else to ask: the card just shown again, rather than calling Study caught up while it's still being learned.
  return queue.length > 0 ? reviewOf(queue[0]) : null;
}

/** How many of the last cards drilled are kept out of the next pick, so nothing comes straight back. */
const DRILL_GAP = 3;
/** Cards met within this long count as new in a drill round, and come up more. */
const FRESH_MS = 7 * DAY_MS;

/**
 * How much a card needs drilling. Every card starts at 1, so the strong ones
 * still turn up now and then; on top of that come how likely it is to have
 * been forgotten, being still learned or recently met, how often it has been
 * forgotten before, and misses this round (`missed`), which count most.
 */
export function drillWeight(state: CardState, now: number, missed = 0): number {
  const fading = 1 - recallChance(state, now);
  const learning = state.interval < 1 ? 3 : state.interval < 7 ? 1.5 : 0;
  const fresh = now - state.introduced < FRESH_MS ? 2 : 0;
  return 1 + 8 * fading + learning + fresh + 2 * Math.min(state.lapses, 3) + 4 * missed;
}

/**
 * The next card for a drill round, which runs until the learner stops it: any
 * card met, words and guides alike, that `askable` allows, picked at random by
 * drillWeight. The last few cards asked (`recent`, latest last) sit out while
 * that leaves one to ask. Null with nothing to ask.
 */
export function pickDrillCard(
  progress: Progress,
  now: number,
  recent: string[],
  missed: ReadonlyMap<string, number>,
  askable: (card: Card) => boolean = () => true,
  random: () => number = Math.random,
): Card | null {
  const pool = Object.entries(progress.cards)
    .map(([id, state]) => ({ card: getCard(id), state }))
    .filter((p): p is { card: Card; state: CardState } => !!p.card && askable(p.card))
    .map(({ card, state }) => ({ card, w: drillWeight(state, now, missed.get(card.id)) }));
  const keep = Math.min(DRILL_GAP, pool.length - 1);
  const skip = new Set(keep > 0 ? recent.slice(-keep) : []);
  const open = pool.filter((p) => !skip.has(p.card.id));
  if (open.length === 0) return null;
  let r = random() * open.reduce((sum, p) => sum + p.w, 0);
  return (open.find((p) => (r -= p.w) <= 0) ?? open[open.length - 1]).card;
}

/** A few more new cards beyond the daily rate, for when the learner wants them. */
export function buildExtraSession(progress: Progress, size = 5): Step[] {
  return upcomingNewCards(progress, size).map((cardId) => ({ cardId, kind: 'new' }));
}

/** Put a missed card back a few steps later so it comes round again this session. */
export function requeue(queue: Step[], step: Step): Step[] {
  const next = [...queue];
  next.splice(Math.min(REQUEUE_GAP, next.length), 0, { cardId: step.cardId, kind: 'review' });
  return next;
}

/**
 * Pick wrong answers for a multiple-choice question on a word or phrase.
 * Prefers cards of the same kind (word vs phrase) so the right answer can't be
 * spotted by its length, and never one that could also be right (CLOSE_MEANINGS).
 * Guides are never used.
 */
export function distractors(
  card: Card,
  field: 'en' | 'tl',
  count: number,
  pool: Card[] = VOCAB,
  random: () => number = Math.random,
): Card[] {
  const seen = new Set([card[field].toLowerCase()]);
  const candidates = shuffle(
    pool.filter((c) => c.id !== card.id && isVocab(c) && !closeInMeaning(c.id, card.id)),
    random,
  ).sort((a, b) => Number(b.kind === card.kind) - Number(a.kind === card.kind));
  const picked: Card[] = [];
  for (const c of candidates) {
    const key = c[field].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(c);
    if (picked.length === count) break;
  }
  return picked;
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A drill's whole Tagalog sentence, with the answer in its gap. */
export function drillSentence(drill: Drill): string {
  return drill.tl ? drill.tl.replace('___', drill.answer) : drill.answer;
}

/**
 * The words to build a drill's sentence from, lower case and without
 * punctuation, so a capital or a full stop doesn't give the order away. A
 * one-word wrong answer joins them as a decoy.
 */
export function buildTiles(drill: Drill): { words: string[]; decoy?: string } {
  const words = tileWords(drillSentence(drill));
  const decoy = drill.wrong.find((w) => !w.includes(' ') && !words.includes(tileWords(w)[0]));
  return { words, decoy: decoy && tileWords(decoy)[0] };
}

function tileWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?"]/g, '')
    .split(' ')
    .filter(Boolean);
}

/** Whether a drill makes a sentence worth building from tiles. */
export function canBuild(drill: Drill): boolean {
  return !!drill.tl && buildTiles(drill).words.length >= 3;
}

/**
 * One of a guide's drills to ask, at random so a pattern turns up in fresh
 * sentences. Prefers drills made only of cards the learner has met, and for
 * `build`, ones with a sentence to build. Never the drill asked last time, if
 * there is another.
 */
export function pickDrill(
  card: Card,
  progress: Progress,
  format: Format,
  last?: Drill,
  random: () => number = Math.random,
): Drill | undefined {
  let drills = card.drills ?? [];
  if (format === 'build') drills = drills.filter(canBuild);
  const known = drills.filter((d) => (d.uses ?? []).every((id) => isIntroduced(progress, id)));
  if (known.length > 0) drills = known;
  if (drills.length > 1 && last) drills = drills.filter((d) => d !== last);
  return drills[Math.floor(random() * drills.length)];
}

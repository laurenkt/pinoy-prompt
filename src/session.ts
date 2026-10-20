// Builds a study session and tracks it as the learner works through it.
// Kept free of DOM code so it can be unit tested.

import { ALL_CARDS, getCard, type Card } from './deck';
import { recallChance } from './memory';
import { isDue, type CardState } from './srs';
import type { Progress } from './store';

/** Extra steps are practice beyond the schedule: they never change it. */
export type StepKind = 'new' | 'review' | 'extra';

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

/** The next cards to introduce, in deck order. */
export function upcomingNewCards(progress: Progress, limit: number): string[] {
  const result: string[] = [];
  for (const card of ALL_CARDS) {
    if (result.length >= limit) break;
    if (!isIntroduced(progress, card.id)) result.push(card.id);
  }
  return result;
}

/** How a card is asked. One memory per word: these are different ways of testing it, not separate things to learn. */
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
  /** Say it out loud and get coached. Pronunciation only, so it never changes the schedule. */
  | 'speak';

/** What this device can do, which decides the formats on offer. */
export interface Abilities {
  listen: boolean;
  speak: boolean;
}

/**
 * Words still being learned get a multiple-choice check. Learned words are
 * self-rated, because a lucky guess would push a word weeks out; they move from
 * reading and hearing to producing the Tagalog from the English as they hold.
 */
export function pickFormat(state: CardState, can: Abilities, random: () => number = Math.random): Format {
  if (state.interval < 1) return 'read';
  const formats: Format[] = state.interval < 7 ? ['remember'] : ['remember', 'produce', 'produce'];
  if (can.listen) formats.push('hear');
  return formats[Math.floor(random() * formats.length)];
}

/** New words wait while this many words are still being learned (just met, or just forgotten). */
export const MAX_LEARNING = 3;
/** A card shown in the last few steps isn't shown again yet, so a miss gets a short gap. */
const RECENT_GAP = 3;
/** Roughly one in this many practice steps is a speaking one, when the device can do it. */
const SPEAK_EVERY = 4;

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
 * 3. Extra practice on the weakest words, which doesn't change the schedule.
 * `recent` is the cards shown this session, latest last. `misses` counts
 * extra-practice misses this session, so those words come round again.
 */
export function nextStudyStep(
  progress: Progress,
  now: number,
  recent: string[],
  can: Abilities,
  misses: ReadonlyMap<string, number> = new Map(),
  random: () => number = Math.random,
): Step | null {
  const shownRecently = new Set(recent.slice(-RECENT_GAP));
  const last = recent[recent.length - 1];
  // A full gap when there's enough to fill it; otherwise just not the same card twice running.
  const queue = studyQueue(progress, now);
  const review = queue.find((id) => !shownRecently.has(id)) ?? queue.find((id) => id !== last);
  if (review) return { cardId: review, kind: 'review', format: pickFormat(progress.cards[review], can, random) };

  if (newCardsLeftToday(progress) > 0 && learningCount(progress) < MAX_LEARNING) {
    const [fresh] = upcomingNewCards(progress, 1);
    if (fresh) return { cardId: fresh, kind: 'new', format: 'read' };
  }

  const known = Object.entries(progress.cards).filter(([id]) => getCard(id));
  if (known.length === 0) return null;
  const ranked = known
    .map(([id, state]) => ({ id, weakness: recallChance(state, now) - (misses.get(id) ?? 0) }))
    .sort((a, b) => a.weakness - b.weakness)
    .map(({ id }) => id);
  // Small decks can't keep a full gap, but never ask the same card twice in a row unless it's the only one.
  const cardId = ranked.find((id) => !shownRecently.has(id)) ?? ranked.find((id) => id !== last) ?? ranked[0];
  const formats: Format[] = ['read', 'recall'];
  if (can.listen) formats.push('listen');
  const format = can.speak && random() < 1 / SPEAK_EVERY ? 'speak' : formats[Math.floor(random() * formats.length)];
  return { cardId, kind: 'extra', format };
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
 * Pick wrong answers for a multiple-choice question. Prefers cards of the same
 * kind (word vs phrase) so the right answer can't be spotted by its length.
 */
export function distractors(
  card: Card,
  field: 'en' | 'tl',
  count: number,
  pool: Card[] = ALL_CARDS,
  random: () => number = Math.random,
): Card[] {
  const seen = new Set([card[field].toLowerCase()]);
  const candidates = shuffle(
    pool.filter((c) => c.id !== card.id),
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

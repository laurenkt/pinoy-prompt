// Builds a study session and tracks it as the learner works through it.
// Kept free of DOM code so it can be unit tested.

import { ALL_CARDS, UNITS, getCard, type Card, type Unit } from './deck';
import { isDue } from './srs';
import type { Progress } from './store';

export type StepKind = 'new' | 'review';

export interface Step {
  cardId: string;
  kind: StepKind;
}

const MAX_REVIEWS = 50;
/** How far back in the queue a missed card is re-inserted. */
const REQUEUE_GAP = 3;

export function isIntroduced(progress: Progress, cardId: string): boolean {
  return cardId in progress.cards;
}

export function unitProgress(progress: Progress, unit: Unit): { introduced: number; total: number } {
  const introduced = unit.cards.filter((c) => isIntroduced(progress, c.id)).length;
  return { introduced, total: unit.cards.length };
}

/** A unit unlocks once every card in the unit before it has been introduced. */
export function isUnlocked(progress: Progress, unitIndex: number): boolean {
  if (unitIndex <= 0) return true;
  const prev = UNITS[unitIndex - 1];
  return prev.cards.every((c) => isIntroduced(progress, c.id));
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

/** The next cards to introduce, in deck order, from unlocked units only. */
export function upcomingNewCards(progress: Progress, limit: number, unitId?: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < UNITS.length && result.length < limit; i++) {
    const unit = UNITS[i];
    if (unitId && unit.id !== unitId) continue;
    if (!isUnlocked(progress, i)) break;
    for (const card of unit.cards) {
      if (result.length >= limit) break;
      if (!isIntroduced(progress, card.id)) result.push(card.id);
    }
  }
  return result;
}

/**
 * The day's session: due reviews with new cards mixed in, one new card after
 * every few reviews so a long review backlog never hides new material.
 */
export function buildSession(progress: Progress, now: number): Step[] {
  const reviews = dueCards(progress, now).slice(0, MAX_REVIEWS);
  const fresh = upcomingNewCards(progress, newCardsLeftToday(progress));
  const steps: Step[] = [];
  let r = 0;
  let n = 0;
  while (r < reviews.length || n < fresh.length) {
    for (let i = 0; i < 3 && r < reviews.length; i++) steps.push({ cardId: reviews[r++], kind: 'review' });
    if (n < fresh.length) steps.push({ cardId: fresh[n++], kind: 'new' });
  }
  return steps;
}

/** A session focused on one unit's new cards, ignoring the daily limit. */
export function buildUnitSession(progress: Progress, unitId: string, size = 5): Step[] {
  return upcomingNewCards(progress, size, unitId).map((cardId) => ({ cardId, kind: 'new' }));
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

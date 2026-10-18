// A small SM-2 style scheduler.
//
// Each card carries an ease factor and an interval in days. Ratings move the
// interval forward (or reset it on a miss) and nudge the ease up or down.

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface CardState {
  /** Ease factor; the interval multiplier for a "good" answer. */
  ease: number;
  /** Current interval in days. 0 means the card is still being learned. */
  interval: number;
  /** Consecutive successful reviews. */
  reps: number;
  /** Total times the card was forgotten after being learned. */
  lapses: number;
  /** When the card is next due, as epoch milliseconds. */
  due: number;
  /** When the card was first introduced, as epoch milliseconds. */
  introduced: number;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3;
const START_EASE = 2.5;
const RELEARN_DELAY_MS = 60 * 1000;

export function newCardState(now: number): CardState {
  return { ease: START_EASE, interval: 0, reps: 0, lapses: 0, due: now, introduced: now };
}

/** Interval in days the card would get for a rating, without changing it. */
export function nextInterval(card: CardState, rating: Rating): number {
  switch (rating) {
    case 'again':
      return 0;
    case 'hard':
      return Math.max(1, round1(card.interval * 1.2));
    case 'good':
      if (card.reps === 0) return 1;
      if (card.reps === 1) return 3;
      return Math.max(card.interval + 1, round1(card.interval * card.ease));
    case 'easy':
      if (card.reps === 0) return 4;
      return Math.max(card.interval + 1, round1(card.interval * card.ease * 1.3));
  }
}

export function review(card: CardState, rating: Rating, now: number): CardState {
  const interval = nextInterval(card, rating);
  const next: CardState = { ...card, interval };

  switch (rating) {
    case 'again':
      next.ease = Math.max(MIN_EASE, card.ease - 0.2);
      next.reps = 0;
      if (card.reps > 0) next.lapses = card.lapses + 1;
      next.due = now + RELEARN_DELAY_MS;
      return next;
    case 'hard':
      next.ease = Math.max(MIN_EASE, card.ease - 0.15);
      break;
    case 'good':
      break;
    case 'easy':
      next.ease = card.ease + 0.15;
      break;
  }
  next.reps = card.reps + 1;
  next.due = now + interval * DAY_MS;
  return next;
}

export function isDue(card: CardState, now: number): boolean {
  return card.due <= now;
}

/** A card counts as "known" once it has survived a few weeks between reviews. */
export function isMature(card: CardState): boolean {
  return card.interval >= 21;
}

/** Short human label for an interval, e.g. "1m", "3d", "2mo". */
export function formatInterval(days: number): string {
  if (days <= 0) return '1m';
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${round1(days / 365)}y`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

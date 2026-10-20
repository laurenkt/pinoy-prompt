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
  /** When the card was last reviewed. Missing on cards saved before it was tracked. */
  reviewed?: number;
  /**
   * Each time the card moved to a different strength (see memory.ts), as
   * [time, new interval] pairs, oldest first. Missing on cards saved before it
   * was tracked; their past is worked out from the schedule instead.
   */
  log?: [number, number][];
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_EASE = 1.3;
export const START_EASE = 2.5;
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
  const next: CardState = { ...card, interval, reviewed: now };

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
  next.due = startOfDayAfter(now, interval);
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

/**
 * Local midnight of the day an interval lands on, so a card due "in 1 day" is
 * ready first thing tomorrow rather than at this exact time tomorrow.
 */
export function startOfDayAfter(now: number, days: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + Math.round(days));
  return d.getTime();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

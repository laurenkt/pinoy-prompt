// A small SM-2 style scheduler.
//
// Each card carries an ease factor and an interval in days. Ratings move the
// interval forward (or reset it on a miss) and nudge the ease up or down.
// Intervals run from the moment of the review, so a card seen at 3pm with a
// one-day interval is due at 3pm tomorrow, and reviews trickle in through the
// day instead of all landing at midnight.

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
  /**
   * Drills only, never the schedule: how many times its answer was picked from the choices after "Show choices"
   * (MAX_HINTED at most), less the times it has been typed right since. Brings it up more in drill rounds until
   * it's answered without them (see drillWeight). Missing means none.
   */
  hinted?: number;
}

/** Most "Show choices" answers a card's `hinted` holds, so a few answers typed right are enough to clear it. */
export const MAX_HINTED = 3;

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

/** Short human label for an interval, e.g. "1m", "3d", "2mo": to the nearest unit, or with `up`, rounded up. */
export function formatInterval(days: number, { up = false } = {}): string {
  const round = up ? Math.ceil : Math.round;
  if (days <= 0) return '1m';
  if (days < 30) return `${round(days)}d`;
  const months = round(days / 30);
  // Rounded up, the last days of a year would say "13mo".
  if (days < 365 && months <= 12) return `${months}mo`;
  return `${up ? Math.ceil(days / 36.5) / 10 : round1(days / 365)}y`;
}

/** Local midnight a whole number of days after (or before) the day of `now`. */
export function startOfDayAfter(now: number, days: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + Math.round(days));
  return d.getTime();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

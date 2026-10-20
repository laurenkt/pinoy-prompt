// What the learner's memory looks like, worked out from the review schedule.
// Nothing here is stored: it is all derived from saved progress, so it is
// right for progress saved by any earlier version of the app too.

import { getCard } from './deck';
import { DAY_MS, startOfDayAfter, type CardState } from './srs';
import { dayKey, type Progress } from './progress-schema';

/** How long a word holds in memory before it needs a review. */
export type Strength = 'new' | 'days' | 'weeks' | 'long';

export const STRENGTHS: { id: Strength; label: string; desc: string }[] = [
  { id: 'new', label: 'Just met', desc: 'back within a day' },
  { id: 'days', label: 'Days', desc: 'holds for a few days' },
  { id: 'weeks', label: 'Weeks', desc: 'holds for a week or two' },
  { id: 'long', label: 'Long-term', desc: 'holds for three weeks or more' },
];

/** Reviews needed before measured recall is shown instead of the estimate. */
export const MIN_MEASURED_REVIEWS = 10;
/** How many days back measured recall looks. */
export const RECALL_WINDOW_DAYS = 30;

/**
 * The interval is how long the scheduler expects the word to hold, so it is a
 * direct read of how firmly it is stored. "Long-term" matches isMature().
 */
export function strengthOf(card: CardState): Strength {
  if (card.interval < 1) return 'new';
  if (card.interval < 7) return 'days';
  if (card.interval < 21) return 'weeks';
  return 'long';
}

/**
 * When the card was last answered. Older saves don't record it, so it is
 * worked back from the schedule: due is local midnight a whole number of days
 * after the review, so the review was on that day; midday is the best guess.
 */
function lastSeen(card: CardState, now: number): number {
  const seen =
    card.reviewed ??
    (card.interval >= 1 ? startOfDayAfter(card.due, -Math.round(card.interval)) + DAY_MS / 2 : card.introduced);
  return Math.min(seen, now);
}

/**
 * Estimated chance of recalling the card right now. Uses the forgetting curve
 * from FSRS, taking the interval as the time at which recall falls to 90%, which
 * is what the schedule aims for.
 */
export function recallChance(card: CardState, now: number): number {
  // A word not yet learned, or just forgotten, is a coin toss at best, even
  // straight after seeing the answer, and fades within hours.
  if (card.interval < 1) {
    const days = (now - lastSeen(card, now)) / DAY_MS;
    return 0.5 * Math.pow(1 + ((19 / 81) * days) / 0.25, -0.5);
  }
  const days = (now - lastSeen(card, now)) / DAY_MS;
  return Math.pow(1 + ((19 / 81) * days) / card.interval, -0.5);
}

export interface MemorySummary {
  /** Words and phrases met so far. */
  total: number;
  strengths: Record<Strength, number>;
  /** Average estimated recall right now, 0 to 1; null with no words. */
  estimatedRecall: number | null;
  /** Reviews of learned words in the last RECALL_WINDOW_DAYS days. */
  recent: { reviews: number; missed: number };
  /** Reviews falling due later today or tomorrow, and in the rest of the coming week. */
  due: { tomorrow: number; week: number };
}

export function memorySummary(progress: Progress, now: number): MemorySummary {
  // Only cards still in the deck count; saved progress may outlive removed cards.
  const cards = Object.entries(progress.cards)
    .filter(([id]) => getCard(id))
    .map(([, card]) => card);
  const strengths: Record<Strength, number> = { new: 0, days: 0, weeks: 0, long: 0 };
  const due = { tomorrow: 0, week: 0 };
  const endOfTomorrow = startOfDayAfter(now, 2);
  const endOfWeek = startOfDayAfter(now, 8);
  let recall = 0;
  for (const card of cards) {
    strengths[strengthOf(card)]++;
    recall += recallChance(card, now);
    if (card.due <= now) continue;
    if (card.due < endOfTomorrow) due.tomorrow++;
    else if (card.due < endOfWeek) due.week++;
  }
  return {
    total: cards.length,
    strengths,
    estimatedRecall: cards.length ? recall / cards.length : null,
    recent: recentReviews(progress, now),
    due,
  };
}

/** Totals of the day tallies within the recall window, today included. */
export function recentReviews(progress: Progress, now: number, days = RECALL_WINDOW_DAYS): { reviews: number; missed: number } {
  const from = dayKey(startOfDayAfter(now, 1 - days));
  const today = dayKey(now);
  let reviews = 0;
  let missed = 0;
  for (const [day, tally] of Object.entries(progress.history)) {
    // A day after today came from a device with its clock set ahead.
    if (day < from || day > today) continue;
    reviews += tally.reviews;
    missed += tally.missed;
  }
  return { reviews, missed };
}

/**
 * The card's strength over time, as [time, strength] steps, oldest first: it
 * is "new" from when it was introduced, then moves at each step. Cards saved
 * before moves were logged get a likely past worked back from the schedule.
 */
export function strengthSteps(card: CardState, now: number): [number, Strength][] {
  // Times are kept within [introduced, now], so a clock that ran ahead can't
  // leave a word out of today's count.
  const start = Math.min(card.introduced, now);
  const steps: [number, Strength][] = [[start, 'new']];
  const seen = lastSeen(card, now);
  const current = strengthOf(card);
  for (const [at, interval] of pastLog(card, now)) {
    steps.push([Math.min(Math.max(at, start, steps[steps.length - 1][0]), now), strengthOf({ ...card, interval })]);
  }
  // An older build may have reviewed the card without logging the move.
  if (steps[steps.length - 1][1] !== current) steps.push([Math.max(seen, steps[steps.length - 1][0]), current]);
  return steps;
}

/** The card's log, or for a card saved without one, a likely one. */
export function pastLog(card: CardState, now: number): [number, number][] {
  return card.log ?? guessedLog(card, lastSeen(card, now));
}

/**
 * A likely log for a card saved without one: the "good" path the scheduler
 * takes to reach the card's interval (1 day, 3 days, then times the ease), each
 * review falling when the one before came due.
 */
function guessedLog(card: CardState, seen: number): [number, number][] {
  if (card.interval < 1) return [];
  const intervals = [1];
  for (let next = 3; intervals[intervals.length - 1] < card.interval && next < card.interval; next *= card.ease) {
    intervals.push(next);
  }
  // The interval reached might fall between two guessed ones; end on it.
  if (intervals[intervals.length - 1] !== card.interval) intervals.push(card.interval);
  // The last review was `seen`, and each earlier one an interval before the
  // next. Real paths often jump further in fewer reviews, so if the guess
  // doesn't fit since the card was introduced, the gaps are squeezed to fit.
  const gaps = intervals.slice(0, -1).map((days) => days * DAY_MS);
  const span = gaps.reduce((sum, gap) => sum + gap, 0);
  const scale = span > 0 ? Math.min(1, Math.max(0, seen - card.introduced) / span) : 1;
  const log: [number, number][] = [];
  let at = seen;
  for (let i = intervals.length - 1; i >= 0; i--) {
    log.unshift([Math.max(at, card.introduced), intervals[i]]);
    if (i > 0) at -= gaps[i - 1] * scale;
  }
  // Only moves to a new strength are logged.
  const strength = (interval: number) => strengthOf({ ...card, interval });
  return log.filter(([, interval], i) => strength(interval) !== strength(i ? log[i - 1][1] : 0));
}

export interface MemoryHistory {
  /** When the first word was met (now, with none). */
  since: number;
  /** Sample times, oldest first; the last is now. */
  times: number[];
  /** How many words had each strength at each sample time. */
  counts: Record<Strength, number[]>;
}

/** Shortest span the history covers, so a first day still reads as a start. */
export const MIN_HISTORY_DAYS = 7;
/** No word was met before the app existed; an earlier time is a damaged save. */
const EARLIEST = new Date(2025, 0, 1).getTime();

/**
 * How many words had each strength, sampled evenly from the first word met
 * (or a week ago, if later) up to now.
 */
export function memoryHistory(progress: Progress, now: number, samples = 64): MemoryHistory {
  samples = Math.max(2, Math.round(samples));
  const steps = Object.entries(progress.cards)
    .filter(([id]) => getCard(id))
    .map(([, card]) => strengthSteps(card, now));
  const since = Math.min(now, Math.max(EARLIEST, Math.min(...steps.map((s) => s[0][0]))));
  const first = Math.min(now - MIN_HISTORY_DAYS * DAY_MS, since);
  const times = Array.from({ length: samples }, (_, i) => first + ((now - first) * i) / (samples - 1));
  const counts: Record<Strength, number[]> = {
    new: times.map(() => 0),
    days: times.map(() => 0),
    weeks: times.map(() => 0),
    long: times.map(() => 0),
  };
  for (const card of steps) {
    // Walk the card's steps alongside the sample times.
    let step = -1;
    times.forEach((t, i) => {
      while (step + 1 < card.length && card[step + 1][0] <= t) step++;
      if (step >= 0) counts[card[step][1]][i]++;
    });
  }
  return { since, times, counts };
}

// What the learner's memory looks like, worked out from the review schedule.
// Nothing here is stored: it is all derived from saved progress, so it is
// right for progress saved by any earlier version of the app too.

import { getCard } from './deck';
import { DAY_MS, startOfDayAfter, type CardState } from './srs';
import { dayKey, type Progress } from './store';

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

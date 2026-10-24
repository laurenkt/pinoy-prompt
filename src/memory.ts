// What the learner's memory looks like, worked out from the review schedule.
// Nothing here is stored: it is all derived from saved progress, so it is
// right for progress saved by any earlier version of the app too.

import { ALL_CARDS, isVocab, keyed, studyWays, type Card } from './deck';
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
 * worked back from the schedule. Those saves come from builds that put due at
 * local midnight a whole number of days after the review, so the review was on
 * that day and midday is the best guess; otherwise due is exactly one interval
 * after the review.
 */
export function lastSeen(card: CardState, now: number): number {
  return Math.min(card.reviewed ?? guessedReview(card), now);
}

function guessedReview(card: CardState): number {
  if (card.interval < 1) return card.introduced;
  if (startOfDayAfter(card.due, 0) === card.due) return startOfDayAfter(card.due, -Math.round(card.interval)) + DAY_MS / 2;
  return card.due - card.interval * DAY_MS;
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

/** How many of these cards are at each strength. */
export function strengthCounts(cards: readonly CardState[]): Record<Strength, number> {
  const counts: Record<Strength, number> = { new: 0, days: 0, weeks: 0, long: 0 };
  for (const card of cards) counts[strengthOf(card)]++;
  return counts;
}

export interface MemorySummary {
  /** Words and phrases met so far. */
  total: number;
  strengths: Record<Strength, number>;
  /** Average estimated recall right now, 0 to 1; null with no words. */
  estimatedRecall: number | null;
  /** Reviews of learned words in the last RECALL_WINDOW_DAYS days. */
  recent: { reviews: number; missed: number };
  /** Reviews not yet due but falling due by the end of tomorrow (later today included), and in the rest of the coming week. */
  due: { tomorrow: number; week: number };
}

export function memorySummary(progress: Progress, now: number): MemorySummary {
  // Only cards still in the deck count; saved progress may outlive removed cards.
  const cards = Object.entries(progress.cards)
    .filter(([key]) => keyed(key))
    .map(([, card]) => card);
  const due = { tomorrow: 0, week: 0 };
  const endOfTomorrow = startOfDayAfter(now, 2);
  const endOfWeek = startOfDayAfter(now, 8);
  let recall = 0;
  for (const card of cards) {
    recall += recallChance(card, now);
    if (card.due <= now) continue;
    if (card.due < endOfTomorrow) due.tomorrow++;
    else if (card.due < endOfWeek) due.week++;
  }
  return {
    total: cards.length,
    strengths: strengthCounts(cards),
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
 * How long the card was expected to hold over time, as [time, interval in days] steps, oldest first: 0 from when it
 * was introduced, then a step at each move to a new strength (see `log`). Cards saved before moves were logged get a
 * likely past worked back from the schedule.
 */
export function intervalSteps(card: CardState, now: number): [number, number][] {
  // Times are kept within [introduced, now], so a clock that ran ahead can't
  // leave a word out of today's count.
  const start = Math.min(card.introduced, now);
  const steps: [number, number][] = [[start, 0]];
  const seen = lastSeen(card, now);
  for (const [at, interval] of pastLog(card, now)) {
    steps.push([Math.min(Math.max(at, start, steps[steps.length - 1][0]), now), interval]);
  }
  // An older build may have reviewed the card without logging the move.
  const [lastAt, lastInterval] = steps[steps.length - 1];
  if (strengthOf({ ...card, interval: lastInterval }) !== strengthOf(card)) steps.push([Math.max(seen, lastAt), card.interval]);
  return steps;
}

/**
 * The card's strength over time, as [time, strength] steps, oldest first: it
 * is "new" from when it was introduced, then moves at each step.
 */
export function strengthSteps(card: CardState, now: number): [number, Strength][] {
  return intervalSteps(card, now).map(([at, interval]) => [at, strengthOf({ ...card, interval })]);
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
    .filter(([key]) => keyed(key))
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

/**
 * Rough vocabulary sizes for what a learner can do, in plain words. There are
 * no published figures for Tagalog, so these are rounded from the usual
 * estimates for English and other European languages: about 500 words at CEFR
 * A1, 1,000 at A2, 2,000 to 3,000 at B1 and 4,000 at B2 (Nation; Milton).
 * Sources differ by twice or more, so the app only ever calls them rough.
 */
export const MILESTONES: { words: number; label: string }[] = [
  { words: 500, label: 'Everyday basics' },
  { words: 1000, label: 'Get by on a trip' },
  { words: 2500, label: 'Casual conversation' },
  { words: 4000, label: 'Talk about most things' },
];

/**
 * Cards the deck spends on each Tagalog word it teaches, so the milestones can
 * be counted in cards like the rest of the chart: each way a card is studied
 * (studyWays) is a card of its own. A phrase teaches several
 * words but repeats many met before, and guides (patterns, sounds) teach none.
 * Each spelling counts as a word, so "maganda" and "magandang" are two: rough,
 * like the milestones themselves.
 */
export function cardsPerWord(cards: readonly Card[] = ALL_CARDS): number {
  const words = new Set(cards.filter(isVocab).flatMap((c) => c.tl.toLowerCase().match(/\p{L}[\p{L}'-]*/gu) ?? []));
  const studied = cards.reduce((sum, c) => sum + studyWays(c).length, 0);
  return words.size ? studied / words.size : 1;
}

/** Worked out once: the deck only changes with the app. */
const CARDS_PER_WORD = cardsPerWord();

/** A milestone's words as cards, rounded so it doesn't read as exact. */
function inCards(words: number, perWord: number): number {
  const step = words >= 100 ? 50 : 1;
  return Math.round((words * perWord) / step) * step;
}

/** How far back the pace looks. */
export const PACE_DAYS = 28;
/** Less learning than this to look back on, and the pace is only an early guess. */
export const MIN_PACE_DAYS = 14;
/** Further out than this, a date means nothing. */
const MAX_FORECAST_YEARS = 20;

export interface Forecast {
  /** Cards that have stuck: they hold for a week or more (early on, every card met). */
  known: number;
  /** Net cards stuck per day over the days looked back on; null with too little to go on. */
  perDay: number | null;
  /**
   * Under MIN_PACE_DAYS of learning, too few cards have had a week to stick,
   * so an early guess counts every card met instead. It runs ahead of the real
   * pace, as some of those cards will slip.
   */
  early: boolean;
  /** Days the pace was measured over. */
  days: number;
  /** When each milestone, in cards, might be reached: 'reached', a time, null if not at this pace. */
  milestones: { cards: number; label: string; at: 'reached' | number | null }[];
  /** The curve the dates come from; null with no pace to go on. */
  curve: LearningCurve | null;
}

/**
 * Words over time from today: rising at today's pace and bending by `power`,
 * with days counted from the first word (`days` of them today). A power under
 * 1 is a pace that eases off, as reviews of earlier words take more of each
 * session; 1 keeps today's pace.
 */
export interface LearningCurve {
  now: number;
  days: number;
  known: number;
  perDay: number;
  power: number;
}

/** The power is kept to this range: a curve that eases off, at most to this extent, or a steady pace. */
const MIN_POWER = 0.7;
const MAX_POWER = 1;

export function curveAt(curve: LearningCurve, time: number): number {
  const { days, known, perDay, power } = curve;
  const ratio = Math.max(0, days + (time - curve.now) / DAY_MS) / days;
  return known + ((perDay * days) / power) * (ratio ** power - 1);
}

/** When the curve reaches `words`. */
export function curveReaches(curve: LearningCurve, words: number): number {
  const { days, known, perDay, power } = curve;
  const ratio = (1 + ((words - known) * power) / (perDay * days)) ** (1 / power);
  return curve.now + (ratio - 1) * days * DAY_MS;
}

/**
 * The power that best fits [days, words] points, by least squares on their
 * logs, kept within range; null with too few points to show a shape.
 */
export function fitPower(points: [number, number][]): number | null {
  const logs = points.filter(([d, w]) => d >= 1 && w > 0).map(([d, w]) => [Math.log(d), Math.log(w)]);
  if (logs.length < 3) return null;
  const mx = logs.reduce((sum, [x]) => sum + x, 0) / logs.length;
  const my = logs.reduce((sum, [, y]) => sum + y, 0) / logs.length;
  const sxx = logs.reduce((sum, [x]) => sum + (x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = logs.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0);
  return Math.min(MAX_POWER, Math.max(MIN_POWER, sxy / sxx));
}

/**
 * When the learner might reach each milestone, if their learning carries on
 * the way it has gone: from today's count at the pace of the last few weeks,
 * bending as their cards met over time have (eased off, or steady). It counts
 * cards, like the chart, each milestone's words turned into cards by
 * `perWord`; and cards that have stuck, not cards met, so it follows what has
 * actually been learned, and a card that slips back counts against it. In the first two weeks it is an early guess (see
 * `early`). With no growth over the last few weeks, there are no dates.
 */
export function forecast(progress: Progress, now: number, milestones = MILESTONES, perWord = CARDS_PER_WORD): Forecast {
  const steps = Object.entries(progress.cards)
    .filter(([key]) => keyed(key))
    .map(([, card]) => strengthSteps(card, now));
  const since = Math.max(EARLIEST, Math.min(now, ...steps.map((s) => s[0][0])));
  const days = Math.min(PACE_DAYS, (now - since) / DAY_MS);
  const early = days < MIN_PACE_DAYS;
  const held: Strength[] = early ? ['new', 'days', 'weeks', 'long'] : ['weeks', 'long'];
  const stuckAt = (t: number) =>
    steps.filter((s) => {
      let strength: Strength | null = null;
      for (const [when, id] of s) if (when <= t) strength = id;
      return strength !== null && held.includes(strength);
    }).length;
  const known = stuckAt(now);
  // A window reaching back to the first word starts from none. At least a day,
  // so a first session's words aren't read as a pace per minute.
  const before = days < PACE_DAYS ? 0 : stuckAt(now - days * DAY_MS);
  const perDay = steps.length ? (known - before) / Math.max(1, days) : null;
  let curve: LearningCurve | null = null;
  if (perDay && perDay > 0) {
    // The bend comes from words met, one point a day: they show how intake has
    // gone without the week's lag before a word can stick. At least a day in,
    // so a first session isn't read as a pace per minute.
    const span = Math.max(1, (now - since) / DAY_MS);
    const met = steps.map((s) => s[0][0]).sort((x, y) => x - y);
    const points: [number, number][] = [];
    let n = 0;
    for (let d = 1; d < span; d++) {
      // Words met in the first d days.
      while (n < met.length && met[n] < since + d * DAY_MS) n++;
      points.push([d, n]);
    }
    points.push([span, met.length]);
    curve = { now, days: span, known, perDay, power: fitPower(points) ?? 1 };
  }
  const ahead = milestones.map(({ words, label }) => {
    const cards = inCards(words, perWord);
    if (known >= cards) return { cards, label, at: 'reached' as const };
    if (!curve) return { cards, label, at: null };
    const at = Math.max(now, curveReaches(curve, cards));
    return { cards, label, at: at - now > MAX_FORECAST_YEARS * 365 * DAY_MS ? null : at };
  });
  return { known, perDay, early, days, milestones: ahead, curve };
}

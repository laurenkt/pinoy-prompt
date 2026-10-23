import { describe, expect, it } from 'vitest';
import { MILESTONES, cardsPerWord, curveAt, curveReaches, fitPower, forecast, memoryHistory, memorySummary, recallChance, recentReviews, strengthCounts, strengthOf, strengthSteps } from './memory';
import { ALL_CARDS, LEARN_ORDER, isVocab } from './deck';
import { DAY_MS, newCardState, review, startOfDayAfter, type CardState } from './srs';
import { dayKey, emptyProgress, recordAnswer } from './store';

const NOW = new Date(2026, 9, 19, 12).getTime();

function card(interval: number, reviewedDaysAgo: number, extra: Partial<CardState> = {}): CardState {
  const reviewed = NOW - reviewedDaysAgo * DAY_MS;
  // Scheduled as review() does: a whole interval after the review.
  const due = interval > 0 ? reviewed + interval * DAY_MS : reviewed + 60_000;
  return { ...newCardState(reviewed), interval, reps: interval > 0 ? 2 : 0, reviewed, due, ...extra };
}

describe('strengthOf', () => {
  it('reads how firmly a word is stored from how long it holds between reviews', () => {
    expect(strengthOf(card(0, 0))).toBe('new');
    expect(strengthOf(card(1, 0))).toBe('days');
    expect(strengthOf(card(6.9, 0))).toBe('days');
    expect(strengthOf(card(7, 0))).toBe('weeks');
    expect(strengthOf(card(21, 0))).toBe('long');
  });
});

describe('recallChance', () => {
  it('is near certain just after a review and 90% when the review falls due', () => {
    expect(recallChance(card(10, 0), NOW)).toBeCloseTo(1);
    expect(recallChance(card(10, 10), NOW)).toBeCloseTo(0.9, 5);
    expect(recallChance(card(10, 30), NOW)).toBeLessThan(0.9);
  });

  it('fades faster for a word held only a short while', () => {
    expect(recallChance(card(1, 3), NOW)).toBeLessThan(recallChance(card(20, 3), NOW));
  });

  it('works out the last review for cards saved before it was recorded', () => {
    // Due is exactly one interval after the review, so the review time comes back exactly.
    const reviewed = new Date(2026, 9, 15, 22).getTime();
    const old = review({ ...newCardState(reviewed - 3 * DAY_MS), reps: 2, interval: 2 }, 'good', reviewed);
    const exact = recallChance(old, NOW);
    delete old.reviewed;
    const guessed = recallChance(old, NOW);
    expect(guessed).toBeCloseTo(exact, 10);
  });

  it('works out the last review for old saves that were due at local midnight', () => {
    // Older builds put due at midnight of the day the interval landed on.
    const reviewed = new Date(2026, 9, 15, 22).getTime();
    const exact = recallChance(card(2, (NOW - reviewed) / DAY_MS), NOW);
    const old = { ...card(2, 0), due: startOfDayAfter(reviewed, 2) };
    delete old.reviewed;
    expect(Math.abs(recallChance(old, NOW) - exact)).toBeLessThan(0.02);
  });

  it('treats a word still being learned, or just forgotten, as half likely at best', () => {
    expect(recallChance(card(0, 0), NOW)).toBeCloseTo(0.5);
    expect(recallChance(card(0, 1), NOW)).toBeLessThan(0.5);
  });

  it('never goes above 1 for a review stamped in the future', () => {
    expect(recallChance({ ...card(3, 0), reviewed: NOW + 2 * DAY_MS }, NOW)).toBe(1);
  });
});

describe('memorySummary', () => {
  it('counts words by strength and what is coming up, ignoring cards no longer in the deck', () => {
    const p = emptyProgress(NOW);
    p.cards.isa = card(0, 0, { due: NOW - 1 });
    p.cards.dalawa = card(3, 2);
    p.cards.tatlo = card(10, 2);
    p.cards.apat = card(30, 1);
    p.cards['removed-card'] = card(30, 1);
    // Due later today, tomorrow, in five days, and in a month.
    p.cards.dalawa.due = NOW + 60_000;
    p.cards.tatlo.due = startOfDayAfter(NOW, 1);
    p.cards.apat.due = startOfDayAfter(NOW, 5);

    const m = memorySummary(p, NOW);
    expect(m.total).toBe(4);
    expect(m.strengths).toEqual({ new: 1, days: 1, weeks: 1, long: 1 });
    expect(m.due).toEqual({ tomorrow: 2, week: 1 });
    expect(m.estimatedRecall).toBeGreaterThan(0);
    expect(m.estimatedRecall).toBeLessThanOrEqual(1);
  });

  it('has no estimate before any words are met', () => {
    expect(memorySummary(emptyProgress(NOW), NOW).estimatedRecall).toBeNull();
  });
});

describe('recentReviews', () => {
  it('adds up the last 30 days of reviews, today included and nothing after it', () => {
    const p = emptyProgress(NOW);
    p.history = {
      [dayKey(NOW)]: { reviews: 4, missed: 1 },
      [dayKey(NOW - 29 * DAY_MS)]: { reviews: 6, missed: 0 },
      [dayKey(NOW - 30 * DAY_MS)]: { reviews: 100, missed: 50 },
      [dayKey(NOW + DAY_MS)]: { reviews: 100, missed: 50 },
    };
    expect(recentReviews(p, NOW)).toEqual({ reviews: 10, missed: 1 });
  });

  it('measures what recordAnswer records', () => {
    const p = emptyProgress(NOW);
    recordAnswer(p, 'isa', 'good', NOW - 3 * DAY_MS);
    p.cards.isa = review(p.cards.isa, 'good', NOW - 2 * DAY_MS);
    recordAnswer(p, 'isa', 'again', NOW);
    expect(recentReviews(p, NOW)).toEqual({ reviews: 1, missed: 1 });
  });
});

describe('strengthSteps', () => {
  it('follows the moves recordAnswer logs, including a lapse', () => {
    const p = emptyProgress(NOW);
    const t0 = NOW - 40 * DAY_MS;
    recordAnswer(p, 'isa', 'good', t0); // 1 day
    recordAnswer(p, 'isa', 'good', t0 + DAY_MS); // 3 days, still "days"
    recordAnswer(p, 'isa', 'good', t0 + 4 * DAY_MS); // 7.5 days
    recordAnswer(p, 'isa', 'good', t0 + 12 * DAY_MS); // 18.8 days, still "weeks"
    recordAnswer(p, 'isa', 'good', t0 + 31 * DAY_MS); // long-term
    recordAnswer(p, 'isa', 'again', NOW);
    expect(p.cards.isa.log).toHaveLength(4);
    expect(strengthSteps(p.cards.isa, NOW)).toEqual([
      [t0, 'new'],
      [t0, 'days'],
      [t0 + 4 * DAY_MS, 'weeks'],
      [t0 + 31 * DAY_MS, 'long'],
      [NOW, 'new'],
    ]);
  });

  it('works out a likely past for cards saved before moves were logged', () => {
    const c = card(30, 2, { introduced: NOW - 60 * DAY_MS });
    const steps = strengthSteps(c, NOW);
    expect(steps[0]).toEqual([c.introduced, 'new']);
    expect(steps[steps.length - 1]).toEqual([c.reviewed, 'long']);
    expect(steps.map((s) => s[1])).toEqual(expect.arrayContaining(['days', 'weeks']));
    for (let i = 1; i < steps.length; i++) expect(steps[i][0]).toBeGreaterThanOrEqual(steps[i - 1][0]);
  });

  it('squeezes the guessed past into the time since the card was met', () => {
    const c = card(30, 0, { introduced: NOW - 5 * DAY_MS });
    for (const [at] of strengthSteps(c, NOW)) expect(at).toBeGreaterThanOrEqual(c.introduced);
  });

  it('keeps the likely past of an older card when it next moves', () => {
    const p = emptyProgress(NOW);
    p.cards.isa = card(30, 31, { introduced: NOW - 90 * DAY_MS });
    recordAnswer(p, 'isa', 'again', NOW);
    const strengths = strengthSteps(p.cards.isa, NOW).map((s) => s[1]);
    expect(strengths).toEqual(['new', 'days', 'weeks', 'long', 'new']);
  });

  it('keeps every step within the time the card was met and now', () => {
    const c = card(30, 0, { introduced: NOW + DAY_MS, log: [[NOW + 2 * DAY_MS, 30]] });
    for (const [at] of strengthSteps(c, NOW)) expect(at).toBeLessThanOrEqual(NOW);
  });

  it('ends on the current strength even if an older build missed a move', () => {
    const c = card(30, 1, { log: [[NOW - 9 * DAY_MS, 3]] });
    expect(strengthSteps(c, NOW).slice(-1)).toEqual([[c.reviewed, 'long']]);
  });
});

describe('memoryHistory', () => {
  it('counts words by strength over time, ending on today', () => {
    const p = emptyProgress(NOW);
    p.cards.isa = card(30, 1, { introduced: NOW - 20 * DAY_MS });
    p.cards.dalawa = card(0, 0);
    p.cards['removed-card'] = card(30, 1);
    const { since, times, counts } = memoryHistory(p, NOW, 21);
    expect(since).toBe(NOW - 20 * DAY_MS);
    expect(times[0]).toBe(since);
    expect(times[20]).toBe(NOW);
    expect(counts.new[0] + counts.days[0] + counts.weeks[0] + counts.long[0]).toBe(1);
    expect([counts.new[20], counts.days[20], counts.weeks[20], counts.long[20]]).toEqual([1, 0, 0, 1]);
  });

  it('ignores a damaged start time from before the app existed', () => {
    const p = emptyProgress(NOW);
    p.cards.isa = card(3, 1, { introduced: 0 });
    expect(memoryHistory(p, NOW).since).toBeGreaterThan(new Date(2024, 11, 31).getTime());
  });

  it('covers at least a week, so a first day reads as a start', () => {
    const p = emptyProgress(NOW);
    p.cards.isa = card(0, 0);
    const { times, counts } = memoryHistory(p, NOW, 8);
    expect(times[0]).toBe(NOW - 7 * DAY_MS);
    expect(counts.new).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });
});

describe('forecast', () => {
  /** `n` words met 40 days ago, each moving to "weeks" (a 7-day interval) `stuckDaysAgo` days ago. */
  function learner(n: number, stuckDaysAgo: number[]) {
    const p = emptyProgress(NOW - 40 * DAY_MS);
    LEARN_ORDER.slice(0, n).forEach((id, i) => {
      const at = NOW - stuckDaysAgo[i] * DAY_MS;
      p.cards[id] = card(7, stuckDaysAgo[i], { introduced: NOW - 40 * DAY_MS, log: [[at - 3 * DAY_MS, 1], [at, 7]] });
    });
    return p;
  }

  it('measures the pace of words that stuck over the last four weeks', () => {
    // 14 words stuck in the last 28 days, 6 before: half a word a day.
    const p = learner(20, [...Array(6).fill(35), ...Array(14).fill(10)]);
    const f = forecast(p, NOW);
    expect(f.known).toBe(20);
    expect(f.perDay).toBeCloseTo(0.5);
    expect(f.milestones[0].at).toBeGreaterThan(NOW);
  });

  /** A word met `metDaysAgo` days ago that stuck a week later. */
  function stuck(p: ReturnType<typeof emptyProgress>, id: string, metDaysAgo: number) {
    const at = NOW - (metDaysAgo - 7) * DAY_MS;
    p.cards[id] = card(7, metDaysAgo - 7, { introduced: NOW - metDaysAgo * DAY_MS, log: [[at - 3 * DAY_MS, 1], [at, 7]] });
  }

  it('runs on from today at the recent pace, steady for a steady learner', () => {
    // A word met each day for 60 days, each stuck a week later.
    const p = emptyProgress(NOW - 60 * DAY_MS);
    LEARN_ORDER.slice(0, 60).forEach((id, i) => stuck(p, id, 60 - i));
    const f = forecast(p, NOW);
    expect(f.curve!.power).toBeCloseTo(1, 1);
    expect(curveAt(f.curve!, NOW)).toBe(f.known);
    expect(f.milestones[0].at).toBe(curveReaches(f.curve!, f.milestones[0].cards));
    // Steady: the date is close to the straight line at today's pace.
    expect(f.milestones[0].at as number).toBeCloseTo(NOW + ((f.milestones[0].cards - f.known) / f.perDay!) * DAY_MS, -10);
  });

  it('follows the recent pace for a learner who has come back', () => {
    // 20 words a year ago, then 3 a day for the last 30 days.
    const p = emptyProgress(NOW - 400 * DAY_MS);
    LEARN_ORDER.slice(0, 20).forEach((id) => stuck(p, id, 380));
    LEARN_ORDER.slice(20, 110).forEach((id, i) => stuck(p, id, 37 - Math.floor(i / 3)));
    const f = forecast(p, NOW);
    const linear = NOW + ((f.milestones[0].cards - f.known) / f.perDay!) * DAY_MS;
    expect(f.milestones[0].at as number).toBeLessThan(NOW + 2 * (linear - NOW));
  });

  it('eases off for a learner whose intake has slowed', () => {
    // Words met ever more slowly: about 10 × the square root of the day.
    const p = emptyProgress(NOW - 100 * DAY_MS);
    LEARN_ORDER.slice(0, 100).forEach((id, i) => stuck(p, id, 100 - Math.round((i / 10) ** 2)));
    const f = forecast(p, NOW);
    expect(f.curve!.power).toBeLessThan(0.9);
    expect(f.milestones[0].at as number).toBeGreaterThan(NOW + ((f.milestones[0].cards - f.known) / f.perDay!) * DAY_MS);
  });

  it('counts only words that have stuck, not words met', () => {
    const p = learner(4, [10, 10, 10, 10]);
    p.cards[LEARN_ORDER[10]] = card(1, 0, { introduced: NOW - 2 * DAY_MS });
    expect(forecast(p, NOW).known).toBe(4);
  });

  it('gives an early guess from words met, under two weeks in', () => {
    const p = emptyProgress(NOW);
    p.cards[LEARN_ORDER[0]] = card(1, 1, { introduced: NOW - 4 * DAY_MS });
    p.cards[LEARN_ORDER[1]] = card(0, 0, { introduced: NOW - DAY_MS });
    const f = forecast(p, NOW);
    expect(f.early).toBe(true);
    expect(f.known).toBe(2);
    expect(f.perDay).toBeCloseTo(0.5);
    expect(f.curve).not.toBeNull();
  });

  it('gives a guess from the first session, as if over a day', () => {
    const p = emptyProgress(NOW);
    p.cards[LEARN_ORDER[0]] = card(0, 0, { introduced: NOW - 60_000 });
    p.cards[LEARN_ORDER[1]] = card(0, 0, { introduced: NOW - 60_000 });
    expect(forecast(p, NOW).perDay).toBe(2);
    expect(forecast(emptyProgress(NOW), NOW).perDay).toBeNull();
  });

  it('gives no dates when nothing new has stuck lately', () => {
    const f = forecast(learner(5, [35, 35, 35, 35, 35]), NOW);
    expect(f.perDay).toBe(0);
    expect(f.milestones.every((m) => m.at === null)).toBe(true);
  });

  it('marks milestones already reached', () => {
    const levels = [{ words: 3, label: 'a' }, ...MILESTONES];
    const f = forecast(learner(3, [35, 10, 10]), NOW, levels, 1);
    expect(f.milestones.map((m) => m.at === 'reached')).toEqual([true, false, false, false, false]);
  });

  it('counts in cards, like the chart: guides too, and each milestone turned from words into cards', () => {
    const p = learner(2, [10, 10]);
    const guide = ALL_CARDS.find((c) => !isVocab(c))!;
    p.cards[guide.id] = card(7, 10, { introduced: NOW - 40 * DAY_MS, log: [[NOW - 13 * DAY_MS, 1], [NOW - 10 * DAY_MS, 7]] });
    const f = forecast(p, NOW, MILESTONES, 1.1);
    expect(f.known).toBe(3);
    expect(f.milestones.map((m) => m.cards)).toEqual([550, 1100, 2750, 4400]);
  });
});

describe('cardsPerWord', () => {
  const vocab = (tl: string, kind: 'word' | 'phrase' = 'phrase') => ({ id: tl, tl, en: '', kind, hook: '' });
  it('divides the cards by the different words their Tagalog uses', () => {
    // "Salamat po" repeats both words; the guide teaches none.
    const cards = [vocab('Salamat', 'word'), vocab('po', 'word'), vocab('Salamat po.'), vocab('Taga-saan ka?'), { ...vocab('___ ka'), kind: 'pattern' as const }];
    expect(cardsPerWord(cards)).toBeCloseTo(5 / 4);
  });

  it('comes to about one card a word for the deck', () => {
    expect(cardsPerWord()).toBeGreaterThan(0.8);
    expect(cardsPerWord()).toBeLessThan(1.5);
  });
});

describe('fitPower', () => {
  it('reads a steady pace as a straight line', () => {
    expect(fitPower([1, 2, 3, 4, 5].map((d) => [d, 3 * d]))).toBeCloseTo(1);
  });

  it('reads a pace that eases off, but only so far', () => {
    expect(fitPower([1, 4, 9, 16].map((d) => [d, 10 * d ** 0.8]))).toBeCloseTo(0.8);
    expect(fitPower([1, 4, 9, 16].map((d) => [d, 10 * Math.sqrt(d)]))).toBe(0.7);
  });

  it('needs a few days to show a shape', () => {
    expect(fitPower([[1, 3], [2, 5]])).toBeNull();
    expect(fitPower([[0.5, 3], [1, 0], [2, 0], [3, 4]])).toBeNull();
  });
});

describe('strengthCounts', () => {
  it('counts only the given cards, and only those met', () => {
    const progress = emptyProgress(NOW);
    const [a, b, c] = ALL_CARDS;
    progress.cards[a.id] = card(0, 0);
    progress.cards[b.id] = card(10, 0);
    progress.cards[c.id] = card(30, 0);
    expect(strengthCounts(progress, [a, b, ALL_CARDS[3]])).toEqual({ new: 1, days: 0, weeks: 1, long: 0 });
  });
});

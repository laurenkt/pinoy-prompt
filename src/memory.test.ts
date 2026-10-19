import { describe, expect, it } from 'vitest';
import { memorySummary, recallChance, recentReviews, strengthOf } from './memory';
import { DAY_MS, newCardState, review, startOfDayAfter, type CardState } from './srs';
import { dayKey, emptyProgress, recordAnswer } from './store';

const NOW = new Date(2026, 9, 19, 12).getTime();

function card(interval: number, reviewedDaysAgo: number, extra: Partial<CardState> = {}): CardState {
  const reviewed = NOW - reviewedDaysAgo * DAY_MS;
  // Scheduled as review() does: local midnight a whole number of days on.
  const due = interval > 0 ? startOfDayAfter(reviewed, interval) : reviewed + 60_000;
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
    // Reviewed late in the evening; the guess is midday that day, so within half a day.
    const reviewed = new Date(2026, 9, 15, 22).getTime();
    const old = review({ ...newCardState(reviewed - 3 * DAY_MS), reps: 2, interval: 2 }, 'good', reviewed);
    const exact = recallChance(old, NOW);
    delete old.reviewed;
    const guessed = recallChance(old, NOW);
    expect(Math.abs(guessed - exact)).toBeLessThan(0.02);
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

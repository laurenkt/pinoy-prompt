import { describe, expect, it } from 'vitest';
import { DAY_MS, answersOf, formatInterval, formatWait, isDue, newCardState, nextInterval, review } from './srs';

const NOW = Date.UTC(2026, 0, 1);

describe('review', () => {
  it('graduates a new card to 1 day, then 3 days, then grows by ease', () => {
    let card = newCardState(NOW);
    card = review(card, 'good', NOW);
    expect(card.interval).toBe(1);
    card = review(card, 'good', NOW);
    expect(card.interval).toBe(3);
    card = review(card, 'good', NOW);
    expect(card.interval).toBe(7.5);
    expect(card.due).toBe(NOW + 7.5 * DAY_MS);
  });

  it('resets a forgotten card, lowers ease and counts a lapse', () => {
    let card = review(review(newCardState(NOW), 'good', NOW), 'good', NOW);
    card = review(card, 'again', NOW);
    expect(card.interval).toBe(0);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(1);
    expect(card.ease).toBeCloseTo(2.3);
    expect(card.due - NOW).toBe(60 * 1000);
  });

  it('does not count a lapse for a card that was never learned', () => {
    expect(review(newCardState(NOW), 'again', NOW).lapses).toBe(0);
  });

  it('never lets ease drop below 1.3', () => {
    let card = newCardState(NOW);
    for (let i = 0; i < 20; i++) card = review(card, 'again', NOW);
    expect(card.ease).toBe(1.3);
  });

  it('orders intervals again < hard <= good < easy', () => {
    const card = { ...newCardState(NOW), reps: 3, interval: 10 };
    const [a, h, g, e] = (['again', 'hard', 'good', 'easy'] as const).map((r) => nextInterval(card, r));
    expect(a).toBe(0);
    expect(h).toBeLessThanOrEqual(g);
    expect(g).toBeLessThan(e);
  });

  it('makes a card due a whole interval after the review, not at midnight', () => {
    const evening = new Date(2026, 0, 1, 20).getTime();
    const card = review(newCardState(evening), 'good', evening);
    expect(isDue(card, new Date(2026, 0, 2, 0, 1).getTime())).toBe(false);
    expect(isDue(card, new Date(2026, 0, 2, 19, 59).getTime())).toBe(false);
    expect(isDue(card, new Date(2026, 0, 2, 20).getTime())).toBe(true);
    expect(card.due).toBe(evening + DAY_MS);
  });
});

describe('formatInterval', () => {
  it('formats short and long intervals', () => {
    expect(formatInterval(0)).toBe('1m');
    expect(formatInterval(3)).toBe('3d');
    expect(formatInterval(60)).toBe('2mo');
    expect(formatInterval(730)).toBe('2y');
    expect(formatInterval(364)).toBe('12mo');
  });

  it('rounds up when asked, never past a unit into "13mo"', () => {
    expect(formatInterval(40)).toBe('1mo');
    expect(formatInterval(40, { up: true })).toBe('2mo');
    expect(formatInterval(2.2, { up: true })).toBe('3d');
    expect(formatInterval(361, { up: true })).toBe('1y');
    expect(formatInterval(380, { up: true })).toBe('1.1y');
  });
});

describe('answers in Study', () => {
  it('counts each review', () => {
    let card = newCardState(0);
    expect(answersOf(card)).toEqual({ count: 0, atLeast: false });
    card = review(card, 'good', 0);
    card = review(card, 'again', DAY_MS);
    expect(answersOf(card)).toEqual({ count: 2, atLeast: false });
  });

  it('starts a card saved before they were counted from what its schedule shows for certain', () => {
    const old = { ...newCardState(0), reps: 3, lapses: 1, interval: 10 };
    expect(answersOf(old)).toEqual({ count: 4, atLeast: true });
    // Still a floor once counted on, as answers before it are unknown.
    expect(answersOf(review(old, 'good', DAY_MS))).toEqual({ count: 5, atLeast: true });
    // Answered only with "again" before, it has no run and no lapses to show, but it was answered.
    const missed = { ...newCardState(0), reviewed: 0 };
    expect(answersOf(missed)).toEqual({ count: 1, atLeast: true });
  });

  it("starts from none on a way only copied from reading's schedule", () => {
    const copied = { ...newCardState(0), reps: 3, interval: 10, split: true as const };
    expect(answersOf(copied)).toEqual({ count: 0, atLeast: false });
    expect(review(copied, 'good', DAY_MS).reviews).toBe(1);
  });
});

describe('formatWait', () => {
  it('rounds up to the minute, hour, day or longer', () => {
    expect(formatWait(0)).toBe('1m');
    expect(formatWait(25 * 60_000 - 1)).toBe('25m');
    expect(formatWait(61 * 60_000)).toBe('2h');
    expect(formatWait(25 * 3_600_000)).toBe('2d');
    expect(formatWait(40 * DAY_MS)).toBe('2mo');
  });
});

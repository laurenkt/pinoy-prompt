import { describe, expect, it } from 'vitest';
import { DAY_MS, formatInterval, isDue, newCardState, nextInterval, review } from './srs';

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
  });
});

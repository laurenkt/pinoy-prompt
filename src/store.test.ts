import { describe, expect, it } from 'vitest';
import { DAY_MS } from './srs';
import { currentStreak, dayKey, emptyProgress, recordAnswer, rollDay } from './store';

const NOW = new Date(2026, 0, 1, 12).getTime();

describe('streaks', () => {
  it('grows on consecutive days and lapses after a missed day', () => {
    const p = emptyProgress(NOW);
    recordAnswer(p, 'isa', 'good', NOW);
    recordAnswer(p, 'dalawa', 'good', NOW + DAY_MS);
    expect(currentStreak(p, NOW + DAY_MS)).toBe(2);
    expect(currentStreak(p, NOW + 2 * DAY_MS)).toBe(2);
    expect(currentStreak(p, NOW + 3 * DAY_MS)).toBe(0);
    recordAnswer(p, 'tatlo', 'good', NOW + 3 * DAY_MS);
    expect(currentStreak(p, NOW + 3 * DAY_MS)).toBe(1);
  });
});

describe('streaks across daylight saving', () => {
  it('counts the day before a short (spring-forward) day as yesterday', () => {
    const p = emptyProgress(NOW);
    const before = new Date(2026, 2, 7, 23, 30).getTime();
    const after = new Date(2026, 2, 8, 0, 30).getTime();
    recordAnswer(p, 'isa', 'good', before);
    recordAnswer(p, 'dalawa', 'good', after);
    expect(p.streak.count).toBe(2);
  });
});

describe('daily counters', () => {
  it('counts new cards and reviews, and resets on a new day', () => {
    let p = emptyProgress(NOW);
    recordAnswer(p, 'isa', 'good', NOW);
    recordAnswer(p, 'isa', 'good', NOW);
    expect(p.today).toEqual({ day: dayKey(NOW), newCount: 1, reviewCount: 1 });
    p = rollDay(p, NOW + DAY_MS);
    expect(p.today.newCount).toBe(0);
  });
});

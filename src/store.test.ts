import { describe, expect, it } from 'vitest';
import { DAY_MS } from './srs';
import { dayKey, emptyProgress, recordAnswer, rollDay } from './store';

const NOW = new Date(2026, 0, 1, 12).getTime();

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

import { describe, expect, it, vi } from 'vitest';
import { DAY_MS } from './srs';
import { dayKey, emptyProgress, load, recordAnswer, rollDay, save } from './store';

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

describe('loading saved progress', () => {
  it('drops the streak older versions saved', () => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
    });
    const old = { ...emptyProgress(NOW), streak: { count: 3, lastDay: dayKey(NOW) } };
    items.set('pinoy-prompt:v1', JSON.stringify(old));
    const p = load(NOW);
    expect('streak' in p).toBe(false);
    save(p);
    expect(items.get('pinoy-prompt:v1')).not.toContain('streak');
    vi.unstubAllGlobals();
  });
});

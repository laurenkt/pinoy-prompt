// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { type Strength } from '../memory';
import { DAY_MS } from '../srs';
import { h } from '../ui';
import { curve, growthChart, smooth } from './growth-chart';

describe('smooth', () => {
  it('softens steps but ends exactly on the last value', () => {
    const out = smooth([0, 0, 0, 10, 10, 10]);
    expect(out[2]).toBeGreaterThan(0);
    expect(out[3]).toBeLessThan(10);
    expect(out[5]).toBe(10);
  });
});

describe('curve', () => {
  it('passes through every point without overshooting a flat stretch', () => {
    const d = curve([0, 10, 20, 30], [5, 5, 0, 0]);
    expect(d.trim().split(' C')).toHaveLength(3);
    expect(d).toContain('10.0,5.0');
    expect(d).toContain('30.0,0.0');
    // The control points either side of a flat run stay flat.
    expect(d).toMatch(/^ C3\.3,5\.0 6\.7,5\.0 10\.0,5\.0/);
  });
});

describe('growthChart', () => {
  const now = Date.now();
  const history = {
    since: now - 10 * DAY_MS,
    times: [now - 10 * DAY_MS, now - 5 * DAY_MS, now],
    counts: { new: [2, 1, 0], days: [0, 3, 1], weeks: [0, 0, 4], long: [0, 0, 2] },
  };
  const legend = () =>
    Object.fromEntries((['new', 'days', 'weeks', 'long'] as Strength[]).map((id) => [id, h('span')])) as Record<Strength, HTMLElement>;

  it('draws a layer and an outline per strength, captioned with today', () => {
    const counts = legend();
    const el = growthChart(history, counts);
    expect(el.querySelectorAll('.layer')).toHaveLength(4);
    expect(el.querySelectorAll('.edge')).toHaveLength(4);
    expect(el.querySelector('.growth-caption')!.textContent).toContain('7 cards today');
    expect(counts.weeks.textContent).toBe('4');
    expect(el.querySelector('.growth-hint')).toBeNull();
  });

  it('shows an earlier day when touched, and comes back to today', () => {
    const counts = legend();
    const el = growthChart(history, counts);
    const frame = el.querySelector<HTMLElement>('.growth-frame')!;
    frame.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;
    frame.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, pointerType: 'touch' }));
    expect(el.querySelector('.growth-caption')!.textContent).toMatch(/^4 cards on /);
    expect(counts.days.textContent).toBe('3');
    expect(el.querySelector<HTMLElement>('.growth-marker')!.hidden).toBe(false);
    el.querySelector<HTMLButtonElement>('.growth-back')!.click();
    expect(el.querySelector('.growth-caption')!.textContent).toContain('7 cards today');
    expect(counts.days.textContent).toBe('1');
  });

  it('explains itself in the first days', () => {
    const el = growthChart({ ...history, since: now - DAY_MS }, legend());
    expect(el.querySelector('.growth-hint')).not.toBeNull();
  });
});

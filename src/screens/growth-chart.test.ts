// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { type Forecast, type Strength } from '../memory';
import { DAY_MS } from '../srs';
import { h } from '../ui';
import { curve, forecastView, growthChart, smooth } from './growth-chart';

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

describe('forecast', () => {
  const now = Date.now();
  const history = {
    since: now - 30 * DAY_MS,
    times: [now - 30 * DAY_MS, now],
    counts: { new: [0, 0], days: [0, 0], weeks: [0, 10], long: [0, 0] },
  };
  const legend = () =>
    Object.fromEntries((['new', 'days', 'weeks', 'long'] as Strength[]).map((id) => [id, h('span')])) as Record<Strength, HTMLElement>;
  const ahead = (perDay: number | null, at: Forecast['milestones'][number]['at'] = null): Forecast => ({
    known: 10,
    perDay,
    days: 28,
    milestones: [
      { words: 5, label: 'First', at: 'reached' },
      { words: 500, label: 'Second', at },
    ],
  });

  it('projects a dotted line to the next milestone, which opens the rest', () => {
    const el = growthChart(history, legend(), ahead(0.5, now + 400 * DAY_MS));
    expect(el.querySelector('.projection')).not.toBeNull();
    const goal = el.querySelector<HTMLButtonElement>('.growth-goal')!;
    expect(goal.textContent).toMatch(/^~\w+ \d{4}500 words$/);
    const panel = el.querySelector<HTMLElement>('.growth-forecast')!;
    expect(panel.hidden).toBe(true);
    goal.click();
    expect(panel.hidden).toBe(false);
    expect(goal.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps looking back through time on the past side of the chart', () => {
    const counts = legend();
    const el = growthChart(history, counts, ahead(0.5, now + 400 * DAY_MS));
    const frame = el.querySelector<HTMLElement>('.growth-frame')!;
    frame.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;
    // Past the 70% where today sits is still today.
    frame.dispatchEvent(new PointerEvent('pointerdown', { clientX: 250, pointerType: 'touch' }));
    expect(el.querySelector('.growth-caption')!.textContent).toContain('today');
    frame.dispatchEvent(new PointerEvent('pointerdown', { clientX: 20, pointerType: 'touch' }));
    expect(el.querySelector('.growth-caption')!.textContent).toMatch(/^0 cards on /);
  });

  it('draws no projection without a date ahead', () => {
    for (const f of [undefined, ahead(null), ahead(0)]) {
      const el = growthChart(history, legend(), f);
      expect(el.querySelector('.projection')).toBeNull();
      expect(el.querySelector('.growth-goal')).toBeNull();
    }
  });

  it('lists each milestone with a date, and says the counts are rough', () => {
    const text = forecastView(ahead(0.5, now + 400 * DAY_MS)).textContent!;
    expect(text).toContain('about 4 words a week sticking');
    expect(text).toContain('Reached');
    expect(text).toMatch(/~\w+ \d{4}/);
    expect(text).toContain('rough');
    expect(forecastView(ahead(0.05, now + 400 * DAY_MS)).textContent).toContain('less than a word a week');
  });

  it('keeps the tag a button to a screen reader, outside the picture', () => {
    const el = growthChart(history, legend(), ahead(0.5, now + 400 * DAY_MS));
    expect(el.querySelector('.growth-goal')!.closest('[role="img"]')).toBeNull();
    expect(el.querySelector('svg')!.getAttribute('aria-label')).toContain('today');
  });
});

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { type Forecast, type Strength } from '../memory';
import { DAY_MS } from '../srs';
import { h } from '../ui';
import { curve, forecastView, growthChart, projected, smooth, timeUntil } from './growth-chart';

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

/** A tap: down and up in one place. */
function tap(target: HTMLElement, clientX: number): void {
  target.dispatchEvent(new PointerEvent('pointerdown', { clientX, pointerType: 'touch' }));
  target.dispatchEvent(new PointerEvent('pointerup', { clientX, pointerType: 'touch' }));
}

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
    tap(frame, 140);
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
    early: false,
    days: 28,
    curve: null,
    milestones: [
      { cards: 5, label: 'First', at: 'reached' },
      { cards: 500, label: 'Second', at },
    ],
  });

  it('carries the stream on, hatched, to the next milestone, whose tag opens the rest', () => {
    const el = growthChart(history, legend(), ahead(0.5, now + 400 * DAY_MS));
    expect(el.querySelector('.projection')).not.toBeNull();
    const goal = el.querySelector<HTMLButtonElement>('.growth-goal')!;
    expect(goal.textContent).toBe('Secondin about 13 months');
    expect(goal.closest('.growth-frame')).not.toBeNull();
    expect(el.querySelector('.growth-axis-ahead')!.textContent).toMatch(/^~\w+ \d{4}$/);
    const panel = el.querySelector<HTMLElement>('.growth-forecast')!;
    expect(panel.hidden).toBe(true);
    goal.click();
    expect(panel.hidden).toBe(false);
    expect(goal.getAttribute('aria-expanded')).toBe('true');
  });

  it('reads the past on the left and the projection on the right', () => {
    const counts = legend();
    const el = growthChart(history, counts, ahead(0.5, now + 400 * DAY_MS));
    el.querySelector<HTMLButtonElement>('.growth-goal')!.click();
    const frame = el.querySelector<HTMLElement>('.growth-frame')!;
    frame.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;
    // Halfway from today (at 70%) to the milestone: halfway from 10 words to 500.
    tap(frame, 20);
    tap(frame, 255);
    expect(el.querySelector('.growth-caption')!.textContent).toMatch(/^~255 cards(Back to today)?$/);
    // The legend is back on today, not the day looked at before.
    expect(counts.weeks.textContent).toBe('10');
    expect(el.querySelector<HTMLElement>('.growth-marker')!.style.left).toBe('85%');
    tap(frame, 20);
    expect(el.querySelector('.growth-caption')!.textContent).toMatch(/^0 cards on /);
    // The level's label stays, with its list, while looking along the chart.
    expect(el.querySelector<HTMLElement>('.growth-forecast')!.hidden).toBe(false);
    expect(el.querySelector<HTMLElement>('.growth-goal')!.hidden).toBe(false);
    expect(el.querySelector<HTMLElement>('.growth-back')!.hidden).toBe(false);
  });

  it('starts the projection from the cards that have stuck, the count the forecast runs on', () => {
    // 10 cards today, 4 of them only days old: 6 have stuck.
    const met = { ...history, counts: { new: [0, 0], days: [0, 4], weeks: [0, 6], long: [0, 0] } };
    const el = growthChart(met, legend(), { ...ahead(0.5, now + 400 * DAY_MS), known: 6 });
    const frame = el.querySelector<HTMLElement>('.growth-frame')!;
    frame.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;
    tap(frame, 210.3);
    expect(el.querySelector('.growth-caption')!.textContent).toMatch(/^~[6-8] cards(Back to today)?$/);
  });

  it("opens the list from the level's label without looking along the chart", () => {
    const el = growthChart(history, legend(), ahead(0.5, now + 400 * DAY_MS));
    el.querySelector<HTMLElement>('.growth-frame')!.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;
    const goal = el.querySelector<HTMLElement>('.growth-goal')!;
    goal.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 20, pointerType: 'mouse' }));
    goal.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 20, pointerType: 'mouse' }));
    expect(el.querySelector('.growth-caption')!.textContent).toContain('cards today');
    // A mouse moving onto it from the chart puts the chart back on today.
    el.querySelector('.growth-frame')!.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, pointerType: 'mouse' }));
    expect(el.querySelector('.growth-caption')!.textContent).toMatch(/^0 cards on /);
    goal.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    expect(el.querySelector('.growth-caption')!.textContent).toContain('cards today');
  });

  it('leaves a drag up or down to scroll the page, and follows one sideways', () => {
    const el = growthChart(history, legend(), ahead(0.5, now + 400 * DAY_MS));
    const frame = el.querySelector<HTMLElement>('.growth-frame')!;
    frame.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;
    const caption = () => el.querySelector('.growth-caption')!.textContent;
    frame.dispatchEvent(new PointerEvent('pointerdown', { clientX: 20, clientY: 50, pointerType: 'touch' }));
    expect(caption()).toContain('cards today');
    frame.dispatchEvent(new PointerEvent('pointermove', { clientX: 22, clientY: 90, pointerType: 'touch' }));
    frame.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 90, pointerType: 'touch' }));
    frame.dispatchEvent(new PointerEvent('pointerup', { clientX: 60, clientY: 90, pointerType: 'touch' }));
    expect(caption()).toContain('cards today');
    frame.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 50, pointerType: 'touch' }));
    frame.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 52, pointerType: 'touch' }));
    expect(caption()).toMatch(/^0 cards on /);
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
    expect(text).toContain('Reached');
    expect(text).toMatch(/~\w+ \d{4}/);
    expect(text).toContain('A rough estimate.');
  });

  it('marks an early guess as one', () => {
    const f = { ...ahead(0.5, now + 400 * DAY_MS), early: true, days: 4 };
    const goal = growthChart(history, legend(), f).querySelector('.growth-goal')!;
    expect(goal.getAttribute('aria-label')).toMatch(/^Early guess/);
    expect(forecastView(f).textContent).toContain('A rough early guess.');
  });

  it('keeps the tag a button to a screen reader, outside the picture', () => {
    const el = growthChart(history, legend(), ahead(0.5, now + 400 * DAY_MS));
    expect(el.querySelector('.growth-goal')!.closest('[role="img"]')).toBeNull();
    expect(el.querySelector('svg')!.getAttribute('aria-label')).toContain('today');
  });
});

describe('projected', () => {
  const now = Date.now();
  const f = (power: number): Forecast => ({
    known: 10,
    perDay: 1,
    early: false,
    days: 10,
    milestones: [],
    curve: { now, days: 10, known: 10, perDay: 1, power },
  });

  it('rises early and flattens for a pace that eases off, and runs straight for a steady one', () => {
    const at = now + 400 * DAY_MS;
    expect(projected(f(0.7), at, now, 0.5)).toBeGreaterThan(0.52);
    expect(projected(f(1), at, now, 0.5)).toBeCloseTo(0.5);
    expect(projected(f(0.7), at, now, 0)).toBeCloseTo(0);
    expect(projected(f(0.7), at, now, 1)).toBeCloseTo(1);
    expect(projected({ ...f(1), curve: null }, at, now, 0.3)).toBe(0.3);
  });
});

describe('timeUntil', () => {
  const now = Date.now();
  it('says how long in weeks, then months, then years', () => {
    expect(timeUntil(now + 2 * DAY_MS, now)).toBe('in a few days');
    expect(timeUntil(now + 5 * DAY_MS, now)).toBe('in about a week');
    expect(timeUntil(now + 10.4 * DAY_MS, now)).toBe('in about a week');
    expect(timeUntil(now + 12 * DAY_MS, now)).toBe('in about 2 weeks');
    expect(timeUntil(now + 30 * DAY_MS, now)).toBe('in about 4 weeks');
    expect(timeUntil(now + 330 * DAY_MS, now)).toBe('in about 11 months');
    expect(timeUntil(now + 365 * DAY_MS, now)).toBe('in about a year');
    expect(timeUntil(now + 1000 * DAY_MS, now)).toBe('in about 2.5 years');
  });
});

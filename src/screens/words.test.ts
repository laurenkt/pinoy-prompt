// @vitest-environment happy-dom
// The Library: filters stay out of the way until asked for.

import { afterEach, describe, expect, it } from 'vitest';
import { UNITS } from '../deck';
import { wordsScreen } from './words';
import { button, fakeApp } from '../test/screen';

const toggle = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.filter-toggle')!;
const chips = (root: HTMLElement) => root.querySelector<HTMLElement>('.chips')!;

describe('the Library', () => {
  // The filter is kept across visits, so put it back for the next test.
  afterEach(() => {
    const root = wordsScreen(fakeApp());
    toggle(root).click();
    button(chips(root), 'All').click();
  });

  it('hides the filters behind one button that names the current filter', () => {
    const root = wordsScreen(fakeApp());
    expect(chips(root).hidden).toBe(true);
    expect(toggle(root).textContent).toBe('All');
    expect(toggle(root).className).toBe('chip filter-toggle');
    expect(toggle(root).getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelectorAll('.unit-list').length).toBeGreaterThan(UNITS.length);

    toggle(root).click();
    expect(chips(root).hidden).toBe(false);
    expect(toggle(root).getAttribute('aria-expanded')).toBe('true');
    button(chips(root), 'Sounds').click();

    // Picking one closes the filters and narrows the list to it.
    expect(chips(root).hidden).toBe(true);
    expect(toggle(root).textContent).toBe('Sounds');
    // The button looks the same whichever filter it names; only the chosen chip is marked.
    expect(toggle(root).className).toBe('chip filter-toggle');
    toggle(root).click();
    expect([...chips(root).querySelectorAll('.chip.selected')].map((c) => c.textContent)).toEqual(['Sounds']);
    expect(root.querySelectorAll('.unit-list').length).toBe(1);
    expect(wordsScreen(fakeApp()).querySelector('.filter-toggle')!.textContent).toBe('Sounds');
  });

  it('leaves open topics open when the filters are shown and hidden', () => {
    const root = wordsScreen(fakeApp());
    const first = root.querySelector<HTMLDetailsElement>('.unit-list')!;
    first.open = true;
    const button = toggle(root);
    button.click();
    button.click();
    expect(root.querySelector('.unit-list')).toBe(first);
    expect(first.open).toBe(true);
    expect(toggle(root)).toBe(button);
  });

  it('fills each heading with its cards by memory strength, firmest first, the title in ink over the fill', () => {
    const unit = UNITS[0];
    const [a, b] = unit.cards;
    const app = fakeApp([a.id, b.id]);
    app.progress.cards[b.id].interval = 30;
    const summary = wordsScreen(app).querySelector('.unit-list summary')!;
    const fill = summary.querySelector('.memory-fill')!;
    // Named by its title before its count.
    expect(summary.firstElementChild!.className).toBe('unit-body');
    expect([...fill.children].map((s) => s.className)).toEqual(['s-long', 's-days']);
    expect(parseFloat((fill.children[0] as HTMLElement).style.width)).toBeCloseTo(100 / unit.cards.length);
    expect(fill.getAttribute('aria-label')).toBe(`2 of ${unit.cards.length} met: Long-term 1, Days 1`);
    // The ink copy of the title is for the eye only, and covers just the fill.
    const ink = summary.querySelector<HTMLElement>('.memory-ink')!;
    expect(ink.getAttribute('aria-hidden')).toBe('true');
    expect(ink.textContent).toBe(summary.querySelector(':scope > .unit-body')!.textContent);
    expect(parseFloat(ink.style.clipPath.match(/inset\(0(?:px)? ([\d.]+)%/)![1])).toBeCloseTo(100 - (200 / unit.cards.length));

    const none = wordsScreen(fakeApp()).querySelector('.unit-list summary')!;
    expect(none.querySelector('.memory-fill')!.getAttribute('aria-label')).toBe(`None of ${unit.cards.length} met yet`);
    expect(none.querySelector('.memory-ink')).toBeNull();
  });
});

// @vitest-environment happy-dom
// The Library: filters stay out of the way until asked for.

import { describe, expect, it } from 'vitest';
import type { App } from '../app';
import { UNITS } from '../deck';
import { emptyProgress } from '../store';
import { wordsScreen } from './words';

function fakeApp(): App {
  const now = Date.now();
  return { progress: emptyProgress(now), now: () => now, commit: () => {}, replaceProgress: () => {}, navigate: () => {}, onKey: () => {}, onBack: () => {} };
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`No "${text}" button`);
  return found;
}

describe('the Library', () => {
  it('hides the filters behind one button that names the current filter', () => {
    const root = wordsScreen(fakeApp());
    const toggle = root.querySelector<HTMLButtonElement>('.filter-toggle')!;
    expect(root.querySelector('.chips')).toBeNull();
    expect(toggle.textContent).toBe('All');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelectorAll('.unit-list').length).toBeGreaterThan(UNITS.length);

    toggle.click();
    expect(root.querySelector('.filter-toggle')!.getAttribute('aria-expanded')).toBe('true');
    button(root.querySelector('.chips')!, 'Sounds').click();

    // Picking one closes the filters and narrows the list to it.
    expect(root.querySelector('.chips')).toBeNull();
    expect(root.querySelector('.filter-toggle')!.textContent).toBe('Sounds');
    expect(root.querySelector('.filter-toggle')!.classList.contains('selected')).toBe(true);
    expect(root.querySelectorAll('.unit-list').length).toBe(1);

    // The choice is kept for the next visit; put it back for other tests.
    expect(wordsScreen(fakeApp()).querySelector('.filter-toggle')!.textContent).toBe('Sounds');
    root.querySelector<HTMLButtonElement>('.filter-toggle')!.click();
    button(root.querySelector('.chips')!, 'All').click();
  });
});

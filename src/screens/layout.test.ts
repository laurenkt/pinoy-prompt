// @vitest-environment happy-dom
// Every screen is a page or a session (docs/ARCHITECTURE.md): a page has the
// back arrow to Home, a session the close button, and never both. A screen
// that fits passes the phone's height down to what can use it.

import { describe, expect, it, vi } from 'vitest';
import type { App } from '../app';
import { homeScreen } from './home';
import { practiceScreen } from './practice';
import { sessionScreen } from './session';
import css from '../style.css?raw';
import { settingsScreen } from './settings';
import { wordsScreen } from './words';
import { fakeApp } from '../test/screen';

const KNOWN = ['salamat', 'kumusta', 'oo', 'hindi', 'paalam', 'kape'];

const backArrows = (root: HTMLElement) => root.querySelectorAll('.back-bar').length;
const closeButtons = (root: HTMLElement) => root.querySelectorAll('.session-header').length;

describe('page and session layouts', () => {
  it.each([
    ['Library', wordsScreen],
    ['Settings', settingsScreen],
  ])('%s is a page: a back arrow to Home above its title', (title, screen) => {
    const app = fakeApp(KNOWN);
    const root = screen(app);
    expect(backArrows(root)).toBe(1);
    expect(closeButtons(root)).toBe(0);
    expect(root.querySelector('.page-header h1')?.textContent).toBe(title);
    root.querySelector<HTMLButtonElement>('.back-bar button')!.click();
    expect(app.navigate).toHaveBeenCalledWith({ name: 'home' });
  });

  it('keeps the way back on Drills before there are enough words to drill', () => {
    const root = practiceScreen(fakeApp(['salamat']));
    expect(root.textContent).toContain('Learn at least');
    expect(backArrows(root)).toBe(1);
    expect(root.querySelector('.page-header h1')?.textContent).toBe('Drills');
  });

  it('opens Drills straight into a round, a session with only its close button, which goes Home', () => {
    const app = fakeApp(KNOWN);
    const root = practiceScreen(app);
    expect(closeButtons(root)).toBe(1);
    expect(backArrows(root)).toBe(0);
    root.querySelector<HTMLButtonElement>('.session-header .icon-btn')!.click();
    expect(app.navigate).toHaveBeenCalledWith({ name: 'home' });
  });

  it('leaves the back gesture going Home from a drill round', () => {
    const app = fakeApp(KNOWN);
    const onBack = vi.fn<App['onBack']>();
    app.onBack = onBack;
    practiceScreen(app);
    // Without a handler of its own, the system back gesture goes Home.
    expect(onBack.mock.calls.every(([handler]) => handler === null)).toBe(true);
  });
});

describe('filling the screen', () => {
  // The containers style.css lays out as a column that takes the spare height ("Layout").
  const column = /\/\* The column from the screen down to the panel\. \*\/\n([^{]+)\{/.exec(css)?.[1].trim();

  /** Whether every element from the screen's root down to `el` passes the height on. */
  function filled(root: HTMLElement, el: Element | null): boolean {
    expect(el).not.toBeNull();
    for (let node = el!.parentElement; node && node !== root.parentElement; node = node.parentElement) {
      if (!node.matches(column!)) return false;
    }
    return true;
  }

  it("doesn't let the page bounce, so a screen that fits can't be dragged", () => {
    expect(/html,\nbody \{[^}]*overscroll-behavior: none;/.exec(css)).not.toBeNull();
  });

  it('sizes things from the height less the status bar and home bar, not the raw screen height', () => {
    // Besides the screen's own min-height and --fill itself, a dvh would let an iPhone's insets push a fitting screen over.
    const raw = css.split('\n').filter((line) => line.includes('dvh') && !/^\s*(min-height: 100dvh;|--fill:|@supports)/.test(line));
    expect(raw).toEqual([]);
  });

  it('names the column in style.css', () => {
    expect(column).toBeTruthy();
  });

  it.each([
    ['a drill round', () => practiceScreen(fakeApp(KNOWN)), '.choices'],
    ['a study question', () => sessionScreen(fakeApp(KNOWN), [{ kind: 'review', cardId: 'salamat', format: 'remember' }]), '.panel > .btn.big'],
    ['Home', () => homeScreen(fakeApp(KNOWN)), '.hub'],
  ])('passes the height down to what grows on %s', (_, screen, grows) => {
    const root = screen();
    expect(filled(root, root.querySelector(grows))).toBe(true);
  });
});

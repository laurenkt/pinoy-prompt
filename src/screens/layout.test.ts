// @vitest-environment happy-dom
// Every screen is a page or a session (docs/ARCHITECTURE.md): a page has the
// back arrow to Home, a session the close button, and never both.

import { describe, expect, it, vi } from 'vitest';
import type { App } from '../app';
import { practiceScreen } from './practice';
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

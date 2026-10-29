// @vitest-environment happy-dom
// Every screen is a page or a session (docs/ARCHITECTURE.md): a page has the
// back arrow to Home, a session the close button, and never both. A screen
// that fits passes the phone's height down to what can use it.

import { describe, expect, it, vi } from 'vitest';
import type { App } from '../app';
import { homeScreen } from './home';
import { practiceScreen } from './practice';
import { sessionScreen } from './session';
import { talkScreen } from './talk';
import { walkScreen } from './walk';
import { setApiKey } from '../openai';
import css from '../style.css?raw';
import { settingsScreen } from './settings';
import { wordsScreen } from './words';
import { fakeApp } from '../test/screen';
import { h } from '../ui';

const KNOWN = ['salamat', 'kumusta', 'oo', 'hindi', 'paalam', 'kape'];

const backArrows = (root: HTMLElement) => root.querySelectorAll('.back-bar').length;
const closeButtons = (root: HTMLElement) => root.querySelectorAll('.session-header').length;

describe('page and session layouts', () => {
  it.each([
    ['Library', wordsScreen, 'settings', 'Back to Settings'],
    ['Settings', settingsScreen, 'home', 'Home'],
  ] as const)('%s is a page: a back arrow to where it was opened from above its title', (title, screen, to, label) => {
    const app = fakeApp(KNOWN);
    const root = screen(app);
    expect(backArrows(root)).toBe(1);
    expect(closeButtons(root)).toBe(0);
    expect(root.querySelector('.page-header h1')?.textContent).toBe(title);
    const back = root.querySelector<HTMLButtonElement>('.back-bar button')!;
    expect(back.getAttribute('aria-label')).toBe(label);
    back.click();
    expect(app.navigate).toHaveBeenCalledWith({ name: to });
  });

  it('opens the Library from Settings, and the back gesture goes back there', () => {
    const app = fakeApp(KNOWN);
    [...settingsScreen(app).querySelectorAll('button')].find((b) => b.textContent?.includes('Open the Library'))!.click();
    expect(app.navigate).toHaveBeenLastCalledWith({ name: 'words' });
    let back: (() => void) | null = null;
    app.onBack = (handler) => (back = handler);
    wordsScreen(app);
    back!();
    expect(app.navigate).toHaveBeenLastCalledWith({ name: 'settings' });
  });

  it("keeps Home's settings button on Settings, pressed, so a second tap closes it", () => {
    const app = fakeApp(KNOWN);
    const home = homeScreen(app);
    const settings = settingsScreen(app);
    const gear = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.icon-btn[aria-label="Settings"]')!;
    expect(gear(home).getAttribute('aria-pressed')).toBe('false');
    expect(gear(settings).getAttribute('aria-pressed')).toBe('true');
    // At the top right of both: last in the top row, after the back arrow on Settings.
    expect(gear(settings).parentElement?.classList.contains('back-bar')).toBe(true);
    expect(gear(settings).parentElement?.lastElementChild).toBe(gear(settings));
    gear(home).click();
    expect(app.navigate).toHaveBeenLastCalledWith({ name: 'settings' });
    gear(settings).click();
    expect(app.navigate).toHaveBeenLastCalledWith({ name: 'home' });
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

  it("stops the page bouncing only while it fits, so a long screen scrolls as usual", () => {
    expect(/\.fits,\n\.fits body \{[^}]*overscroll-behavior: none;/.exec(css)).not.toBeNull();
    expect(/html,\nbody \{[^}]*overscroll-behavior/.exec(css)).toBeNull();
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
    // A message with a way forward sits in the middle, the same on every screen.
    ['a finished study session', () => sessionScreen(fakeApp(KNOWN), []), '.panel.center'],
    ['Drills before there are words to drill', () => practiceScreen(fakeApp(['salamat'])), '.panel.center'],
    [
      'walk and talk before it starts',
      () => {
        setApiKey('sk-proj-abcdefghijklmnopqrstuvwxyz0123');
        return walkScreen(fakeApp(KNOWN));
      },
      '.panel.center',
    ],
    [
      'Chat before there are words to chat with',
      () => {
        setApiKey('sk-proj-abcdefghijklmnopqrstuvwxyz0123');
        return talkScreen(fakeApp(['salamat']));
      },
      '.panel.center',
    ],
  ])('passes the height down to what grows on %s', (_, screen, grows) => {
    const root = screen();
    expect(filled(root, root.querySelector(grows))).toBe(true);
  });
});

describe('two kinds of text', () => {
  // The controls and chrome style.css keeps from selecting on a long press ("Text you can copy").
  const chrome = /New chrome joins this list, not a rule of its own\. \*\/\n([^{]+)\{/.exec(css)?.[1].trim();
  const copyable = /\/\* Back in:[^*]*\*\/\n([^{]+)\{/.exec(css)?.[1].trim();
  const isChrome = (el: Element) => el.closest(chrome!) !== null && !el.matches(copyable!);

  const screens: [string, () => HTMLElement][] = [
    ['Home', () => homeScreen(fakeApp(KNOWN))],
    ['a drill round', () => practiceScreen(fakeApp(KNOWN))],
    ['a study question', () => sessionScreen(fakeApp(KNOWN), [{ kind: 'review', cardId: 'salamat', format: 'remember' }])],
    ['Library', () => wordsScreen(fakeApp(KNOWN))],
    ['Settings', () => settingsScreen(fakeApp(KNOWN))],
  ];

  it('names the chrome and what opts back in in style.css', () => {
    expect(chrome).toBeTruthy();
    expect(copyable).toBeTruthy();
  });

  it.each(screens)('keeps every control and chart on %s from selecting', (_, screen) => {
    const root = screen();
    const controls = [...root.querySelectorAll('button, label, summary, [role="radio"], .chip, svg, .session-header, .page-header')];
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.filter((el) => !isChrome(el)).map((el) => el.outerHTML)).toEqual([]);
  });

  it.each(screens)('leaves the words and messages on %s copyable', (_, screen) => {
    const root = screen();
    // Tagalog shown as content (not on a button or topic heading) and the English beside it.
    const content = [...root.querySelectorAll('[lang="fil"], .greeting + p, .eyebrow, .prompt-en, .prompt-meaning, .word-tl, .word-en, .feedback, .key-problem')].filter(
      (el) => !el.closest('button, summary'),
    );
    expect(content.filter(isChrome).map((el) => el.outerHTML)).toEqual([]);
  });

  it('finds Tagalog to copy on a study question and in Library', () => {
    const study = sessionScreen(fakeApp(KNOWN), [{ kind: 'review', cardId: 'salamat', format: 'remember' }]);
    const library = wordsScreen(fakeApp(KNOWN));
    for (const root of [study, library]) {
      expect([...root.querySelectorAll('[lang="fil"]')].some((el) => !isChrome(el))).toBe(true);
    }
  });

  it('keeps the known words in a Chat message copyable with the rest of it', () => {
    // The markup of a message from talk.ts's bubble(); talk.test.ts checks a real call puts its word buttons there.
    const message = h('p', { class: 'bubble ai' }, 'Ay, ', h('span', { class: 'tl-word' }, h('button', { lang: 'fil' }, 'salamat')), '!');
    expect(isChrome(message.querySelector('button')!)).toBe(false);
  });

  it('lets text fields select, so typing and pasting work inside chrome on iOS, but not checkboxes', () => {
    const field = h('label', null, h('input', { type: 'password' }));
    const box = h('label', null, h('input', { type: 'checkbox' }));
    expect(isChrome(field.querySelector('input')!)).toBe(false);
    expect(isChrome(box.querySelector('input')!)).toBe(true);
  });
});

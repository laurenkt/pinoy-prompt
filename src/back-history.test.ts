import { afterEach, describe, expect, it, vi } from 'vitest';
import { backHistory } from './back-history';

/** A browser history whose back step lands later, as a real one does. */
function fakeBrowser(initial: unknown = null) {
  const events = new EventTarget();
  const entries: unknown[] = [initial];
  let index = 0;
  const history = {
    get state() {
      return entries[index];
    },
    pushState(state: unknown) {
      entries.splice(index + 1, Infinity, state);
      index++;
    },
    back() {
      if (index === 0) return;
      queueMicrotask(() => swipeBack());
    },
  };
  /** The system back gesture: step back now and tell the page. */
  function swipeBack() {
    if (index === 0) return;
    index--;
    events.dispatchEvent(Object.assign(new Event('popstate'), { state: entries[index] }));
  }
  return { history, events, entries, swipeBack, index: () => index };
}

function setup(initial: unknown = null) {
  const browser = fakeBrowser(initial);
  const drawn: string[] = [];
  let backHandler: (() => void) | null = null;
  const screens = backHistory<string>({
    history: browser.history,
    events: browser.events,
    isHome: (route) => route === 'home',
    draw: (route) => {
      backHandler = null;
      drawn.push(route);
    },
    back: () => (backHandler ?? (() => screens.go('home')))(),
  });
  return { browser, drawn, screens, onBack: (handler: () => void) => (backHandler = handler) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.useRealTimers());

describe('back gesture', () => {
  it('goes from a screen back to Home', () => {
    const { browser, drawn, screens } = setup();
    screens.go('home');
    screens.go('words');
    expect(browser.index()).toBe(1);
    browser.swipeBack();
    expect(drawn).toEqual(['home', 'words', 'home']);
    expect(browser.index()).toBe(0);
  });

  it("does what the screen's own close button does", () => {
    const { browser, drawn, screens, onBack } = setup();
    screens.go('home');
    screens.go('study');
    // Study shows its summary in place instead of leaving.
    let summary = false;
    onBack(() => (summary ? screens.go('home') : ((summary = true), drawn.push('summary'))));
    browser.swipeBack();
    expect(drawn).toEqual(['home', 'study', 'summary']);
    // Still away from Home, so back works again from the summary.
    expect(browser.index()).toBe(1);
    browser.swipeBack();
    expect(drawn.at(-1)).toBe('home');
    expect(browser.index()).toBe(0);
  });

  it('keeps one entry above Home however many screens are visited', () => {
    const { browser, screens } = setup();
    screens.go('home');
    screens.go('practice');
    screens.go('practice');
    screens.go('study');
    expect(browser.entries).toHaveLength(2);
  });

  it("steps history back when the app's own button goes Home", async () => {
    const { browser, drawn, screens } = setup();
    screens.go('home');
    screens.go('settings');
    screens.go('home');
    // Home draws once history has stepped back, so back from Home leaves the app.
    expect(drawn).toEqual(['home', 'settings']);
    await settle();
    expect(drawn).toEqual(['home', 'settings', 'home']);
    expect(browser.index()).toBe(0);
    screens.go('words');
    expect(browser.entries).toHaveLength(2);
  });

  it('draws the latest screen asked for while stepping back', async () => {
    const { browser, drawn, screens } = setup();
    screens.go('home');
    screens.go('settings');
    screens.go('home');
    screens.go('study');
    await settle();
    expect(drawn).toEqual(['home', 'settings', 'study']);
    expect(browser.index()).toBe(1);
  });

  it('does nothing on Home', () => {
    const { browser, drawn, screens } = setup();
    screens.go('home');
    browser.swipeBack();
    expect(drawn).toEqual(['home']);
  });

  it('returns to the base entry after reloading on another screen', async () => {
    const browser = fakeBrowser(null);
    browser.history.pushState({ 'pinoy-prompt-away': true });
    const drawn: string[] = [];
    const screens = backHistory<string>({
      history: browser.history,
      events: browser.events,
      isHome: (route) => route === 'home',
      draw: (route) => drawn.push(route),
      back: () => screens.go('home'),
    });
    screens.go('home');
    await settle();
    expect(drawn).toEqual(['home']);
    expect(browser.index()).toBe(0);
  });

  it("still draws Home if history can't step back", () => {
    vi.useFakeTimers();
    const browser = fakeBrowser({ 'pinoy-prompt-away': true });
    const drawn: string[] = [];
    const screens = backHistory<string>({
      history: browser.history,
      events: browser.events,
      isHome: (route) => route === 'home',
      draw: (route) => drawn.push(route),
      back: () => screens.go('home'),
    });
    screens.go('home');
    expect(drawn).toEqual([]);
    vi.advanceTimersByTime(500);
    expect(drawn).toEqual(['home']);
  });

  it('keeps the fallback from firing after history has stepped back', async () => {
    vi.useFakeTimers();
    const { browser, drawn, screens } = setup();
    screens.go('home');
    screens.go('settings');
    screens.go('home');
    await vi.advanceTimersByTimeAsync(0);
    screens.go('study');
    vi.advanceTimersByTime(500);
    expect(drawn).toEqual(['home', 'settings', 'home', 'study']);
    expect(browser.entries).toHaveLength(2);
  });
});

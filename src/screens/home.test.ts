// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_CARDS, cardKey, studyWays } from '../deck';
import { fakeApp } from '../test/screen';
import { homeScreen } from './home';

const HOUR = 60 * 60 * 1000;

/** A learner with new cards turned off and nothing else due, the next review `wait` away. */
function caughtUp(wait: number) {
  const app = fakeApp(ALL_CARDS.slice(0, 8).map((c) => c.id));
  const now = app.now();
  for (const state of Object.values(app.progress.cards)) Object.assign(state, { interval: 30, reps: 3, due: now + 400 * 24 * HOUR });
  // Studied every way, so no way of a word is waiting to start.
  for (const card of ALL_CARDS.slice(0, 8)) {
    for (const way of studyWays(card)) app.progress.cards[cardKey(card.id, way)] ??= { ...app.progress.cards[card.id] };
  }
  app.progress.cards[ALL_CARDS[2].id].due = now + wait;
  app.progress.settings.dailyNew = 0;
  return app;
}

const kicker = (root: HTMLElement) => root.querySelector('.study-btn .hub-kicker')?.textContent;

describe('Study button', () => {
  it.each([
    [25 * 60 * 1000, 'Next in 25m'],
    [30 * 1000, 'Next in 1m'],
    [3 * HOUR + 10 * 60 * 1000, 'Next in 4h'],
    [3 * HOUR, 'Next in 3h'],
    [50 * HOUR, 'Next in 3d'],
    [90 * 24 * HOUR, 'Next in 3mo'],
    // Rounded up, not to the nearest month or year.
    [40 * 24 * HOUR, 'Next in 2mo'],
    [380 * 24 * HOUR, 'Next in 1.1y'],
  ])('says how long until the next review once caught up (%i ms)', (wait, label) => {
    const root = homeScreen(caughtUp(wait));
    expect(root.querySelector('.study-btn')?.classList.contains('study-caught-up')).toBe(true);
    expect(kicker(root)).toBe(label);
  });

  it('still says how many cards are due when some are', () => {
    expect(kicker(homeScreen(caughtUp(-1)))).toBe('1 card due');
  });

  describe('while Home stays open', () => {
    afterEach(() => {
      vi.useRealTimers();
      document.body.replaceChildren();
    });

    /** Home on show, with time moved on by `advance`. */
    function open(wait: number, setup: (app: ReturnType<typeof caughtUp>) => void = () => {}) {
      vi.useFakeTimers();
      const app = caughtUp(wait);
      setup(app);
      let now = app.now();
      app.now = () => now;
      const root = homeScreen(app);
      document.body.append(root);
      const advance = (ms: number) => {
        now += ms;
        vi.advanceTimersByTime(ms);
      };
      return { root, advance };
    }

    it('counts the wait down', () => {
      const { root, advance } = open(25 * 60 * 1000);
      advance(60 * 1000);
      expect(kicker(root)).toBe('Next in 24m');
      advance(10 * 60 * 1000);
      expect(kicker(root)).toBe('Next in 14m');
    });

    it('says the card is due once it is', () => {
      const { root, advance } = open(90 * 1000);
      advance(90 * 1000);
      expect(kicker(root)).toBe('1 card due');
      expect(root.querySelector('.study-btn')?.classList.contains('study-review')).toBe(true);
    });

    it("offers the new day's cards after midnight", () => {
      const { root, advance } = open(400 * 24 * HOUR, (app) => {
        app.progress.settings.dailyNew = 8;
        app.progress.today.newCount = 8;
      });
      expect(root.querySelector('.study-btn')?.classList.contains('study-caught-up')).toBe(true);
      advance(25 * HOUR);
      expect(root.querySelector('.study-btn')?.classList.contains('study-learn')).toBe(true);
    });

    it('keeps the same button, so focus on it stays', () => {
      const { root, advance } = open(25 * 60 * 1000);
      const button = root.querySelector<HTMLButtonElement>('.study-btn')!;
      button.focus();
      advance(60 * 1000);
      expect(root.querySelector('.study-btn')).toBe(button);
      expect(document.activeElement).toBe(button);
    });

    it("updates the memory card's numbers when what is due changes, leaving its chart be", () => {
      const { root, advance } = open(2 * 60 * 1000);
      const facts = () => root.querySelector('.strength-card .coming')?.textContent;
      const chart = root.querySelector('.strength-card svg');
      expect(facts()).toContain('1 more due by tomorrow');
      advance(2 * 60 * 1000);
      expect(kicker(root)).toBe('1 card due');
      expect(facts()).not.toContain('more due by tomorrow');
      expect(root.querySelector('.strength-card svg')).toBe(chart);
    });

    it('stops while the app is hidden', () => {
      const { root, advance } = open(25 * 60 * 1000);
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      advance(60 * 1000);
      hidden.mockRestore();
      expect(kicker(root)).toBe('Next in 25m');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops once Home is left', () => {
      const { root, advance } = open(25 * 60 * 1000);
      document.body.replaceChildren();
      advance(60 * 1000);
      expect(kicker(root)).toBe('Next in 25m');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('leaves only one timer when Home is drawn again', () => {
      open(25 * 60 * 1000);
      homeScreen(caughtUp(25 * 60 * 1000));
      expect(vi.getTimerCount()).toBe(1);
    });
  });
});

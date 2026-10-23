// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '../deck';
import { fakeApp } from '../test/screen';
import { homeScreen } from './home';

const HOUR = 60 * 60 * 1000;

/** A learner with new cards turned off and nothing else due, the next review `wait` away. */
function caughtUp(wait: number) {
  const app = fakeApp(ALL_CARDS.slice(0, 8).map((c) => c.id));
  const now = app.now();
  for (const state of Object.values(app.progress.cards)) Object.assign(state, { interval: 30, reps: 3, due: now + 30 * 24 * HOUR });
  app.progress.cards[ALL_CARDS[2].id].due = now + wait;
  app.progress.settings.dailyNew = 0;
  return app;
}

const kicker = (root: HTMLElement) => root.querySelector('.study-btn .hub-kicker')?.textContent;

describe('Study button', () => {
  it.each([
    [25 * 60 * 1000, 'Next in 25m'],
    [30 * 1000, 'Next in 1m'],
    [3 * HOUR + 10 * 60 * 1000, 'Next in 3h'],
    [50 * HOUR, 'Next in 2d'],
  ])('says how long until the next review once caught up (%i ms)', (wait, label) => {
    const root = homeScreen(caughtUp(wait));
    expect(root.querySelector('.study-btn')?.classList.contains('study-caught-up')).toBe(true);
    expect(kicker(root)).toBe(label);
  });

  it('still says how many cards are due when some are', () => {
    expect(kicker(homeScreen(caughtUp(-1)))).toBe('1 card due');
  });
});

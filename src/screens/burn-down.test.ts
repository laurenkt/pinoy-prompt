// @vitest-environment happy-dom
// Study's burn-down: only when open-ended study starts on a big backlog, one point per answer, agreeing with the header.

import { describe, expect, it } from 'vitest';
import { VOCAB } from '../deck';
import { BIG_BACKLOG, burnDownChart, caughtUp, noteLeft, startBurnDown } from './burn-down';
import { sessionScreen } from './session';
import { button, fakeApp } from '../test/screen';

/** A learner back after days away: `n` words, every one due. */
function backlog(n: number) {
  const app = fakeApp(VOCAB.slice(0, n).map((c) => c.id));
  app.progress.settings.dailyNew = 0;
  for (const state of Object.values(app.progress.cards)) state.due = app.now() - 1;
  return app;
}

/** Answer whatever is asked, right or wrong. */
function answer(root: HTMLElement): void {
  const choice = root.querySelector<HTMLButtonElement>('.choice');
  if (choice) return choice.click();
  button(root, 'Show').click();
  button(root, 'Good').click();
}

const left = (root: HTMLElement) => Number(root.querySelector('.session-count')!.textContent!.split(' ')[0]);
const done = (root: HTMLElement) => root.querySelector('.burn-done strong')?.textContent;

describe('burn-down in Study', () => {
  it('stays out of a session that starts small', () => {
    const root = sessionScreen(backlog(10), null);
    expect(left(root)).toBeLessThan(BIG_BACKLOG);
    expect(root.querySelector('.burn-down')).toBeNull();
  });

  it('charts the cards left after every answer on a big backlog, and counts the answers done', () => {
    const root = sessionScreen(backlog(BIG_BACKLOG), null);
    const start = left(root);
    expect(start).toBeGreaterThanOrEqual(BIG_BACKLOG);
    expect(done(root)).toBe('0');
    expect(root.querySelector('.burn-svg')!.getAttribute('aria-label')).toContain(`${start} at the start, ${start} now`);
    answer(root);
    expect(done(root)).toBe('1');
    // The chart's latest count is the header's.
    expect(root.querySelector('.burn-svg')!.getAttribute('aria-label')).toContain(`${start} at the start, ${left(root)} now`);
  });

  it('leaves a guided session without it, however long', () => {
    const app = backlog(BIG_BACKLOG);
    const steps = VOCAB.slice(0, BIG_BACKLOG).map((c) => ({ kind: 'review' as const, cardId: c.id, format: 'remember' as const }));
    expect(sessionScreen(app, steps).querySelector('.burn-down')).toBeNull();
  });
});

describe('burn-down record', () => {
  it('can rise as well as fall, and ends at nothing once caught up', () => {
    const burn = startBurnDown(60)!;
    noteLeft(burn, 59);
    noteLeft(burn, 61);
    noteLeft(burn, 1);
    caughtUp(burn);
    expect(burn.left).toEqual([60, 59, 61, 0]);
    const chart = burnDownChart(burn);
    expect(chart.querySelector('.burn-done strong')!.textContent).toBe('3');
    expect(chart.querySelector('.burn-edge')!.getAttribute('d')).toMatch(/^M0,.* H.* V.* H.* V.* H.* V/);
  });

  it('starts only at the threshold', () => {
    expect(startBurnDown(BIG_BACKLOG - 1)).toBeNull();
    expect(startBurnDown(BIG_BACKLOG)).toEqual({ left: [BIG_BACKLOG] });
  });
});

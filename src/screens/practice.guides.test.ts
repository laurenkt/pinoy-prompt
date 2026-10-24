// @vitest-environment happy-dom
// Guides in a drill round: asked the way Study asks them, a gap to fill under
// Read and a sentence to build under Recall, and never changing the schedule.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCard } from '../deck';
import { buildTiles, drillSentence } from '../session';
import { DAY_MS } from '../srs';
import { practiceScreen } from './practice';
import { button, drillScope, fakeApp, noMic } from '../test/screen';

const WORDS = ['salamat', 'kumusta', 'oo', 'hindi', 'gusto-ko-ito', 'kape'];

/** A learner who knows the words well, and is still learning the pattern, so the round leans on it. */
function app() {
  const a = fakeApp([...WORDS, 'p-gusto']);
  for (const id of WORDS) Object.assign(a.progress.cards[id], { interval: 90, reps: 5, introduced: a.now() - 200 * DAY_MS });
  Object.assign(a.progress.cards['p-gusto'], { interval: 0, lapses: 3 });
  return a;
}

const drillOf = (root: HTMLElement) => getCard('p-gusto')!.drills!.find((d) => d.q === root.querySelector('.drill-q')?.textContent)!;

/** Move on through the round until the pattern is asked. */
function untilGuide(root: HTMLElement, eyebrow: string): void {
  for (let i = 0; i < 40 && !root.textContent?.includes(eyebrow); i++) {
    // Words settled in Study are typed; picking from choices is quicker here.
    if (root.querySelector('.meaning-input')) button(root, 'Show choices').click();
    if (!root.querySelector('.feedback')) root.querySelector<HTMLButtonElement>('.choice')!.click();
    button(root, 'Next').click();
  }
  expect(root.textContent).toContain(eyebrow);
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('guides in a drill round', () => {
  it('asks a gap to fill under Read, and shows the answer and the rule on a miss', () => {
    const a = app();
    const root = practiceScreen(a, noMic);
    drillScope(root, ['read']);
    const before = structuredClone(a.progress.cards);
    untilGuide(root, 'Fill the gap');
    const drill = drillOf(root);
    [...root.querySelectorAll<HTMLButtonElement>('.choice')].find((c) => c.textContent!.replace(/^\d/, '') !== drill.answer)!.click();
    const feedback = root.querySelector('.feedback.bad')!.textContent;
    expect(feedback).toContain('Mali.');
    expect(feedback).toContain(drillSentence(drill));
    expect(feedback).toContain(getCard('p-gusto')!.note);
    // The schedule is left alone; only the drills' own count of the miss, asked that way, is kept.
    expect(a.progress.cards['p-gusto'].help).toEqual({ read: 1 });
    const schedules = (cards: typeof before) => Object.values(cards).map(({ help: _help, helpAt: _at, ...schedule }) => schedule);
    expect(schedules(a.progress.cards)).toEqual(schedules(before));
    drillScope(root, ['listen', 'read', 'recall', 'speak']);
  });

  it('asks a sentence to build under Recall, right only in order', () => {
    const root = practiceScreen(app(), noMic);
    drillScope(root, ['recall']);
    untilGuide(root, 'Put it in order');
    for (const w of buildTiles(drillOf(root)).words) {
      [...root.querySelectorAll<HTMLButtonElement>('.tile-pool .build-tile')].find((t) => !t.disabled && t.textContent === w)!.click();
    }
    button(root, 'Check').click();
    expect(root.querySelector('.feedback.good')?.textContent).toContain('Tama!');
    drillScope(root, ['listen', 'read', 'recall', 'speak']);
  });

  it('leaves guides out when only Listen is chosen', () => {
    // A voice, so listening can be asked.
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], speak: () => {}, cancel: () => {}, addEventListener: () => {} });
    const root = practiceScreen(app(), noMic);
    drillScope(root, ['listen']);
    for (let i = 0; i < 20; i++) {
      expect(root.querySelector('.drill-q')).toBeNull();
      // Words settled in Study are typed; picking from choices is quicker here.
      if (root.querySelector('.meaning-input')) button(root, 'Show choices').click();
      if (!root.querySelector('.feedback')) root.querySelector<HTMLButtonElement>('.choice')!.click();
      button(root, 'Next').click();
    }
    drillScope(root, ['listen', 'read', 'recall', 'speak']);
  });
});

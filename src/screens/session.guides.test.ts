// @vitest-environment happy-dom
// Guides in a study session: introduced with their explanation, then checked
// with a gap to fill, a sentence to build, or an answer to recall.

import { describe, expect, it } from 'vitest';
import type { App } from '../app';
import { getCard } from '../deck';
import { buildTiles, drillSentence } from '../session';
import { emptyProgress, recordAnswer } from '../store';
import { sessionScreen } from './session';
import type { SpeakDeps } from './speak';

const noMic = { recordingSupported: () => false, modelDownloaded: async () => false } as unknown as SpeakDeps;

function fakeApp(known: string[] = []): App {
  const now = Date.now();
  const progress = emptyProgress(now);
  progress.settings.autoplay = false;
  for (const id of known) recordAnswer(progress, id, 'good', now);
  return { progress, now: () => now, commit: () => {}, replaceProgress: () => {}, navigate: () => {}, onKey: () => {}, onBack: () => {} };
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text || b.textContent?.includes(text));
  if (!found) throw new Error(`No "${text}" button`);
  return found;
}

const choices = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.choice')];
const answerOf = (root: HTMLElement) => {
  const g = getCard('p-gusto')!;
  const q = root.querySelector('.drill-q')!.textContent;
  return g.drills!.find((d) => d.q === q)!;
};

describe('a new pattern', () => {
  it('is explained in plain words with examples, then checked with a gap', () => {
    const app = fakeApp(['gusto-ko-ito', 'kape']);
    const root = sessionScreen(app, [{ kind: 'new', cardId: 'p-gusto' }], undefined, noMic);
    expect(root.textContent).toContain('New pattern');
    expect(root.textContent).toContain(getCard('p-gusto')!.note);
    expect(root.querySelectorAll('.examples li').length).toBe(3);
    button(root, 'Got it, try one').click();
    expect(root.textContent).toContain('Fill the gap');
    const drill = answerOf(root);
    choices(root).find((c) => c.textContent!.includes(drill.answer))!.click();
    expect(root.querySelector('.feedback.good')).not.toBeNull();
    expect(app.progress.cards['p-gusto']).toBeDefined();
  });

  it('shows the rule again after a wrong answer, and brings it back', () => {
    const app = fakeApp(['gusto-ko-ito', 'kape']);
    const root = sessionScreen(app, [{ kind: 'new', cardId: 'p-gusto' }], undefined, noMic);
    button(root, 'Got it, try one').click();
    const drill = answerOf(root);
    choices(root).find((c) => !c.textContent!.includes(drill.answer))!.click();
    expect(root.querySelector('.feedback.bad')!.textContent).toContain(getCard('p-gusto')!.note);
    expect(root.querySelector(".feedback.bad")!.textContent).toContain(drillSentence(drill));
    button(root, 'Continue').click();
    expect(root.textContent).toContain('Fill the gap');
  });
});

describe('a learned pattern', () => {
  it('can be built from tiles, and counts as right only in order', () => {
    const app = fakeApp(['gusto-ko-ito', 'kape', 'p-gusto']);
    const root = sessionScreen(app, [{ kind: 'review', cardId: 'p-gusto', format: 'build' }], undefined, noMic);
    expect(root.textContent).toContain('Put it in order');
    const drill = answerOf(root);
    const { words, decoy } = buildTiles(drill);
    // A decoy word joins the tiles, so the last one left isn't a giveaway.
    expect(root.querySelectorAll('.tile-pool .build-tile').length).toBe(words.length + (decoy ? 1 : 0));
    for (const w of words) {
      const tile = [...root.querySelectorAll<HTMLButtonElement>('.tile-pool .build-tile')].find((t) => !t.disabled && t.textContent === w)!;
      tile.click();
    }
    button(root, 'Check').click();
    expect(root.querySelector('.feedback.good')).not.toBeNull();
    expect(app.progress.cards['p-gusto'].reps).toBe(2);
  });

  it('can be recalled and self-rated, with the explanation on request', () => {
    const app = fakeApp(['gusto-ko-ito', 'kape', 'p-gusto']);
    const root = sessionScreen(app, [{ kind: 'review', cardId: 'p-gusto', format: 'think' }], undefined, noMic);
    expect(root.textContent).toContain('How do you say…');
    // The whole sentence is recalled, not just the gap.
    expect(root.querySelector('.gap')).toBeNull();
    button(root, 'Show the answer').click();
    expect(root.querySelector('.gap')!.textContent).not.toBe('___');
    expect(root.textContent).not.toContain(getCard('p-gusto')!.note);
    button(root, 'Show the explanation').click();
    expect(root.textContent).toContain(getCard('p-gusto')!.note);
    button(root, 'Good').click();
    expect(app.progress.cards['p-gusto'].reps).toBe(2);
  });
});

describe('a know-how card', () => {
  it('asks a plain question rather than a sentence', () => {
    const root = sessionScreen(fakeApp(['kuya', 'ate']), [{ kind: 'new', cardId: 'k-kuya' }], undefined, noMic);
    expect(root.textContent).toContain('Good to know');
    button(root, 'Got it, try one').click();
    expect(root.querySelector('.gap')).toBeNull();
    expect(choices(root).length).toBe(3);
  });
});

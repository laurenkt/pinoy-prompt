// @vitest-environment happy-dom
// Recall drills: words still being learned have their Tagalog picked from
// choices; words that have settled in Study have it typed, or said, from the
// English. The English said back isn't an answer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../app';
import type { Card } from '../deck';
import type { MeaningJudge } from '../meaning';
import type { Take } from '../recorder';
import { recordAnswer } from '../store';
import { button, drillScope, fakeApp, flush, noMic } from '../test/screen';
import { practiceScreen, type MeaningHearer } from './practice';
import type { SpeakDeps } from './speak';
import { play } from '../speech';

vi.mock('../speech', async (actual) => {
  const speech = await actual<typeof import('../speech')>();
  return { ...speech, play: vi.fn(async () => {}) };
});

/** Asked in this order, since every pick rolls 0. */
const KNOWN = ['salamat', 'maraming-salamat', 'magandang-umaga', 'bukas'];

/** Words just met; settled ones have been remembered again since. */
function learner(settled: boolean): App {
  const app = fakeApp(KNOWN);
  if (settled) for (const id of KNOWN) recordAnswer(app.progress, id, 'good', app.now());
  return app;
}

const box = (root: HTMLElement) => root.querySelector<HTMLInputElement>('.meaning-input');

function type(root: HTMLElement, text: string): void {
  box(root)!.value = text;
  root.querySelector('form.meaning-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
}

/** A round asking only Recall, opened with that scope so its first question is on the first word. */
function recall(app: App, judge: MeaningJudge | null = null, deps: SpeakDeps = noMic, hearer: MeaningHearer | null = null): HTMLElement {
  drillScope(practiceScreen(fakeApp(KNOWN), noMic), ['recall']);
  const root = practiceScreen(app, deps, judge, () => hearer);
  document.body.replaceChildren(root);
  return root;
}

let last: HTMLElement | undefined;
beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
  // The scope is kept across visits: back to the mix for the next test.
  if (last) drillScope(last, ['listen', 'read', 'recall', 'speak']);
  last = undefined;
  vi.restoreAllMocks();
  vi.mocked(play).mockClear();
  document.body.replaceChildren();
});

describe('recalling words still being learned', () => {
  it('picks the Tagalog from choices', () => {
    const root = (last = recall(learner(false)));
    expect(root.textContent).toContain('How do you say…');
    expect(root.querySelectorAll('.choice')).toHaveLength(4);
    expect(box(root)).toBeNull();
  });
});

describe('recalling words that have settled', () => {
  it('asks for the Tagalog to be typed, and takes it with a "po" or a typo', async () => {
    const judge = vi.fn<MeaningJudge>(async () => null);
    const root = (last = recall(learner(true), judge));
    expect(root.querySelector('.prompt-en')?.textContent).toBe('Thank you');
    expect(root.querySelector('.choice')).toBeNull();
    expect(box(root)!.placeholder).toBe('Type it in Tagalog');
    expect(box(root)!.getAttribute('autocorrect')).toBe('off');
    type(root, 'Salamat po');
    await flush();
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
    expect(box(root)!.classList.contains('correct')).toBe(true);
    expect(root.querySelector('.continue.counting')).not.toBeNull();
    // The word is said back once it's answered.
    expect(play).toHaveBeenCalledWith(expect.objectContaining<Partial<Card>>({ id: 'salamat' }), false);
    expect(judge).not.toHaveBeenCalled();
  });

  it("doesn't play the word before it's answered, since it's the answer", () => {
    const root = (last = recall(learner(true)));
    expect(root.querySelector('.audio-btn')).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it('turns the English said back down', async () => {
    // OpenAI, told the answer has to be in Tagalog.
    const judge = vi.fn<MeaningJudge>(async () => false);
    const root = (last = recall(learner(true), judge));
    type(root, 'thank you');
    await flush();
    expect(root.querySelector('.feedback')?.textContent).toContain('Mali.');
    expect(root.querySelector('.feedback')?.textContent).toContain('Salamat');
    expect(judge).toHaveBeenCalledWith('thank you', expect.objectContaining<Partial<Card>>({ id: 'salamat' }), 'tl');
  });

  it('checks other wording with OpenAI, as Tagalog', async () => {
    const judge = vi.fn<MeaningJudge>(async () => true);
    const root = (last = recall(learner(true), judge));
    type(root, 'salamat sa iyo');
    await flush();
    expect(judge).toHaveBeenCalledWith('salamat sa iyo', expect.objectContaining<Partial<Card>>({ id: 'salamat' }), 'tl');
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
  });

  it('offers the choices instead, in Tagalog', () => {
    const root = (last = recall(learner(true)));
    button(root, 'Show choices').click();
    const choices = [...root.querySelectorAll('.choice')];
    expect(choices).toHaveLength(4);
    expect(choices.some((c) => c.textContent?.includes('Salamat'))).toBe(true);
  });

  it('hears a Tagalog answer said into the box as Tagalog', async () => {
    let finish: (t: Take) => void = () => {};
    const record = vi.fn(() => {
      const audio = new Promise<Take>((r) => (finish = r));
      setTimeout(() => finish({ samples: new Float32Array(160), speech: true }), 0);
      return { audio, stop: () => {}, cancel: () => {} };
    });
    const deps = { recordingSupported: () => true, modelDownloaded: async () => false, record } as unknown as SpeakDeps;
    const hearer = vi.fn<MeaningHearer>(async () => 'Salamat.');
    const root = (last = recall(learner(true), null, deps, hearer));
    root.querySelector<HTMLButtonElement>('.meaning-mic')!.click();
    expect(root.querySelector('.meaning-status')?.textContent).toBe('Listening… say it in Tagalog.');
    await flush();
    await flush();
    expect(hearer).toHaveBeenCalledWith(expect.any(Blob), 'tl');
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
  });
});

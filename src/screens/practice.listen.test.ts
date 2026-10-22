// @vitest-environment happy-dom
// Listening drills: words still being learned are picked from choices; words
// that have settled in Study have their meaning typed, judged on meaning.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../app';
import type { Card } from '../deck';
import type { MeaningJudge } from '../meaning';
import { recordAnswer } from '../store';
import { button, fakeApp, flush, noMic } from '../test/screen';
import { ADVANCE_MS } from './auto-advance';
import { practiceScreen } from './practice';
import { AiError } from '../openai';

/** Asked in this order, since every pick rolls 0. */
const KNOWN = ['salamat', 'maraming-salamat', 'magandang-umaga', 'bukas'];

/** Words just met; settled ones have been remembered again since. */
function learner(settled: boolean): App {
  const app = fakeApp(KNOWN);
  if (settled) for (const id of KNOWN) recordAnswer(app.progress, id, 'good', app.now());
  return app;
}

const has = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].some((b) => b.textContent?.includes(text));
const box = (root: HTMLElement) => root.querySelector<HTMLInputElement>('.meaning-input');

function type(root: HTMLElement, text: string): void {
  box(root)!.value = text;
  root.querySelector('form.meaning-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
}

function listen(app: App, judge: MeaningJudge | null = null): HTMLElement {
  const root = practiceScreen(app, noMic, judge);
  document.body.replaceChildren(root);
  // Every roll is 0, so the mix asks the first kind it can: listening.
  return root;
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  // A voice, so listening is on offer.
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], speak: () => {}, cancel: () => {}, addEventListener: () => {} });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('listening to words still being learned', () => {
  it('picks the meaning from choices', () => {
    const root = listen(learner(false));
    expect(root.querySelectorAll('.choice')).toHaveLength(4);
    expect(box(root)).toBeNull();
  });
});

describe('listening to words that have settled', () => {
  it('asks for the meaning to be typed, and takes other spellings of it', async () => {
    const judge = vi.fn<MeaningJudge>(async () => null);
    const root = listen(learner(true), judge);
    expect(root.querySelector('.choice')).toBeNull();
    expect(root.textContent).toContain('What does it mean?');
    type(root, 'thanks');
    await flush();
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
    expect(box(root)!.classList.contains('correct')).toBe(true);
    expect(box(root)!.disabled).toBe(true);
    // A right answer moves on by itself, as a right choice does.
    expect(root.querySelector('.continue.counting')).not.toBeNull();
    expect(judge).not.toHaveBeenCalled();
  });

  it('checks other wording with OpenAI, while saying so', async () => {
    let answer: (right: boolean) => void = () => {};
    const judge = vi.fn<MeaningJudge>(() => new Promise((r) => (answer = r)));
    const root = listen(learner(true), judge);
    type(root, 'thanks');
    await flush();
    button(root, 'Next').click();
    type(root, 'thanks a lot');
    expect(button(root, 'Checking').disabled).toBe(true);
    expect(judge).toHaveBeenCalledWith('thanks a lot', expect.objectContaining<Partial<Card>>({ id: 'maraming-salamat' }));
    answer(true);
    await flush();
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
    expect(root.querySelector('.continue.counting')).not.toBeNull();
  });

  it('shows the meaning after a miss, and lets the learner say they had it', async () => {
    const root = listen(learner(true));
    type(root, 'good night');
    await flush();
    expect(root.querySelector('.feedback')?.textContent).toContain('Mali.');
    expect(root.querySelector('.feedback')?.textContent).toContain('Thank you');
    expect(box(root)!.classList.contains('wrong')).toBe(true);
    expect(root.querySelector('.hook')).not.toBeNull();
    expect(root.querySelector('.continue.counting')).toBeNull();
    button(root, 'I had it right').click();
    expect(box(root)!.classList.contains('correct')).toBe(true);
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
    expect(has(root, 'I had it right')).toBe(false);
  });

  it("doesn't take an empty box as an answer", async () => {
    const judge = vi.fn<MeaningJudge>(async () => true);
    const root = listen(learner(true), judge);
    type(root, '  ');
    await flush();
    expect(root.querySelector('.feedback')).toBeNull();
    expect(box(root)!.disabled).toBe(false);
    expect(judge).not.toHaveBeenCalled();
  });

  it('goes to the choices while a check is slow, and drops the check', async () => {
    let answer: (right: boolean) => void = () => {};
    const root = listen(learner(true), () => new Promise((r) => (answer = r)));
    type(root, 'thanks a lot');
    button(root, 'Show choices').click();
    expect(root.querySelectorAll('.choice')).toHaveLength(4);
    answer(true);
    await flush();
    expect(root.querySelector('.feedback')).toBeNull();
    expect(root.querySelectorAll('.choice:disabled')).toHaveLength(0);
  });

  it('says what to fix when OpenAI turns the key down', async () => {
    const root = listen(learner(true), async () => Promise.reject(new AiError('key', 'bad key')));
    type(root, 'thanks a lot');
    await flush();
    expect(root.querySelector('.feedback-note')?.textContent).toContain("didn't accept the API key");
  });

  it('offers the choices instead, for a word the learner is unsure of', () => {
    const root = listen(learner(true));
    button(root, 'Show choices').click();
    expect(box(root)).toBeNull();
    expect(root.querySelectorAll('.choice')).toHaveLength(4);
  });

  it("drops a check that comes back after the round has ended", async () => {
    let answer: (right: boolean) => void = () => {};
    const app = learner(true);
    const root = listen(app, () => new Promise((r) => (answer = r)));
    type(root, 'thanks a lot');
    document.body.replaceChildren();
    answer(true);
    await flush();
    expect(root.querySelector('.feedback')).toBeNull();
  });

  it('says when OpenAI could not be asked', async () => {
    const root = listen(learner(true), async () => Promise.reject(new Error('offline')));
    type(root, 'thanks a lot');
    await flush();
    expect(root.querySelector('.feedback')?.textContent).toContain("Couldn't reach OpenAI");
    expect(has(root, 'I had it right')).toBe(true);
  });

  it('keeps what was typed while looking back, and holds the way back while checking', async () => {
    vi.useFakeTimers();
    try {
      const root = listen(learner(true), () => new Promise(() => {}));
      type(root, 'thanks');
      // Long enough for the word said back to finish, too.
      await vi.advanceTimersByTimeAsync(ADVANCE_MS * 5);
      box(root)!.value = 'thank you very';
      box(root)!.dispatchEvent(new Event('input'));
      button(root, 'Previous card').click();
      button(root, 'Back to the current card').click();
      expect(box(root)!.value).toBe('thank you very');
      type(root, 'thanks a lot');
      expect(has(root, 'Previous card')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

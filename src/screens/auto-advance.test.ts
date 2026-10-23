// @vitest-environment happy-dom
// A right first answer moves on by itself after a couple of seconds; a miss,
// or a card missed earlier, waits for Continue. Either way the card just
// answered can be looked back at from the next one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VOCAB, getCard } from '../deck';
import type { Step } from '../session';
import { ADVANCE_MS } from './auto-advance';
import { practiceScreen } from './practice';
import { sessionScreen } from './session';
import { button, drillScope, fakeApp, noMic } from '../test/screen';

const KNOWN = ['salamat', 'kumusta', 'oo', 'hindi', 'paalam', 'kape'];

/** Mount a screen, since one that has been left never moves on. */
function mount(el: HTMLElement): HTMLElement {
  document.body.replaceChildren(el);
  return el;
}

const has = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].some((b) => b.textContent?.includes(text));
const shownCard = (root: HTMLElement) => VOCAB.find((c) => c.tl === root.querySelector('.prompt .tl')?.textContent)!;
const answer = (root: HTMLElement, right: boolean) =>
  [...root.querySelectorAll<HTMLButtonElement>('.choice')].find((b) => b.textContent?.includes(shownCard(root).en) === right)!.click();

const reads = (...ids: string[]): Step[] => ids.map((cardId) => ({ kind: 'review', cardId, format: 'read' }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('moving on after a right answer in a session', () => {
  it('goes to the next card by itself, with a way back to the one before', () => {
    const root = mount(sessionScreen(fakeApp(KNOWN), reads('salamat', 'oo')));
    answer(root, true);
    expect(root.querySelector('.continue.counting')).not.toBeNull();
    vi.advanceTimersByTime(ADVANCE_MS - 1);
    expect(shownCard(root).id).toBe('salamat');
    vi.advanceTimersByTime(1);
    expect(shownCard(root).id).toBe('oo');

    button(root, 'Previous card').click();
    expect(shownCard(root).id).toBe('salamat');
    expect(root.querySelector('.feedback.good')).not.toBeNull();
    // Looking back is for reviewing, so the hook is there too.
    expect(root.querySelector('.hook')?.textContent).toContain(getCard('salamat')!.hook);
    button(root, 'Back to the current card').click();
    expect(shownCard(root).id).toBe('oo');
    expect(root.querySelector('.feedback')).toBeNull();

    // Once this one is answered, the way back goes.
    answer(root, false);
    expect(has(root, 'Previous card')).toBe(false);
  });

  it('waits for Continue after a miss', () => {
    const root = mount(sessionScreen(fakeApp(KNOWN), reads('salamat', 'oo')));
    answer(root, false);
    expect(root.querySelector('.counting')).toBeNull();
    vi.advanceTimersByTime(ADVANCE_MS * 5);
    expect(shownCard(root).id).toBe('salamat');
    button(root, 'Continue').click();
    button(root, 'Previous card').click();
    expect(shownCard(root).id).toBe('salamat');
    expect(root.querySelector('.feedback.bad')).not.toBeNull();
  });

  it('keeps the hook up when a card missed earlier is got right', () => {
    const root = mount(sessionScreen(fakeApp(KNOWN), reads('salamat')));
    answer(root, false);
    button(root, 'Continue').click();
    expect(shownCard(root).id).toBe('salamat');
    answer(root, true);
    expect(root.querySelector('.hook')?.textContent).toContain(getCard('salamat')!.hook);
    vi.advanceTimersByTime(ADVANCE_MS * 5);
    expect(root.querySelector('.feedback.good')).not.toBeNull();
  });

  it('stops counting down when the learner taps something else', () => {
    const root = mount(sessionScreen(fakeApp(KNOWN), reads('salamat', 'oo')));
    answer(root, true);
    root.querySelector<HTMLButtonElement>('.audio-btn')!.click();
    expect(root.querySelector('.counting')).toBeNull();
    vi.advanceTimersByTime(ADVANCE_MS * 5);
    expect(shownCard(root).id).toBe('salamat');
  });

  it('moves on straight away from Continue, still offering the way back', () => {
    const root = mount(sessionScreen(fakeApp(KNOWN), reads('salamat', 'oo')));
    answer(root, true);
    button(root, 'Continue').click();
    expect(shownCard(root).id).toBe('oo');
    vi.advanceTimersByTime(ADVANCE_MS * 5);
    expect(shownCard(root).id).toBe('oo');
    button(root, 'Previous card').click();
    expect(shownCard(root).id).toBe('salamat');
    expect(root.querySelector('.feedback.good')).not.toBeNull();
  });

  it('shows a rated card again without its ratings, so looking back never rates it twice', () => {
    const app = fakeApp(KNOWN);
    let onKey: (e: KeyboardEvent) => void = () => {};
    app.onKey = (fn) => void (onKey = fn ?? onKey);
    const steps: Step[] = [{ kind: 'review', cardId: 'salamat', format: 'remember' }, ...reads('oo')];
    const root = mount(sessionScreen(app, steps));
    button(root, 'Show the meaning').click();
    button(root, 'Good').click();
    const rated = structuredClone(app.progress.cards.salamat);

    button(root, 'Previous card').click();
    expect(shownCard(root).id).toBe('salamat');
    expect(root.querySelector('.answer .meaning')?.textContent).toBe(getCard('salamat')!.en);
    expect(root.querySelector('.hook')?.textContent).toContain(getCard('salamat')!.hook);
    expect(root.querySelector('.rate')).toBeNull();
    onKey(new KeyboardEvent('keydown', { key: '1' }));
    expect(app.progress.cards.salamat).toEqual(rated);

    button(root, 'Back to the current card').click();
    expect(shownCard(root).id).toBe('oo');
  });

  it('looks back at a card missed on its flashcard', () => {
    const steps: Step[] = [{ kind: 'review', cardId: 'salamat', format: 'remember' }, ...reads('oo')];
    const root = mount(sessionScreen(fakeApp(KNOWN), steps));
    button(root, 'Show the meaning').click();
    button(root, 'Again').click();
    button(root, 'Continue').click();
    expect(shownCard(root).id).toBe('oo');
    button(root, 'Previous card').click();
    expect(root.querySelector('.eyebrow')?.textContent).toBe('Coming back shortly');
    button(root, 'Back to the current card').click();
    expect(shownCard(root).id).toBe('oo');
  });

  it("doesn't put focus on the next card's choices, so a late Enter can't answer it", () => {
    const root = mount(sessionScreen(fakeApp(KNOWN), reads('salamat', 'oo')));
    answer(root, true);
    vi.advanceTimersByTime(ADVANCE_MS);
    expect(shownCard(root).id).toBe('oo');
    expect(document.activeElement?.classList.contains('choice')).toBe(false);
  });

  it('does nothing once the screen has been left', () => {
    const root = mount(sessionScreen(fakeApp(KNOWN), reads('salamat', 'oo')));
    answer(root, true);
    document.body.replaceChildren();
    vi.advanceTimersByTime(ADVANCE_MS * 5);
    expect(shownCard(root).id).toBe('salamat');
  });
});

describe('moving on after a right answer in a drill', () => {
  function round(): HTMLElement {
    const root = mount(practiceScreen(fakeApp(KNOWN), noMic));
    drillScope(root, ['read']);
    return root;
  }

  it('goes to the next question by itself, with a way back', () => {
    const root = round();
    const first = shownCard(root);
    answer(root, true);
    vi.advanceTimersByTime(ADVANCE_MS);
    expect(root.querySelector('.choice:disabled')).toBeNull();
    button(root, 'Previous card').click();
    expect(shownCard(root).id).toBe(first.id);
    expect(root.querySelector('.hook')?.textContent).toContain(first.hook);
    button(root, 'Back to the current card').click();
    expect(root.querySelector('.choice:disabled')).toBeNull();
    expect(root.querySelector('.session-count')?.textContent).toBe('1 done');
  });

  it('keeps asking until the learner closes it, with no word straight after itself', () => {
    const root = round();
    let last = '';
    for (let i = 0; i < 25; i++) {
      const card = shownCard(root);
      expect(card.id).not.toBe(last);
      last = card.id;
      answer(root, true);
      vi.advanceTimersByTime(ADVANCE_MS);
    }
    expect(root.querySelector('.session-count')?.textContent).toBe('25 done');
  });

  it('waits for Next after a miss', () => {
    const root = round();
    answer(root, false);
    vi.advanceTimersByTime(ADVANCE_MS * 5);
    expect(root.querySelector('.choice:disabled')).not.toBeNull();
    const missed = root.querySelector('.choice.wrong')?.textContent;
    button(root, 'Next').click();
    button(root, 'Previous card').click();
    expect(root.querySelector('.feedback.bad')).not.toBeNull();
    expect(root.querySelector('.choice.wrong')?.textContent).toBe(missed);
    button(root, 'Back to the current card').click();
    expect(root.querySelector('.choice:disabled')).toBeNull();
  });
});

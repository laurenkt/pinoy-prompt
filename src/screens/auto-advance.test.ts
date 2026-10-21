// @vitest-environment happy-dom
// A right first answer moves on by itself after a couple of seconds, with a
// way back to it; a miss, or a card missed earlier, waits for Continue.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../app';
import { VOCAB, getCard } from '../deck';
import type { Step } from '../session';
import { emptyProgress, recordAnswer } from '../store';
import { ADVANCE_MS } from './auto-advance';
import { practiceScreen } from './practice';
import { sessionScreen } from './session';
import type { SpeakDeps } from './speak';

const noMic = { recordingSupported: () => false, modelDownloaded: async () => false } as unknown as SpeakDeps;
const KNOWN = ['salamat', 'kumusta', 'oo', 'hindi', 'paalam', 'kape'];

function fakeApp(): App {
  const now = Date.now();
  const progress = emptyProgress(now);
  progress.settings.autoplay = false;
  for (const id of KNOWN) recordAnswer(progress, id, 'good', now);
  return { progress, now: () => now, commit: () => {}, replaceProgress: () => {}, navigate: () => {}, onKey: () => {} };
}

/** Mount a screen, since one that has been left never moves on. */
function mount(el: HTMLElement): HTMLElement {
  document.body.replaceChildren(el);
  return el;
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`No "${text}" button`);
  return found;
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
    const root = mount(sessionScreen(fakeApp(), reads('salamat', 'oo'), undefined, noMic));
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
    const root = mount(sessionScreen(fakeApp(), reads('salamat', 'oo'), undefined, noMic));
    answer(root, false);
    expect(root.querySelector('.counting')).toBeNull();
    vi.advanceTimersByTime(ADVANCE_MS * 5);
    expect(shownCard(root).id).toBe('salamat');
    button(root, 'Continue').click();
    expect(has(root, 'Previous card')).toBe(false);
  });

  it('keeps the hook up when a card missed earlier is got right', () => {
    const root = mount(sessionScreen(fakeApp(), reads('salamat'), undefined, noMic));
    answer(root, false);
    button(root, 'Continue').click();
    expect(shownCard(root).id).toBe('salamat');
    answer(root, true);
    expect(root.querySelector('.hook')?.textContent).toContain(getCard('salamat')!.hook);
    vi.advanceTimersByTime(ADVANCE_MS * 5);
    expect(root.querySelector('.feedback.good')).not.toBeNull();
  });

  it('stops counting down when the learner taps something else', () => {
    const root = mount(sessionScreen(fakeApp(), reads('salamat', 'oo'), undefined, noMic));
    answer(root, true);
    root.querySelector('.audio-btn')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(root.querySelector('.counting')).toBeNull();
    vi.advanceTimersByTime(ADVANCE_MS * 5);
    expect(shownCard(root).id).toBe('salamat');
  });

  it('moves on straight away from Continue, without offering the way back', () => {
    const root = mount(sessionScreen(fakeApp(), reads('salamat', 'oo'), undefined, noMic));
    answer(root, true);
    button(root, 'Continue').click();
    expect(shownCard(root).id).toBe('oo');
    expect(has(root, 'Previous card')).toBe(false);
    vi.advanceTimersByTime(ADVANCE_MS * 5);
    expect(shownCard(root).id).toBe('oo');
  });

  it('does nothing once the screen has been left', () => {
    const root = mount(sessionScreen(fakeApp(), reads('salamat', 'oo'), undefined, noMic));
    answer(root, true);
    document.body.replaceChildren();
    vi.advanceTimersByTime(ADVANCE_MS * 5);
    expect(shownCard(root).id).toBe('salamat');
  });
});

describe('moving on after a right answer in a drill', () => {
  function round(): HTMLElement {
    const root = mount(practiceScreen(fakeApp(), noMic));
    button(root, 'Read').click();
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
    expect(root.querySelector('.session-title')?.textContent).toBe('1 right');
  });

  it('waits for Next after a miss', () => {
    const root = round();
    answer(root, false);
    vi.advanceTimersByTime(ADVANCE_MS * 5);
    expect(root.querySelector('.choice:disabled')).not.toBeNull();
    button(root, 'Next').click();
    expect(has(root, 'Previous card')).toBe(false);
  });
});

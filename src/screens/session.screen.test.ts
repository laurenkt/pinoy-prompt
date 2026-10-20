// @vitest-environment happy-dom
// Memory hooks on the study session: shown on introduction, held back in
// review until the learner asks for one or misses the card.

import { describe, expect, it } from 'vitest';
import type { App } from '../app';
import { getCard } from '../deck';
import { emptyProgress, recordAnswer } from '../store';
import { sessionScreen } from './session';

function fakeApp(known: string[] = []): App {
  const now = Date.now();
  const progress = emptyProgress(now);
  progress.settings.autoplay = false;
  for (const id of known) recordAnswer(progress, id, 'good', now);
  return { progress, now: () => now, commit: () => {}, replaceProgress: () => {}, navigate: () => {}, onKey: () => {} };
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`No "${text}" button`);
  return found;
}

const hookText = (root: HTMLElement) => root.querySelector('.hook')?.textContent ?? null;

describe('memory hooks in a session', () => {
  it('shows the hook when a word is first introduced', () => {
    const root = sessionScreen(fakeApp(['kumusta']), [{ kind: 'new', cardId: 'salamat' }]);
    expect(hookText(root)).toContain(getCard('salamat')!.hook);
  });

  it('keeps the hook hidden on a review until the answer is shown and asked for', () => {
    const root = sessionScreen(fakeApp(['salamat']), [{ kind: 'review', cardId: 'salamat' }]);
    expect(hookText(root)).toBeNull();
    button(root, 'Show the meaning').click();
    expect(hookText(root)).toBeNull();
    button(root, 'Show memory hook').click();
    expect(hookText(root)).toContain(getCard('salamat')!.hook);
  });

  it('shows the hook after a missed review before moving on', () => {
    const root = sessionScreen(fakeApp(['salamat']), [{ kind: 'review', cardId: 'salamat' }]);
    button(root, 'Show the meaning').click();
    button(root, 'Again').click();
    expect(hookText(root)).toContain(getCard('salamat')!.hook);
    button(root, 'Continue').click();
    // The missed card comes straight back, hook hidden again.
    expect(root.textContent).toContain('Do you remember?');
    expect(hookText(root)).toBeNull();
  });

  it('skips the extra step on a miss when the hook was already open', () => {
    const root = sessionScreen(fakeApp(['salamat']), [{ kind: 'review', cardId: 'salamat' }]);
    button(root, 'Show the meaning').click();
    button(root, 'Show memory hook').click();
    button(root, 'Again').click();
    expect(root.textContent).toContain('Do you remember?');
  });
});

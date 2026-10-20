// @vitest-environment happy-dom
// Memory hooks on the study session: shown on introduction, held back in
// review until the learner asks for one or misses the card.

import { describe, expect, it } from 'vitest';
import type { App } from '../app';
import { getCard } from '../deck';
import { emptyProgress, recordAnswer } from '../store';
import { sessionScreen } from './session';
import type { SpeakDeps } from './speak';

const noMic = { recordingSupported: () => false, modelDownloaded: async () => false } as unknown as SpeakDeps;

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
    const root = sessionScreen(fakeApp(['salamat']), [{ kind: 'review', cardId: 'salamat', format: 'remember' }]);
    expect(hookText(root)).toBeNull();
    button(root, 'Show the meaning').click();
    expect(hookText(root)).toBeNull();
    button(root, 'Show memory hook').click();
    expect(hookText(root)).toContain(getCard('salamat')!.hook);
  });

  it('shows the hook after a missed review before moving on', () => {
    const root = sessionScreen(fakeApp(['salamat']), [{ kind: 'review', cardId: 'salamat', format: 'remember' }]);
    button(root, 'Show the meaning').click();
    button(root, 'Again').click();
    expect(hookText(root)).toContain(getCard('salamat')!.hook);
    button(root, 'Continue').click();
    // The missed card comes straight back, asked the easy way, hook hidden again.
    expect(root.textContent).toContain('What does this mean?');
    expect(hookText(root)).toBeNull();
  });

  it('skips the extra step on a miss when the hook was already open', () => {
    const root = sessionScreen(fakeApp(['salamat']), [{ kind: 'review', cardId: 'salamat', format: 'remember' }]);
    button(root, 'Show the meaning').click();
    button(root, 'Show memory hook').click();
    button(root, 'Again').click();
    expect(root.textContent).toContain('What does this mean?');
  });
});

describe('open-ended study', () => {
  it('brings a missed word back after a short gap, without a fixed end', () => {
    const app = fakeApp(['salamat', 'kumusta', 'oo', 'paalam']);
    app.progress.settings.dailyNew = 0;
    for (const id of Object.keys(app.progress.cards)) app.progress.cards[id].due = app.now() - 1;
    const root = sessionScreen(app, null, undefined, noMic);
    expect(root.textContent).toContain('0 done');
    const shown: string[] = [];
    // Answer every question wrong: missed words keep coming round.
    for (let i = 0; i < 8; i++) {
      const prompt = root.querySelector('.prompt')?.textContent ?? '';
      const card = ['salamat', 'kumusta', 'oo', 'paalam'].map((id) => getCard(id)!).find((c) => prompt.includes(c.tl) || prompt.includes(c.en));
      shown.push(card?.id ?? '?');
      const choices = [...root.querySelectorAll<HTMLButtonElement>('.choice')];
      const wrong = choices.find((b) => card && !b.textContent!.includes(card.en) && !b.textContent!.includes(card.tl));
      if (choices.length) {
        expect(wrong).toBeDefined();
        wrong!.click();
        button(root, 'Continue').click();
      } else {
        button(root, 'Show').click();
        button(root, 'Again').click();
        if (root.textContent?.includes('Coming back shortly')) button(root, 'Continue').click();
      }
    }
    expect(root.textContent).toContain('8 done');
    // Never the same word twice running.
    expect(shown.some((id, i) => id === shown[i - 1])).toBe(false);
    expect(root.textContent).not.toContain('caught up');
  });

  it('says when it is caught up, and offers practice or new words', () => {
    const app = fakeApp(['salamat', 'kumusta', 'oo', 'paalam']);
    app.progress.settings.dailyNew = 4;
    const root = sessionScreen(app, null, undefined, noMic);
    expect(root.textContent).toContain("You're caught up");
    expect(root.textContent).toContain('Learn new words');
    button(root, 'Keep practising').click();
    expect(root.textContent).toContain('Extra practice');
    expect(root.querySelectorAll('.choice').length).toBe(4);
  });

  it('shows what was done when the learner stops', () => {
    const app = fakeApp();
    const root = sessionScreen(app, null, undefined, noMic);
    button(root, "Let's go").click();
    button(root, 'Got it, quiz me').click();
    root.querySelector<HTMLButtonElement>('.choice')!.click();
    root.querySelector<HTMLButtonElement>('[aria-label="Stop studying"]')!.click();
    expect(root.textContent).toContain('Session finished');
  });
});

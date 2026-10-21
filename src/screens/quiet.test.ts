// @vitest-environment happy-dom
// Quiet mode: nothing asks the learner to speak, and skipping speaking leaves the schedule alone.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../app';
import { emptyProgress, recordAnswer } from '../store';
import { practiceScreen } from './practice';
import { sessionScreen } from './session';
import type { SpeakDeps } from './speak';

const KNOWN = ['salamat', 'kumusta', 'oo', 'paalam', 'tatlo', 'kape'];

/** A microphone and model that are ready, so speaking would join the mix. */
const micReady = {
  recordingSupported: () => true,
  modelDownloaded: async () => true,
  loadPhoneModel: () => new Promise(() => {}),
} as unknown as SpeakDeps;

function fakeApp(quiet: boolean): App {
  const now = Date.now();
  const progress = emptyProgress(now);
  progress.settings.autoplay = false;
  progress.settings.dailyNew = KNOWN.length;
  progress.settings.quiet = quiet;
  for (const id of KNOWN) recordAnswer(progress, id, 'good', now);
  return { progress, now: () => now, commit: () => {}, replaceProgress: () => {}, navigate: () => {}, onKey: () => {} };
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`No "${text}" button in: ${root.textContent}`);
  return found;
}

/** Pick the first choice, right or wrong, and move on. */
function answer(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>('.choice')!.click();
  root.querySelector<HTMLButtonElement>('.btn.primary')!.click();
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const speaking = (root: HTMLElement) => root.textContent?.includes('Say this out loud') ?? false;

afterEach(() => vi.restoreAllMocks());

describe('quiet mode in study', () => {
  it('never asks to speak', async () => {
    // Always roll a speaking step, if speaking is allowed.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const root = sessionScreen(fakeApp(true), null, undefined, micReady);
    await flush();
    button(root, 'Keep practising').click();
    for (let i = 0; i < 10; i++) {
      expect(speaking(root)).toBe(false);
      answer(root);
    }
  });

  it('skips a speaking step when turned on mid-step, leaving the card as it was', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const app = fakeApp(false);
    const root = sessionScreen(app, null, undefined, micReady);
    await flush();
    button(root, 'Keep practising').click();
    // The first practice step was picked before the microphone was known to be ready.
    answer(root);
    expect(speaking(root)).toBe(true);
    const before = structuredClone(app.progress.cards);

    button(root, 'Quiet').click();

    expect(app.progress.settings.quiet).toBe(true);
    expect(speaking(root)).toBe(false);
    expect(root.querySelector('.choice')).not.toBeNull();
    expect(root.textContent).toContain('1 done');
    expect(app.progress.cards).toEqual(before);
    expect(button(root, 'Quiet').getAttribute('aria-pressed')).toBe('true');
  });

  it('asks a speaking step that was already picked another way', async () => {
    const root = sessionScreen(fakeApp(true), [{ kind: 'extra', cardId: 'salamat', format: 'speak' }], undefined, micReady);
    await flush();
    button(root, 'Keep practising').click();
    expect(speaking(root)).toBe(false);
  });

  it('asks new words to be said in your head', () => {
    const app = fakeApp(true);
    const root = sessionScreen(app, [{ kind: 'new', cardId: 'mabuti' }], undefined, micReady);
    expect(root.textContent).toContain('say it in your head');
    expect(root.textContent).not.toContain('out loud');
  });
});

describe('quiet mode in drills', () => {
  it('turns off the speak drill and can be turned back on', async () => {
    const root = practiceScreen(fakeApp(true), micReady);
    await flush();
    expect(button(root, 'Speak').disabled).toBe(true);
    expect(root.textContent).toContain('Off in quiet mode');
    button(root, 'Quiet').click();
    expect(button(root, 'Speak').disabled).toBe(false);
  });
});

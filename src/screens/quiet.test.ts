// @vitest-environment happy-dom
// Quiet mode: nothing asks the learner to speak, and skipping speaking leaves the schedule alone.
// Without headphones it's silent too: nothing plays and nothing needs listening.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../app';
import { play } from '../speech';
import { emptyProgress, recordAnswer } from '../store';
import { practiceScreen } from './practice';
import { applyAudioMode, quietToggle } from './quiet';
import { sessionScreen } from './session';
import type { SpeakDeps } from './speak';

const KNOWN = ['salamat', 'kumusta', 'oo', 'paalam', 'tatlo', 'kape'];

/** A microphone and model that are ready, so speaking would join the mix. */
const micReady = {
  recordingSupported: () => true,
  modelDownloaded: async () => true,
  loadPhoneModel: () => new Promise(() => {}),
} as unknown as SpeakDeps;

/** Quiet, quiet with headphones in, or off. */
function fakeApp(quiet: boolean, headphones = true): App {
  const now = Date.now();
  const progress = emptyProgress(now);
  progress.settings.autoplay = false;
  progress.settings.dailyNew = KNOWN.length;
  progress.settings.quiet = quiet;
  progress.settings.headphones = headphones;
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

const hearing = (root: HTMLElement) => /What did you hear|what you heard/.test(root.textContent ?? '');

/** A speech voice that records what it was asked to say. */
const speak = vi.fn();
beforeEach(() => {
  speak.mockClear();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], speak, cancel: () => {}, addEventListener: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  applyAudioMode(emptyProgress(0).settings);
});

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
    expect(app.progress.settings.headphones).toBe(false);
    expect(speaking(root)).toBe(false);
    expect(root.querySelector('.choice')).not.toBeNull();
    expect(root.textContent).toContain('1 done');
    expect(app.progress.cards).toEqual(before);
    expect(button(root, 'Silent').getAttribute('aria-label')).toBe('Quiet mode: silent');
  });

  it('asks a speaking step that was already picked another way', async () => {
    const root = sessionScreen(fakeApp(true), [{ kind: 'extra', cardId: 'salamat', format: 'speak' }], undefined, micReady);
    await flush();
    button(root, 'Keep practising').click();
    expect(speaking(root)).toBe(false);
  });

  it('asks new words to be said in your head, and in silence says nothing about listening', () => {
    const silent = sessionScreen(fakeApp(true, false), [{ kind: 'new', cardId: 'mabuti' }], undefined, micReady);
    expect(silent.textContent).toContain('Say it in your head');
    expect(silent.textContent).not.toContain('Listen');

    const app = fakeApp(true);
    const root = sessionScreen(app, [{ kind: 'new', cardId: 'mabuti' }], undefined, micReady);
    expect(root.textContent).toContain('say it in your head');
    expect(root.textContent).not.toContain('out loud');
  });
});

describe('silent quiet mode (no headphones)', () => {
  it('never asks a listening question in practice, though headphones allow one', async () => {
    // Always roll the last format: listening, when it's allowed.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const withHeadphones = sessionScreen(fakeApp(true, true), null, undefined, micReady);
    button(withHeadphones, 'Keep practising').click();
    expect(hearing(withHeadphones)).toBe(true);

    const silent = sessionScreen(fakeApp(true, false), null, undefined, micReady);
    button(silent, 'Keep practising').click();
    for (let i = 0; i < 6; i++) {
      expect(hearing(silent)).toBe(false);
      answer(silent);
    }
  });

  it('reviews a learned card by reading instead of hearing, and still counts it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const app = fakeApp(true, false);
    Object.assign(app.progress.cards.salamat, { interval: 10, due: app.now() - 1 });
    const reps = app.progress.cards.salamat.reps;
    const root = sessionScreen(app, [{ kind: 'review', cardId: 'salamat' }], undefined, micReady);
    expect(hearing(root)).toBe(false);
    button(root, 'Show the').click();
    button(root, 'Good').click();
    expect(app.progress.cards.salamat.reps).toBe(reps + 1);
  });

  it('asks an unanswered listening step again by reading when silence is turned on', () => {
    const app = fakeApp(false);
    const root = sessionScreen(app, [{ kind: 'review', cardId: 'salamat', format: 'hear' }], undefined, micReady);
    expect(hearing(root)).toBe(true);
    const before = structuredClone(app.progress.cards);
    button(root, 'Quiet').click();
    expect(hearing(root)).toBe(false);
    expect(root.textContent).toContain('Salamat');
    expect(app.progress.cards).toEqual(before);
  });

  it('plays nothing and hides the play buttons', () => {
    const app = fakeApp(false);
    const toggle = () => quietToggle(app, () => {});
    toggle().click();
    expect(app.progress.settings).toMatchObject({ quiet: true, headphones: false });
    expect(document.documentElement.classList.contains('silent')).toBe(true);
    void play({ tl: 'Salamat' });
    expect(speak).not.toHaveBeenCalled();

    toggle().click();
    expect(app.progress.settings).toMatchObject({ quiet: true, headphones: true });
    expect(document.documentElement.classList.contains('silent')).toBe(false);

    toggle().click();
    expect(app.progress.settings).toMatchObject({ quiet: false, headphones: false });
  });
});

describe('quiet mode in drills', () => {
  it('turns off the speak drill, and listening too without headphones', async () => {
    const root = practiceScreen(fakeApp(true, false), micReady);
    await flush();
    expect(button(root, 'Speak').disabled).toBe(true);
    expect(button(root, 'Listen').disabled).toBe(true);
    expect(root.textContent).toContain('Off in quiet mode');
    button(root, 'Silent').click();
    expect(button(root, 'Listen').disabled).toBe(false);
    expect(button(root, 'Speak').disabled).toBe(true);
    button(root, 'Quiet').click();
    expect(button(root, 'Speak').disabled).toBe(false);
  });
});

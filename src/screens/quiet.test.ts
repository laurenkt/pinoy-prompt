// @vitest-environment happy-dom
// Quiet mode: nothing asks the learner to speak, and skipping speaking leaves the schedule alone.
// Without headphones it's silent too: nothing plays and nothing needs listening.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { play } from '../speech';
import { emptyProgress } from '../store';
import { ADVANCE_MS } from './auto-advance';
import { practiceScreen } from './practice';
import { applyAudioMode, quietToggle } from './quiet';
import { sessionScreen } from './session';
import type { SpeakDeps } from './speak';
import { button, drillScope, fakeApp as knowing, flush } from '../test/screen';

const KNOWN = ['salamat', 'kumusta', 'oo', 'paalam', 'tatlo', 'kape'];

/** A microphone and model that are ready, so speaking would join the mix. */
const micReady = {
  recordingSupported: () => true,
  modelDownloaded: async () => true,
  loadPhoneModel: () => new Promise(() => {}),
} as unknown as SpeakDeps;

/** Quiet, quiet with headphones in, or off. */
function fakeApp(quiet: boolean, headphones = true) {
  return knowing(KNOWN, { dailyNew: KNOWN.length, quiet, headphones });
}

/** Pick the first choice, right or wrong, and move on. */
function answer(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>('.choice')!.click();
  root.querySelector<HTMLButtonElement>('.btn.primary')!.click();
}

const speaking = (root: HTMLElement) => root.textContent?.includes('Say this out loud') ?? false;

const hearing = (root: HTMLElement) => /What did you hear|what you heard/.test(root.textContent ?? '');

/** A speech voice that records what it was asked to say. */
const speak = vi.fn();
beforeEach(() => {
  speak.mockClear();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], speak, cancel: () => {}, addEventListener: () => {} });
});

afterEach(() => {
  vi.useRealTimers();
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
  /** The round's quiet toggle, an icon in its header. */
  const quiet = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.session-header [aria-label^="Quiet mode"]')!;

  it('takes speaking out of scope, and listening too without headphones', async () => {
    const root = practiceScreen(fakeApp(true, false), micReady);
    await flush();
    const chip = (mode: string) => root.querySelector<HTMLButtonElement>(`#drill-scope [data-mode="${mode}"]`)!;
    expect(chip('speak').disabled).toBe(true);
    expect(chip('listen').disabled).toBe(true);
    expect(root.textContent).toContain('Speak is off in quiet mode.');
    quiet(root).click();
    expect(chip('listen').disabled).toBe(false);
    expect(chip('speak').disabled).toBe(true);
    quiet(root).click();
    expect(chip('speak').disabled).toBe(false);
  });

  it('swaps a listening question for another kind when silent mode came on while looking back', () => {
    vi.useFakeTimers();
    const root = practiceScreen(fakeApp(false), micReady);
    document.body.replaceChildren(root);
    drillScope(root, ['listen']);
    // Answer until one is right, so the round moves on by itself and the one before can be looked back at.
    for (let i = 0; i < 20 && !root.textContent?.includes('Tama!'); i++) {
      if (root.querySelector('.feedback')) button(root, 'Next').click();
      root.querySelector<HTMLButtonElement>('.choice')!.click();
    }
    vi.advanceTimersByTime(ADVANCE_MS);
    expect(hearing(root)).toBe(true);
    button(root, 'Previous card').click();
    quiet(root).click();
    expect(root.querySelector('[aria-label="Quiet mode: silent"]')).not.toBeNull();
    button(root, 'Back to the current card').click();
    expect(hearing(root)).toBe(false);
    drillScope(root, ['listen', 'read', 'recall', 'speak']);
    document.body.replaceChildren();
  });

  it('swaps an unanswered speaking question for another kind when quiet mode comes on', async () => {
    const root = practiceScreen(fakeApp(false), micReady);
    await flush();
    drillScope(root, ['speak']);
    expect(speaking(root)).toBe(true);
    quiet(root).click();
    expect(speaking(root)).toBe(false);
    expect(root.querySelector('.choice')).not.toBeNull();
    expect(root.textContent).toContain('0 done');
  });
});

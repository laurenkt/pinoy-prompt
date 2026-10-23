// @vitest-environment happy-dom
// Quiet mode, as two switches: with the mic off nothing asks the learner to speak, with the sound off nothing plays
// and nothing needs listening, in any mix of the two. Skipping a step for either leaves the schedule alone.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { play } from '../speech';
import { emptyProgress } from '../store';
import { ADVANCE_MS } from './auto-advance';
import { homeScreen } from './home';
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

/** The mic and sound each on or off. */
function fakeApp(mic: boolean, sound = true) {
  return knowing(KNOWN, { dailyNew: KNOWN.length, mic, sound });
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

/** The halves of the quiet toggle in a screen's header: the same split button on every screen. */
const micSwitch = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.split-toggle [aria-label="Mic off"]')!;
const soundSwitch = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.split-toggle [aria-label="Sound off"]')!;

describe('quiet mode in study', () => {
  it('tells new words to be heard and said only as the mic and sound allow', () => {
    const advice = (mic: boolean, sound: boolean) => sessionScreen(fakeApp(mic, sound), [{ kind: 'new', cardId: 'mabuti' }]).textContent;
    expect(advice(true, true)).toContain('Listen, then say it out loud');
    expect(advice(false, true)).toContain('Listen, then say it in your head');
    expect(advice(true, false)).toContain('Say it out loud');
    expect(advice(true, false)).not.toContain('Listen');
    expect(advice(false, false)).toContain('Say it in your head');
    expect(advice(false, false)).not.toContain('Listen');
  });
});

describe('sound off', () => {
  it('reviews a learned card by reading instead of hearing, and still counts it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const app = fakeApp(true, false);
    Object.assign(app.progress.cards.salamat, { interval: 10, due: app.now() - 1 });
    const reps = app.progress.cards.salamat.reps;
    const root = sessionScreen(app, [{ kind: 'review', cardId: 'salamat' }]);
    expect(hearing(root)).toBe(false);
    button(root, 'Show the').click();
    button(root, 'Good').click();
    expect(app.progress.cards.salamat.reps).toBe(reps + 1);
  });

  it('asks an unanswered listening step again by reading when the sound goes off', () => {
    const app = fakeApp(true);
    const root = sessionScreen(app, [{ kind: 'review', cardId: 'salamat', format: 'hear' }]);
    expect(hearing(root)).toBe(true);
    const before = structuredClone(app.progress.cards);
    soundSwitch(root).click();
    expect(hearing(root)).toBe(false);
    expect(root.textContent).toContain('Salamat');
    expect(app.progress.cards).toEqual(before);
  });

  it('plays nothing and hides the play buttons, whatever the mic', () => {
    const app = fakeApp(true);
    const toggle = () => quietToggle(app, () => {});
    soundSwitch(toggle()).click();
    expect(app.progress.settings).toMatchObject({ mic: true, sound: false });
    expect(document.documentElement.classList.contains('silent')).toBe(true);
    void play({ tl: 'Salamat' });
    expect(speak).not.toHaveBeenCalled();

    micSwitch(toggle()).click();
    expect(app.progress.settings).toMatchObject({ mic: false, sound: false });
    expect(document.documentElement.classList.contains('silent')).toBe(true);

    soundSwitch(toggle()).click();
    expect(app.progress.settings).toMatchObject({ mic: false, sound: true });
    expect(document.documentElement.classList.contains('silent')).toBe(false);

    micSwitch(toggle()).click();
    expect(app.progress.settings).toMatchObject({ mic: true, sound: true });
  });
});

describe('the quiet toggle', () => {
  it('is one split button on Home, Study and Drills alike, each half pressed while it is off', () => {
    for (const [mic, sound] of [[true, true], [false, true], [true, false], [false, false]] as const) {
      const roots = [homeScreen(fakeApp(mic, sound)), sessionScreen(fakeApp(mic, sound), null), practiceScreen(fakeApp(mic, sound))];
      const looks = roots.map((root) => {
        const halves = [...root.querySelectorAll<HTMLButtonElement>('.split-toggle button')];
        return halves.map((b) => ({ pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'), text: b.textContent, icon: b.innerHTML }));
      });
      expect(looks[0]).toEqual([
        { pressed: String(!mic), label: 'Mic off', text: '', icon: expect.any(String) },
        { pressed: String(!sound), label: 'Sound off', text: '', icon: expect.any(String) },
      ]);
      expect(looks[1]).toEqual(looks[0]);
      expect(looks[2]).toEqual(looks[0]);
    }
  });

  it('shows a struck-out icon for a switch that is off', () => {
    const on = quietToggle(fakeApp(true, true), () => {});
    const off = quietToggle(fakeApp(false, false), () => {});
    expect(micSwitch(on).innerHTML).not.toBe(micSwitch(off).innerHTML);
    expect(soundSwitch(on).innerHTML).not.toBe(soundSwitch(off).innerHTML);
  });
});

describe('quiet mode in drills', () => {
  /** The round's quiet toggle, in its header. */
  const mic = (root: HTMLElement) => micSwitch(root.querySelector('.session-header')!);
  const sound = (root: HTMLElement) => soundSwitch(root.querySelector('.session-header')!);

  it('takes speaking out of scope with the mic off, and listening with the sound off, in any mix', async () => {
    const root = practiceScreen(fakeApp(false, false), micReady);
    await flush();
    const chip = (mode: string) => root.querySelector<HTMLButtonElement>(`#drill-scope [data-mode="${mode}"]`)!;
    const off = () => ['listen', 'read', 'recall', 'speak'].filter((m) => chip(m).disabled);
    expect(off()).toEqual(['listen', 'speak']);
    expect(root.textContent).toContain('Speak is off while the mic is off.');
    expect(root.textContent).toContain('Listen is off while the sound is off.');
    sound(root).click();
    expect(off()).toEqual(['speak']);
    mic(root).click();
    expect(off()).toEqual([]);
    sound(root).click();
    expect(off()).toEqual(['listen']);
  });

  it('asks only what can be seen and answered by tapping or typing with both off', () => {
    const app = fakeApp(false, false);
    applyAudioMode(app.progress.settings);
    const root = practiceScreen(app, micReady);
    for (let i = 0; i < 30; i++) {
      expect(hearing(root)).toBe(false);
      expect(speaking(root)).toBe(false);
      expect(root.querySelector('.meaning-mic')).toBeNull();
      const choice = root.querySelector<HTMLButtonElement>('.choice:not(:disabled)');
      if (choice) choice.click();
      else root.querySelector<HTMLButtonElement>('.meaning-form .btn.secondary')?.click();
      if (root.querySelector('.feedback')) button(root, 'Next').click();
    }
    // The play buttons are drawn but hidden, and nothing was played.
    expect(document.documentElement.classList.contains('silent')).toBe(true);
    expect(speak).not.toHaveBeenCalled();
  });

  it('swaps a listening question for another kind when the sound went off while looking back', () => {
    vi.useFakeTimers();
    const root = practiceScreen(fakeApp(true), micReady);
    document.body.replaceChildren(root);
    drillScope(root, ['listen']);
    // Answer until one is right, so the round moves on by itself and the one before can be looked back at.
    for (let i = 0; i < 20 && !root.textContent?.includes('Tama!'); i++) {
      if (root.querySelector('.feedback')) button(root, 'Next').click();
      root.querySelector<HTMLButtonElement>('.choice')!.click();
    }
    // Long enough to give up waiting for the answer's audio, which never finishes here.
    vi.advanceTimersByTime(ADVANCE_MS * 4);
    expect(hearing(root)).toBe(true);
    button(root, 'Previous card').click();
    sound(root).click();
    expect(sound(root).getAttribute('aria-pressed')).toBe('true');
    button(root, 'Back to the current card').click();
    expect(hearing(root)).toBe(false);
    drillScope(root, ['listen', 'read', 'recall', 'speak']);
    document.body.replaceChildren();
  });

  it('swaps an unanswered speaking question for another kind when the mic goes off', async () => {
    const root = practiceScreen(fakeApp(true), micReady);
    await flush();
    drillScope(root, ['speak']);
    expect(speaking(root)).toBe(true);
    mic(root).click();
    expect(speaking(root)).toBe(false);
    expect(root.querySelector('.choice')).not.toBeNull();
    expect(root.textContent).toContain('0 done');
  });
});

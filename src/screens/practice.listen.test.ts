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
import { practiceScreen, type MeaningHearer } from './practice';
import type { RecorderEvents, Take } from '../recorder';
import type { SpeakDeps } from './speak';
import { AiError } from '../openai';
import { play } from '../speech';

vi.mock('../speech', async (actual) => {
  const speech = await actual<typeof import('../speech')>();
  return { ...speech, play: vi.fn(speech.play) };
});

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
    expect(judge).toHaveBeenCalledWith('thanks a lot', expect.objectContaining<Partial<Card>>({ id: 'maraming-salamat' }), 'en');
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

  it('looks back at a typed miss from the next question', async () => {
    const root = listen(learner(true));
    type(root, 'good night');
    await flush();
    button(root, 'Next').click();
    button(root, 'Previous card').click();
    expect(box(root)!.value).toBe('good night');
    expect(box(root)!.classList.contains('wrong')).toBe(true);
    expect(root.querySelector('.feedback')?.textContent).toContain('Mali.');
    expect(has(root, 'I had it right')).toBe(false);
    button(root, 'Back to the current card').click();
    expect(box(root)!.value).toBe('');
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

  it('brings a word got only from the choices up more in later rounds, until its meaning is typed right', async () => {
    const app = learner(true);
    const commit = vi.spyOn(app, 'commit');
    const root = listen(app);
    button(root, 'Show choices').click();
    [...root.querySelectorAll<HTMLButtonElement>('.choice')].find((c) => c.textContent?.endsWith('Thank you'))!.click();
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
    expect(app.progress.cards.salamat.hinted).toBe(1);
    expect(commit).toHaveBeenCalled();
    // Typed right next time, it's back to how often it came up before.
    const again = listen(app);
    type(again, 'thanks');
    await flush();
    expect(again.querySelector('.feedback')?.textContent).toContain('Tama!');
    expect(app.progress.cards.salamat.hinted).toBeUndefined();
  });

  it('brings a word typed wrong up more in later rounds too, unless the learner had it right after all', async () => {
    const app = learner(true);
    const root = listen(app);
    type(root, 'good night');
    await flush();
    expect(app.progress.cards.salamat.hinted).toBe(1);
    // "I had it right" takes the miss back and counts it typed right.
    app.progress.cards.salamat.hinted = 2;
    const again = listen(app);
    type(again, 'good night');
    await flush();
    expect(app.progress.cards.salamat.hinted).toBe(3);
    button(again, 'I had it right').click();
    expect(app.progress.cards.salamat.hinted).toBe(1);
    // A miss that couldn't count (three already) has nothing to take back.
    app.progress.cards.salamat.hinted = 3;
    const full = listen(app);
    type(full, 'good night');
    await flush();
    button(full, 'I had it right').click();
    expect(app.progress.cards.salamat.hinted).toBe(2);
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

describe('accepting a typed meaning as it is typed', () => {
  function typing(root: HTMLElement, text: string): void {
    box(root)!.value = text;
    box(root)!.dispatchEvent(new Event('input'));
  }

  it('takes a meaning the device can tell is right once typing pauses, without Check', async () => {
    vi.useFakeTimers();
    try {
      const root = listen(learner(true));
      typing(root, 'thank');
      await vi.advanceTimersByTimeAsync(1000);
      expect(root.querySelector('.feedback')).toBeNull();
      typing(root, 'thank you');
      await vi.advanceTimersByTimeAsync(300);
      expect(root.querySelector('.feedback')).toBeNull();
      await vi.advanceTimersByTimeAsync(700);
      expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
    } finally {
      vi.useRealTimers();
    }
  });

  it('still takes it when the screen is redrawn during the pause', async () => {
    vi.useFakeTimers();
    try {
      const root = listen(learner(true));
      typing(root, 'thank you');
      await vi.advanceTimersByTimeAsync(300);
      root.querySelector<HTMLButtonElement>('.filter-toggle')!.click();
      await vi.advanceTimersByTimeAsync(700);
      expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't send it after going to the choices", async () => {
    vi.useFakeTimers();
    try {
      const root = listen(learner(true));
      typing(root, 'thank you');
      button(root, 'Show choices').click();
      await vi.advanceTimersByTimeAsync(1000);
      expect(root.querySelector('.feedback')).toBeNull();
      expect(root.querySelector('.choice')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never sends part of a longer meaning, or a wrong one, by itself', async () => {
    vi.useFakeTimers();
    try {
      const judge = vi.fn<MeaningJudge>(async () => true);
      const root = listen(learner(true), judge);
      // Right on the way, but typing goes on to something else: "no" on the way to "now".
      for (const text of ['good', 'good night', 'goodbye', 'thank you', 'thank you very much']) typing(root, text);
      await vi.advanceTimersByTimeAsync(1000);
      expect(root.querySelector('.feedback')).toBeNull();
      expect(judge).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes it exactly as written, in any case or punctuation, and leaves a typo for Check', async () => {
    vi.useFakeTimers();
    try {
      const root = listen(learner(true));
      // Close enough for Check, and on the way to the meaning, but not it yet.
      typing(root, 'thank yo');
      await vi.advanceTimersByTimeAsync(1000);
      expect(root.querySelector('.feedback')).toBeNull();
      typing(root, 'Thank you!');
      await vi.advanceTimersByTimeAsync(1000);
      expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
    } finally {
      vi.useRealTimers();
    }
  });

  it('still takes a typo once it is checked', async () => {
    vi.useFakeTimers();
    try {
      const root = listen(learner(true));
      typing(root, 'thnak you');
      await vi.advanceTimersByTimeAsync(1000);
      expect(root.querySelector('.feedback')).toBeNull();
      type(root, 'thnak you');
      await vi.advanceTimersByTimeAsync(0);
      expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('saying the meaning out loud', () => {
  /** Tells the screen the last recording's microphone gives sound. */
  let listening: (() => void) | undefined;

  /** A microphone that hears `speech` once stopped, or by itself after a moment. */
  function mic(speech = true) {
    listening = undefined;
    const record = vi.fn((events: RecorderEvents = {}) => {
      let finish: (t: Take) => void = () => {};
      const audio = new Promise<Take>((r) => (finish = r));
      listening = events.onListening;
      setTimeout(() => finish({ samples: new Float32Array(160), speech }), 0);
      return { audio, stop: () => finish({ samples: new Float32Array(160), speech }), cancel: () => finish({ samples: new Float32Array(0), speech: false }) };
    });
    const deps = { recordingSupported: () => true, modelDownloaded: async () => false, record } as unknown as SpeakDeps;
    return { deps, record };
  }

  function speaking(app: App, hearer: MeaningHearer | null, deps: SpeakDeps): HTMLElement {
    const root = practiceScreen(app, deps, null, () => hearer);
    document.body.replaceChildren(root);
    return root;
  }

  const micButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.meaning-mic');

  it('only listens once the microphone button is tapped, then checks what was heard', async () => {
    const { deps, record } = mic();
    const hearer = vi.fn<MeaningHearer>(async () => 'Thank you.');
    const root = speaking(learner(true), hearer, deps);
    expect(record).not.toHaveBeenCalled();
    micButton(root)!.click();
    expect(record).toHaveBeenCalledTimes(1);
    // Nothing said yet would be heard, so it says to wait, over faint bars, until the microphone gives sound.
    expect(root.querySelector('.meaning-status')?.textContent).toBe('Getting the mic ready…');
    expect(root.querySelector('.meaning-wave')?.classList).not.toContain('live');
    listening?.();
    expect(root.querySelector('.meaning-status')?.textContent).toContain('Listening');
    expect(root.querySelector('.meaning-wave')?.classList).toContain('live');
    await flush();
    await flush();
    expect(hearer).toHaveBeenCalledWith(expect.any(Blob), 'en');
    expect(box(root)!.value).toBe('Thank you.');
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
  });

  it('throws the take away on a second tap before the microphone gives sound, and stops it after', () => {
    const takes: { events: RecorderEvents; stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }[] = [];
    const record = vi.fn((events: RecorderEvents = {}) => {
      const take = { events, stop: vi.fn(), cancel: vi.fn() };
      takes.push(take);
      return { audio: new Promise<Take>(() => {}), stop: take.stop, cancel: take.cancel };
    });
    const deps = { recordingSupported: () => true, modelDownloaded: async () => false, record } as unknown as SpeakDeps;
    const root = speaking(learner(true), async () => '', deps);
    micButton(root)!.click();
    micButton(root)!.click();
    // Nothing could have been heard yet, so there's nothing to send: the box is back.
    expect(takes[0].cancel).toHaveBeenCalled();
    expect(takes[0].stop).not.toHaveBeenCalled();
    expect(box(root)).not.toBeNull();
    micButton(root)!.click();
    takes[1].events.onListening?.();
    micButton(root)!.click();
    expect(takes[1].stop).toHaveBeenCalled();
    expect(takes[1].cancel).not.toHaveBeenCalled();
  });

  it("doesn't take what was typed once the meaning is being said instead", async () => {
    vi.useFakeTimers();
    try {
      // A recording that goes on until it's stopped.
      const record = vi.fn(() => ({ audio: new Promise<Take>(() => {}), stop: () => {}, cancel: () => {} }));
      const deps = { recordingSupported: () => true, modelDownloaded: async () => false, record } as unknown as SpeakDeps;
      const root = speaking(learner(true), async () => '', deps);
      box(root)!.value = 'thank you';
      box(root)!.dispatchEvent(new Event('input'));
      micButton(root)!.click();
      await vi.advanceTimersByTimeAsync(1000);
      expect(root.querySelector('.feedback')).toBeNull();
      expect(micButton(root)!.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws a meaning being said away on Cancel, leaving the question to say again or type', async () => {
    let cancelled = 0;
    let finish: (t: Take) => void = () => {};
    let live: (() => void) | undefined;
    const record = vi.fn((events: RecorderEvents = {}) => {
      live = events.onListening;
      return {
        audio: new Promise<Take>((r) => (finish = r)),
        stop: () => finish({ samples: new Float32Array(160), speech: true }),
        cancel: () => {
          cancelled++;
          finish({ samples: new Float32Array(0), speech: false });
        },
      };
    });
    const deps = { recordingSupported: () => true, modelDownloaded: async () => false, record } as unknown as SpeakDeps;
    const hearer = vi.fn<MeaningHearer>(async () => 'Thank you.');
    const root = speaking(learner(true), hearer, deps);
    const cancel = () => [...root.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');
    expect(cancel()).toBeUndefined();
    micButton(root)!.click();
    cancel()!.click();
    await flush();
    expect(cancelled).toBe(1);
    expect(hearer).not.toHaveBeenCalled();
    expect(root.querySelector('.feedback')).toBeNull();
    expect(root.querySelector('.meaning-status')).toBeNull();
    expect(box(root)!.disabled).toBe(false);
    expect(cancel()).toBeUndefined();
    // Said again, it's heard and checked as usual.
    micButton(root)!.click();
    live?.();
    micButton(root)!.click();
    await flush();
    await flush();
    expect(hearer).toHaveBeenCalledOnce();
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
  });

  it('says so when nothing was heard, and leaves the box to type in', async () => {
    const { deps } = mic(false);
    const hearer = vi.fn<MeaningHearer>(async () => '');
    const root = speaking(learner(true), hearer, deps);
    micButton(root)!.click();
    await flush();
    expect(hearer).not.toHaveBeenCalled();
    expect(root.querySelector('.meaning-status')?.textContent).toContain("Didn't hear anything");
    expect(box(root)!.disabled).toBe(false);
  });

  it('has no microphone without a way to hear it, or with the mic off', () => {
    expect(micButton(speaking(learner(true), null, mic().deps))).toBeNull();
    const quiet = learner(true);
    quiet.progress.settings.mic = false;
    expect(micButton(speaking(quiet, async () => '', mic().deps))).toBeNull();
    expect(micButton(speaking(learner(true), async () => '', mic().deps))).not.toBeNull();
  });

  it("records silently, and doesn't play the word or offer the way back while listening or hearing", async () => {
    const record = vi.fn(() => ({ audio: new Promise<Take>(() => {}), stop: () => {}, cancel: () => {} }));
    const deps = { recordingSupported: () => true, modelDownloaded: async () => false, record } as unknown as SpeakDeps;
    const root = speaking(learner(true), async () => '', deps);
    vi.mocked(play).mockClear();
    expect(micButton(root)!.hasAttribute('data-no-tap')).toBe(true);
    micButton(root)!.click();
    expect(has(root, 'Previous card')).toBe(false);
    root.querySelector<HTMLButtonElement>('.prompt button')!.click();
    expect(play).not.toHaveBeenCalled();
  });

  it("drops a spoken meaning still being heard when the question goes, without touching the next one's", async () => {
    const { deps } = mic();
    const replies: ((text: string) => void)[] = [];
    const root = speaking(learner(true), () => new Promise<string>((r) => replies.push(r)), deps);
    micButton(root)!.click();
    await flush();
    button(root, 'Show choices').click();
    root.querySelector<HTMLButtonElement>('.choice')!.click();
    button(root, 'Next').click();
    micButton(root)!.click();
    await flush();
    expect(replies).toHaveLength(2);
    replies[0]('Thank you.');
    await flush();
    expect(root.querySelector('.meaning-status')?.textContent).toContain('Hearing');
    expect(root.querySelector('.meaning-wave.thinking')).not.toBeNull();
    expect(root.querySelector('.feedback')).toBeNull();
  });

  it('draws what the microphone hears in the box, and runs along it while that is heard and checked', async () => {
    let onLevel: ((level: number, speech: boolean, parts: number[]) => void) | undefined;
    let finish: (t: Take) => void = () => {};
    const record = vi.fn((events?: { onLevel?: (level: number, speech: boolean, parts: number[]) => void }) => {
      onLevel = events?.onLevel;
      return { audio: new Promise<Take>((r) => (finish = r)), stop: () => {}, cancel: () => {} };
    });
    const deps = { recordingSupported: () => true, modelDownloaded: async () => false, record } as unknown as SpeakDeps;
    let heard: (text: string) => void = () => {};
    let judged: (right: boolean) => void = () => {};
    const root = practiceScreen(learner(true), deps, () => new Promise<boolean>((r) => (judged = r)), () => () => new Promise<string>((r) => (heard = r)));
    document.body.replaceChildren(root);
    const bars = () => [...root.querySelectorAll<HTMLElement>('.meaning-wave span')].map((b) => Number(b.style.getPropertyValue('--level')));
    micButton(root)!.click();
    // The box gives way to an empty wave, which grows from the left only while there's speech: the room's hiss and
    // the pauses draw nothing.
    expect(box(root)).toBeNull();
    expect(root.querySelector('.meaning-wave.thinking')).toBeNull();
    expect(bars()).toEqual([]);
    onLevel!(0.01, false, [0.01, 0.01, 0.01, 0.01]);
    expect(bars()).toEqual([]);
    // A bar for each part of a block of speech.
    onLevel!(0.5, true, [0.5, 0.25, 0.5, 0.25]);
    onLevel!(0.01, false, [0.01, 0.01, 0.01, 0.01]);
    expect(bars()).toEqual([0.5, 0.25, 0.5, 0.25]);
    // Once the box is full, neighbouring bars merge in pairs, each the louder, and later ones stand for two parts.
    for (let i = 0; i < 19; i++) onLevel!(0.75, true, [0.75, 0.75, 0.75, 0.75]);
    expect(bars()).toHaveLength(80);
    onLevel!(0.1, true, [0.1, 0.2, 0.3, 0.1]);
    expect(bars()).toHaveLength(42);
    expect(bars().slice(0, 3)).toEqual([0.5, 0.5, 0.75]);
    expect(bars().slice(-2)).toEqual([0.2, 0.3]);
    finish({ samples: new Float32Array(160), speech: true });
    await flush();
    // Hearing it: the same wave, kept across the redraw, with the beat running along it.
    expect(root.querySelector('.meaning-wave.thinking')).not.toBeNull();
    expect(bars()).toHaveLength(42);
    expect(bars().slice(-2)).toEqual([0.2, 0.3]);
    heard('Many thanks.');
    await flush();
    expect(root.querySelector('.meaning-wave.thinking')).not.toBeNull();
    expect(root.querySelector('.meaning-status')?.textContent).toContain('Heard “Many thanks”. Checking');
    judged(true);
    await flush();
    expect(root.querySelector('.meaning-wave')).toBeNull();
    expect(box(root)!.value).toBe('Many thanks.');
  });

  it('puts the box back when nothing was heard, and checks a typed meaning without the wave', async () => {
    const { deps } = mic(false);
    let judged: (right: boolean) => void = () => {};
    const root = practiceScreen(learner(true), deps, () => new Promise<boolean>((r) => (judged = r)), () => async () => '');
    document.body.replaceChildren(root);
    micButton(root)!.click();
    expect(root.querySelector('.meaning-wave')).not.toBeNull();
    await flush();
    expect(root.querySelector('.meaning-wave')).toBeNull();
    box(root)!.value = 'many thanks';
    button(root, 'Check').click();
    expect(root.querySelector('.meaning-wave')).toBeNull();
    expect(box(root)!.value).toBe('many thanks');
    judged(true);
  });
});

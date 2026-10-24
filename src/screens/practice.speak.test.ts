// @vitest-environment happy-dom
// Speak mode inside a practice round, with a stand-in microphone and model.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCard } from '../deck';
import { speaking, stop } from '../speech';
import { toPhones } from '../phonetics';
import type { RecorderEvents, Take } from '../recorder';
import { ADVANCE_MS } from './auto-advance';
import { practiceScreen } from './practice';
import type { SpeakDeps } from './speak';
import { FakeAudioContext, chimes } from '../test/fake-audio';
import { FakePlayer, fakeRecognition } from '../test/fake-speech';
import { drillScope, fakeApp, flush } from '../test/screen';

const KNOWN = ['salamat', 'kumusta', 'tatlo', 'paalam', 'oo', 'kape'];

/** What the last recording was told to report, so a test can say when the microphone gives sound. */
let recorder: RecorderEvents = {};

/** A model that hears whatever the card should sound like, so every attempt is right. */
function deps(overrides: Partial<SpeakDeps> = {}): SpeakDeps {
  let card = '';
  return {
    recordingSupported: () => true,
    modelDownloaded: async () => true,
    record: ((events: RecorderEvents = {}) => {
      card = document.querySelector('.prompt .tl')?.textContent ?? '';
      recorder = events;
      let finish: (t: Take) => void = () => {};
      const audio = new Promise<Take>((r) => (finish = r));
      return { audio, stop: () => finish({ samples: new Float32Array(1), speech: true }), cancel: () => {} };
    }) as SpeakDeps['record'],
    loadPhoneModel: async () => ({
      recognise: async () => {
        const id = KNOWN.find((k) => getCard(k)!.tl === card)!;
        return fakeRecognition(toPhones(getCard(id)!.tl).filter((p) => !p.optional).map((p) => p.ipa));
      },
    }),
    player: () => new FakePlayer(),
    ...overrides,
  };
}

function button(name: string): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(name) || b.textContent?.trim().endsWith(name));
  if (!match) throw new Error(`No button "${name}" in: ${document.body.textContent}`);
  return match;
}

beforeEach(() => document.body.replaceChildren());

describe('Speak mode', () => {
  it('runs a round of spoken questions', async () => {
    const root = practiceScreen(fakeApp(KNOWN), deps());
    document.body.append(root);
    await flush();
    drillScope(root, ['speak']);
    await flush();
    button('Tap and speak').click();
    recorder.onListening?.();
    button("I'm done").click();
    await flush();
    expect(document.querySelector('.feedback strong')?.textContent).toBe('Tama!');
    button('Next').click();
    await flush();
    expect(button('Tap and speak')).toBeTruthy();
  });

  it('brings a word not said right up more to be said in later rounds, and lets it go once it is', async () => {
    const mumble = deps({ loadPhoneModel: async () => ({ recognise: async () => fakeRecognition(['ʃ']) }) });
    const app = fakeApp(KNOWN);
    const asked = () => KNOWN.find((k) => getCard(k)!.tl === document.querySelector('.prompt .tl')?.textContent)!;
    const say = async () => {
      button('Tap and speak').click();
      recorder.onListening?.();
      button("I'm done").click();
      await flush();
    };
    // Missed, then moved on: one more answer needing help, asked to be said, and no other way.
    let root = practiceScreen(app, mumble);
    document.body.replaceChildren(root);
    await flush();
    drillScope(root, ['speak']);
    await flush();
    const word = asked();
    await say();
    expect(app.progress.cards[word].help).toBeUndefined();
    button('Next').click();
    expect(app.progress.cards[word].help).toEqual({ speak: 1 });
    // Said right first time: one off.
    for (const id of KNOWN) app.progress.cards[id].help = { speak: 1 };
    root = practiceScreen(app, deps());
    document.body.replaceChildren(root);
    await flush();
    drillScope(root, ['speak']);
    await flush();
    const said = asked();
    await say();
    expect(app.progress.cards[said].help).toBeUndefined();
  });

  it('starts and stops listening with one big button in the same place, under what the mic hears', async () => {
    const root = practiceScreen(fakeApp(KNOWN), deps());
    document.body.append(root);
    await flush();
    drillScope(root, ['speak']);
    await flush();
    // One layout while listening (.speak.listening in style.css): the cue, the button below it, and room for Cancel.
    const layout = () => [...document.querySelector('.panel > .speak')!.children].map((c) => c.className);
    expect(layout()).toEqual(['speak-cue', 'btn mic huge', 'row speak-cancel']);
    button('Tap and speak').click();
    expect(layout()).toEqual(['speak-cue', 'btn mic huge done', 'row speak-cancel']);
    expect(document.querySelector('.speak-cue .meter')).toBeTruthy();
  });

  it('chimes for a right attempt, not a miss', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    chimes.count = 0;
    const mumble = deps({ loadPhoneModel: async () => ({ recognise: async () => fakeRecognition(['ʃ']) }) });
    for (const [model, heard] of [[mumble, 0], [deps(), 1]] as const) {
      const root = practiceScreen(fakeApp(KNOWN), model);
      document.body.replaceChildren(root);
      await flush();
      drillScope(root, ['speak']);
      await flush();
      button('Tap and speak').click();
      recorder.onListening?.();
      button("I'm done").click();
      await flush();
      await flush();
      expect(chimes.count).toBe(heard);
    }
    vi.unstubAllGlobals();
  });

  it('warms the microphone on a spoken question, and lets it go as the mic goes off', async () => {
    let running = 0;
    const warmRecorder = () => {
      running++;
      let cooled = false;
      return {
        get warm() {
          return !cooled;
        },
        cool: () => {
          if (!cooled) running--;
          cooled = true;
        },
      };
    };
    const app = fakeApp(KNOWN);
    const root = practiceScreen(app, deps({ warmRecorder, modelKnownDownloaded: () => true }));
    document.body.append(root);
    await flush();
    drillScope(root, ['speak']);
    await flush();
    expect(running).toBe(1);
    document.querySelector<HTMLButtonElement>('.split-toggle [aria-label="Mic off"]')!.click();
    await flush();
    expect(app.progress.settings.mic).toBe(false);
    expect(running).toBe(0);
  });

  it('asks another way when the mic goes off mid-round', async () => {
    const app = fakeApp(KNOWN);
    const root = practiceScreen(app, deps());
    document.body.append(root);
    await flush();
    drillScope(root, ['speak']);
    await flush();
    button('Tap and speak').click();
    recorder.onListening?.();
    button("I'm done").click();
    await flush();
    app.progress.settings.mic = false;
    button('Next').click();
    expect(document.querySelector('.session-header')).not.toBeNull();
    expect(document.querySelector('.choice')).not.toBeNull();
    expect(document.body.textContent).toContain('Speak is off while the mic is off.');
  });

  it('is offered but explained when the browser cannot record', async () => {
    document.body.append(practiceScreen(fakeApp(KNOWN), deps({ recordingSupported: () => false })));
    expect(document.querySelector<HTMLButtonElement>('#drill-scope [data-mode="speak"]')!.disabled).toBe(true);
    expect(document.body.textContent).toContain("this browser can't record");
  });
});

describe('the word before an attempt', () => {
  const speak = vi.fn();
  beforeEach(() => {
    speak.mockClear();
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], speak, cancel: () => {}, addEventListener: () => {}, speaking: false, pending: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("isn't played, so the drill asks what the learner remembers, then can be heard on the result", async () => {
    const root = practiceScreen(fakeApp(KNOWN, { autoplay: true }), deps());
    document.body.append(root);
    await flush();
    // The round opens mixed, and its first question may have played.
    stop();
    drillScope(root, ['speak']);
    await flush();
    expect(root.querySelector('.prompt .audio-btn')).toBeNull();
    expect(speaking()).toBe(false);
    button('Tap and speak').click();
    recorder.onListening?.();
    button("I'm done").click();
    await flush();
    button('▶ Target').click();
    expect(speaking()).toBe(true);
  });

});

describe('moving on after a right attempt', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Say the word on screen, right or (by saying nothing like it) wrong. */
  async function attempt(): Promise<void> {
    button('Tap and speak').click();
    recorder.onListening?.();
    button("I'm done").click();
    await vi.advanceTimersByTimeAsync(0);
  }
  const shown = () => document.querySelector('.prompt .tl')?.textContent;
  const mumble = deps({ loadPhoneModel: async () => ({ recognise: async () => fakeRecognition(['ʃ']) }) });

  it('goes to the next word by itself in a drill', async () => {
    document.body.append(practiceScreen(fakeApp(KNOWN), deps()));
    await vi.advanceTimersByTimeAsync(0);
    drillScope(document.body, ['speak']);
    await vi.advanceTimersByTimeAsync(0);
    await attempt();
    expect(document.querySelector('.continue.counting')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(ADVANCE_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.session-count')?.textContent).toBe('1 done');
    // The next word doesn't take focus, so a late Enter meant for Next can't start a recording.
    expect(document.activeElement).not.toBe(button('Tap and speak'));
  });

  it('waits after a miss', async () => {
    document.body.append(practiceScreen(fakeApp(KNOWN), mumble));
    await vi.advanceTimersByTimeAsync(0);
    drillScope(document.body, ['speak']);
    await vi.advanceTimersByTimeAsync(0);
    await attempt();
    expect(document.querySelector('.counting')).toBeNull();
    await vi.advanceTimersByTimeAsync(ADVANCE_MS * 5);
    expect(button('Try again')).toBeTruthy();
  });

  it('stops counting down when the learner plays their attempt back', async () => {
    document.body.append(practiceScreen(fakeApp(KNOWN), deps()));
    await vi.advanceTimersByTimeAsync(0);
    drillScope(document.body, ['speak']);
    await vi.advanceTimersByTimeAsync(0);
    await attempt();
    const word = shown();
    button('▶ Yours').click();
    expect(document.querySelector('.counting')).toBeNull();
    await vi.advanceTimersByTimeAsync(ADVANCE_MS * 5);
    expect(shown()).toBe(word);
    expect(document.querySelector('.session-count')?.textContent).toBe('0 done');
  });

});

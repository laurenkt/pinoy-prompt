// @vitest-environment happy-dom
// Asking for the microphone as a drill round or Study's practice starts, from the tap that starts it, with a
// holding screen while the phone asks, so its question never comes over a speaking question.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardKey } from '../deck';
import { recordAnswer } from '../store';
import { practiceScreen } from './practice';
import { quietToggle } from './quiet';
import type { SpeakDeps } from './speak';
import { button, drillScope, fakeApp as knowing, flush } from '../test/screen';

const KNOWN = ['salamat', 'kumusta', 'oo', 'paalam', 'tatlo', 'kape'];

/** A model already on the device, and a microphone the browser would ask for; `answer` is the learner's reply. */
function micNotYet(overrides: Partial<SpeakDeps> = {}) {
  let allowed = false;
  let answer: (allow: boolean) => void = () => {};
  const askMicrophone = vi.fn(
    () =>
      new Promise<boolean>((resolve, reject) => {
        answer = (allow) => (allow ? ((allowed = true), resolve(true)) : reject(new DOMException('no', 'NotAllowedError')));
      }),
  );
  const deps = {
    recordingSupported: () => true,
    modelDownloaded: async () => true,
    modelKnownDownloaded: () => true,
    loadPhoneModel: () => new Promise(() => {}),
    microphoneAllowed: () => allowed,
    askMicrophone,
    ...overrides,
  } as unknown as SpeakDeps;
  return { deps, askMicrophone, answer: (allow: boolean) => answer(allow) };
}

const fakeApp = (quiet = false) => knowing(KNOWN, { dailyNew: KNOWN.length, mic: !quiet });
const waiting = (root: HTMLElement) => root.querySelector('.mic-waiting') !== null;
const speaking = (root: HTMLElement) => root.textContent?.includes('Say this out loud') ?? false;

beforeEach(() => document.body.replaceChildren());

describe('asking for the microphone in Drills', () => {
  it('asks as the round opens, with a holding screen until the learner answers', async () => {
    const mic = micNotYet();
    const root = practiceScreen(fakeApp(), mic.deps);
    document.body.append(root);
    expect(mic.askMicrophone).toHaveBeenCalledOnce();
    expect(waiting(root)).toBe(true);
    expect(root.querySelector('.choice, .speak')).toBeNull();
    mic.answer(true);
    await flush();
    expect(waiting(root)).toBe(false);
    expect(root.querySelector('.choice, .speak')).not.toBeNull();
  });

  it('says where a spoken answer goes: on the phone, or to OpenAI for a meaning said into the box', () => {
    const local = practiceScreen(fakeApp(), micNotYet().deps, null, () => null);
    expect(local.querySelector('.mic-waiting')!.textContent).toContain('checked on this phone');
    expect(local.querySelector('.mic-waiting')!.textContent).not.toContain('OpenAI');
    // A voice, so listening questions (where the box is) are on offer.
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], speak: () => {}, cancel: () => {}, addEventListener: () => {} });
    try {
      const withKey = practiceScreen(fakeApp(), micNotYet().deps, null, () => async () => '');
      expect(withKey.querySelector('.mic-waiting')!.textContent).toContain('goes to OpenAI');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("doesn't mention the answer box when the round has no listening questions to type into", () => {
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], speak: () => {}, cancel: () => {}, addEventListener: () => {} });
    const scoped = practiceScreen(fakeApp(), micNotYet({ microphoneAllowed: () => true }).deps);
    try {
      drillScope(scoped, ['read', 'speak']);
      const root = practiceScreen(fakeApp(), micNotYet().deps, null, () => async () => '');
      expect(root.querySelector('.mic-waiting')!.textContent).not.toContain('OpenAI');
    } finally {
      // The scope is kept across visits, so the rest get the whole mix back.
      drillScope(scoped, ['listen', 'read', 'recall', 'speak']);
      vi.unstubAllGlobals();
    }
  });

  it('leaves speaking out for the visit when refused', async () => {
    const mic = micNotYet();
    const root = practiceScreen(fakeApp(), mic.deps);
    document.body.append(root);
    mic.answer(false);
    await flush();
    expect(waiting(root)).toBe(false);
    for (let i = 0; i < 20; i++) {
      expect(speaking(root)).toBe(false);
      root.querySelector<HTMLButtonElement>('.choice')!.click();
      button(root, 'Next').click();
    }
    expect(root.querySelector<HTMLButtonElement>('[data-mode="speak"]')!.disabled).toBe(true);
  });

  it("doesn't answer the hidden question from the keyboard while the phone asks", () => {
    const app = fakeApp();
    let onKey: ((e: KeyboardEvent) => void) | null = null;
    app.onKey = (handler) => void (onKey = handler);
    const root = practiceScreen(app, micNotYet().deps);
    onKey!(new KeyboardEvent('keydown', { key: '1' }));
    expect(root.querySelector('.feedback')).toBeNull();
    expect(waiting(root)).toBe(true);
  });

  it("doesn't ask with the mic off, or when the round can't ask to speak", () => {
    const quiet = micNotYet();
    practiceScreen(fakeApp(true), quiet.deps);
    expect(quiet.askMicrophone).not.toHaveBeenCalled();
    const first = micNotYet();
    const root = practiceScreen(fakeApp(), first.deps);
    first.answer(true);
    drillScope(root, ['read']);
    const readOnly = micNotYet();
    practiceScreen(fakeApp(), readOnly.deps);
    expect(readOnly.askMicrophone).not.toHaveBeenCalled();
    // The scope is kept across visits, so the rest get the whole mix back.
    drillScope(root, ['listen', 'read', 'recall', 'speak']);
  });

  it("asks without a holding screen when the browser wouldn't, so its remembered Allow starts again", () => {
    const allowed = micNotYet({ microphoneAllowed: () => true });
    const root = practiceScreen(fakeApp(), allowed.deps);
    expect(allowed.askMicrophone).toHaveBeenCalledOnce();
    expect(waiting(root)).toBe(false);
    expect(root.querySelector('.choice, .speak')).not.toBeNull();
    // Once is enough for the visit.
    drillScope(root, ['read', 'speak']);
    expect(allowed.askMicrophone).toHaveBeenCalledOnce();
    drillScope(root, ['listen', 'read', 'recall', 'speak']);
  });

  it('asks again, over the holding screen, once the remembered Allow has lapsed', () => {
    let allowed = true;
    const mic = micNotYet({ microphoneAllowed: () => allowed });
    const root = practiceScreen(fakeApp(), mic.deps);
    expect(mic.askMicrophone).toHaveBeenCalledOnce();
    // A long while in the background closes the stream.
    allowed = false;
    drillScope(root, ['read', 'speak']);
    expect(mic.askMicrophone).toHaveBeenCalledTimes(2);
    expect(waiting(root)).toBe(true);
    drillScope(root, ['listen', 'read', 'recall', 'speak']);
  });

  it('asks again over the holding screen when a speaking question comes up after ten minutes without a take', async () => {
    let allowed = true;
    // A model that won't start, so the speaking question offers Skip.
    const mic = micNotYet({ microphoneAllowed: () => allowed, loadPhoneModel: async () => Promise.reject(new Error('no')) });
    const root = practiceScreen(fakeApp(), mic.deps);
    document.body.append(root);
    mic.answer(true);
    await flush();
    drillScope(root, ['speak']);
    await flush();
    expect(mic.askMicrophone).toHaveBeenCalledOnce();
    allowed = false;
    button(root, 'Skip').click();
    expect(mic.askMicrophone).toHaveBeenCalledTimes(2);
    expect(waiting(root)).toBe(true);
    drillScope(root, ['listen', 'read', 'recall', 'speak']);
  });

  it('leaves speaking out when an ask that should have gone straight through is refused', async () => {
    const allowed = micNotYet({ microphoneAllowed: () => true });
    const root = practiceScreen(fakeApp(), allowed.deps);
    document.body.append(root);
    allowed.answer(false);
    await flush();
    for (let i = 0; i < 20; i++) {
      expect(speaking(root)).toBe(false);
      root.querySelector<HTMLButtonElement>('.choice')!.click();
      button(root, 'Next').click();
    }
  });

  it("leaves speaking out when the model is only found after the round opened and the phone would ask", async () => {
    const mic = micNotYet({ modelKnownDownloaded: () => false });
    const root = practiceScreen(fakeApp(), mic.deps);
    document.body.append(root);
    await flush();
    for (let i = 0; i < 20; i++) {
      expect(speaking(root)).toBe(false);
      root.querySelector<HTMLButtonElement>('.choice')!.click();
      button(root, 'Next').click();
    }
    expect(mic.askMicrophone).not.toHaveBeenCalled();
  });

  it('lets speaking in once a later tap holds the microphone, when the model is found late', async () => {
    const mic = micNotYet({ modelKnownDownloaded: () => false, microphoneAllowed: () => true });
    const root = practiceScreen(fakeApp(), mic.deps);
    document.body.append(root);
    await flush();
    expect(mic.askMicrophone).not.toHaveBeenCalled();
    // Narrowing to Speak and back is a tap that may ask to speak.
    drillScope(root, ['read', 'speak']);
    expect(mic.askMicrophone).toHaveBeenCalledOnce();
    let spoke = false;
    for (let i = 0; i < 40 && !spoke; i++) {
      spoke = speaking(root);
      if (spoke) break;
      root.querySelector<HTMLButtonElement>('.choice')!.click();
      button(root, 'Next').click();
    }
    expect(spoke).toBe(true);
    drillScope(root, ['listen', 'read', 'recall', 'speak']);
  });

  it('taps before turning Speak or the mic on, as either may open the microphone, and only then', () => {
    const root = practiceScreen(fakeApp(), micNotYet({ microphoneAllowed: () => true }).deps);
    const tapsFirst = (selector: string) => root.querySelector(selector)!.getAttribute('data-tap') === 'before';
    // Speak is on, so the chip would turn it off; the mic is on, so its switch would turn it off.
    expect(tapsFirst('[data-mode="speak"]')).toBe(false);
    expect(tapsFirst('[aria-label="Mic off"]')).toBe(false);
    expect(tapsFirst('[aria-label="Sound off"]')).toBe(false);
    drillScope(root, ['read']);
    expect(tapsFirst('[data-mode="speak"]')).toBe(true);
    expect(tapsFirst('[data-mode="listen"]')).toBe(false);
    drillScope(root, ['listen', 'read', 'recall', 'speak']);
    const quiet = practiceScreen(knowing(KNOWN, { dailyNew: KNOWN.length, mic: false, sound: false }), micNotYet().deps);
    expect(quiet.querySelector('[aria-label="Mic off"]')!.getAttribute('data-tap')).toBe('before');
    // Sound going on never opens the microphone, so it taps after the change, and is heard.
    expect(quiet.querySelector('[aria-label="Sound off"]')!.hasAttribute('data-tap')).toBe(false);
    // Elsewhere (Home, Study) it never opens the microphone, so it taps after, as other controls do.
    expect(quietToggle(knowing(KNOWN, { mic: false }), () => {}).querySelector('[data-tap]')).toBeNull();
  });

  it("doesn't ask when the sound goes on or off, which can't let the round ask to speak", async () => {
    // The Allow has lapsed since the round opened, so a tap that may let it speak would ask again.
    const mic = micNotYet({ microphoneAllowed: () => false });
    const root = practiceScreen(fakeApp(), mic.deps);
    mic.answer(true);
    await flush();
    const sound = () => root.querySelector<HTMLButtonElement>('[aria-label="Sound off"]')!;
    sound().click();
    sound().click();
    expect(mic.askMicrophone).toHaveBeenCalledOnce();
    expect(waiting(root)).toBe(false);
  });

  it('asks when Speak is chosen again mid-round', async () => {
    const off = micNotYet({ microphoneAllowed: () => true });
    const root = practiceScreen(fakeApp(), off.deps);
    drillScope(root, ['read']);
    const mic = micNotYet();
    const again = practiceScreen(fakeApp(), mic.deps);
    expect(mic.askMicrophone).not.toHaveBeenCalled();
    again.querySelector<HTMLButtonElement>('.filter-toggle')!.click();
    again.querySelector<HTMLButtonElement>('[data-mode="speak"]')!.click();
    expect(mic.askMicrophone).toHaveBeenCalledOnce();
    expect(waiting(again)).toBe(true);
    drillScope(again, ['listen', 'read', 'recall', 'speak']);
  });
});

describe('asking for the microphone around a typed meaning', () => {
  /** Words settled in Study, so a listening question asks for the meaning typed; the mic off, so its going on asks. */
  function typedRound(judge: () => Promise<boolean | null>) {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], speak: () => {}, cancel: () => {}, addEventListener: () => {} });
    const app = fakeApp(true);
    for (const id of KNOWN) for (const key of [id, cardKey(id, 'listen'), cardKey(id, 'listen')]) recordAnswer(app.progress, key, 'good', app.now());
    const mic = micNotYet();
    const root = practiceScreen(app, mic.deps, judge, () => null);
    document.body.append(root);
    const box = () => root.querySelector<HTMLInputElement>('.meaning-input')!;
    const send = (text: string) => {
      box().value = text;
      root.querySelector('form.meaning-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    };
    const micOn = () => root.querySelector<HTMLButtonElement>('[aria-label="Mic off"]')!.click();
    return { root, mic, box, send, micOn };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows a wrong typed meaning again as it was once the phone has asked', async () => {
    const { root, mic, box, send, micOn } = typedRound(async () => false);
    send('good night');
    await flush();
    micOn();
    expect(waiting(root)).toBe(true);
    mic.answer(true);
    await flush();
    expect(root.querySelector('.feedback')?.textContent).toContain('Mali.');
    expect(box().value).toBe('good night');
  });

  it("doesn't cover a meaning being checked with the holding screen", async () => {
    const { root, mic, send, micOn } = typedRound(() => new Promise(() => {}));
    send('thanks a lot');
    micOn();
    expect(waiting(root)).toBe(false);
    expect(mic.askMicrophone).not.toHaveBeenCalled();
  });
});

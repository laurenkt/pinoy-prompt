// @vitest-environment happy-dom
// Asking for the microphone as a drill round or Study's practice starts, from the tap that starts it, with a
// holding screen while the phone asks, so its question never comes over a speaking question.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { practiceScreen } from './practice';
import { sessionScreen } from './session';
import type { SpeakDeps } from './speak';
import { button, drillScope, fakeApp as knowing, flush } from '../test/screen';

const KNOWN = ['salamat', 'kumusta', 'oo', 'paalam', 'tatlo', 'kape'];

/** A model already on the device, and a microphone the browser would ask for; `answer` is the learner's reply. */
function micNotYet(overrides: Partial<SpeakDeps> = {}) {
  let allowed = false;
  let answer: (allow: boolean) => void = () => {};
  const holdMicrophone = vi.fn(
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
    holdMicrophone,
    ...overrides,
  } as unknown as SpeakDeps;
  return { deps, holdMicrophone, answer: (allow: boolean) => answer(allow) };
}

const fakeApp = (quiet = false) => knowing(KNOWN, { dailyNew: KNOWN.length, quiet, headphones: true });
const waiting = (root: HTMLElement) => root.querySelector('.mic-waiting') !== null;
const speaking = (root: HTMLElement) => root.textContent?.includes('Say this out loud') ?? false;

beforeEach(() => document.body.replaceChildren());

describe('asking for the microphone in Drills', () => {
  it('asks as the round opens, with a holding screen until the learner answers', async () => {
    const mic = micNotYet();
    const root = practiceScreen(fakeApp(), mic.deps);
    document.body.append(root);
    expect(mic.holdMicrophone).toHaveBeenCalledOnce();
    expect(waiting(root)).toBe(true);
    expect(root.querySelector('.choice, .speak')).toBeNull();
    mic.answer(true);
    await flush();
    expect(waiting(root)).toBe(false);
    expect(root.querySelector('.choice, .speak')).not.toBeNull();
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

  it("doesn't ask in quiet mode, when the round can't ask to speak, or when the browser wouldn't ask", () => {
    const quiet = micNotYet();
    practiceScreen(fakeApp(true), quiet.deps);
    expect(quiet.holdMicrophone).not.toHaveBeenCalled();
    const allowed = micNotYet({ microphoneAllowed: () => true });
    practiceScreen(fakeApp(), allowed.deps);
    expect(allowed.holdMicrophone).not.toHaveBeenCalled();
    const first = micNotYet();
    const root = practiceScreen(fakeApp(), first.deps);
    first.answer(true);
    drillScope(root, ['read']);
    const readOnly = micNotYet();
    practiceScreen(fakeApp(), readOnly.deps);
    expect(readOnly.holdMicrophone).not.toHaveBeenCalled();
    // The scope is kept across visits, so the rest get the whole mix back.
    drillScope(root, ['listen', 'read', 'recall', 'speak']);
  });

  it('asks when Speak is chosen again mid-round', async () => {
    const off = micNotYet({ microphoneAllowed: () => true });
    const root = practiceScreen(fakeApp(), off.deps);
    drillScope(root, ['read']);
    const mic = micNotYet();
    const again = practiceScreen(fakeApp(), mic.deps);
    expect(mic.holdMicrophone).not.toHaveBeenCalled();
    again.querySelector<HTMLButtonElement>('.filter-toggle')!.click();
    again.querySelector<HTMLButtonElement>('[data-mode="speak"]')!.click();
    expect(mic.holdMicrophone).toHaveBeenCalledOnce();
    expect(waiting(again)).toBe(true);
    drillScope(again, ['listen', 'read', 'recall', 'speak']);
  });
});

describe('asking for the microphone in Study', () => {
  it('asks as practice starts, before a speaking step', async () => {
    const mic = micNotYet();
    const root = sessionScreen(fakeApp(), [{ kind: 'extra', cardId: 'salamat', format: 'speak' }], undefined, mic.deps);
    document.body.append(root);
    expect(mic.holdMicrophone).not.toHaveBeenCalled();
    button(root, 'Keep practising').click();
    expect(mic.holdMicrophone).toHaveBeenCalledOnce();
    expect(waiting(root)).toBe(true);
    expect(speaking(root)).toBe(false);
    mic.answer(true);
    await flush();
    expect(speaking(root)).toBe(true);
  });

  it('asks the step another way when refused', async () => {
    const mic = micNotYet();
    const root = sessionScreen(fakeApp(), [{ kind: 'extra', cardId: 'salamat', format: 'speak' }], undefined, mic.deps);
    document.body.append(root);
    button(root, 'Keep practising').click();
    mic.answer(false);
    await flush();
    expect(waiting(root)).toBe(false);
    expect(speaking(root)).toBe(false);
    expect(root.querySelector('.panel')).not.toBeNull();
  });
});

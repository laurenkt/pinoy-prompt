// @vitest-environment happy-dom
// Asking for the microphone up front, on a screen of its own, before a drill round or Study's practice
// might ask the learner to speak, so the phone's question never comes over a speaking question.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { practiceScreen } from './practice';
import { sessionScreen } from './session';
import type { SpeakDeps } from './speak';
import { button, drillScope, fakeApp as knowing, flush } from '../test/screen';

const KNOWN = ['salamat', 'kumusta', 'oo', 'paalam', 'tatlo', 'kape'];

/** A model already on the device, and a microphone the browser would ask for until it's turned on. */
function micNotYet(overrides: Partial<SpeakDeps> = {}) {
  let allowed = false;
  const holdMicrophone = vi.fn(async () => void (allowed = true));
  const deps = {
    recordingSupported: () => true,
    modelDownloaded: async () => true,
    modelKnownDownloaded: () => true,
    loadPhoneModel: () => new Promise(() => {}),
    microphoneAllowed: () => allowed,
    holdMicrophone,
    ...overrides,
  } as unknown as SpeakDeps;
  return { deps, holdMicrophone };
}

const fakeApp = (quiet = false) => knowing(KNOWN, { dailyNew: KNOWN.length, quiet, headphones: true });
const gated = (root: HTMLElement) => root.querySelector('.mic-gate') !== null;
const speaking = (root: HTMLElement) => root.textContent?.includes('Say this out loud') ?? false;

beforeEach(() => document.body.replaceChildren());

describe('the microphone question in Drills', () => {
  it('comes before the first question when speaking may come up, and turning it on holds the microphone', async () => {
    const { deps, holdMicrophone } = micNotYet();
    const root = practiceScreen(fakeApp(), deps);
    expect(gated(root)).toBe(true);
    expect(root.querySelector('.choice')).toBeNull();
    button(root, 'Turn on').click();
    await flush();
    expect(holdMicrophone).toHaveBeenCalledOnce();
    expect(gated(root)).toBe(false);
    expect(root.querySelector('.panel')).not.toBeNull();
  });

  it('leaves speaking out for the visit when skipped', async () => {
    const { deps, holdMicrophone } = micNotYet();
    const root = practiceScreen(fakeApp(), deps);
    document.body.append(root);
    button(root, 'Skip speaking').click();
    expect(gated(root)).toBe(false);
    for (let i = 0; i < 20; i++) {
      expect(speaking(root)).toBe(false);
      root.querySelector<HTMLButtonElement>('.choice')!.click();
      button(root, 'Next').click();
    }
    expect(holdMicrophone).not.toHaveBeenCalled();
  });

  it("isn't asked in quiet mode, or when the round can't ask to speak", () => {
    expect(gated(practiceScreen(fakeApp(true), micNotYet().deps))).toBe(false);
    const root = practiceScreen(fakeApp(), micNotYet().deps);
    drillScope(root, ['read']);
    expect(gated(root)).toBe(false);
    // The scope is kept across visits, so the rest get the whole mix back.
    drillScope(root, ['listen', 'read', 'recall', 'speak']);
  });

  it("isn't asked when the browser wouldn't ask", () => {
    expect(gated(practiceScreen(fakeApp(), micNotYet({ microphoneAllowed: () => true }).deps))).toBe(false);
  });

  it('goes when quiet mode comes on', () => {
    const root = practiceScreen(fakeApp(), micNotYet().deps);
    root.querySelector<HTMLButtonElement>('.quiet-icon')!.click();
    expect(gated(root)).toBe(false);
  });

  it('says so when the microphone is blocked, and the round can carry on without it', async () => {
    const blocked = vi.fn(async () => Promise.reject(new DOMException('no', 'NotAllowedError')));
    const root = practiceScreen(fakeApp(), micNotYet({ holdMicrophone: blocked }).deps);
    button(root, 'Turn on').click();
    await flush();
    expect(root.textContent).toContain('microphone is blocked');
    button(root, 'Skip speaking').click();
    expect(gated(root)).toBe(false);
  });
});

describe('the microphone question in Study', () => {
  it('comes as practice starts, before a speaking step', async () => {
    const { deps, holdMicrophone } = micNotYet();
    const root = sessionScreen(fakeApp(), [{ kind: 'extra', cardId: 'salamat', format: 'speak' }], undefined, deps);
    button(root, 'Keep practising').click();
    expect(gated(root)).toBe(true);
    expect(speaking(root)).toBe(false);
    button(root, 'Turn on').click();
    await flush();
    expect(holdMicrophone).toHaveBeenCalledOnce();
    expect(speaking(root)).toBe(true);
  });

  it('asks the step another way when skipped', () => {
    const root = sessionScreen(fakeApp(), [{ kind: 'extra', cardId: 'salamat', format: 'speak' }], undefined, micNotYet().deps);
    button(root, 'Keep practising').click();
    button(root, 'Skip speaking').click();
    expect(gated(root)).toBe(false);
    expect(speaking(root)).toBe(false);
    expect(root.querySelector('.panel')).not.toBeNull();
  });
});

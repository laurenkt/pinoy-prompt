// @vitest-environment happy-dom
// A right answer in a drill gets a short chime; a wrong one doesn't, and silent mode hears nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VOCAB } from '../deck';
import { setMuted } from '../speech';
import { FakeAudioContext, chimes } from '../test/fake-audio';
import { drillScope, fakeApp, flush, noMic } from '../test/screen';
import { practiceScreen } from './practice';

const KNOWN = ['salamat', 'kumusta', 'oo', 'hindi', 'paalam', 'kape'];

/** The right choice for the read question showing, or a wrong one. */
function choice(root: HTMLElement, right: boolean): HTMLButtonElement {
  const tl = root.querySelector('.prompt .tl')!.textContent;
  const en = VOCAB.find((c) => c.tl === tl)!.en;
  return [...root.querySelectorAll<HTMLButtonElement>('.choice')].find((b) => (b.textContent!.slice(1) === en) === right)!;
}

let root: HTMLElement;
beforeEach(() => {
  chimes.count = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  root = practiceScreen(fakeApp(KNOWN), noMic);
  document.body.replaceChildren(root);
  drillScope(root, ['read']);
});
afterEach(() => {
  setMuted(false);
  drillScope(root, ['listen', 'read', 'recall', 'speak']);
  vi.unstubAllGlobals();
});

describe('the sound of a right answer in a drill', () => {
  it('chimes once for a right answer', async () => {
    choice(root, true).click();
    await flush();
    expect(chimes.count).toBe(1);
  });

  it("doesn't chime for a wrong one", async () => {
    choice(root, false).click();
    await flush();
    expect(chimes.count).toBe(0);
  });

  it('is silent in silent mode', async () => {
    setMuted(true);
    choice(root, true).click();
    await flush();
    expect(chimes.count).toBe(0);
  });
});

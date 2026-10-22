// @vitest-environment happy-dom
// A right answer in a drill gets a short chime; a wrong one doesn't, and silent mode hears nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VOCAB } from '../deck';
import { setMuted } from '../speech';
import { drillScope, fakeApp, noMic } from '../test/screen';
import { practiceScreen } from './practice';

const KNOWN = ['salamat', 'kumusta', 'oo', 'hindi', 'paalam', 'kape'];

/** Sounds made in code (the chime), as against clips decoded from a file. */
let chimes: number;

class FakeContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  resume = async () => {};
  suspend = async () => {};
  close = async () => {};
  decodeAudioData = async () => ({ duration: 1 });
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { made: true, sampleRate, duration: length / sampleRate, getChannelData: () => data };
  }
  createGain() {
    const param = { setValueAtTime() {}, linearRampToValueAtTime() {} };
    return { gain: param, connect: (to: unknown) => to };
  }
  createBufferSource() {
    const source = {
      buffer: null as { made?: boolean } | null,
      playbackRate: { value: 1 },
      onended: null,
      connect: (to: unknown) => to,
      start: () => source.buffer?.made && chimes++,
      stop: () => {},
    };
    return source;
  }
}

/** The right choice for the read question showing, or a wrong one. */
function choice(root: HTMLElement, right: boolean): HTMLButtonElement {
  const tl = root.querySelector('.prompt .tl')!.textContent;
  const en = VOCAB.find((c) => c.tl === tl)!.en;
  return [...root.querySelectorAll<HTMLButtonElement>('.choice')].find((b) => (b.textContent!.slice(1) === en) === right)!;
}

let root: HTMLElement;
beforeEach(() => {
  chimes = 0;
  vi.stubGlobal('AudioContext', FakeContext);
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
  it('chimes once for a right answer', () => {
    choice(root, true).click();
    expect(chimes).toBe(1);
  });

  it("doesn't chime for a wrong one", () => {
    choice(root, false).click();
    expect(chimes).toBe(0);
  });

  it('is silent in silent mode', () => {
    setMuted(true);
    choice(root, true).click();
    expect(chimes).toBe(0);
  });
});

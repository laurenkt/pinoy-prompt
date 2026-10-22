// @vitest-environment happy-dom
// Drills open straight into a mixed round; a tucked-away filter narrows which kinds of question it asks.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { practiceScreen } from './practice';
import type { SpeakDeps } from './speak';
import { button, drillScope, fakeApp, flush, noMic } from '../test/screen';

const KNOWN = ['salamat', 'kumusta', 'oo', 'hindi', 'paalam', 'kape'];

/** Ready to record, with the model on the device, so speaking can join the mix. */
const micReady = { recordingSupported: () => true, modelDownloaded: async () => true, loadPhoneModel: () => new Promise(() => {}) } as unknown as SpeakDeps;

const kind = (root: HTMLElement) => {
  const text = root.querySelector('.prompt .eyebrow')?.textContent ?? '';
  if (text.startsWith('What did you hear')) return 'listen';
  if (text.startsWith('What does this mean')) return 'read';
  if (text.startsWith('How do you say')) return 'recall';
  if (text.startsWith('Say this')) return 'speak';
  throw new Error(`No question: ${root.textContent}`);
};

/** Answer the question showing and go on to the next. */
function next(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>('.choice')!.click();
  button(root, 'Next').click();
}

const toggle = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.filter-toggle')!;

let root: HTMLElement;
beforeEach(() => {
  // A voice, so listening can be asked; no microphone, so speaking can't.
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], speak: () => {}, cancel: () => {}, addEventListener: () => {} });
  root = practiceScreen(fakeApp(KNOWN), noMic);
  document.body.replaceChildren(root);
  drillScope(root, ['listen', 'read', 'recall', 'speak']);
});
afterEach(() => {
  drillScope(root, ['listen', 'read', 'recall', 'speak']);
  vi.unstubAllGlobals();
});

describe('the kinds of question in a drill round', () => {
  it('starts with the mix, the choices tucked away', () => {
    const fresh = practiceScreen(fakeApp(KNOWN), noMic);
    expect(fresh.querySelector('.prompt')).not.toBeNull();
    expect(toggle(fresh).textContent).toBe('Mix');
    expect(toggle(fresh).getAttribute('aria-expanded')).toBe('false');
    expect(fresh.querySelector<HTMLElement>('#drill-scope')!.hidden).toBe(true);
  });

  it('opens and closes the choices from the header', () => {
    toggle(root).click();
    expect(root.querySelector<HTMLElement>('#drill-scope')!.hidden).toBe(false);
    expect(toggle(root).getAttribute('aria-expanded')).toBe('true');
    toggle(root).click();
    expect(root.querySelector<HTMLElement>('#drill-scope')!.hidden).toBe(true);
  });

  it('asks only the kinds left in, from the next question on, and changes an unanswered one straight away', () => {
    drillScope(root, ['recall']);
    expect(kind(root)).toBe('recall');
    expect(toggle(root).textContent).toBe('Recall');
    for (let i = 0; i < 12; i++) {
      next(root);
      expect(kind(root)).toBe('recall');
    }
    drillScope(root, ['read', 'recall']);
    expect(toggle(root).textContent).toBe('2 kinds');
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      seen.add(kind(root));
      next(root);
    }
    expect([...seen].sort()).toEqual(['read', 'recall']);
  });

  it('keeps an answered question as it is', () => {
    drillScope(root, ['read']);
    root.querySelector<HTMLButtonElement>('.choice')!.click();
    drillScope(root, ['recall']);
    expect(kind(root)).toBe('read');
    button(root, 'Next').click();
    expect(kind(root)).toBe('recall');
  });

  it('always keeps one kind in', () => {
    drillScope(root, ['read']);
    root.querySelector<HTMLButtonElement>('#drill-scope [data-mode="read"]')!.click();
    expect(root.querySelector('#drill-scope [data-mode="read"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(kind(root)).toBe('read');
  });

  it('is kept for the next round', () => {
    drillScope(root, ['recall']);
    const again = practiceScreen(fakeApp(KNOWN), noMic);
    expect(kind(again)).toBe('recall');
    expect(toggle(again).textContent).toBe('Recall');
  });

  it('only speaks in the mix once the model is on the device, but asks for it when Speak is chosen', async () => {
    const notYet = { ...micReady, modelDownloaded: async () => false } as unknown as SpeakDeps;
    const mix = practiceScreen(fakeApp(KNOWN), notYet);
    document.body.replaceChildren(mix);
    await flush();
    for (let i = 0; i < 30; i++) {
      expect(kind(mix)).not.toBe('speak');
      next(mix);
    }
    drillScope(mix, ['speak']);
    expect(kind(mix)).toBe('speak');
    drillScope(mix, ['listen', 'read', 'recall', 'speak']);
  });
});

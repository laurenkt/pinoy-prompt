// What screen tests share: an app to draw a screen with, and ways to find and
// press its buttons. A change to App or Settings is made here once, not in
// every test file.

import { vi } from 'vitest';
import type { App } from '../app';
import type { SpeakDeps } from '../screens/speak';
import { emptyProgress, recordAnswer, type Settings } from '../store';

/**
 * An app whose learner already knows `known`, each answered right just now.
 * Words don't play by themselves unless `settings` says so. `navigate` is a
 * mock, so a test can check where a screen went.
 */
export function fakeApp(known: string[] = [], settings: Partial<Settings> = {}) {
  const now = Date.now();
  const progress = emptyProgress(now);
  Object.assign(progress.settings, { autoplay: false }, settings);
  for (const id of known) recordAnswer(progress, id, 'good', now);
  const navigate = vi.fn<App['navigate']>();
  const app: App = { progress, now: () => now, commit: () => {}, replaceProgress: () => {}, navigate, onKey: () => {}, onBack: () => {} };
  return Object.assign(app, { navigate });
}

/** The button labelled `text`, or failing that, the first whose label contains it. */
export function button(root: ParentNode, text: string): HTMLButtonElement {
  const all = [...root.querySelectorAll('button')];
  const found = all.find((b) => b.textContent?.trim() === text) ?? all.find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`No "${text}" button in: ${(root as Node).textContent}`);
  return found;
}

/** No microphone, so speaking never joins the mix. */
export const noMic = { recordingSupported: () => false, modelDownloaded: async () => false } as unknown as SpeakDeps;

/** Let pending promises and timers of 0 ms run. */
export const flush = () => new Promise((r) => setTimeout(r, 0));

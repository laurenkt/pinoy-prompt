// What screen tests share: an app to draw a screen with, and ways to find and
// press its buttons. A change to App or Settings is made here once, not in
// every test file.

import { vi } from 'vitest';
import type { App } from '../app';
import { VOCAB } from '../deck';
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

/**
 * Narrow a drill round to exactly these kinds of question, through its scope chips. The scope is kept across visits,
 * so a test that cares about it sets it rather than relying on what an earlier test left.
 */
export function drillScope(root: HTMLElement, modes: string[]): void {
  const chips = () => [...root.querySelectorAll<HTMLButtonElement>('#drill-scope [data-mode]')];
  const set = (on: boolean) => {
    for (const mode of chips().map((c) => c.dataset.mode!)) {
      const chip = root.querySelector<HTMLButtonElement>(`#drill-scope [data-mode="${mode}"]`)!;
      if (modes.includes(mode) === on && (chip.getAttribute('aria-pressed') === 'true') !== on) chip.click();
    }
  };
  // Turn the wanted ones on first, so the last one left on is never one being turned off.
  set(true);
  set(false);
}

/**
 * Pick the right choice on a word read or recalled from choices, found from what the prompt shows, so a drill round
 * doesn't bring the word straight back as a miss. Falls back on the first choice for anything else.
 */
export function chooseRight(root: ParentNode): void {
  // A typed question (after a run of right answers, say) is answered from its choices too.
  if (!root.querySelector('.choice')) [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Show choices')?.click();
  const prompt = root.querySelector('.prompt');
  const shown = `${prompt?.textContent ?? ''} ${[...(prompt?.querySelectorAll('img') ?? [])].map((i) => i.alt).join(' ')}`;
  const choices = [...root.querySelectorAll<HTMLButtonElement>('.choice')];
  // A choice reads as its number key, then its label.
  const label = (b: HTMLButtonElement) => b.textContent!.replace(/^\d/, '');
  const right = choices.find((b) => VOCAB.some((c) => (label(b) === c.en && shown.includes(c.tl)) || (label(b) === c.tl && shown.includes(c.en))));
  (right ?? choices[0]).click();
}

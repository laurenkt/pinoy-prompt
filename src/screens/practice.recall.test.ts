// @vitest-environment happy-dom
// Recall drills: words still being learned have their Tagalog picked from
// choices; words that have settled in Study have it typed, or said, from the
// English. The English said back isn't an answer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../app';
import { cardKey, type Card } from '../deck';
import type { MeaningJudge } from '../meaning';
import type { RecorderEvents, Take } from '../recorder';
import { recordAnswer } from '../store';
import { DAY_MS } from '../srs';
import { button, drillScope, fakeApp, flush, noMic } from '../test/screen';
import { practiceScreen, type MeaningHearer } from './practice';
import type { SpeakDeps } from './speak';
import { play } from '../speech';
import { fakeRecognition } from '../test/fake-speech';

vi.mock('../speech', async (actual) => {
  const speech = await actual<typeof import('../speech')>();
  return { ...speech, play: vi.fn(async () => {}) };
});

/** Asked in this order, since every pick rolls 0. */
const KNOWN = ['salamat', 'maraming-salamat', 'magandang-umaga', 'bukas'];

/** Words just met; settled ones have been remembered again since. */
function learner(settled: boolean): App {
  const app = fakeApp(KNOWN);
  // Settled the way it's asked here: met, then remembered again since, as its own card (see Way).
  if (settled) for (const id of KNOWN) for (const key of [id, cardKey(id, 'recall'), cardKey(id, 'recall')]) recordAnswer(app.progress, key, 'good', app.now());
  return app;
}

const box = (root: HTMLElement) => root.querySelector<HTMLInputElement>('.meaning-input');

function type(root: HTMLElement, text: string): void {
  box(root)!.value = text;
  root.querySelector('form.meaning-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
}

/** A round asking only Recall, opened with that scope so its first question is on the first word. */
function recall(app: App, judge: MeaningJudge | null = null, deps: SpeakDeps = noMic, hearer: MeaningHearer | null = null): HTMLElement {
  drillScope(practiceScreen(fakeApp(KNOWN), noMic), ['recall']);
  const root = practiceScreen(app, deps, judge, () => hearer);
  document.body.replaceChildren(root);
  return root;
}

let last: HTMLElement | undefined;
beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
  // The scope is kept across visits: back to the mix for the next test.
  if (last) drillScope(last, ['listen', 'read', 'recall', 'speak']);
  last = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(play).mockClear();
  document.body.replaceChildren();
});

describe('recalling words still being learned', () => {
  it('picks the Tagalog from choices', () => {
    const root = (last = recall(learner(false)));
    expect(root.textContent).toContain('How do you say…');
    expect(root.querySelectorAll('.choice')).toHaveLength(4);
    expect(box(root)).toBeNull();
  });
});

describe("how well the card is known", () => {
  const toggle = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.prompt .memory-toggle')!;
  const details = (root: HTMLElement) => root.querySelector<HTMLElement>('.prompt .card-memory')!;

  it('stays hidden until the button on the prompt is tapped, and shuts again for the next question', () => {
    const app = learner(false);
    // Recalling it is a card of its own (see Way), started here and still being learned; reading it is held for weeks.
    app.progress.cards['salamat:recall'] = { ...app.progress.cards.salamat, interval: 0 };
    app.progress.cards.salamat.interval = 30;
    const root = (last = recall(app));
    expect(root.querySelector('.prompt .eyebrow')?.textContent).toBe('How do you say… ');
    expect(details(root).hidden).toBe(true);
    expect(toggle(root).getAttribute('aria-expanded')).toBe('false');
    toggle(root).click();
    expect(details(root).hidden).toBe(false);
    expect(toggle(root).getAttribute('aria-expanded')).toBe('true');
    expect(details(root).querySelector('.badge.s-new')?.textContent).toBe('Memory: Just met');
    // Still open once answered, as nothing about it changed.
    root.querySelector<HTMLButtonElement>('.choice')!.click();
    expect(details(root).hidden).toBe(false);
    button(root, 'Next').click();
    expect(details(root).hidden).toBe(true);
  });

  it('follows the schedule of the way it is asked, with how often Study asked it and the drills helped', () => {
    const app = learner(true);
    Object.assign(app.progress.cards['salamat:recall'], { interval: 30, due: app.now() + 30 * DAY_MS, reviews: 6, lapses: 1 });
    app.progress.cards.salamat.help = { recall: 2 };
    const root = (last = recall(app));
    toggle(root).click();
    const text = details(root).textContent;
    expect(details(root).querySelector('.badge.s-long')?.textContent).toBe('Memory: Long-term');
    expect(text).toContain('Next in StudyIn 1mo');
    expect(text).toContain('Answered in Study6 times, forgotten once');
    expect(text).toContain('Help in DrillsNeeded twice lately');
  });

  it("says a way Study hasn't asked yet hasn't been answered", () => {
    const root = (last = recall(learner(false)));
    toggle(root).click();
    expect(details(root).querySelector('.badge')).toBeNull();
    expect(details(root).textContent).toContain('MemoryStudy hasn’t asked it this way yet');
    expect(details(root).textContent).toContain('Help in DrillsNot needed lately');
  });
});

describe('recalling words that have settled', () => {
  it('asks for the Tagalog to be typed, and takes it with a "po" or a typo', async () => {
    const judge = vi.fn<MeaningJudge>(async () => null);
    const root = (last = recall(learner(true), judge));
    expect(root.querySelector('.prompt-en')?.textContent).toBe('Thank you');
    expect(root.querySelector('.choice')).toBeNull();
    expect(box(root)!.placeholder).toBe('Type it in Tagalog');
    expect(box(root)!.getAttribute('autocorrect')).toBe('off');
    type(root, 'Salamat po');
    await flush();
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
    expect(box(root)!.classList.contains('correct')).toBe(true);
    expect(root.querySelector('.continue.counting')).not.toBeNull();
    // The word is said back once it's answered.
    expect(play).toHaveBeenCalledWith(expect.objectContaining<Partial<Card>>({ id: 'salamat' }), false);
    expect(judge).not.toHaveBeenCalled();
  });

  it("doesn't play the word before it's answered, since it's the answer", () => {
    const root = (last = recall(learner(true)));
    expect(root.querySelector('.audio-btn')).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it('turns the English said back down', async () => {
    // OpenAI, told the answer has to be in Tagalog.
    const judge = vi.fn<MeaningJudge>(async () => false);
    const root = (last = recall(learner(true), judge));
    type(root, 'thank you');
    await flush();
    expect(root.querySelector('.feedback')?.textContent).toContain('Mali.');
    expect(root.querySelector('.feedback')?.textContent).toContain('Salamat');
    expect(judge).toHaveBeenCalledWith('thank you', expect.objectContaining<Partial<Card>>({ id: 'salamat' }), 'tl');
  });

  it('checks other wording with OpenAI, as Tagalog', async () => {
    const judge = vi.fn<MeaningJudge>(async () => true);
    const root = (last = recall(learner(true), judge));
    type(root, 'salamat sa iyo');
    await flush();
    expect(judge).toHaveBeenCalledWith('salamat sa iyo', expect.objectContaining<Partial<Card>>({ id: 'salamat' }), 'tl');
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
  });

  it('offers the choices instead, in Tagalog', () => {
    const root = (last = recall(learner(true)));
    button(root, 'Show choices').click();
    const choices = [...root.querySelectorAll('.choice')];
    expect(choices).toHaveLength(4);
    expect(choices.some((c) => c.textContent?.includes('Salamat'))).toBe(true);
  });

  it('hears a Tagalog answer said into the box as Tagalog', async () => {
    let finish: (t: Take) => void = () => {};
    let listening: (() => void) | undefined;
    const record = vi.fn((events: RecorderEvents = {}) => {
      listening = events.onListening;
      const audio = new Promise<Take>((r) => (finish = r));
      setTimeout(() => finish({ samples: new Float32Array(160), speech: true }), 0);
      return { audio, stop: () => {}, cancel: () => {} };
    });
    const deps = { recordingSupported: () => true, modelDownloaded: async () => false, record } as unknown as SpeakDeps;
    const hearer = vi.fn<MeaningHearer>(async () => 'Salamat.');
    const root = (last = recall(learner(true), null, deps, hearer));
    root.querySelector<HTMLButtonElement>('.meaning-mic')!.click();
    listening?.();
    expect(root.querySelector('.meaning-status')?.textContent).toBe('Listening… say it in Tagalog.');
    await flush();
    await flush();
    expect(hearer).toHaveBeenCalledWith(expect.any(Blob), 'tl');
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
  });
});

describe('a Tagalog answer said into the box, with the pronunciation model on the device', () => {
  /** A microphone that records at once, and a model that hears these sounds. */
  function onDevice(sounds: string[]) {
    const record = vi.fn((events: RecorderEvents = {}) => {
      setTimeout(() => events.onListening?.(), 0);
      return { audio: new Promise<Take>((r) => setTimeout(() => r({ samples: new Float32Array(160), speech: true }), 0)), stop: () => {}, cancel: () => {} };
    });
    const recognise = vi.fn(async () => fakeRecognition(sounds));
    const deps = {
      recordingSupported: () => true,
      modelDownloaded: async () => true,
      modelKnownDownloaded: () => true,
      loadPhoneModel: async () => ({ recognise }),
      record,
    } as unknown as SpeakDeps;
    return { deps, recognise };
  }

  async function say(root: HTMLElement): Promise<void> {
    root.querySelector<HTMLButtonElement>('.meaning-mic')!.click();
    for (let i = 0; i < 5; i++) await flush();
  }

  it('is judged by its sounds, so speech-to-text writing a look-alike can\'t mark it wrong', async () => {
    const { deps, recognise } = onDevice(['s', 'a', 'l', 'a', 'm', 'a', 't']);
    // What speech-to-text might make of it.
    const hearer = vi.fn<MeaningHearer>(async () => 'Solomon');
    const judge = vi.fn<MeaningJudge>(async () => false);
    const root = (last = recall(learner(true), judge, deps, hearer));
    await say(root);
    expect(recognise).toHaveBeenCalled();
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
    expect(box(root)!.value).toBe('Salamat');
    expect(box(root)!.classList.contains('correct')).toBe(true);
    // It passed on the device, so the recording never went to OpenAI.
    expect(hearer).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
  });

  it('goes to speech-to-text when its sounds are another word, which may still be right in other words', async () => {
    const { deps } = onDevice(['b', 'u', 'k', 'a', 's']);
    const hearer = vi.fn<MeaningHearer>(async () => 'Bukas');
    const judge = vi.fn<MeaningJudge>(async () => false);
    const root = (last = recall(learner(true), judge, deps, hearer));
    await say(root);
    expect(hearer).toHaveBeenCalledWith(expect.any(Blob), 'tl');
    expect(root.querySelector('.feedback')?.textContent).toContain('Mali.');
    expect(box(root)!.value).toBe('Bukas');
  });

  it("leaves English meanings to speech-to-text", async () => {
    const { deps, recognise } = onDevice(['s', 'a', 'l', 'a', 'm', 'a', 't']);
    const hearer = vi.fn<MeaningHearer>(async () => 'Thank you');
    // A voice, so listening is on offer.
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], speak: () => {}, cancel: () => {}, addEventListener: () => {} });
    drillScope(practiceScreen(fakeApp(KNOWN), noMic), ['listen']);
    const app = learner(true);
    // Heard and settled too, so a listening question asks for the meaning in the box.
    for (const id of KNOWN) for (let i = 0; i < 2; i++) recordAnswer(app.progress, cardKey(id, 'listen'), 'good', app.now());
    const root = (last = practiceScreen(app, deps, null, () => hearer));
    document.body.replaceChildren(root);
    await say(root);
    expect(recognise).not.toHaveBeenCalled();
    expect(hearer).toHaveBeenCalledWith(expect.any(Blob), 'en');
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
  });
});

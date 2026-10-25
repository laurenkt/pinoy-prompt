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

describe("how well the card is known, on its back", () => {
  const card = (root: HTMLElement) => root.querySelector<HTMLElement>('.prompt')!;
  // Drawn only once the card is first turned.
  const back = (root: HTMLElement) => root.querySelector<HTMLElement>('.prompt .card-back') ?? { hidden: true, click() {} };
  const front = (root: HTMLElement) => root.querySelector<HTMLElement>('.prompt .card-front')!;

  it('turns over with a tap anywhere on the card, back again with another, and is face up for the next question', () => {
    const app = learner(false);
    // Recalling it is a card of its own (see Way), started here and still being learned; reading it is held for weeks.
    app.progress.cards['salamat:recall'] = { ...app.progress.cards.salamat, interval: 0 };
    app.progress.cards.salamat.interval = 30;
    const root = (last = recall(app));
    expect(back(root).hidden).toBe(true);
    expect(root.querySelector('.prompt button')?.getAttribute('aria-expanded')).toBe('false');
    root.querySelector<HTMLElement>('.prompt-en')!.click();
    expect(back(root).hidden).toBe(false);
    expect(front(root).hidden).toBe(true);
    expect(card(root).classList.contains('turned')).toBe(true);
    expect(root.querySelector('.prompt button')?.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('.stairs')?.getAttribute('aria-label')).toContain('Read: Long-term.');
    expect(root.querySelector('.stairs')?.getAttribute('aria-label')).toContain('Recall: Just met, asked now.');
    expect(root.querySelector('.asked-label')?.textContent).toBe('asked now');
    expect(root.querySelector('.tag.asked')).not.toBeNull();
    // Still turned once answered, as nothing on it changed.
    root.querySelector<HTMLButtonElement>('.choice')!.click();
    expect(back(root).hidden).toBe(false);
    back(root).click();
    expect(back(root).hidden).toBe(true);
    back(root).click();
    button(root, 'Next').click();
    expect(back(root).hidden).toBe(true);
  });

  it("doesn't turn for a tap on one of the card's own controls", () => {
    const app = learner(true);
    const root = (last = practiceScreen(app, noMic));
    document.body.replaceChildren(root);
    drillScope(root, ['read']);
    root.querySelector<HTMLButtonElement>('.prompt .audio-btn')!.click();
    expect(back(root).hidden).toBe(true);
  });

  it('draws the way asked from its own schedule, with how often Study asked it and the drills helped', () => {
    const app = learner(true);
    Object.assign(app.progress.cards['salamat:recall'], { interval: 30, due: app.now() + 30 * DAY_MS, reviews: 6, lapses: 1 });
    app.progress.cards.salamat.help = { recall: 2 };
    const root = (last = recall(app));
    card(root).click();
    expect(root.querySelector('.stairs')?.getAttribute('aria-label')).toContain('Recall: Long-term, the drills helped twice lately, asked now.');
    expect(root.querySelector('.back-help')?.textContent).toBe('Lately the drills had to help with Recall twice.');
    expect([...root.querySelectorAll('.count-n')].map((n) => n.textContent)).toEqual(['6', '1', '0']);
    expect(root.querySelector('.slope')?.getAttribute('aria-label')).toContain('Study asks in 1mo');
    expect(root.querySelector('.skyline .building.s-long')).not.toBeNull();
    expect(root.querySelector('.hero-way')?.textContent).toBe('Recall');
    expect(root.querySelector('.hero-text')?.textContent).toContain('Study asks it again in 1mo.');
    expect([...root.querySelectorAll('.skyline .tick')].map((n) => n.textContent)).toEqual(['1d', '1w', '1mo']);
  });

  it("draws a way only copied from reading's schedule from reading, and says so", () => {
    const app = learner(true);
    Object.assign(app.progress.cards['salamat:recall'], { split: true, lapses: 2, reps: 3 });
    const root = (last = recall(app));
    card(root).click();
    expect(root.querySelector('.back-note')?.textContent).toBe('Study hasn’t asked Recall yet, so these are Read’s numbers.');
    expect([...root.querySelectorAll('.count-n')].map((n) => n.textContent)[1]).toBe('0');
  });

  it("draws a way Study hasn't asked yet from reading, and says so", () => {
    const root = (last = recall(learner(false)));
    card(root).click();
    expect(root.querySelector('.stairs')?.getAttribute('aria-label')).toContain('Recall: not started yet, asked now.');
    expect(root.querySelector('.hero-way')?.textContent).toBe('Read');
    expect(root.querySelector('.back-note')?.textContent).toBe('Study hasn’t asked Recall yet, so these are Read’s numbers.');
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
    expect(judge).toHaveBeenCalledWith('thank you', expect.objectContaining<Partial<Card>>({ id: 'salamat' }), 'tl', true);
  });

  it('checks other wording with OpenAI, as Tagalog', async () => {
    const judge = vi.fn<MeaningJudge>(async () => true);
    const root = (last = recall(learner(true), judge));
    type(root, 'salamat sa iyo');
    await flush();
    expect(judge).toHaveBeenCalledWith('salamat sa iyo', expect.objectContaining<Partial<Card>>({ id: 'salamat' }), 'tl', true);
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
  });

  it('turns a misspelling down, says to check the spelling, and offers no "I had it right"', async () => {
    const judge = vi.fn<MeaningJudge>(async () => true);
    const root = (last = recall(learner(true), judge));
    type(root, 'salamt');
    await flush();
    expect(root.querySelector('.feedback')?.textContent).toContain('Mali.');
    expect(root.querySelector('.feedback')?.textContent).toContain('Nearly: check the spelling.');
    expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'I had it right')).toBe(false);
    expect(judge).not.toHaveBeenCalled();
  });

  it('offers the choices instead, in Tagalog', () => {
    const root = (last = recall(learner(true)));
    button(root, 'Show choices').click();
    const choices = [...root.querySelectorAll('.choice')];
    expect(choices).toHaveLength(4);
    expect(choices.some((c) => c.textContent?.includes('Salamat'))).toBe(true);
  });

  it('has no microphone without a key or the pronunciation model', () => {
    const deps = { recordingSupported: () => true, modelDownloaded: async () => false, record: vi.fn() } as unknown as SpeakDeps;
    const root = (last = recall(learner(true), null, deps, null));
    expect(box(root)).not.toBeNull();
    expect(root.querySelector('.meaning-mic')).toBeNull();
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

  it('needs no OpenAI key: a right answer passes on the device', async () => {
    const { deps } = onDevice(['s', 'a', 'l', 'a', 'm', 'a', 't']);
    const root = (last = recall(learner(true), null, deps, null));
    await say(root);
    expect(root.querySelector('.feedback')?.textContent).toContain('Tama!');
  });

  it("without a key, says to try again or type it when the device doesn't pass it, rather than marking it wrong", async () => {
    const { deps } = onDevice(['b', 'u', 'k', 'a', 's']);
    const root = (last = recall(learner(true), null, deps, null));
    await say(root);
    expect(root.querySelector('.feedback')).toBeNull();
    expect(root.querySelector('.meaning-status')?.textContent).toBe("That didn't sound like it. Tap the microphone and try again, or type it.");
    expect(box(root)).not.toBeNull();
    expect(root.querySelector('.meaning-mic')).not.toBeNull();
  });

  it("without a key, says it couldn't be checked once the phone has cleared the model, and drops the mic", async () => {
    const { deps } = onDevice(['s', 'a', 'l', 'a', 'm', 'a', 't']);
    const root = (last = recall(learner(true), null, deps, null));
    (deps as { modelDownloaded: () => Promise<boolean> }).modelDownloaded = async () => false;
    await say(root);
    expect(root.querySelector('.feedback')).toBeNull();
    expect(root.querySelector('.meaning-status')?.textContent).toBe("Couldn't check it on this phone. Type it instead.");
    expect(root.querySelector('.meaning-mic')).toBeNull();
    expect(box(root)).not.toBeNull();
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

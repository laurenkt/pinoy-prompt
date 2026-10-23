// @vitest-environment happy-dom
// The Speak question, played through with a stand-in microphone and model.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCard } from '../deck';
import type { PhoneModel } from '../phone-model';
import { RecordError, type RecorderEvents, type Take } from '../recorder';
import { compare, toPhones } from '../phonetics';
import { isRight, speakPanel, type SpeakDeps, type SpeakPanel } from './speak';
import { DownloadError } from '../model-cache';
import { FakePlayer, fakeRecognition } from '../test/fake-speech';
import { flush } from '../test/screen';

/** A scriptable microphone: the test decides what it hears and when it stops. */
class FakeMic {
  events: RecorderEvents = {};
  finish: (take: Take) => void = () => {};
  fail: (err: unknown) => void = () => {};
  stopped = false;
  cancelled = false;
  record = (events: RecorderEvents = {}) => {
    this.events = events;
    this.stopped = false;
    const audio = new Promise<Take>((resolve, reject) => {
      this.finish = resolve;
      this.fail = reject;
    });
    return {
      audio,
      stop: () => {
        this.stopped = true;
        this.finish({ samples: new Float32Array(16000), speech: true });
      },
      cancel: () => {
        this.cancelled = true;
      },
    };
  };
}

let mic: FakeMic;
let heard: string[];
let downloaded: boolean;
let loadModel: ReturnType<typeof vi.fn<SpeakDeps['loadPhoneModel']>>;
let panel: SpeakPanel;
let player: FakePlayer;
const onAttempt = vi.fn();
const onNext = vi.fn();
const say = vi.fn();

function deps(overrides: Partial<SpeakDeps> = {}): SpeakDeps {
  const model: PhoneModel = { recognise: async () => fakeRecognition(heard) };
  loadModel = vi.fn<SpeakDeps['loadPhoneModel']>(async (onProgress) => {
    onProgress?.(0.5);
    onProgress?.(1);
    return model;
  });
  return {
    recordingSupported: () => true,
    record: mic.record as unknown as SpeakDeps['record'],
    modelDownloaded: async () => downloaded,
    loadPhoneModel: loadModel,
    player: () => player,
    ...overrides,
  };
}

const text = (selector: string) => panel.el.querySelector(selector)?.textContent ?? '';
function button(name: string): HTMLButtonElement {
  const match = [...panel.el.querySelectorAll('button')].find((b) => b.textContent?.trim().endsWith(name));
  if (!match) throw new Error(`No button "${name}" in: ${panel.el.textContent}`);
  return match;
}

async function open(cardId: string, overrides?: Partial<SpeakDeps>): Promise<void> {
  panel = speakPanel(getCard(cardId)!, { say, silence: () => {}, onAttempt, onNext, deps: deps(overrides) });
  document.body.replaceChildren(panel.el);
  await flush();
}

beforeEach(() => {
  mic = new FakeMic();
  player = new FakePlayer();
  heard = [];
  downloaded = true;
  vi.clearAllMocks();
});

afterEach(() => panel?.dispose());

describe('first use', () => {
  it('asks before downloading the model, then downloads it', async () => {
    downloaded = false;
    await open('salamat');
    expect(panel.el.textContent).toContain('71 MB');
    expect(loadModel).not.toHaveBeenCalled();
    loadModel.mockImplementationOnce(() => new Promise(() => {}));
    button('Download').click();
    expect(text('.listen-status')).toBe('Downloading… 0%');
    panel.dispose();
    await open('salamat');
    button('Download').click();
    await flush();
    expect(loadModel).toHaveBeenCalled();
    expect(button('Tap and speak')).toBeTruthy();
  });

  it("doesn't say it's downloading while loading a model already on the device", async () => {
    let loaded: (model: PhoneModel) => void = () => {};
    await open('salamat', { loadPhoneModel: () => new Promise((resolve) => (loaded = resolve)) });
    expect(text('.listen-status')).toBe('Getting ready…');
    expect(panel.el.querySelector('.download-bar')).toBeNull();
    loaded({ recognise: async () => fakeRecognition(heard) });
    await flush();
    expect(button('Tap and speak')).toBeTruthy();
  });

  it('shows the download once one starts, even for a model it thought was kept', async () => {
    let progress: (fraction: number) => void = () => {};
    await open('salamat', { loadPhoneModel: (onProgress) => ((progress = onProgress!), new Promise(() => {})) });
    progress(0.25);
    expect(text('.listen-status')).toBe('Downloading… 25%');
    progress(0.5);
    expect(text('.listen-status')).toBe('Downloading… 50%');
    expect(panel.el.querySelector<HTMLElement>('.bar-fill')!.style.width).toBe('50%');
  });

  it('lets the learner skip the download', async () => {
    downloaded = false;
    await open('salamat');
    button('Not now').click();
    expect(onNext).toHaveBeenCalled();
  });

  it('explains a failed download and offers to retry', async () => {
    await open('salamat', { loadPhoneModel: async () => Promise.reject(new DownloadError('Model download failed: TypeError: Load failed')) });
    expect(text('.feedback')).toContain("Couldn't download");
    expect(text('.problem-detail')).toContain('Load failed');
    expect(button('Try again')).toBeTruthy();
  });

  it('blames the connection for anything that fails while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await open('salamat', { loadPhoneModel: async () => Promise.reject(new TypeError('Importing a module script failed.')) });
    expect(text('.feedback')).toContain("Couldn't download");
    vi.restoreAllMocks();
  });

  it("doesn't blame the connection when the model is there but won't start", async () => {
    await open('salamat', { loadPhoneModel: async () => Promise.reject(new RangeError('Out of memory')) });
    expect(text('.feedback')).toContain("Couldn't start");
    expect(text('.feedback')).not.toContain('connection');
    expect(text('.problem-detail')).toBe('Out of memory');
    expect(button('Try again')).toBeTruthy();
  });

  it("offers the download when it can't tell whether the model is there", async () => {
    await open('salamat', { modelDownloaded: async () => Promise.reject(new Error('chunk failed to load')) });
    expect(button('Download')).toBeTruthy();
  });

  it('tells the practice screen once speaking is ready', async () => {
    const onReady = vi.fn();
    panel = speakPanel(getCard('salamat')!, { say, silence: () => {}, onAttempt, onNext, onReady, deps: deps() });
    await flush();
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('says so when the browser has no microphone access at all', async () => {
    await open('salamat', { recordingSupported: () => false });
    expect(text('.feedback')).toContain("can't record");
  });
});

describe('an attempt', () => {
  it('shows the mic state and stops when the learner taps done', async () => {
    await open('salamat');
    button('Tap and speak').click();
    expect(text('.listen-status')).toBe('Mic on. Say it now.');
    expect(panel.mayPlay()).toBe(false);
    mic.events.onSpeech?.();
    expect(text('.listen-status')).toBe('Hearing you…');
    expect(panel.el.classList).toContain('phase-sound');
    mic.events.onLevel?.(0.8);
    expect(panel.el.querySelector<HTMLElement>('.meter span')!.style.height).not.toBe('');
    button("I'm done").click();
    expect(mic.stopped).toBe(true);
  });

  it('praises a clean attempt and counts it', async () => {
    heard = ['s', 'a', 'l', 'a', 'm', 'a', 't'];
    await open('salamat');
    button('Tap and speak').click();
    button("I'm done").click();
    await flush();
    expect(text('.feedback strong')).toBe('Tama!');
    expect(onAttempt).toHaveBeenCalledWith(true);
    expect(panel.el.querySelectorAll('.sound-off, .sound-missing')).toHaveLength(0);
  });

  it('marks the letters that were off and coaches on them', async () => {
    await open('ingat');
    heard = ['i', 'n', 'a', 't']; // "ng" said as "n"
    button('Tap and speak').click();
    button("I'm done").click();
    await flush();
    expect(onAttempt).toHaveBeenCalledWith(false);
    expect(panel.el.querySelector('.sound-off')?.textContent).toBe('ng');
    // The breakdown marks the ng and the n that was heard, and starts on it with its tip.
    expect(text('.mark-off .mark-target')).toBe('ŋ');
    expect(text('.mark-off .mark-heard')).toBe('n');
    expect(text('.sound-detail .detail-letters')).toBe('“ng”');
    expect(text('.sound-detail')).toContain('sing');
    // The whole word, yours and the target, at the bottom over the way on, not in the result card.
    expect(panel.el.classList).toContain('has-breakdown');
    expect(panel.el.querySelector('.result-card button')).toBeNull();
    const row = panel.el.querySelector('.word-actions')!;
    expect(row.nextElementSibling?.classList).toContain('result-actions');
    expect(row.previousElementSibling?.classList).toContain('sound-results');
    const wordButton = (label: string) => [...row.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!;
    wordButton('▶ Yours').click();
    expect(player.calls.at(-1)).toMatchObject({ kind: 'slice' });
    wordButton('▶ Target').click();
    expect(say).toHaveBeenLastCalledWith();
    wordButton('Target, slowly').click();
    expect(say).toHaveBeenLastCalledWith(true);
    // Another go, or move on.
    expect(button('Try again')).toBeTruthy();
    button('Next word').click();
    expect(onNext).toHaveBeenCalled();
  });

  it('accepts another standard pronunciation of the card', async () => {
    heard = ['k', 'a', 'm', 'u', 's', 't', 'a'];
    await open('kumusta');
    button('Tap and speak').click();
    button("I'm done").click();
    await flush();
    expect(text('.feedback strong')).toBe('Tama!');
    expect(text('.letters')).toBe('Kamusta?');
  });

  it("says it didn't catch anything when there was no speech", async () => {
    await open('salamat');
    button('Tap and speak').click();
    mic.finish({ samples: new Float32Array(0), speech: false });
    await flush();
    expect(text('.feedback strong')).toBe("Didn't catch that.");
    expect(onAttempt).not.toHaveBeenCalled();
  });

  it('explains a blocked microphone', async () => {
    await open('salamat');
    button('Tap and speak').click();
    mic.fail(new RecordError('denied'));
    await flush();
    expect(text('.feedback')).toContain('microphone is blocked');
  });

  it("tells a microphone that gave no sound at all from one that didn't hear speech, and records again on Try again", async () => {
    await open('salamat');
    button('Tap and speak').click();
    mic.fail(new RecordError('silent'));
    await flush();
    expect(text('.feedback')).toContain("didn't pick up any sound");
    expect(text('.feedback strong')).not.toBe("Didn't catch that.");
    button('Try again').click();
    expect(panel.el.textContent).toContain("I'm done");
  });

  it("lets the card's audio play only once an attempt has been judged", async () => {
    heard = ['s', 'a', 'm', 'a', 't'];
    await open('salamat');
    expect(panel.mayPlay()).toBe(false);
    // Nor does the sounds-like spelling show yet.
    expect(panel.el.querySelector('.hint')).toBeNull();
    button('Tap and speak').click();
    mic.finish({ samples: new Float32Array(0), speech: false });
    await flush();
    // Nothing heard isn't an attempt, so it offers nothing to listen to either.
    expect(panel.mayPlay()).toBe(false);
    expect(panel.el.textContent).not.toContain('Hear it slowly');
    button('Try again').click();
    button("I'm done").click();
    await flush();
    expect(panel.mayPlay()).toBe(true);
    button('Try again').click();
    expect(text('.hint')).toContain(getCard('salamat')!.hint!);
  });

  it('stops recording when the question goes away', async () => {
    await open('salamat');
    button('Tap and speak').click();
    panel.dispose();
    expect(mic.cancelled).toBe(true);
  });
});

describe('what counts as right', () => {
  /** The sounds of `tl` said cleanly, then with the sounds at `drop` left out. */
  function saidWithout(tl: string, drop: number[]) {
    const phones = toPhones(tl);
    const heard = phones.filter((p) => !p.optional).map((p) => p.ipa).filter((_, i) => !drop.includes(i));
    return compare(phones, heard);
  }

  it('passes a long phrase with one sound slipping, as a listener would still get it', () => {
    const one = saidWithout('Hindi ko maintindihan.', [4]);
    expect(one.score).toBeGreaterThan(0.9);
    expect(one.sounds.some((s) => s.verdict === 'missing')).toBe(true);
    expect(isRight(one)).toBe(true);
  });

  it('fails a long phrase with several sounds missing', () => {
    expect(isRight(saidWithout('Hindi ko maintindihan.', [1, 5, 9, 13]))).toBe(false);
  });

  it('fails a short word with one sound missing, as that can make another word', () => {
    expect(isRight(saidWithout('Salamat', [2]))).toBe(false);
  });
});

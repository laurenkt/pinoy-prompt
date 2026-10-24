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
  it('says to wait until the microphone gives sound, then plainly that it is listening, and stops when the learner taps done', async () => {
    await open('salamat');
    button('Tap and speak').click();
    // Getting ready: nothing said yet would be recorded, so it doesn't ask for it, and there's nothing to stop.
    expect(text('.listen-status')).toBe('Getting the mic ready…');
    expect(panel.el.classList).toContain('phase-starting');
    expect(panel.el.classList).not.toContain('live');
    expect(button('Wait…').disabled).toBe(true);
    expect(button('Cancel').disabled).toBe(false);
    expect(panel.mayPlay()).toBe(false);
    mic.events.onRestart?.();
    expect(text('.listen-status')).toBe('Still getting the mic ready…');
    mic.events.onListening?.();
    expect(text('.listen-status')).toBe('Listening. Say it now!');
    expect(panel.el.classList).toContain('live');
    expect(panel.el.classList).toContain('phase-mic-on');
    expect(document.activeElement).toBe(button("I'm done"));
    mic.events.onSpeech?.();
    expect(text('.listen-status')).toBe('Hearing you…');
    expect(panel.el.classList).toContain('phase-sound');
    mic.events.onLevel?.(0.8, true, [0.8, 0.8, 0.8, 0.8]);
    expect(panel.el.querySelector<HTMLElement>('.meter span')!.style.height).not.toBe('');
    button("I'm done").click();
    expect(mic.stopped).toBe(true);
  });

  it('counts speech as the microphone giving sound, should it come first', async () => {
    await open('salamat');
    button('Tap and speak').click();
    mic.events.onSpeech?.();
    expect(text('.listen-status')).toBe('Hearing you…');
    expect(panel.el.classList).toContain('live');
    expect(panel.el.classList).toContain('phase-sound');
    mic.events.onListening?.();
    expect(text('.listen-status')).toBe('Hearing you…');
    expect(panel.el.classList).toContain('phase-sound');
  });

  it('leaves focus where the learner put it while the mic got ready', async () => {
    await open('salamat');
    button('Tap and speak').click();
    button('Cancel').focus();
    mic.events.onListening?.();
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('praises a clean attempt and counts it', async () => {
    heard = ['s', 'a', 'l', 'a', 'm', 'a', 't'];
    await open('salamat');
    button('Tap and speak').click();
    mic.events.onListening?.();
    button("I'm done").click();
    await flush();
    expect(text('.feedback strong')).toBe('Tama!');
    expect(onAttempt).toHaveBeenCalledWith(true);
    expect(panel.el.querySelectorAll('.sound-off, .sound-missing')).toHaveLength(0);
    // A full ring holds a check, not "100%", which doesn't fit inside it.
    const dial = panel.el.querySelector('.dial')!;
    expect(dial.getAttribute('aria-label')).toBe('100% of the way there');
    expect(dial.querySelector('span .icon')).not.toBeNull();
    expect(dial.querySelector('span')!.textContent).toBe('');
  });

  it('says which syllable to lean on, apart from the score, when the attempt clearly leaned on the other', async () => {
    heard = ['s', 'a', 'l', 'a', 'm', 'a', 't'];
    // Every sound right, but the last "a" the longest, highest and loudest: "sa-la-MAT".
    const vowel = (length: number, pitch: number, level: number) => ({ length, pitch, level });
    const consonant = vowel(0.06, 0, -30);
    const prosody = [consonant, vowel(0.08, 200, -14), consonant, vowel(0.08, 190, -16), consonant, vowel(0.17, 270, -11), consonant];
    await open('salamat', { loadPhoneModel: async () => ({ recognise: async () => fakeRecognition(heard, prosody) }) });
    button('Tap and speak').click();
    mic.events.onListening?.();
    button("I'm done").click();
    await flush();
    expect(text('.feedback strong')).toBe('Tama!');
    expect(onAttempt).toHaveBeenCalledWith(true);
    expect(panel.el.querySelector('.dial')!.getAttribute('aria-label')).toBe('100% of the way there');
    expect(text('.result-card .stress-tip')).toBe('Lean on LAH, not MAHT: higher and longer.');
  });

  it("doesn't mention stress when it can't tell", async () => {
    heard = ['s', 'a', 'l', 'a', 'm', 'a', 't'];
    await open('salamat');
    button('Tap and speak').click();
    mic.events.onListening?.();
    button("I'm done").click();
    await flush();
    expect(panel.el.querySelector('.stress-tip')).toBeNull();
  });

  it('marks the letters that were off and coaches on them', async () => {
    await open('ingat');
    heard = ['i', 'n', 'a', 't']; // "ng" said as "n"
    button('Tap and speak').click();
    mic.events.onListening?.();
    button("I'm done").click();
    await flush();
    expect(onAttempt).toHaveBeenCalledWith(false);
    expect(panel.el.querySelector('.sound-off')?.textContent).toBe('ng');
    expect(panel.el.querySelector('.dial span')!.textContent).toMatch(/^\d{1,2}%$/);
    expect(panel.el.querySelector('.dial .icon')).toBeNull();
    // The breakdown marks the ng and the n that was heard, and starts on it with its tip.
    expect(text('.mark-off .mark-target')).toBe('ŋ');
    expect(text('.mark-off .mark-heard')).toBe('n');
    expect(text('.detail-page.open .detail-letters')).toBe('“ng”');
    expect(text('.detail-page.open')).toContain('sing');
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
    mic.events.onListening?.();
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
    expect(panel.el.classList).toContain('recording');
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
    mic.events.onListening?.();
    button("I'm done").click();
    await flush();
    expect(panel.mayPlay()).toBe(true);
    button('Try again').click();
    expect(text('.hint')).toContain(getCard('salamat')!.hint!);
  });

  it('throws a take away on Cancel, without counting it, and listens again on the next tap', async () => {
    heard = ['s', 'a', 'l', 'a', 'm', 'a', 't'];
    await open('salamat');
    expect(button('Cancel').disabled).toBe(true);
    button('Tap and speak').click();
    mic.events.onSpeech?.();
    button('Cancel').click();
    expect(mic.cancelled).toBe(true);
    expect(panel.el.classList).toContain('ready');
    // Whatever the cancelled take gives back is ignored.
    mic.finish({ samples: new Float32Array(16000), speech: true });
    await flush();
    expect(onAttempt).not.toHaveBeenCalled();
    expect(panel.el.classList).toContain('ready');
    button('Tap and speak').click();
    expect(text('.listen-status')).toBe('Getting the mic ready…');
    mic.events.onListening?.();
    button("I'm done").click();
    await flush();
    expect(onAttempt).toHaveBeenCalledOnce();
    expect(onAttempt).toHaveBeenCalledWith(true);
  });

  it('stops recording when the question goes away', async () => {
    await open('salamat');
    button('Tap and speak').click();
    panel.dispose();
    expect(mic.cancelled).toBe(true);
  });
});

describe('warming the microphone up', () => {
  /** A stand-in warm-up that counts how many are running. */
  function warmth() {
    const w = { running: 0, started: 0 };
    const warmRecorder = () => {
      w.running++;
      w.started++;
      let cooled = false;
      return {
        get warm() {
          return !cooled;
        },
        cool: () => {
          if (!cooled) w.running--;
          cooled = true;
        },
      };
    };
    return { w, warmRecorder };
  }

  it('starts as the question comes up, when the model is on the device, so the tap that brought it is the gesture', async () => {
    const { w, warmRecorder } = warmth();
    panel = speakPanel(getCard('salamat')!, { say, silence: () => {}, onAttempt, onNext, deps: deps({ warmRecorder, modelKnownDownloaded: () => true }) });
    expect(w.running).toBe(1);
    await flush();
    expect(w.started).toBe(1);
  });

  it('waits for the model otherwise, and stops for the result, coming back after Cancel', async () => {
    heard = ['s', 'a', 'l', 'a', 'm', 'a', 't'];
    const { w, warmRecorder } = warmth();
    await open('salamat', { warmRecorder });
    expect(w.running).toBe(1);
    button('Tap and speak').click();
    // The take adopted it.
    expect(w.running).toBe(0);
    button('Cancel').click();
    expect(w.running).toBe(1);
    button('Tap and speak').click();
    mic.events.onListening?.();
    button("I'm done").click();
    await flush();
    expect(text('.feedback strong')).toBe('Tama!');
    expect(w.running).toBe(0);
  });

  it('stops when it may not warm (the mic going off), and when the question goes', async () => {
    const { w, warmRecorder } = warmth();
    await open('salamat', { warmRecorder });
    panel.setWarm(false);
    expect(w.running).toBe(0);
    panel.setWarm(true);
    expect(w.running).toBe(1);
    panel.dispose();
    expect(w.running).toBe(0);
  });

  it('tries again once ready if there was nothing to warm as it came up (the microphone still opening)', async () => {
    const { w, warmRecorder } = warmth();
    let open = false;
    const later = () => (open ? warmRecorder() : null);
    panel = speakPanel(getCard('salamat')!, { say, silence: () => {}, onAttempt, onNext, deps: deps({ warmRecorder: later, modelKnownDownloaded: () => true }) });
    expect(w.running).toBe(0);
    open = true;
    await flush();
    expect(panel.el.classList).toContain('ready');
    expect(w.running).toBe(1);
  });

  it("doesn't warm while offering the download", async () => {
    downloaded = false;
    const { w, warmRecorder } = warmth();
    await open('salamat', { warmRecorder });
    expect(text('strong')).toBe('Pronunciation coaching');
    expect(w.started).toBe(0);
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

// @vitest-environment happy-dom
// The Speak question, played through with a stand-in microphone and model.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCard } from '../deck';
import type { PhoneModel } from '../phone-model';
import { RecordError, type RecorderEvents, type Take } from '../recorder';
import { speakPanel, type SpeakDeps, type SpeakPanel } from './speak';
import { FakePlayer, fakeRecognition } from '../test/fake-speech';

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

const flush = () => new Promise((r) => setTimeout(r, 0));
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
    button('Download').click();
    await flush();
    expect(loadModel).toHaveBeenCalled();
    expect(button('Tap and speak')).toBeTruthy();
  });

  it('lets the learner skip the download', async () => {
    downloaded = false;
    await open('salamat');
    button('Not now').click();
    expect(onNext).toHaveBeenCalled();
  });

  it('explains a failed download and offers to retry', async () => {
    await open('salamat', { loadPhoneModel: async () => Promise.reject(new Error('offline')) });
    expect(text('.feedback')).toContain("Couldn't download");
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
    expect(panel.recording()).toBe(true);
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
    expect(text('.tips')).toContain('sing');
    // The breakdown pairs the ng with the n that was heard, and starts on it.
    expect(text('.pair-off .tile-target .tile-ipa')).toBe('ŋ');
    expect(text('.pair-off .tile-heard')).toBe('n');
    expect(text('.sound-detail .detail-letters')).toBe('“ng”');
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

  it('stops recording when the question goes away', async () => {
    await open('salamat');
    button('Tap and speak').click();
    panel.dispose();
    expect(mic.cancelled).toBe(true);
  });
});

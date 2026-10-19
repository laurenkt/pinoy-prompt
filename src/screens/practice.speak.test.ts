// @vitest-environment happy-dom
// The Speak practice mode, played through with a scripted recogniser.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../app';
import { NO_START_MS, STOP_GRACE_MS } from '../listen';
import { emptyProgress, recordAnswer } from '../store';
import { FakeRecognition } from '../test/fake-recognition';

const KNOWN = ['salamat', 'kumusta', 'tatlo', 'paalam', 'oo', 'kape'];

function fakeApp(): App {
  const now = Date.now();
  const progress = emptyProgress(now);
  progress.settings.autoplay = false;
  for (const id of KNOWN) recordAnswer(progress, id, 'good', now);
  return {
    progress,
    now: () => now,
    commit: () => {},
    replaceProgress: () => {},
    navigate: () => {},
    onKey: () => {},
  };
}

function button(name: string | RegExp): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')].find((b) =>
    typeof name === 'string' ? b.textContent?.trim().startsWith(name) : name.test(b.textContent ?? ''),
  );
  if (!match) throw new Error(`No button "${name}" in: ${document.body.textContent}`);
  return match;
}

const text = (selector: string) => document.querySelector(selector)?.textContent ?? '';
const flush = () => vi.advanceTimersByTimeAsync(0);

/** Open Speak mode and tap the microphone; returns the card's Tagalog text. */
async function startSpeaking(): Promise<string> {
  button('Speak').click();
  const tagalog = text('.prompt .tl');
  button('Tap and speak').click();
  await flush();
  return tagalog;
}

let uninstall: () => void;
let getUserMedia: ReturnType<typeof vi.fn>;
let micTrackStop: ReturnType<typeof vi.fn>;

/**
 * Stand in for the browser's microphone permission: granted, refused with a
 * DOMException name, or 'pending' for a prompt the learner never answers.
 */
function fakeMicrophone(refuse?: string): void {
  micTrackStop = vi.fn();
  getUserMedia = vi.fn(async () => {
    if (refuse === 'pending') return new Promise(() => {});
    if (refuse) throw new DOMException('refused', refuse);
    return { getTracks: () => [{ stop: micTrackStop }] };
  });
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
}

/** Install the recogniser, then draw the Practice screen (which checks for it). */
async function setUp(options?: Parameters<typeof FakeRecognition.install>[0], refuseMic?: string): Promise<void> {
  vi.useFakeTimers();
  fakeMicrophone(refuseMic);
  uninstall = FakeRecognition.install(options);
  // Fresh modules, so one test's "no Filipino here" doesn't carry into the next.
  vi.resetModules();
  const { practiceScreen } = await import('./practice');
  document.body.replaceChildren(practiceScreen(fakeApp()));
}

afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

describe('Speak mode with a recogniser that behaves like Chrome', () => {
  beforeEach(() => setUp());

  it('asks for the microphone, then listens in Filipino', async () => {
    await startSpeaking();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    // The permission check's own stream is let go, so the recogniser can open the mic.
    expect(micTrackStop).toHaveBeenCalled();
    expect(FakeRecognition.latest.lang).toBe('fil-PH');
    expect(FakeRecognition.latest.started).toBe(true);
  });

  it('says so when the recogniser never starts', async () => {
    await startSpeaking();
    await vi.advanceTimersByTimeAsync(NO_START_MS);
    expect(text('.feedback')).toContain("speech recogniser didn't start");
    expect(button('Try again')).toBeTruthy();
  });

  it('shows whether the mic is open and hearing sound', async () => {
    await startSpeaking();
    const view = () => document.querySelector('.speak')!;
    expect(text('.listen-status')).toBe('Waiting for the microphone…');

    FakeRecognition.latest.audioStart();
    expect(text('.listen-status')).toBe('Mic on. Say it now.');
    expect(view().classList).toContain('phase-mic-on');

    FakeRecognition.latest.soundStart();
    expect(text('.listen-status')).toBe('Hearing you…');
    expect(view().classList).toContain('phase-sound');

    FakeRecognition.latest.results(['sala'], false);
    expect(text('.hearing')).toBe('sala');

    FakeRecognition.latest.soundEnd();
    expect(view().classList).toContain('phase-mic-on');
  });

  it('treats a transcript as hearing sound, for recognisers that skip the sound events', async () => {
    await startSpeaking();
    FakeRecognition.latest.results(['sala'], false);
    expect(text('.listen-status')).toBe('Hearing you…');
  });

  it("judges what was heard when the learner taps I'm done", async () => {
    const tagalog = await startSpeaking();
    FakeRecognition.latest.audioStart();
    FakeRecognition.latest.results([tagalog.toLowerCase()], false);
    button("I'm done").click();
    await flush();
    expect(text('.feedback strong')).toBe('Tama!');
    expect(text('.session-title')).toBe('1 right');
  });

  it('marks a wrong attempt and offers another go', async () => {
    await startSpeaking();
    FakeRecognition.latest.results(['magandang hapon po'], true);
    FakeRecognition.latest.end();
    await flush();
    expect(text('.feedback strong')).not.toBe('Tama!');
    expect(text('.heard')).toContain('magandang hapon po');
    expect(document.querySelector('.mark.miss')).not.toBeNull();
    button(/Try again/).click();
    await flush();
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(text('.listen-status')).toBe('Waiting for the microphone…');
  });

  it('stops by itself a while after the mic opens', async () => {
    await startSpeaking();
    FakeRecognition.latest.audioStart();
    await vi.advanceTimersByTimeAsync(8000);
    expect(FakeRecognition.latest.ended).toBe(true);
    expect(text('.feedback strong')).toBe("Didn't catch that.");
  });

  it('explains a microphone the recogniser was refused', async () => {
    await startSpeaking();
    FakeRecognition.latest.error('not-allowed');
    FakeRecognition.latest.end();
    await flush();
    expect(text('.feedback')).toContain('microphone is blocked');
  });

  it("turns Speak off when the recogniser doesn't know Filipino", async () => {
    await startSpeaking();
    FakeRecognition.latest.error('language-not-supported');
    FakeRecognition.latest.end();
    await flush();
    expect(text('.feedback')).toContain("can't recognise Filipino");
    button('Skip').click();
    // Later speaking questions say so straight away instead of opening the mic.
    expect(text('.feedback')).toContain("can't recognise Filipino");
  });
});

describe('Speak mode when the microphone is refused', () => {
  beforeEach(() => setUp({}, 'NotAllowedError'));

  it("explains it and doesn't start the recogniser", async () => {
    await startSpeaking();
    expect(text('.feedback')).toContain('microphone is blocked');
    expect(FakeRecognition.instances).toHaveLength(0);
  });
});

describe('Speak mode while the microphone prompt is unanswered', () => {
  beforeEach(() => setUp({}, 'pending'));

  it("lets the learner stop with I'm done", async () => {
    await startSpeaking();
    expect(text('.listen-status')).toBe('Waiting for the microphone…');
    button("I'm done").click();
    await flush();
    expect(text('.feedback strong')).toBe("Didn't catch that.");
    expect(FakeRecognition.instances).toHaveLength(0);
  });
});

describe('Speak mode in an iPhone home-screen app', () => {
  beforeEach(async () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    await setUp();
  });

  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).standalone;
  });

  it('is shown as unavailable rather than failing silently', () => {
    expect(button('Speak').disabled).toBe(true);
    expect(button('Speak').textContent).toContain('iPhone home-screen');
  });
});

describe('Speak mode with a recogniser that never reports the end', () => {
  beforeEach(() => setUp({ endsOnStop: false }));

  it("still finishes when the learner taps I'm done", async () => {
    const tagalog = await startSpeaking();
    FakeRecognition.latest.audioStart();
    FakeRecognition.latest.results([tagalog.toLowerCase()], false);
    button("I'm done").click();
    await flush();
    expect(text('.listen-status')).toBe('Checking what we heard…');
    expect(button("I'm done").disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS);
    expect(text('.feedback strong')).toBe('Tama!');
  });

  it('still finishes if the learner never taps done', async () => {
    await startSpeaking();
    FakeRecognition.latest.audioStart();
    await vi.advanceTimersByTimeAsync(30000 + STOP_GRACE_MS);
    expect(text('.feedback strong')).toBe("Didn't catch that.");
  });
});

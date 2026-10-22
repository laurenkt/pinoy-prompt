// The app's one AudioContext, and the recorded clips it plays.
//
// Every recorded sound (card clips, reference sounds, slices of the learner's
// own recording) plays through this one context, so iOS sets up its audio
// hardware once rather than for each player. Starting a decoded buffer is all
// a tap has to do, which is why clips play straight away where the built-in
// voice can lag: that voice runs outside the page and can't be loaded ahead.
//
// iOS changes the hardware rate when the microphone opens or closes, and a
// context made before that can play distorted, so the context is replaced
// whenever the microphone has opened or closed since it was made. The recorder
// keeps its own for the same reason.

import { setAudioSession } from './audio-session';
import { microphoneOpen } from './microphone';

let context: AudioContext | null = null;
/** Whether the microphone was open when the context was made. */
let madeWithMicrophone = false;
/** When the context was last asked for, by performance.now(). */
let lastUsed = -Infinity;

function contextClass(): typeof AudioContext | undefined {
  const scope = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

/**
 * The shared context, resumed. Call it from inside a tap the first time, as iOS only starts audio then.
 * `incidental` is for the tap sound, which shouldn't count as the press having made a sound (audioBusy).
 */
export function audioContext(incidental = false): AudioContext {
  if (!incidental) lastUsed = performance.now();
  // Web Audio is muted by the iPhone's silent switch too, unless the session says it's playback (iOS 17+).
  const mic = microphoneOpen();
  if (!mic) setAudioSession('playback');
  // iOS leaves a context "interrupted" after a call, Siri or another app's audio, and it may never
  // resume from there; a new one made in the tap starts at once.
  const stuck = context && context.state !== 'running' && context.state !== 'suspended';
  if (context && (madeWithMicrophone !== mic || stuck)) closeContext();
  // Counted again from every use, and it waits for anything still playing.
  suspendWhenIdle();
  if (!context) {
    context = new (contextClass()!)({ latencyHint: 'interactive' });
    madeWithMicrophone = mic;
  }
  if (context.state !== 'running') void context.resume().catch(() => {});
  return context;
}

/**
 * A running context holds the phone's audio (it shows in the Dynamic Island,
 * and other apps' audio stays paused), so it's suspended once nothing has
 * played for a while. The next tap resumes it.
 */
export const IDLE_SUSPEND_MS = 30_000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
/** What's playing now, by the function that finishes it. */
const sounding = new Set<() => void>();

function suspendWhenIdle(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (sounding.size === 0 && context?.state === 'running') void context.suspend().catch(() => {});
  }, IDLE_SUSPEND_MS);
}

/** Close the shared context; the next use makes a fresh one. Decoded clips aren't tied to it, so they're kept. */
function closeContext(): void {
  if (!context) return;
  // A closed context never reports its sounds ended, so they're finished here.
  for (const finish of [...sounding]) finish();
  void context.close().catch(() => {});
  context = null;
}

// After the app has been in the background, iOS can hand back a context that says it's running
// but plays nothing, every other time. So it's closed when the app is hidden, and the first tap
// back makes a new one.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) closeContext();
  });
}

/** Whether something is playing through the shared context, or it was asked for within the last `withinMs` (a sound still loading). */
export function audioBusy(withinMs: number): boolean {
  return sounding.size > 0 || performance.now() - lastUsed < withinMs;
}

/** Whether the shared context can play now, waiting a moment for it to resume. */
export async function audioRunning(ctx: AudioContext, waitMs = 300): Promise<boolean> {
  if (ctx.state === 'running') return true;
  await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, waitMs))]);
  return (ctx.state as AudioContextState) === 'running';
}

/** Whether this browser can play clips at all. */
export function clipsSupported(): boolean {
  return contextClass() !== undefined;
}

/**
 * Decoded clips, most recently used last. A second of decoded audio is about
 * 200 KB, so only the clips in use are kept; the files themselves stay in the
 * browser's cache.
 */
const decoded = new Map<string, Promise<AudioBuffer>>();
export const KEEP_DECODED = 48;

/**
 * Clips are decoded offline, so loading ahead doesn't take the audio session
 * (which would pause the learner's music just for showing a card). A new one
 * each time, at the rate the shared context plays at now.
 */
function decoderContext(): BaseAudioContext {
  const scope = globalThis as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const Offline = scope.OfflineAudioContext ?? scope.webkitOfflineAudioContext;
  // Decoding plays nothing, so it doesn't count as the app making a sound (audioBusy).
  return Offline ? new Offline(1, 1, context?.sampleRate ?? 48000) : audioContext(true);
}

/** A clip decoded and ready to play. Decoding starts on the first call, so calling it early loads ahead. */
export function loadClip(url: string): Promise<AudioBuffer> {
  let buffer = decoded.get(url);
  if (buffer) {
    decoded.delete(url);
  } else {
    buffer = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((bytes) => decoderContext().decodeAudioData(bytes));
    buffer.catch(() => decoded.get(url) === buffer && decoded.delete(url));
  }
  decoded.set(url, buffer);
  while (decoded.size > KEEP_DECODED) decoded.delete(decoded.keys().next().value!);
  return buffer;
}

/** Fade in and out over a few milliseconds, so clips and slices don't click. */
const FADE = 0.012;

export interface Sound {
  /** When it starts, in the context's time. */
  startsAt: number;
  /** Resolves when it finishes or is stopped. */
  done: Promise<void>;
  stop(): void;
}

export interface PlayOptions {
  /** Playback rate. */
  rate?: number;
  /** Start no earlier than this, in the context's time. */
  at?: number;
  /** Short fades in and out, so clips and slices don't click. A tap sound starts and ends at silence, and needs its sharp attack. */
  fades?: boolean;
  /** A tap sound: it doesn't make the context busy (audioBusy), so taps in quick succession each get one. */
  incidental?: boolean;
}

/** Play a buffer now, or no earlier than `at`. */
export function playBuffer(buffer: AudioBuffer, { rate = 1, at = 0, fades = true, incidental = false }: PlayOptions = {}): Sound {
  const ctx = audioContext(incidental);
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(gain).connect(ctx.destination);
  // A few ms ahead, so the fade-in is scheduled before the first sample.
  const t0 = Math.max(ctx.currentTime + 0.005, at);
  const length = buffer.duration / rate;
  if (fades) {
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(1, t0 + Math.min(FADE, length / 4));
    gain.gain.setValueAtTime(1, t0 + Math.max(length - FADE, length * 0.75));
    gain.gain.linearRampToValueAtTime(0, t0 + length);
  }
  source.start(t0);
  let finish = () => {};
  const done = new Promise<void>((resolve) => (finish = resolve));
  if (!incidental) sounding.add(finish);
  void done.then(() => {
    sounding.delete(finish);
    suspendWhenIdle();
  });
  source.onended = () => finish();
  return {
    startsAt: t0,
    done,
    stop() {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      finish();
    },
  };
}

/** How long after now a sound started at `at` (context time) reaches the speaker, in ms. */
export function msUntilHeard(at: number): number {
  const ctx = audioContext();
  const output = ctx.outputLatency || ctx.baseLatency || 0;
  return Math.max(0, (at - ctx.currentTime + output) * 1000);
}

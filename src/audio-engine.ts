// The app's one AudioContext, and the recorded clips it plays.
//
// Every recorded sound (card clips, reference sounds, slices of the learner's
// own recording) plays through this one context, so iOS sets up its audio
// hardware once rather than for each player. Starting a decoded buffer is all
// a tap has to do, which is why clips play straight away where the built-in
// voice can lag: that voice runs outside the page and can't be loaded ahead.
//
// The recorder keeps its own context: iOS changes the hardware rate when the
// microphone opens, and a context made before that can play distorted.

import { setAudioSession } from './audio-session';
import { microphoneOpen } from './microphone';

let context: AudioContext | null = null;

/** The shared context, resumed. Call it from inside a tap the first time, as iOS only starts audio then. */
export function audioContext(): AudioContext {
  // Web Audio is muted by the iPhone's silent switch too, unless the session says it's playback.
  if (!microphoneOpen()) setAudioSession('playback');
  context ??= new AudioContext({ latencyHint: 'interactive' });
  if (context.state !== 'running') void context.resume().catch(() => {});
  return context;
}

/** Whether this browser can play clips at all. */
export function clipsSupported(): boolean {
  return typeof AudioContext !== 'undefined';
}

/**
 * Decoded clips, most recently used last. A second of decoded audio is about
 * 200 KB, so only the clips in use are kept; the files themselves stay in the
 * browser's cache.
 */
const decoded = new Map<string, Promise<AudioBuffer>>();
export const KEEP_DECODED = 48;

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
      .then((bytes) => audioContext().decodeAudioData(bytes));
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

/** Play a buffer now, with short fades. */
export function playBuffer(buffer: AudioBuffer, rate = 1): Sound {
  const ctx = audioContext();
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(gain).connect(ctx.destination);
  // A few ms ahead, so the fade-in is scheduled before the first sample.
  const t0 = ctx.currentTime + 0.005;
  const length = buffer.duration / rate;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(1, t0 + Math.min(FADE, length / 4));
  gain.gain.setValueAtTime(1, t0 + Math.max(length - FADE, length * 0.75));
  gain.gain.linearRampToValueAtTime(0, t0 + length);
  source.start(t0);
  let finish = () => {};
  const done = new Promise<void>((resolve) => (finish = resolve));
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

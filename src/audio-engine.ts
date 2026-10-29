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
// once the microphone has opened or closed since it was made. The recorder
// keeps its own for the same reason. A new context only starts inside a tap
// or while the microphone is open (WebKit's autoplay rule), so after the
// microphone closes the old one is kept until a tap can start its
// replacement: a word said back by itself straight after a take still plays.

import { setAudioSession } from './audio-session';
import { microphoneChanges, microphoneOpen } from './microphone';

let context: AudioContext | null = null;
/** The microphone's count of openings and closings when the context was made (microphoneChanges). */
let madeAt = 0;
/** When the context was last asked for, by performance.now(). */
let lastUsed = -Infinity;
/** Until when, in the context's time, the phone's output may still be starting up after the context was made or woken. */
let wokenUntil = 0;

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
  if (context && ((madeAt !== microphoneChanges() && (mic || inTap())) || stuck)) closeContext();
  // Counted again from every use, and it waits for anything still playing.
  suspendWhenIdle();
  if (!context) {
    context = new (contextClass()!)({ latencyHint: 'interactive' });
    madeAt = microphoneChanges();
    wokenUntil = WAKE_SECONDS;
  }
  if (context.state !== 'running') {
    // Its time stands still until it's running, so this is counted from when the output starts.
    wokenUntil = context.currentTime + WAKE_SECONDS;
    void context.resume().catch(() => {});
  }
  return context;
}

/** Whether the page is inside a tap's window to start audio. A browser that can't say (Safari before 16.4) keeps the context it has. */
function inTap(): boolean {
  return (globalThis.navigator as { userActivation?: { isActive: boolean } } | undefined)?.userActivation?.isActive ?? false;
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
/** A call is holding the context running (holdAudio). */
let held = false;

/**
 * Keep the shared context running for a call that plays sounds beside its voice (walk and talk), or let it go. On an
 * iPhone each suspend and resume restarts the phone's audio output under the call, which can make the call's voice
 * stutter, so a held context isn't suspended when idle. The call's microphone stays open throughout, so the context
 * isn't replaced either, as long as its first sound comes once the microphone is open.
 */
export function holdAudio(hold: boolean): void {
  held = hold;
  suspendWhenIdle();
}

function suspendWhenIdle(): void {
  clearTimeout(idleTimer);
  if (held) return;
  idleTimer = setTimeout(() => {
    if (sounding.size === 0 && context?.state === 'running') void context.suspend().catch(() => {});
  }, IDLE_SUSPEND_MS);
}

/** Let the phone's audio go now rather than once idle, if nothing is playing (a call that plays no sounds of its own). */
export function suspendAudio(): void {
  clearTimeout(idleTimer);
  if (sounding.size === 0 && context?.state === 'running') void context.suspend().catch(() => {});
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

/**
 * The shared context only if it's already running, for a sound from outside a tap (a drag): it doesn't
 * make, resume or keep awake the context, or touch the audio session.
 */
export function runningContext(): AudioContext | null {
  return context?.state === 'running' ? context : null;
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

/**
 * How long the phone's output takes to start once the context is made or woken (it's suspended after a while
 * idle, and closed when the app is hidden). A sound started straight away loses its first moment on an iPhone,
 * which took the k off "Kailan", so sounds wait this long after a wake. The tap sound doesn't: it's there to be heard
 * at once, and losing a moment of a click doesn't change it.
 */
export const WAKE_SECONDS = 0.12;

/** When a sound may start, in the context's time: a few ms ahead, so a fade-in is scheduled before its first sample, and after a wake. */
function startTime(ctx: AudioContext, at: number, incidental: boolean): number {
  return Math.max(ctx.currentTime + 0.005, at, incidental ? 0 : wokenUntil);
}

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
  const t0 = startTime(ctx, at, incidental);
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

/**
 * Play a sound made as it plays, from a graph of nodes rather than a buffer (a synthesized sound, held as long as a
 * finger is down). `make` builds it on the shared context to start at `t0`, and says how to stop its sources; it's
 * faded in and out like a clip, and counts as playing (audioBusy) until stopped.
 */
export function playLive(make: (ctx: AudioContext, t0: number) => { out: AudioNode; end(at: number): void }): Sound {
  const ctx = audioContext();
  const t0 = startTime(ctx, 0, false);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(1, t0 + FADE);
  gain.connect(ctx.destination);
  const { out, end } = make(ctx, t0);
  out.connect(gain);
  let finish = () => {};
  const done = new Promise<void>((resolve) => (finish = resolve));
  sounding.add(finish);
  void done.then(() => {
    sounding.delete(finish);
    suspendWhenIdle();
  });
  let stopped = false;
  return {
    startsAt: t0,
    done,
    stop() {
      if (stopped) return;
      stopped = true;
      const at = Math.max(ctx.currentTime, t0);
      gain.gain.cancelScheduledValues(at);
      // Stopped before it started (a finger moving on within a wake), it fades from silence rather than full.
      gain.gain.setValueAtTime(ctx.currentTime < t0 ? 0 : gain.gain.value, at);
      gain.gain.linearRampToValueAtTime(0, at + FADE * 2);
      end(at + FADE * 2 + 0.01);
      setTimeout(() => gain.disconnect(), (FADE * 2 + 0.05) * 1000);
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

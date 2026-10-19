// Plays short pieces of audio for the pronunciation results: a slice of the
// learner's own recording, or a reference clip of a sound. One at a time;
// starting another stops the last.

export interface Playback {
  /** Resolves when it finishes or is stopped. */
  done: Promise<void>;
}

export interface Player {
  /** Play samples[from..to] (in seconds) of a recording. onTime reports the position, in seconds of the recording. */
  playSlice(samples: Float32Array, sampleRate: number, from: number, to: number, onTime?: (t: number) => void): Playback;
  /** Play a clip by URL. onTime reports the position as a fraction, 0–1. */
  playUrl(url: string, onTime?: (fraction: number) => void): Playback;
  stop(): void;
}

let context: AudioContext | null = null;
const decoded = new Map<string, Promise<AudioBuffer>>();

function audio(): AudioContext {
  context ??= new AudioContext();
  void context.resume().catch(() => {});
  return context;
}

/** Fade in and out over a few milliseconds, so slices don't click. */
const FADE = 0.012;

function start(buffer: AudioBuffer, onFraction: ((f: number) => void) | undefined, stopper: { stop: () => void }): Playback {
  const ctx = audio();
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.connect(gain).connect(ctx.destination);
  const t0 = ctx.currentTime + 0.01;
  const length = buffer.duration;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(1, t0 + Math.min(FADE, length / 4));
  gain.gain.setValueAtTime(1, t0 + Math.max(length - FADE, length * 0.75));
  gain.gain.linearRampToValueAtTime(0, t0 + length);
  source.start(t0);
  let frame = 0;
  const done = new Promise<void>((resolve) => {
    const tick = () => {
      onFraction?.(Math.min(1, Math.max(0, (ctx.currentTime - t0) / length)));
      frame = requestAnimationFrame(tick);
    };
    if (onFraction) frame = requestAnimationFrame(tick);
    const finish = () => {
      cancelAnimationFrame(frame);
      onFraction?.(1);
      resolve();
    };
    source.onended = finish;
    stopper.stop = () => {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      finish();
    };
  });
  return { done };
}

/** The real player, using Web Audio. */
export function webAudioPlayer(): Player {
  let current = { stop: () => {} };
  const player: Player = {
    playSlice(samples, sampleRate, from, to, onTime) {
      player.stop();
      const ctx = audio();
      const a = Math.max(0, Math.floor(from * sampleRate));
      const b = Math.min(samples.length, Math.ceil(to * sampleRate));
      const buffer = ctx.createBuffer(1, Math.max(1, b - a), sampleRate);
      buffer.copyToChannel(samples.slice(a, Math.max(a + 1, b)), 0);
      current = { stop: () => {} };
      return start(buffer, onTime && ((f) => onTime(from + f * (to - from))), current);
    },
    playUrl(url, onTime) {
      player.stop();
      const mine = (current = { stop: () => {} });
      let buffer = decoded.get(url);
      if (!buffer) {
        buffer = fetch(url)
          .then((r) => r.arrayBuffer())
          .then((bytes) => audio().decodeAudioData(bytes));
        decoded.set(url, buffer);
        buffer.catch(() => decoded.delete(url));
      }
      let cancelled = false;
      mine.stop = () => (cancelled = true);
      const done = buffer.then(
        (b) => (cancelled || current !== mine ? undefined : start(b, onTime, mine).done),
        () => undefined,
      );
      return { done };
    },
    stop() {
      current.stop();
    },
  };
  return player;
}

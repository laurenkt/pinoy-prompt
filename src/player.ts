// Plays short pieces of audio for the pronunciation results: a slice of the
// learner's own recording, or a reference clip of a sound. One at a time;
// starting another stops the last.

import { audioContext, loadClip, playBuffer, type Sound } from './audio-engine';

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

function start(buffer: AudioBuffer, onFraction: ((f: number) => void) | undefined, stopper: { stop: () => void }): Playback {
  const ctx = audioContext();
  const sound: Sound = playBuffer(buffer);
  const length = buffer.duration;
  let frame = 0;
  const tick = () => {
    onFraction?.(Math.min(1, Math.max(0, (ctx.currentTime - sound.startsAt) / length)));
    frame = requestAnimationFrame(tick);
  };
  if (onFraction) frame = requestAnimationFrame(tick);
  stopper.stop = () => sound.stop();
  const done = sound.done.then(() => {
    cancelAnimationFrame(frame);
    onFraction?.(1);
  });
  return { done };
}

/** The real player, using Web Audio. */
export function webAudioPlayer(): Player {
  let current = { stop: () => {} };
  const player: Player = {
    playSlice(samples, sampleRate, from, to, onTime) {
      player.stop();
      const ctx = audioContext();
      const a = Math.max(0, Math.floor(from * sampleRate));
      const b = Math.min(samples.length, Math.ceil(to * sampleRate));
      const buffer = ctx.createBuffer(1, Math.max(1, b - a), sampleRate);
      buffer.copyToChannel(samples.slice(a, Math.max(a + 1, b)), 0);
      current = { stop: () => {} };
      return start(buffer, onTime && ((f) => onTime(from + f * (to - from))), current);
    },
    playUrl(url, onTime) {
      player.stop();
      // Resumed here, inside the tap, as the clip may only be ready after it.
      audioContext();
      const mine = (current = { stop: () => {} });
      let cancelled = false;
      mine.stop = () => (cancelled = true);
      const done = loadClip(url).then(
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

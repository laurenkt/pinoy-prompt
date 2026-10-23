// Plays short pieces of audio for the pronunciation results: a slice of the
// learner's own recording, or a single sound made in code (src/phone-synth.ts),
// held as long as a finger is down. One at a time; starting another stops the
// last.

import { audioContext, playBuffer, playLive, type Sound } from './audio-engine';
import { canSynthesize, phoneVoice, type Voice } from './phone-synth';

export interface Playback {
  /** Resolves when it finishes or is stopped. */
  done: Promise<void>;
}

export interface Player {
  /** Play samples[from..to] (in seconds) of a recording. onTime reports the position, in seconds of the recording. */
  playSlice(samples: Float32Array, sampleRate: number, from: number, to: number, onTime?: (t: number) => void): Playback;
  /**
   * Hold a sound made in code: `from`, `to`, or `mix` of the way between them (0 is `from`), until released.
   * Null when either sound can't be made (canSynthesize).
   */
  hold(from: string, to: string, mix: number): Held | null;
  stop(): void;
}

export interface Held extends Playback {
  /** Move between the two sounds, 0–1. */
  setMix(mix: number): void;
  /** Let go. A tap still sounds for a moment (TAP_MS). */
  release(): void;
}

/** The shortest a held sound plays, so a quick tap is heard. */
export const TAP_MS = 600;
/** How far ahead a held sound is laid down, and how often, in seconds. */
const AHEAD = 0.3;
const EVERY_MS = 80;

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
    hold(from, to, mix) {
      if (!canSynthesize(from) || !canSynthesize(to)) return null;
      player.stop();
      let live!: Voice;
      let ctx!: AudioContext;
      const sound = playLive((context, t0) => {
        ctx = context;
        live = phoneVoice(ctx, from, to, mix, t0)!;
        live.scheduleUntil(t0 + AHEAD);
        return live;
      });
      // A finger going down doesn't count as a tap on iOS, so a context that hasn't started yet may stay silent
      // until it's lifted; then it's resumed, and the sound plays from there for a tap's length.
      let heard = ctx.state === 'running';
      let since = performance.now();
      const timer = setInterval(() => {
        if (ctx.state === 'running' && !heard) {
          heard = true;
          since = performance.now();
        }
        live.scheduleUntil(ctx.currentTime + AHEAD);
      }, EVERY_MS);
      void sound.done.then(() => clearInterval(timer));
      current = { stop: () => sound.stop() };
      return {
        done: sound.done,
        setMix: (m) => live.setMix(m),
        release() {
          if (!heard) {
            audioContext();
            since = performance.now();
          }
          const left = TAP_MS - (performance.now() - since);
          if (left > 0) setTimeout(() => sound.stop(), left);
          else sound.stop();
        },
      };
    },
    stop() {
      current.stop();
    },
  };
  return player;
}

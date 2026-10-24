// Stand-ins for the recogniser's output and audio playback, for tests.

import { NUM_MEL_BINS } from '../fbank';
import type { Recognition } from '../phone-model';
import { canSynthesize } from '../phone-synth';
import type { Held, Player } from '../player';

/** What the recogniser would return for these sounds: one every 100 ms from 0.2 s, over a 1 s recording. */
export function fakeRecognition(sounds: string[]): Recognition {
  const frames = 100;
  return {
    sounds,
    timing: sounds.map((_, i) => ({ start: 0.2 + i * 0.1, end: 0.24 + i * 0.1 })),
    runnersUp: sounds.map(() => []),
    odds: [],
    features: { data: new Float32Array(frames * NUM_MEL_BINS).map((_, i) => Math.sin(i)), frames },
  };
}

/** A player that remembers what it was asked to play and finishes straight away. */
export class FakePlayer implements Player {
  calls: ({ kind: 'slice'; from: number; to: number } | { kind: 'hold'; sound: string; volume: number })[] = [];
  stopped = 0;
  /** The sound being held, if any: the volumes it has been set to, and whether it was let go. */
  held: { volumes: number[]; released: boolean } | null = null;
  playSlice(_samples: Float32Array, _rate: number, from: number, to: number) {
    this.calls.push({ kind: 'slice', from, to });
    return { done: Promise.resolve() };
  }
  hold(sound: string, volume: number): Held | null {
    if (!canSynthesize(sound)) return null;
    this.calls.push({ kind: 'hold', sound, volume });
    const held = { volumes: [volume], released: false };
    this.held = held;
    return {
      done: Promise.resolve(),
      setVolume: (v) => held.volumes.push(v),
      release: () => (held.released = true),
    };
  }
  stop() {
    this.stopped++;
  }
}

// Stand-ins for the recogniser's output and audio playback, for tests.

import { NUM_MEL_BINS } from '../fbank';
import type { Recognition } from '../phone-model';
import type { Player } from '../player';

/** What the recogniser would return for these sounds: one every 100 ms from 0.2 s, over a 1 s recording. */
export function fakeRecognition(sounds: string[]): Recognition {
  const frames = 100;
  return {
    sounds,
    timing: sounds.map((_, i) => ({ start: 0.2 + i * 0.1, end: 0.24 + i * 0.1 })),
    features: { data: new Float32Array(frames * NUM_MEL_BINS).map((_, i) => Math.sin(i)), frames },
  };
}

/** A player that remembers what it was asked to play and finishes straight away. */
export class FakePlayer implements Player {
  calls: ({ kind: 'slice'; from: number; to: number } | { kind: 'url'; url: string })[] = [];
  stopped = 0;
  playSlice(_samples: Float32Array, _rate: number, from: number, to: number) {
    this.calls.push({ kind: 'slice', from, to });
    return { done: Promise.resolve() };
  }
  playUrl(url: string) {
    this.calls.push({ kind: 'url', url });
    return { done: Promise.resolve() };
  }
  stop() {
    this.stopped++;
  }
}

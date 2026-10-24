// How long, how high and how loud a heard sound was, for judging which
// syllable of a word was stressed (src/stress.ts). Measured on the same 16 kHz
// recording the recogniser hears, in its 25 ms windows every 10 ms
// (src/fbank.ts): loudness from each window's energy, and pitch found with
// YIN (de Cheveigné and Kawahara, 2002), which needs no library. Pitch is the
// costly part, so it's only found over the sounds asked for.

import { FRAME_LENGTH, FRAME_SHIFT, SAMPLE_RATE } from './fbank';

/** Seconds from a window's start to its middle, which is the moment it measures. */
const CENTRE = FRAME_LENGTH / 2 / SAMPLE_RATE;
const STEP = FRAME_SHIFT / SAMPLE_RATE;
const MIN_HZ = 70;
const MAX_HZ = 500;
const MAX_LAG = Math.ceil(SAMPLE_RATE / MIN_HZ);
const MIN_LAG = Math.floor(SAMPLE_RATE / MAX_HZ);
/** YIN's threshold on the normalised difference: under it, a moment is voiced. Loose enough for a breathy vowel. */
const THRESHOLD = 0.35;
/**
 * A sound's pitch is this far up its voiced moments, highest last: near its peak, where stress shows, but not a
 * single moment's reading, which can jump an octave.
 */
const PITCH_RANK = 0.75;
/** A sound ends where the recording drops this far under its own peak (the silent hold before a final p is not vowel). */
const DROP_DB = 10;
/** Speech ends where the recording stays this far under its loudest moment. */
const SPEECH_DB = 30;

/** How one heard sound came out. */
export interface SoundProsody {
  /** How long it lasted, in seconds. */
  length: number;
  /** How high it was, in Hz (0 if it was never voiced). */
  pitch: number;
  /** Its loudest moment, in dB. */
  level: number;
}

/** How heard sound i came out, if there is one. */
export type Measure = (i: number) => SoundProsody | undefined;

/** The pitch of the window starting at `at`, in Hz, or 0 if it isn't voiced. */
function pitchAt(samples: Float32Array, at: number, d: Float64Array): number {
  // The cumulative mean normalised difference, then the first dip under the threshold, down to its bottom.
  let running = 0;
  for (let lag = 1; lag <= MAX_LAG; lag++) {
    let sum = 0;
    for (let i = 0; i < FRAME_LENGTH; i++) {
      const diff = samples[at + i] - samples[at + i + lag];
      sum += diff * diff;
    }
    running += sum;
    d[lag] = running > 0 ? (sum * lag) / running : 1;
  }
  for (let lag = MIN_LAG; lag < MAX_LAG; lag++) {
    if (d[lag] >= THRESHOLD) continue;
    while (lag + 1 < MAX_LAG && d[lag + 1] < d[lag]) lag++;
    // Between whole samples, from the parabola through the dip.
    const [a, b, c] = [d[lag - 1], d[lag], d[lag + 1]];
    const bend = a - 2 * b + c;
    return SAMPLE_RATE / (lag + (bend > 0 ? (a - c) / (2 * bend) : 0));
  }
  return 0;
}

/**
 * Measures the heard sounds of a recording, each when first asked for. The recogniser times a sound by the moment it
 * heard it, so a sound runs from there to the next one, or for the last one to the end of speech, but no further than
 * it stays within DROP_DB of its own peak.
 */
export function measurer(samples: Float32Array, timing: { start: number; end: number }[]): Measure {
  const frames = Math.max(0, Math.floor((samples.length - FRAME_LENGTH - MAX_LAG) / FRAME_SHIFT) + 1);
  const level = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let energy = 0;
    for (let i = f * FRAME_SHIFT; i < f * FRAME_SHIFT + FRAME_LENGTH; i++) energy += samples[i] * samples[i];
    level[f] = 10 * Math.log10(energy / FRAME_LENGTH + 1e-10);
  }
  const pitch = new Float32Array(frames).fill(-1);
  const d = new Float64Array(MAX_LAG + 1);
  const pitchOf = (f: number) => (pitch[f] >= 0 ? pitch[f] : (pitch[f] = pitchAt(samples, f * FRAME_SHIFT, d)));
  const frameAt = (t: number) => Math.min(frames - 1, Math.max(0, Math.round((t - CENTRE) / STEP)));
  const timeOf = (f: number) => f * STEP + CENTRE;
  let loudest = -Infinity;
  for (let f = 0; f < frames; f++) loudest = Math.max(loudest, level[f]);
  let last = frames - 1;
  while (last > 0 && level[last] < loudest - SPEECH_DB) last--;
  const speechEnd = timeOf(last) + STEP / 2;
  const measured = new Map<number, SoundProsody>();
  return (i) => {
    if (!timing[i] || !frames) return undefined;
    const known = measured.get(i);
    if (known) return known;
    const { start, end } = timing[i];
    const reach = Math.max(timing[i + 1]?.start ?? speechEnd, end);
    const from = frameAt(start);
    const to = frameAt(reach);
    // Its peak, from its first 80 ms, so a louder sound after it doesn't count.
    let peak = -Infinity;
    for (let f = from; f <= Math.min(to, from + 7); f++) peak = Math.max(peak, level[f]);
    let held = from;
    while (held + 1 <= to && level[held + 1] >= peak - DROP_DB) held++;
    const stop = Math.min(reach, Math.max(timeOf(held) + STEP / 2, end));
    const voiced: number[] = [];
    let loud = -100;
    for (let f = from; f <= frameAt(stop); f++) {
      const hz = pitchOf(f);
      if (hz > 0) voiced.push(hz);
      loud = Math.max(loud, level[f]);
    }
    voiced.sort((a, b) => a - b);
    const result = { length: stop - start, pitch: voiced[Math.round((voiced.length - 1) * PITCH_RANK)] ?? 0, level: loud };
    measured.set(i, result);
    return result;
  };
}

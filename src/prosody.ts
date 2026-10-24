// How long, how high and how loud each heard sound was, for judging which
// syllable of a word was stressed (src/stress.ts). Measured on the same 16 kHz
// recording the recogniser hears, every 10 ms like its features: loudness from
// each window's energy, and pitch found with YIN (de Cheveigné and Kawahara,
// 2002), which needs no library and a few milliseconds per take.

const RATE = 16000;
const HOP = 160;
const WINDOW = 400;
/** Seconds from a window's start to its middle, which is the moment it measures. */
const CENTRE = WINDOW / 2 / RATE;
const STEP = HOP / RATE;
const MIN_HZ = 70;
const MAX_HZ = 500;
/** YIN's threshold on the normalised difference: under it, a moment is voiced. Loose enough for a breathy vowel. */
const THRESHOLD = 0.35;
/** A sound ends where the recording drops this far under its own peak (the silent hold before a final p is not vowel). */
const DROP_DB = 10;
/** Speech ends where the recording stays this far under its loudest moment. */
const SPEECH_DB = 30;

export interface Contour {
  /** Pitch in Hz every 10 ms, 0 where unvoiced. */
  pitch: Float32Array;
  /** Loudness in dB every 10 ms. */
  level: Float32Array;
}

export function contour(samples: Float32Array): Contour {
  const maxLag = Math.ceil(RATE / MIN_HZ);
  const minLag = Math.floor(RATE / MAX_HZ);
  const frames = Math.max(0, Math.floor((samples.length - WINDOW - maxLag) / HOP) + 1);
  const pitch = new Float32Array(frames);
  const level = new Float32Array(frames);
  const d = new Float64Array(maxLag + 1);
  for (let f = 0; f < frames; f++) {
    const at = f * HOP;
    let energy = 0;
    for (let i = 0; i < WINDOW; i++) energy += samples[at + i] * samples[at + i];
    level[f] = 10 * Math.log10(energy / WINDOW + 1e-10);
    // The cumulative mean normalised difference, then the first dip under the threshold, down to its bottom.
    let running = 0;
    for (let lag = 1; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i < WINDOW; i++) {
        const diff = samples[at + i] - samples[at + i + lag];
        sum += diff * diff;
      }
      running += sum;
      d[lag] = running > 0 ? (sum * lag) / running : 1;
    }
    for (let lag = minLag; lag < maxLag; lag++) {
      if (d[lag] >= THRESHOLD) continue;
      while (lag + 1 < maxLag && d[lag + 1] < d[lag]) lag++;
      // Between whole samples, from the parabola through the dip.
      const [a, b, c] = [d[lag - 1], d[lag], d[lag + 1]];
      const bend = a - 2 * b + c;
      pitch[f] = RATE / (lag + (bend > 0 ? (a - c) / (2 * bend) : 0));
      break;
    }
  }
  return { pitch, level };
}

/** How one heard sound came out. */
export interface SoundProsody {
  /** How long it lasted, in seconds. */
  length: number;
  /** Its highest pitch, in Hz (0 if it was never voiced). */
  pitch: number;
  /** Its loudest moment, in dB. */
  level: number;
}

/**
 * Each heard sound's length, pitch and loudness. The recogniser times a sound by the moment it heard it, so a sound
 * runs from there to the next one, or for the last one to the end of speech, but no further than it stays within
 * DROP_DB of its own peak.
 */
export function soundProsody({ pitch, level }: Contour, timing: { start: number; end: number }[]): SoundProsody[] {
  const frames = level.length;
  const frameAt = (t: number) => Math.min(frames - 1, Math.max(0, Math.round((t - CENTRE) / STEP)));
  const timeOf = (f: number) => f * STEP + CENTRE;
  let loudest = -Infinity;
  for (let f = 0; f < frames; f++) loudest = Math.max(loudest, level[f]);
  let last = frames - 1;
  while (last > 0 && level[last] < loudest - SPEECH_DB) last--;
  const speechEnd = timeOf(last) + STEP / 2;
  return timing.map(({ start, end }, i) => {
    if (!frames) return { length: end - start, pitch: 0, level: -100 };
    const reach = Math.max(timing[i + 1]?.start ?? speechEnd, end);
    const from = frameAt(start);
    const to = frameAt(reach);
    // Its peak, from its first 80 ms, so a louder sound after it doesn't count.
    let peak = -Infinity;
    for (let f = from; f <= Math.min(to, from + 7); f++) peak = Math.max(peak, level[f]);
    let held = from;
    while (held + 1 <= to && level[held + 1] >= peak - DROP_DB) held++;
    const stop = Math.min(reach, Math.max(timeOf(held) + STEP / 2, end));
    let high = 0;
    let loud = -100;
    for (let f = from; f <= frameAt(stop); f++) {
      high = Math.max(high, pitch[f]);
      loud = Math.max(loud, level[f]);
    }
    return { length: stop - start, pitch: high, level: loud };
  });
}

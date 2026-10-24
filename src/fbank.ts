// Log mel filterbank features, computed the way Kaldi (and lhotse's Fbank,
// which the phone recogniser was trained with) computes them: 25 ms Povey
// windows every 10 ms, DC removed, 0.97 pre-emphasis, 512-point FFT power
// spectrum, 80 mel bins from 20 Hz to 7600 Hz, natural log. Frames run off
// both ends of the audio with reflected samples ("snip_edges = false").

export const SAMPLE_RATE = 16000;
export const FRAME_LENGTH = 400;
export const FRAME_SHIFT = 160;
const FFT_SIZE = 512;
export const NUM_MEL_BINS = 80;
const LOW_FREQ = 20;
const HIGH_FREQ = SAMPLE_RATE / 2 - 400;
const PREEMPH = 0.97;
const LOG_FLOOR = 1.1920928955078125e-7;

const mel = (hz: number) => 1127 * Math.log(1 + hz / 700);

let cached: { window: Float64Array; banks: { start: number; weights: Float64Array }[] } | null = null;

function tables() {
  if (cached) return cached;
  const window = new Float64Array(FRAME_LENGTH);
  for (let i = 0; i < FRAME_LENGTH; i++) window[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_LENGTH - 1)), 0.85);

  const binWidth = SAMPLE_RATE / FFT_SIZE;
  const melLow = mel(LOW_FREQ);
  const melDelta = (mel(HIGH_FREQ) - melLow) / (NUM_MEL_BINS + 1);
  const banks = [];
  for (let b = 0; b < NUM_MEL_BINS; b++) {
    const left = melLow + b * melDelta;
    const center = left + melDelta;
    const right = center + melDelta;
    const weights: number[] = [];
    let start = -1;
    for (let i = 0; i < FFT_SIZE / 2; i++) {
      const m = mel(i * binWidth);
      if (m > left && m < right) {
        if (start < 0) start = i;
        weights.push(m <= center ? (m - left) / (center - left) : (right - m) / (right - center));
      } else if (start >= 0) break;
    }
    banks.push({ start: Math.max(start, 0), weights: Float64Array.from(weights) });
  }
  cached = { window, banks };
  return cached;
}

/** In-place radix-2 FFT of (re, im), length a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/** Features for 16 kHz mono audio in [-1, 1]: one row of NUM_MEL_BINS values per 10 ms frame. */
export function fbank(samples: Float32Array): { data: Float32Array; frames: number } {
  const { window, banks } = tables();
  const n = samples.length;
  const frames = Math.floor((n + FRAME_SHIFT / 2) / FRAME_SHIFT);
  const data = new Float32Array(frames * NUM_MEL_BINS);
  const frame = new Float64Array(FRAME_LENGTH);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const reflect = (i: number) => {
    while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1;
    return i;
  };

  for (let f = 0; f < frames; f++) {
    const start = f * FRAME_SHIFT + FRAME_SHIFT / 2 - FRAME_LENGTH / 2;
    let mean = 0;
    for (let i = 0; i < FRAME_LENGTH; i++) {
      frame[i] = samples[reflect(start + i)];
      mean += frame[i];
    }
    mean /= FRAME_LENGTH;
    for (let i = 0; i < FRAME_LENGTH; i++) frame[i] -= mean;
    for (let i = FRAME_LENGTH - 1; i > 0; i--) frame[i] -= PREEMPH * frame[i - 1];
    frame[0] -= PREEMPH * frame[0];
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < FRAME_LENGTH; i++) re[i] = frame[i] * window[i];
    fft(re, im);
    for (let b = 0; b < NUM_MEL_BINS; b++) {
      const { start: s, weights } = banks[b];
      let energy = 0;
      for (let k = 0; k < weights.length; k++) energy += weights[k] * (re[s + k] * re[s + k] + im[s + k] * im[s + k]);
      data[f * NUM_MEL_BINS + b] = Math.log(Math.max(energy, LOG_FLOOR));
    }
  }
  return { data, frames };
}

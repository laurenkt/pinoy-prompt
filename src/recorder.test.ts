import { describe, expect, it } from 'vitest';
import { resample } from './recorder';

const sine = (hz: number, rate: number, seconds = 0.5) =>
  Float32Array.from({ length: rate * seconds }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));
/** RMS of the middle of a signal, away from the edges. */
const rms = (x: Float32Array) => {
  const mid = x.subarray(x.length / 4, (3 * x.length) / 4);
  return Math.sqrt(mid.reduce((s, v) => s + v * v, 0) / mid.length);
};

describe('resample', () => {
  it('keeps speech frequencies when going down from 48 kHz', () => {
    const out = resample(sine(1000, 48000), 48000);
    expect(out.length).toBe(8000);
    expect(rms(out)).toBeCloseTo(Math.SQRT1_2, 1);
  });

  it("filters out sound above 8 kHz instead of folding it into what's heard", () => {
    // 12 kHz would alias to 4 kHz with plain decimation.
    expect(rms(resample(sine(12000, 48000), 48000))).toBeLessThan(0.05);
  });

  it('handles 44.1 kHz and low-rate microphones', () => {
    expect(rms(resample(sine(500, 44100), 44100))).toBeCloseTo(Math.SQRT1_2, 1);
    const up = resample(sine(500, 8000), 8000);
    expect(up.length).toBe(8000);
    expect(rms(up)).toBeCloseTo(Math.SQRT1_2, 1);
  });
});

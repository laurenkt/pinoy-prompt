import { describe, expect, it } from 'vitest';
import { resample, toWav } from './recorder';

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

describe('a take as a WAV file', () => {
  it('is 16-bit mono at 16 kHz, with the samples clipped to range', async () => {
    const wav = toWav(new Float32Array([0, 1, -1, 2]));
    expect(wav.type).toBe('audio/wav');
    const data = new DataView(await wav.arrayBuffer());
    expect(String.fromCharCode(...new Uint8Array(await wav.slice(0, 4).arrayBuffer()))).toBe('RIFF');
    expect(data.getUint16(22, true)).toBe(1);
    expect(data.getUint32(24, true)).toBe(16000);
    expect(data.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => data.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32767, 32767]);
  });
});

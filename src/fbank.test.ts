import { expect, it } from 'vitest';
import { fbank, NUM_MEL_BINS } from './fbank';
import fixture from './test/fbank-fixture.json';

it("matches lhotse's Fbank, which the phone recogniser was trained on", () => {
  const n = 4000;
  const x = Float32Array.from({ length: n }, (_, i) => {
    const t = i / 16000;
    return 0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.1 * Math.sin(2 * Math.PI * 1800 * t) + 0.05 * Math.sin(2 * Math.PI * 5100 * t);
  });
  const { data, frames } = fbank(x);
  expect(frames).toBe(fixture.frames);
  for (const [row, values] of Object.entries(fixture.rows)) {
    const ours = data.subarray(Number(row) * NUM_MEL_BINS, (Number(row) + 1) * NUM_MEL_BINS);
    values.forEach((v, bin) => expect(ours[bin], `frame ${row} bin ${bin}`).toBeCloseTo(v, 2));
  }
});

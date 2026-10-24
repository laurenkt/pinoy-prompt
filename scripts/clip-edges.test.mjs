import { describe, expect, it } from 'vitest';
import { LEAD, TAIL, edges, trimPlan, trimmedClose } from './clip-edges.mjs';

const RATE = 24000;

/** Seconds of hiss, then a tone, then hiss: the shape of a take. */
function take(quietBefore, sound, quietAfter) {
  const seconds = [quietBefore, sound, quietAfter];
  const out = new Float32Array(Math.round(seconds.reduce((a, b) => a + b) * RATE));
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const sounding = t >= quietBefore && t < quietBefore + sound;
    out[i] = sounding ? 0.3 * Math.sin(2 * Math.PI * 220 * t) : 0.0003 * Math.sin(2 * Math.PI * 3000 * t);
  }
  return out;
}

describe('edges', () => {
  it('finds where the sound starts and ends', () => {
    const found = edges(take(0.2, 0.5, 0.3), RATE);
    expect(found.start).toBeCloseTo(0.2, 2);
    expect(found.end).toBeCloseTo(0.7, 2);
    expect(found.cut).toEqual([]);
  });

  it('says when a take starts or ends mid-sound', () => {
    expect(edges(take(0, 0.5, 0.3), RATE).cut).toEqual(['start']);
    expect(edges(take(0.2, 0.5, 0), RATE).cut).toEqual(['end']);
  });
});

describe('trimPlan', () => {
  it('keeps LEAD and TAIL of the take around its sound', () => {
    expect([LEAD, TAIL]).toEqual([0.05, 0.15]);
    const plan = trimPlan({ start: 0.2, end: 0.7, duration: 1 });
    expect(plan).toEqual({ from: 0.15, to: 0.85, before: 0, after: 0 });
  });

  it('adds silence where the take has less of its own, so the start of a word is never at the start of a clip', () => {
    const plan = trimPlan({ start: 0.01, end: 0.9, duration: 0.95 });
    expect(plan.from).toBe(0);
    expect(plan.to).toBe(0.95);
    expect(plan.before).toBeCloseTo(LEAD - 0.01, 3);
    expect(plan.after).toBeCloseTo(TAIL - 0.05, 3);
  });
});

describe('trimmedClose', () => {
  it('finds clips trimmed right up to their sound', () => {
    expect(trimmedClose(take(0.01, 0.5, 0.05), RATE)).toBe(true);
    expect(trimmedClose(take(LEAD, 0.5, TAIL), RATE)).toBe(false);
  });

  it("doesn't flag a clip for breath that runs into its tail", () => {
    expect(trimmedClose(take(LEAD, 0.5, 0.01), RATE)).toBe(false);
  });
});

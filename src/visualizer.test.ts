// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { BANDS, bands, createVisualizer } from './visualizer';

describe('bands', () => {
  it('averages bins into bands, spaced by pitch', () => {
    const bins = new Uint8Array(256);
    bins.fill(200, 1, 3);
    bins.fill(50, 20, 41);
    const out = bands(bins);
    expect(out).toHaveLength(BANDS);
    expect(out[0]).toBe(200);
    expect(out[BANDS - 1]).toBe(50);
    expect([...out].every((v, i) => i === 0 || v <= out[0])).toBe(true);
  });

  it('gives every band at least one bin', () => {
    expect([...bands(new Uint8Array(256).fill(9), new Uint8Array(BANDS), 1, 4)]).toEqual(new Array(BANDS).fill(9));
  });
});

describe('createVisualizer', () => {
  it('does nothing where WebGL is missing', () => {
    const visual = createVisualizer(document.createElement('canvas'));
    expect(() => {
      visual.listen('you', new MediaStream());
      visual.setMuted(true);
      visual.stop();
    }).not.toThrow();
  });
});

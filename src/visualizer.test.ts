// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createVisualizer, follow, SAMPLES, type Envelope } from './visualizer';

const silent = () => new Uint8Array(1024).fill(128);
/** A tone at the given loudness (0 to 1) with the given number of samples per cycle. */
const tone = (loudness: number, period = 64) => new Uint8Array(1024).map((_, i) => Math.round(128 + 127 * loudness * Math.sin((i / period) * 2 * Math.PI)));
const fresh = (): Envelope => ({ level: 0, kick: 0, bright: 0 });

describe('follow', () => {
  it('shows a sound in the very frame it arrives, and lets it fall away smoothly', () => {
    const env = fresh();
    const out = new Uint8Array(SAMPLES);
    follow(tone(0.3), env, out, 1 / 60);
    expect(env.level).toBeGreaterThan(0.9);
    expect(env.kick).toBe(1);
    const loud = env.level;
    follow(silent(), env, out, 1 / 60);
    expect(env.level).toBeLessThan(loud);
    expect(env.level).toBeGreaterThan(loud * 0.9);
    expect(env.kick).toBeLessThan(1);
  });

  it('stays still in silence', () => {
    const env = fresh();
    follow(silent(), env, new Uint8Array(SAMPLES), 1 / 60);
    expect(env).toEqual(fresh());
  });

  it('passes the raw waveform on, spread over the samples', () => {
    const out = new Uint8Array(SAMPLES);
    const wave = tone(0.5);
    follow(wave, fresh(), out, 1 / 60);
    expect(out[0]).toBe(wave[0]);
    expect(out[SAMPLES / 2]).toBe(wave[512]);
  });

  it('is brighter for hissing sounds than for low ones', () => {
    const low = fresh();
    const hiss = fresh();
    for (let i = 0; i < 30; i++) {
      follow(tone(0.3, 200), low, new Uint8Array(SAMPLES), 1 / 60);
      follow(tone(0.3, 6), hiss, new Uint8Array(SAMPLES), 1 / 60);
    }
    expect(hiss.bright).toBeGreaterThan(low.bright + 0.5);
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

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createVisualizer, follow, quiet, SAMPLES } from './visualizer';

const silent = () => new Uint8Array(1024).fill(128);
/** A tone at the given loudness (0 to 1) with the given number of samples per cycle. */
const tone = (loudness: number, period = 64) => new Uint8Array(1024).map((_, i) => Math.round(128 + 127 * loudness * Math.sin((i / period) * 2 * Math.PI)));
const fresh = quiet;
/** Background hiss: a byte or two either side of silence. */
const hiss = () => new Uint8Array(1024).map((_, i) => 128 + ((i * 7919) % 5) - 2);

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

  it('eases the glow, so the screen never flashes with each syllable', () => {
    const env = fresh();
    const out = new Uint8Array(SAMPLES);
    let swing = 0;
    for (let frame = 0; frame < 120; frame++) {
      // Syllables five times a second.
      const before = env.glow;
      follow(frame % 12 < 6 ? tone(0.3) : silent(), env, out, 1 / 60);
      swing = Math.max(swing, Math.abs(env.glow - before));
    }
    expect(swing).toBeLessThan(0.06);
    expect(env.glow).toBeGreaterThan(0.2);
  });

  it('kicks again on the next sound once the last has faded', () => {
    const env = fresh();
    const out = new Uint8Array(SAMPLES);
    follow(tone(0.3), env, out, 1 / 60);
    for (let i = 0; i < 60; i++) follow(silent(), env, out, 1 / 60);
    expect(env.kick).toBeLessThan(0.01);
    follow(tone(0.3), env, out, 1 / 60);
    expect(env.kick).toBe(1);
  });

  it('takes background hiss for silence', () => {
    const env = fresh();
    for (let i = 0; i < 30; i++) follow(hiss(), env, new Uint8Array(SAMPLES), 1 / 60);
    expect(env.bright).toBe(0);
    expect(env.level).toBeLessThan(0.1);
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

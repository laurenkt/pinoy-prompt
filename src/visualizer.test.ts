// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createVisualizer, follow, loudness, quiet, SAMPLES } from './visualizer';

const silent = () => new Float32Array(1024);
/** A tone with the given amplitude (0 to 1) and number of samples per cycle. */
const tone = (amplitude: number, period = 64) => new Float32Array(1024).map((_, i) => amplitude * Math.sin((i / period) * 2 * Math.PI));
const fresh = quiet;
/** Background hiss, around -55 dB. */
const hiss = () => new Float32Array(1024).map((_, i) => (((i * 7919) % 5) - 2) * 0.001);
/** A tone at this amplitude is about -30 dB, as ordinary talking reaches a phone's microphone. */
const TALKING = 0.045;

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

  it('moves well for ordinary talking, and saves the top for singing or shouting', () => {
    expect(loudness(0.0015)).toBe(0);
    expect(loudness(TALKING / Math.SQRT2)).toBeGreaterThan(0.55);
    expect(loudness(TALKING / Math.SQRT2)).toBeLessThan(0.75);
    expect(loudness(0.5)).toBe(1);
  });

  /** How far the rings' waveform swings from the middle, 0 to 127. */
  const swing = (out: Uint8Array) => Math.max(...out.map((v) => Math.abs(v - 128)));
  const frames = (n: number, wave: () => Float32Array, env = fresh(), out = new Uint8Array(SAMPLES)) => {
    for (let i = 0; i < n; i++) follow(wave(), env, out, 1 / 60);
    return out;
  };

  it('scales quiet talk up so the rings still draw big shapes, and loud sound down', () => {
    expect(swing(frames(30, () => tone(TALKING)))).toBeGreaterThan(55);
    const loud = swing(frames(30, () => tone(0.9)));
    expect(loud).toBeGreaterThan(80);
    expect(loud).toBeLessThan(110);
  });

  /** Room noise around -45 dB, peaking near 0.02. */
  const room = () => new Float32Array(1024).map((_, i) => Math.sin(i * 12.9898) * 0.0035 + (((i * 7919) % 9) - 4) * 0.0018);

  it("doesn't blow room noise up to fill the rings once talking stops", () => {
    const env = fresh();
    frames(60, () => tone(0.2), env);
    const out = frames(300, room, env);
    expect(swing(out)).toBeLessThan(20);
    expect(env.bright).toBeLessThan(0.5);
  });

  it("doesn't shrink talking for long after a click", () => {
    const env = fresh();
    frames(30, () => tone(TALKING), env);
    frames(1, () => tone(1), env);
    expect(swing(frames(30, () => tone(TALKING), env))).toBeGreaterThan(30);
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

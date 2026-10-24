import { describe, expect, it } from 'vitest';
import { contour, soundProsody } from './prosody';

const RATE = 16000;
/** A tone at `hz` for `seconds`, `gain` loud, then silence. */
function tone(hz: number, seconds: number, gain = 0.3, silence = 0.3): Float32Array {
  const out = new Float32Array(Math.round((seconds + silence) * RATE));
  for (let i = 0; i < seconds * RATE; i++) out[i] = gain * (Math.sin((2 * Math.PI * hz * i) / RATE) + 0.4 * Math.sin((4 * Math.PI * hz * i) / RATE));
  return out;
}

describe('contour', () => {
  it('follows the pitch of a voice-like tone', () => {
    for (const hz of [110, 220, 330]) {
      const { pitch } = contour(tone(hz, 0.5));
      const voiced = [...pitch.slice(5, 35)];
      expect(voiced.every((f) => Math.abs(f - hz) < hz * 0.02)).toBe(true);
    }
  });

  it('hears silence as unvoiced and quiet', () => {
    const { pitch, level } = contour(new Float32Array(RATE / 2));
    expect(pitch.every((f) => f === 0)).toBe(true);
    expect(Math.max(...level)).toBeLessThan(-90);
  });
});

describe('soundProsody', () => {
  it('ends a sound where it goes quiet, not at the next sound heard', () => {
    // A 300 ms vowel, then silence; the next sound is heard at 0.55 s (a released final p, say).
    const samples = tone(200, 0.3, 0.3, 0.5);
    samples.set(tone(200, 0.02, 0.05, 0), Math.round(0.55 * RATE));
    const [vowel] = soundProsody(contour(samples), [{ start: 0.02, end: 0.06 }, { start: 0.55, end: 0.57 }]);
    expect(vowel.length).toBeGreaterThan(0.24);
    expect(vowel.length).toBeLessThan(0.32);
    expect(vowel.pitch).toBeCloseTo(200, -1);
  });

  it('measures the louder, higher of two sounds as such', () => {
    const samples = new Float32Array(RATE);
    samples.set(tone(180, 0.15, 0.1, 0), 0);
    samples.set(tone(260, 0.25, 0.3, 0), Math.round(0.15 * RATE));
    const [first, second] = soundProsody(contour(samples), [{ start: 0.01, end: 0.03 }, { start: 0.15, end: 0.17 }]);
    expect(second.pitch).toBeGreaterThan(first.pitch);
    expect(second.level).toBeGreaterThan(first.level);
    expect(second.length).toBeGreaterThan(first.length);
  });
});

import { describe, expect, it } from 'vitest';
import { measurer } from './prosody';

const RATE = 16000;
/** A voice-like tone at `hz` from `from` for `seconds`, `gain` loud, written into `out`. */
function tone(out: Float32Array, from: number, seconds: number, hz: number, gain = 0.3): Float32Array {
  for (let i = 0; i < seconds * RATE; i++) out[Math.round(from * RATE) + i] = gain * (Math.sin((2 * Math.PI * hz * i) / RATE) + 0.4 * Math.sin((4 * Math.PI * hz * i) / RATE));
  return out;
}

describe('measurer', () => {
  it('finds the pitch of a voice-like tone', () => {
    for (const hz of [110, 220, 330]) {
      const measure = measurer(tone(new Float32Array(RATE), 0, 0.5, hz), [{ start: 0.05, end: 0.1 }]);
      expect(measure(0)!.pitch).toBeGreaterThan(hz * 0.98);
      expect(measure(0)!.pitch).toBeLessThan(hz * 1.02);
    }
  });

  it('hears silence as unvoiced, and measures only sounds that were heard', () => {
    const measure = measurer(new Float32Array(RATE / 2), [{ start: 0.1, end: 0.2 }]);
    expect(measure(0)!.pitch).toBe(0);
    expect(measure(0)!.level).toBeLessThan(-90);
    expect(measure(1)).toBeUndefined();
  });

  it('ends a sound where it goes quiet, not at the next sound heard', () => {
    // A 300 ms vowel, then silence; the next sound is heard at 0.55 s (a released final p, say).
    const samples = tone(new Float32Array(RATE), 0, 0.3, 200);
    tone(samples, 0.55, 0.02, 200, 0.05);
    const vowel = measurer(samples, [{ start: 0.02, end: 0.06 }, { start: 0.55, end: 0.57 }])(0)!;
    expect(vowel.length).toBeGreaterThan(0.24);
    expect(vowel.length).toBeLessThan(0.32);
  });

  it('measures the louder, higher, longer of two sounds as such', () => {
    const samples = tone(tone(new Float32Array(RATE), 0, 0.15, 180, 0.1), 0.15, 0.25, 260);
    const measure = measurer(samples, [{ start: 0.01, end: 0.03 }, { start: 0.15, end: 0.17 }]);
    const [first, second] = [measure(0)!, measure(1)!];
    expect(second.pitch).toBeGreaterThan(first.pitch);
    expect(second.level).toBeGreaterThan(first.level);
    expect(second.length).toBeGreaterThan(first.length);
  });

  it("isn't swayed by one moment read an octave high", () => {
    const samples = tone(new Float32Array(RATE), 0, 0.3, 150);
    // 20 ms of the vowel at twice the pitch, as YIN can read from an overtone.
    tone(samples, 0.1, 0.02, 300);
    expect(measurer(samples, [{ start: 0.02, end: 0.06 }])(0)!.pitch).toBeLessThan(160);
  });
});

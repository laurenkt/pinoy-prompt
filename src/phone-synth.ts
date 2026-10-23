// Single sounds made in code, for the pronunciation results: what the learner
// said and what to aim for, held as long as a finger is down. A recording of
// one sound can't be held, so they're synthesized: a buzzing voice shaped by the mouth's resonances
// (formants), and hiss for the noisy sounds.
//
// Vowels and hissing sounds (s, sh) carry on for as long as they're held.
// Other consonants can't be held on their own, so they repeat with "a" after
// them, as "ma-ma-ma", like the syllables they're taught with. Where a sound
// sits comes from its place on the mouth charts (src/sound-map.ts), so the
// sound and the chart agree on how far apart two sounds are.

import { baseSound } from './phonetics';
import { placeOf } from './sound-map';

type Formants = [number, number, number];

/** Everything that makes one sound, as numbers. */
export interface Spec {
  /** The vowel, or for a consonant the "a" after it. */
  vowel: Formants;
  /** How long the mouth is closed (or narrowed, for l, w, y, m) before the vowel, in seconds. */
  close: number;
  /** Humming through the nose while closed (m, n, ng), 0–1, and the pitch the closed mouth swallows. */
  murmur: number;
  dip: number;
  hum: number;
  /** Buzzing behind closed lips or tongue (b, d, g), 0–1. */
  voiceBar: number;
  /** An open, voiced narrowing (l, w, y), 0–1. */
  sonorant: number;
  /** The mouth's resonances while closed or narrowed, and where they start from as it opens. */
  locus: Formants;
  /** The pop as the mouth opens (p, t, k), 0–1, its pitch and how narrow. */
  burst: number;
  burstF: number;
  burstQ: number;
  /** Hiss (s, sh, f), 0–1, its pitch and how narrow, and for how long before the vowel. */
  hiss: number;
  hissF: number;
  hissQ: number;
  hissDur: number;
  /** Buzzing under the hiss (z, v), 0–1. */
  hissVoice: number;
  /** Breath before the voice starts (h, and a puff after p, t, k), 0–1, and for how long. */
  breath: number;
  breathDur: number;
  /** How long the resonances take to move from the consonant to the vowel, in seconds. */
  glide: number;
}

/** How a sound is played while held: a vowel or a hiss carries on; anything else repeats with "a". */
export type Mode = 'vowel' | 'hiss' | 'syllable';

const VOICELESS = new Set(['p', 't', 'k', 'q', 'ʔ', 'f', 'θ', 's', 'ʃ', 'tʃ', 'x', 'h', 'χ']);
/** Places on the consonant chart (src/sound-map.ts PLACES): lips, teeth, roof, back, throat. */
const BY_PLACE = {
  locusF2: [900, 1750, 2250, 2000, 1450],
  locusF3: [2300, 2700, 2900, 2200, 2500],
  burstF: [900, 3800, 3000, 1900, 1500],
  burstQ: [0.8, 1.2, 1.4, 2.5, 1],
  hissF: [5000, 6500, 3300, 1700, 1500],
  /** The dip a hum through the nose puts in the sound, where the closed mouth swallows it. */
  dip: [1000, 1800, 2500, 3000, 3000],
  /** The hum's second resonance. */
  hum: [1100, 1500, 1900, 1100, 1100],
  hissQ: [0.6, 2.2, 2, 2.5, 1],
  hiss: [0.25, 1, 1, 0.5, 0],
};
const VOWEL_SECONDS = 0.26;

/** A value at a place on the chart, between the columns either side of it. */
function atPlace(row: number[], place: number): number {
  const i = Math.min(row.length - 2, Math.max(0, Math.floor(place)));
  const f = Math.min(1, Math.max(0, place - i));
  return row[i] + (row[i + 1] - row[i]) * f;
}

/** A vowel's resonances from where it sits on the vowel chart: lower tongue, higher F1; further back, lower F2. */
function vowelFormants(x: number, y: number): Formants {
  return [250 + 600 * y, 2350 - 1450 * x - 450 * y, 2400 + 600 * (1 - x) * (1 - y)];
}

const A = (() => {
  const a = placeOf('a') as { x: number; y: number };
  return vowelFormants(a.x, a.y);
})();

const SILENT: Omit<Spec, 'vowel' | 'locus'> = {
  close: 0,
  murmur: 0,
  dip: 1000,
  hum: 1100,
  voiceBar: 0,
  sonorant: 0,
  burst: 0,
  burstF: 1500,
  burstQ: 1,
  hiss: 0,
  hissF: 1500,
  hissQ: 1,
  hissDur: 0,
  hissVoice: 0,
  breath: 0,
  breathDur: 0,
  glide: 0.045,
};

/** The sound in the form the charts know it by: g for ɡ, no length marks, no puff of air. */
function plain(ipa: string): string {
  return baseSound(ipa).replace('ʰ', '').replace('g', 'ɡ');
}

/** The settings for one sound, or null for one the charts don't place. */
export function specFor(ipa: string): Spec | null {
  const sound = plain(ipa);
  const place = placeOf(sound);
  if (place.chart === 'vowel') {
    const vowel = vowelFormants(place.x, place.y);
    return { ...SILENT, vowel, locus: vowel, close: 0.05 };
  }
  if (place.chart !== 'consonant') return null;
  const p = place.place;
  const voiced = !VOICELESS.has(sound);
  const locus: Formants = [250, atPlace(BY_PLACE.locusF2, p), atPlace(BY_PLACE.locusF3, p)];
  const spec: Spec = { ...SILENT, vowel: A, locus, burstF: atPlace(BY_PLACE.burstF, p), burstQ: atPlace(BY_PLACE.burstQ, p), hissF: atPlace(BY_PLACE.hissF, p), hissQ: atPlace(BY_PLACE.hissQ, p) };
  const aspirated = ipa.includes('ʰ');
  if (sound === 'tʃ' || sound === 'dʒ') {
    return { ...spec, close: 0.06, burst: 0.5, hiss: 1, hissDur: 0.07, hissVoice: voiced ? 1 : 0, voiceBar: voiced ? 1 : 0 };
  }
  switch (place.manner) {
    case 0: // stop
      if (sound === 'ʔ') return { ...spec, close: 0.08, locus: A, glide: 0.01 };
      return { ...spec, close: 0.07, burst: (p < 0.5 ? 0.5 : 1) * (voiced ? 0.3 : 1), voiceBar: voiced ? 1 : 0, hiss: !voiced && p > 0.5 && p < 1.5 ? 0.15 : 0, hissDur: 0.01, breath: voiced ? 0 : 0.4, breathDur: voiced ? 0 : aspirated ? 0.06 : 0.015 };
    case 1: // nasal
      return { ...spec, close: 0.1, murmur: 1, dip: atPlace(BY_PLACE.dip, p), hum: atPlace(BY_PLACE.hum, p), locus: [250, locus[1], locus[2]], glide: 0.04 };
    case 2: // tap
      return { ...spec, close: 0.025, voiceBar: 0.4, locus: [300, locus[1], locus[2]], glide: 0.03 };
    case 3: // hiss
      if (sound === 'h' || p >= 3.8) return { ...spec, locus: A, breath: 1, breathDur: 0.09, glide: 0.01 };
      return { ...spec, hiss: atPlace(BY_PLACE.hiss, p), hissDur: 0.13, hissVoice: voiced ? 1 : 0 };
    case 4: // lateral
      return { ...spec, close: 0.07, sonorant: 1, locus: [360, sound === 'ɫ' ? 900 : 1150, 2700] };
    case 5: // glide
      return { ...spec, close: 0.06, sonorant: 1, glide: 0.1, locus: sound === 'w' ? [300, 750, 2300] : sound === 'j' ? [280, 2250, 3000] : [350, 1150, 1650] };
  }
  return null;
}

/** Whether a sound can be made here. */
export function canSynthesize(ipa: string): boolean {
  return specFor(ipa) !== null;
}

/** Hissing sounds that can be held on their own: not h, which needs a vowel to colour it. */
const holdsAsHiss = (s: Spec) => s.hiss > 0 && s.hissDur > 0.1;
const isVowel = (ipa: string) => placeOf(plain(ipa)).chart === 'vowel';

/** How a sound is played: held if it can be, otherwise as a repeated syllable. */
export function modeOf(ipa: string): Mode {
  if (isVowel(ipa)) return 'vowel';
  const s = specFor(ipa);
  return s && holdsAsHiss(s) ? 'hiss' : 'syllable';
}

/** One repeat of a syllable, in seconds. */
export function syllableLength(s: Spec): number {
  return s.close + s.hissDur + s.breathDur + VOWEL_SECONDS;
}

/** The voice: a buzz with its overtones falling away, as the vocal folds make. */
function makeVoiceWave(ctx: BaseAudioContext): PeriodicWave {
  // Up to about 18 kHz at the voice's pitch.
  const n = 150;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = 1 / k;
  return ctx.createPeriodicWave(real, imag);
}

/** A second of white noise, the same every time, looped for hiss and breath. */
function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 2 ** 32) * 2 - 1;
  }
  return buffer;
}

/** Made once for each context, so a press only has to wire up nodes. */
const made = new WeakMap<BaseAudioContext, { wave: PeriodicWave; noise: AudioBuffer }>();
function madeFor(ctx: BaseAudioContext) {
  let m = made.get(ctx);
  if (!m) made.set(ctx, (m = { wave: makeVoiceWave(ctx), noise: makeNoise(ctx) }));
  return m;
}

export interface Voice {
  /** Connect this to be heard. */
  out: AudioNode;
  /** Lay down the sound up to this context time; call it often while held, a little ahead. */
  scheduleUntil(time: number): void;
  /** Stop everything at this context time. */
  end(at: number): void;
}

const BRIGHT_DB = 14;
const AIR = 0.5;
/** How loud hiss is against the voice. */
const HISS = 0.9;
/** How wide each resonance is, in Hz. */
const BANDWIDTHS = [80, 100, 150];
/** A resonance's peak for a low-pass filter, whose Q is in decibels. */
const qOf = (frequency: number, bandwidth: number) => 20 * Math.log10(Math.max(1, frequency / bandwidth));

/**
 * A voice saying one sound, from `start` until ended.
 * Built on whatever context it's given: the shared one to play, an offline one to render.
 */
export function phoneVoice(ctx: BaseAudioContext, ipa: string, start: number): Voice | null {
  const found = specFor(ipa);
  if (!found) return null;
  const spec: Spec = found;
  const mode = modeOf(ipa);

  const out = ctx.createGain();
  out.gain.value = 0.25;
  const squash = ctx.createDynamicsCompressor();
  squash.threshold.value = -18;
  squash.ratio.value = 4;
  squash.connect(out);

  // The buzz, with a slow wobble in pitch so it doesn't sound like a machine.
  const voice = ctx.createOscillator();
  voice.setPeriodicWave(madeFor(ctx).wave);
  voice.frequency.value = 120;
  const wobble = ctx.createOscillator();
  wobble.frequency.value = 5.2;
  const wobbleDepth = ctx.createGain();
  wobbleDepth.gain.value = 1.5;
  wobble.connect(wobbleDepth).connect(voice.frequency);
  const voiceAmp = ctx.createGain();
  voiceAmp.gain.value = 0;
  voice.connect(voiceAmp);

  const noise = ctx.createBufferSource();
  noise.buffer = madeFor(ctx).noise;
  noise.loop = true;
  const breathAmp = ctx.createGain();
  breathAmp.gain.value = 0;
  // Breath is soft, without the hiss's high edge.
  const soft = ctx.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = 1200;
  soft.Q.value = -3;
  noise.connect(soft).connect(breathAmp);

  // The mouth's resonances, one after another as in the vocal tract, which the buzz and the breath both pass
  // through. Each is a resonant low-pass, so the overtones fall away above it as they do in a voice.
  const formants = [...BANDWIDTHS, 0].map(() => ctx.createBiquadFilter());
  formants.forEach((filter, i) => {
    filter.type = 'lowpass';
    // The fourth is fixed, near where it sits in everyone's voice.
    if (i === formants.length - 1) {
      filter.frequency.value = 3500;
      filter.Q.value = qOf(3500, 250);
    }
    if (i > 0) formants[i - 1].connect(filter);
  });
  const nose = ctx.createBiquadFilter();
  nose.type = 'peaking';
  nose.Q.value = 2;
  nose.gain.value = 0;
  voiceAmp.connect(nose).connect(formants[0]);
  breathAmp.connect(formants[0]);
  // The higher resonances carry the difference between ee and ah; lifted, as the open mouth does.
  const bright = ctx.createBiquadFilter();
  bright.type = 'highshelf';
  bright.frequency.value = 1500;
  bright.gain.value = BRIGHT_DB;
  formants[formants.length - 1].connect(bright).connect(squash);
  // Resonances above the fourth, which a chain of four would cut away, leaving it muffled: a little of the
  // voice above them, added alongside. Only for an open mouth: a hum behind closed lips has none.
  const air = ctx.createBiquadFilter();
  air.type = 'highpass';
  air.frequency.value = 3800;
  const airLevel = ctx.createGain();
  airLevel.gain.value = mode === 'vowel' ? AIR : 0;
  voiceAmp.connect(air).connect(airLevel).connect(squash);

  const hissFilter = ctx.createBiquadFilter();
  hissFilter.type = 'bandpass';
  const hissAmp = ctx.createGain();
  hissAmp.gain.value = 0;
  noise.connect(hissFilter).connect(hissAmp).connect(squash);

  const burstFilter = ctx.createBiquadFilter();
  burstFilter.type = 'bandpass';
  const burstAmp = ctx.createGain();
  burstAmp.gain.value = 0;
  noise.connect(burstFilter).connect(burstAmp).connect(squash);

  /** Move the resonances to `f`, at once or following (a time constant), `damp` times as wide (a hum through the nose). */
  const setFormants = (f: Formants, at: number, follow = 0, damp = 1) =>
    BANDWIDTHS.forEach((bandwidth, i) => {
      const { frequency, Q } = formants[i];
      const q = qOf(f[i], bandwidth * (i > 0 ? damp : 1));
      if (follow) {
        frequency.setTargetAtTime(f[i], at, follow);
        Q.setTargetAtTime(q, at, follow);
      } else {
        frequency.setValueAtTime(f[i], at);
        Q.setValueAtTime(q, at);
      }
    });
  const glideFormants = (a: Formants, b: Formants, from: number, to: number, damp = 1) =>
    BANDWIDTHS.forEach((bandwidth, i) => {
      const { frequency, Q } = formants[i];
      frequency.setValueAtTime(a[i], from);
      frequency.linearRampToValueAtTime(b[i], to);
      Q.setValueAtTime(qOf(a[i], bandwidth * (i > 0 ? damp : 1)), from);
      Q.linearRampToValueAtTime(qOf(b[i], bandwidth), to);
    });

  /** The hiss's own settings, held. */
  const holdHiss = (s: Spec, at: number, follow: number) => {
    hissFilter.frequency.setTargetAtTime(s.hissF, at, follow);
    hissFilter.Q.setTargetAtTime(s.hissQ, at, follow);
    hissAmp.gain.setTargetAtTime(s.hiss * HISS, at, follow);
    voiceAmp.gain.setTargetAtTime(s.hissVoice * 0.35, at, follow);
  };

  // A held vowel or hiss is set up once; a syllable is laid down repeat by repeat.
  let next = start;
  if (mode === 'vowel') {
    setFormants(spec.vowel, start);
    voiceAmp.gain.setValueAtTime(0, start);
    voiceAmp.gain.linearRampToValueAtTime(1, start + 0.03);
  } else if (mode === 'hiss') {
    setFormants([250, 1500, 2500], start);
    holdHiss(spec, start, 0.005);
  }

  function syllable(t: number): number {
    const s = spec;
    const release = t + s.close;
    const hissEnd = release + s.hissDur;
    const voicing = hissEnd + s.breathDur;
    const length = syllableLength(s);
    const closed = Math.max(s.voiceBar * 0.6, s.murmur, s.sonorant * 0.6);
    // Into a stop or a hum the mouth shuts at once; into l, w or y it moves there.
    const into = s.sonorant * Math.min(s.glide, s.close) * 0.5 + 0.004;

    // Pitch falls a little over each repeat, as in a statement.
    voice.frequency.setValueAtTime(132, t);
    voice.frequency.linearRampToValueAtTime(112, t + length);

    // Closing: the voice drops to its hum (or nothing) and the resonances go to the consonant's.
    voiceAmp.gain.setTargetAtTime(closed, t, (0.015 + into) / 3);
    airLevel.gain.setTargetAtTime(AIR * s.sonorant, t, 0.005);
    const shut: Formants =
      s.murmur > 0.5 ? [250, s.hum, s.locus[2]] : s.voiceBar > 0.5 && s.sonorant === 0 ? [200, s.locus[1], s.locus[2]] : s.locus;
    setFormants(shut, t, into, 1 + 4 * s.murmur);
    if (s.murmur > 0) {
      nose.frequency.setValueAtTime(s.dip, t);
      nose.gain.setTargetAtTime(-20 * s.murmur, t, into);
    }

    // Opening.
    if (s.murmur > 0) nose.gain.setTargetAtTime(0, release, 0.012);
    if (s.burst > 0) {
      burstFilter.frequency.setValueAtTime(s.burstF, release);
      burstFilter.Q.setValueAtTime(s.burstQ, release);
      burstAmp.gain.setValueAtTime(0, release);
      burstAmp.gain.linearRampToValueAtTime(s.burst * 1.4, release + 0.002);
      burstAmp.gain.setTargetAtTime(0, release + 0.002, 0.006);
    }
    if (s.hiss > 0 && s.hissDur > 0) {
      hissFilter.frequency.setValueAtTime(s.hissF, release);
      hissFilter.Q.setValueAtTime(s.hissQ, release);
      hissAmp.gain.setValueAtTime(0, release);
      hissAmp.gain.linearRampToValueAtTime(s.hiss * HISS, release + Math.min(0.015, s.hissDur / 3));
      hissAmp.gain.setValueAtTime(s.hiss * HISS, hissEnd - Math.min(0.015, s.hissDur / 3));
      hissAmp.gain.linearRampToValueAtTime(0, hissEnd);
      voiceAmp.gain.setTargetAtTime(s.hissVoice * 0.35, release, 0.005);
    }
    if (s.breath > 0 && s.breathDur > 0) {
      voiceAmp.gain.setTargetAtTime(0, release, 0.003);
      breathAmp.gain.setValueAtTime(0, hissEnd);
      breathAmp.gain.linearRampToValueAtTime(s.breath * 0.1, hissEnd + 0.005);
      breathAmp.gain.setValueAtTime(s.breath * 0.1, voicing - 0.005);
      breathAmp.gain.linearRampToValueAtTime(0, voicing + 0.01);
    }
    // The vowel: the voice comes in and the resonances move from the consonant's to the vowel's.
    const onset = s.breathDur > 0 || s.hissDur > 0 ? voicing : release;
    voiceAmp.gain.setTargetAtTime(1, onset, (s.close > 0.03 && s.burst === 0 && s.sonorant === 0 && s.murmur === 0 ? 0.004 : 0.012) / 3);
    glideFormants(s.locus, s.vowel, onset, onset + s.glide, 1 + 4 * s.murmur);
    airLevel.gain.setTargetAtTime(AIR, onset, 0.01);
    // And fades a little into the next repeat.
    voiceAmp.gain.setTargetAtTime(0.6, t + length - 0.05, (0.04) / 3);
    return t + length;
  }

  voice.start(start);
  wobble.start(start);
  noise.start(start);

  return {
    out,
    scheduleUntil(time) {
      if (mode !== 'syllable') return;
      while (next < time) next = syllable(next);
    },
    end(at) {
      for (const source of [voice, wobble, noise]) {
        try {
          source.stop(at);
        } catch {
          // Already stopped.
        }
      }
    },
  };
}

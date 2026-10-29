// Audio for cards. Each text has a recorded clip in each of two voices, listed
// in clips.json (made by scripts/generate-audio.mjs), and a word plays in one
// picked at random. It plays through the app's one AudioContext,
// which starts it at once. If a clip can't play, the browser's built-in speech
// voice reads the Tagalog text instead.
//
// Not every device has a Filipino voice. When it doesn't, we fall back to a
// voice whose spelling-to-sound rules are close to Tagalog's (Indonesian,
// Malay, then Spanish) and let the UI say so.

import { audioBusy, audioContext, audioRunning, clipsSupported, loadClip, msUntilHeard, playBuffer, runningContext, type Sound } from './audio-engine';
import clips from './clips.json';
import thockFile from './sounds/tap-thock.mp3?inline';
import { hapticTick } from './haptics';
import { microphoneInUse } from './microphone';
import type { Card } from './deck';

/** Language codes to try, best first. "fil" and "tl" are both used for Filipino/Tagalog. */
const PREFERRED = ['fil', 'tl', 'id', 'ms', 'es'];

let voice: SpeechSynthesisVoice | null = null;
let voiceReady: Promise<void> | null = null;

export type VoiceQuality = 'recorded' | 'native' | 'approximate' | 'none';

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  for (const lang of PREFERRED) {
    const match = voices.find((v) => v.lang.toLowerCase().replace('_', '-').split('-')[0] === lang);
    if (match) return match;
  }
  return null;
}

/** Voices load asynchronously in most browsers; resolve once they're available. */
export function initVoices(): Promise<void> {
  if (voiceReady) return voiceReady;
  voiceReady = new Promise((resolve) => {
    if (!speechSupported()) return resolve();
    const tryPick = () => {
      const voices = speechSynthesis.getVoices();
      if (voices.length === 0) return false;
      voice = pickVoice(voices);
      resolve();
      return true;
    };
    if (tryPick()) return;
    speechSynthesis.addEventListener('voiceschanged', () => tryPick(), { once: true });
    // Some browsers never fire voiceschanged; don't wait forever.
    setTimeout(resolve, 1500);
  });
  return voiceReady;
}

/** Whether words can be heard at all: from recorded clips, or the built-in voice. */
export function canPlay(): boolean {
  return clipsSupported() || speechSupported();
}

export function voiceQuality(): VoiceQuality {
  if (clipsSupported() && Object.keys(CLIPS).length > 0) return 'recorded';
  if (!speechSupported()) return 'none';
  const lang = voice?.lang.toLowerCase() ?? '';
  return lang.startsWith('fil') || lang.startsWith('tl') ? 'native' : 'approximate';
}

/** Clip files by the text they say, one take per voice: `<name>.mp3`, and `<name>-slow.mp3` said slowly. */
const CLIPS: Record<string, string[]> = clips;

/** Which voice each text last played in, so its slow version is the same voice slowed down. */
const lastVoice = new Map<string, number>();

/** The clips for this text, one per voice. */
function clipUrls(card: Pick<Card, 'tl' | 'say'>, slow = false): string[] {
  return (CLIPS[card.say ?? card.tl] ?? []).map((name) => clipFile(name, slow));
}

/** The clip for this text in one voice (the first unless given), if there is one. */
export function clipUrl(card: Pick<Card, 'tl' | 'say'>, slow = false, voice = 0): string | null {
  return clipUrls(card, slow)[voice] ?? null;
}

function clipFile(name: string, slow: boolean): string {
  return `${import.meta.env.BASE_URL}audio/${name}${slow ? '-slow' : ''}.mp3`;
}

/** Every clip file, to keep offline. */
export function allClipUrls(): string[] {
  return Object.values(CLIPS).flatMap((names) => names.flatMap((name) => [clipFile(name, false), clipFile(name, true)]));
}

/** Load a word's clips ahead, in every voice as either may play, so a tap only has to start one. Plays nothing. */
export function preload(card: Pick<Card, 'tl' | 'say'>): void {
  if (muted || !clipsSupported()) return;
  for (const url of clipUrls(card)) void loadClip(url).catch(() => {});
}

let currentClip: Sound | null = null;
/** The play() still loading its clip, by generation, so a screen waiting for the word knows it's coming. */
let loading: number | null = null;
/** Settles with how long the last play() took to be heard, in ms, or null if nothing played. */
let started: Promise<number | null> = Promise.resolve(null);
let reportStart: (ms: number | null) => void = () => {};

/** How long after the last play() call its sound was heard, in ms: for checking audio lag on a device. */
export function lastStartDelay(): Promise<number | null> {
  return started;
}
/** Set while the sound is off (quiet mode): nothing plays at all. */
let muted = false;

/** Whether the sound being off has muted everything, for other players to follow. */
export function audioMuted(): boolean {
  return muted;
}

export function setMuted(on: boolean): void {
  muted = on;
  if (!on) return;
  stop();
  currentChime?.stop();
}
/** Bumped by stop(), so a play() still loading a clip or voices doesn't start afterwards. */
let generation = 0;

/** Play a card, or any Tagalog text (an example sentence) given as `{ tl }`. */
export async function play(card: Pick<Card, 'tl' | 'say'>, slow = false): Promise<void> {
  stop();
  started = new Promise((resolve) => (reportStart = resolve));
  const report = reportStart;
  if (muted) return report(null);
  const tapped = performance.now();
  const mine = generation;
  try {
    await playNow(card, slow, mine, tapped, report);
  } finally {
    if (loading === mine) loading = null;
  }
}

/** Play one recording given by its URL, as play() plays a card's clip, but with no voice to fall back on. */
export async function playUrl(url: string): Promise<void> {
  stop();
  started = new Promise((resolve) => (reportStart = resolve));
  const report = reportStart;
  if (muted || !clipsSupported()) return report(null);
  const tapped = performance.now();
  const mine = generation;
  try {
    if (!(await playClip(url, mine, tapped, report)) && mine === generation) report(null);
  } finally {
    if (loading === mine) loading = null;
  }
}

/** Play a clip unless stop() came first: whether it played, false if it couldn't load or start. */
async function playClip(url: string, mine: number, tapped: number, report: (ms: number | null) => void): Promise<boolean> {
  // Made or resumed now, inside the tap, as the clip may only be ready after it.
  audioContext();
  // Counted as playing until the word starts, so a screen (or a lit button) waits for it.
  loading = mine;
  try {
    const buffer = await loadClip(url);
    if (mine !== generation) return true;
    // A context iOS won't start (outside a tap) plays nothing, so it counts as not played (play() has the voice read it).
    if (!(await audioRunning(audioContext()))) throw new Error('audio suspended');
    if (mine !== generation) return true;
    const sound = (currentClip = playBuffer(buffer, { at: afterChime() }));
    void sound.done.then(() => {
      if (currentClip === sound) currentClip = null;
    });
    report(performance.now() - tapped + msUntilHeard(sound.startsAt));
    return true;
  } catch {
    return false;
  }
}

async function playNow(card: Pick<Card, 'tl' | 'say'>, slow: boolean, mine: number, tapped: number, report: (ms: number | null) => void): Promise<void> {
  const text = card.say ?? card.tl;
  const urls = clipsSupported() ? clipUrls(card, slow) : [];
  // A new voice at random each time, except that a slow replay keeps the one just heard.
  const last = lastVoice.get(text);
  const take = slow && last !== undefined && last < urls.length ? last : Math.floor(Math.random() * urls.length);
  if (urls.length) lastVoice.set(text, take);
  const url = urls[take];
  if (url && (await playClip(url, mine, tapped, report))) return;
  if (mine !== generation) return;
  if (!speechSupported()) return report(null);
  loading = mine;
  await initVoices();
  if (mine !== generation) return;
  const utterance = new SpeechSynthesisUtterance(card.say ?? card.tl);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = 'fil-PH';
  }
  utterance.rate = slow ? 0.6 : 0.9;
  utterance.onstart = () => report(performance.now() - tapped);
  utterance.onend = utterance.onerror = () => report(null);
  speechSynthesis.speak(utterance);
}

/**
 * A soft two-note chime for a right answer. It's short and quiet, as praise
 * should stay small, and goes quiet with the words while the sound is off. A word
 * played with it (the answer, said back) starts once it's done, not over it.
 */
export async function chime(): Promise<void> {
  if (muted || !clipsSupported()) return;
  const ctx = audioContext();
  // Outside a tap (a spoken answer judged) iOS may not start the context; better no chime than one on the next tap.
  if (!(await audioRunning(ctx)) || muted) return;
  if (chimeBuffer?.sampleRate !== ctx.sampleRate) chimeBuffer = chimeSound(ctx);
  const sound = (currentChime = playBuffer(chimeBuffer));
  void sound.done.then(() => currentChime === sound && (currentChime = null));
  lastChime = { ctx, ends: sound.startsAt + chimeBuffer.duration };
}

let chimeBuffer: AudioBuffer | null = null;
/** Stopped by the sound going off, but not by a word starting, which waits for it instead. */
let currentChime: Sound | null = null;
/** When the last chime ends, in its context's time. */
let lastChime: { ctx: AudioContext; ends: number } | null = null;

/** When a word may start so it doesn't play over a chime: 0, for now, unless one is still sounding. */
function afterChime(): number {
  // A new context counts from 0 again, so a chime from an old one doesn't hold a word back.
  return lastChime && lastChime.ctx === audioContext() ? lastChime.ends : 0;
}

/** Two short bell-like notes rising a fifth (E5 to B5), each fading out quickly. */
function chimeSound(ctx: AudioContext): AudioBuffer {
  return bell(ctx, 0.36, [
    { at: 0, freq: 659.25, level: 0.12, decay: 0.07 },
    { at: 0.09, freq: 987.77, level: 0.12, decay: 0.07 },
  ]);
}

/** How often the waiting sound comes while something is on its way. */
const WAITING_EVERY_MS = 1200;

/**
 * A soft low note now and every so often, until the returned function stops it: something is on its way (a call
 * connecting), for someone not looking at the screen. Quiet while the sound is off, like the chime.
 */
export function waitingSound(): () => void {
  const pulse = () => void playMade('waiting', (ctx) => bell(ctx, 0.18, [{ at: 0, freq: 523.25, level: 0.07, decay: 0.05 }]));
  pulse();
  const timer = setInterval(pulse, WAITING_EVERY_MS);
  return () => clearInterval(timer);
}

/** Three notes rising (C5, E5, G5): it's ready, after waitingSound. */
export function readySound(): Promise<void> {
  return playMade('ready', (ctx) =>
    bell(ctx, 0.5, [
      { at: 0, freq: 523.25, level: 0.1, decay: 0.07 },
      { at: 0.1, freq: 659.25, level: 0.1, decay: 0.07 },
      { at: 0.2, freq: 783.99, level: 0.12, decay: 0.1 },
    ]),
  );
}

/** Sounds made in code once per context rate, by name. */
const madeSounds = new Map<string, AudioBuffer>();

/** Play a sound made in code, if the shared context will start (outside a tap iOS may not let it: then nothing). */
async function playMade(name: string, make: (ctx: AudioContext) => AudioBuffer): Promise<void> {
  if (muted || !clipsSupported()) return;
  const ctx = audioContext();
  if (!(await audioRunning(ctx)) || muted) return;
  let buffer = madeSounds.get(name);
  if (buffer?.sampleRate !== ctx.sampleRate) madeSounds.set(name, (buffer = make(ctx)));
  playBuffer(buffer);
}

/** Soft bell-like notes, made in code: each starts at `at` seconds and fades out over about `decay`. */
function bell(ctx: AudioContext, seconds: number, notes: { at: number; freq: number; level: number; decay: number }[]): AudioBuffer {
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.round(rate * seconds), rate);
  const data = buffer.getChannelData(0);
  for (const { at, freq, level, decay } of notes) {
    for (let i = Math.round(at * rate); i < data.length; i++) {
      const t = i / rate - at;
      const envelope = Math.min(1, t / 0.003) * Math.exp(-t / decay);
      // A little of the octave above makes it a bell rather than a beep.
      data[i] += level * envelope * (Math.sin(2 * Math.PI * freq * t) + 0.2 * Math.sin(4 * Math.PI * freq * t));
    }
  }
  return buffer;
}

/** Settings' Tap sounds switch. */
let tapSounds = true;

export function setTapSounds(on: boolean): void {
  tapSounds = on;
}

/** Whether a tap sound may play: Tap sounds on, not silent, and no microphone in use to catch it. */
function tapSoundsCanPlay(): boolean {
  return tapSounds && !muted && clipsSupported() && !microphoneInUse();
}

/** The two tap sounds: a thock for the big chunky buttons, a lighter click for pills, chips and small controls. */
export type TapKind = 'thock' | 'click';

/**
 * The thock is a recording of a real key press, as a synthesised one came out
 * as a drum or a "duk". It's one press from "Keyboard single key presses" by
 * 5ro4 on freesound.org (sound 609534, public domain, CC0), pitched down six
 * semitones, its low end lifted and its top softened, then levelled. Inlined
 * into the app as a data URL (a few KB), so it plays offline with no file to
 * cache.
 */
let thock: Promise<AudioBuffer> | null = null;
let clickBuffer: AudioBuffer | null = null;

/** Decode the thock ahead, offline, so a press only has to start it. Kept here rather than among the recent clips, which come and go. */
function loadThock(): Promise<AudioBuffer> {
  thock ??= loadClip(thockFile).catch((error) => {
    thock = null;
    throw error;
  });
  return thock;
}

/**
 * A soft tap sound for a press, much shorter than the chime.
 * Not when the press already made a sound (a word, the chime, a sound on the
 * results screen) or one is still playing, nor while the microphone is in use,
 * where it would be recorded.
 */
export function tick(kind: TapKind = 'thock'): void {
  if (!tapSoundsCanPlay()) return;
  // A word or the chime takes the shared context inside the press, and a reference sound or slice too.
  if (audioBusy(250) || speaking()) return;
  const ctx = audioContext(true);
  if (kind === 'thock') {
    // Decoded ahead (tickOnPress), so this only waits a moment.
    void loadThock()
      .then((buffer) => playBuffer(buffer, { fades: false, incidental: true }))
      .catch(() => {});
    return;
  }
  if (clickBuffer?.sampleRate !== ctx.sampleRate) {
    const samples = clickSamples(ctx.sampleRate);
    clickBuffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    clickBuffer.getChannelData(0).set(samples);
  }
  playBuffer(clickBuffer, { fades: false, incidental: true });
}

let detentBuffer: AudioBuffer | null = null;

/** How close together detent ticks may come, so a fast scrub stays a ratchet rather than a buzz. */
export const DETENT_GAP_MS = 45;

/**
 * Ticks for a finger dragged across something with steps in it (the memory
 * chart's days), like a picker wheel: the click at half its level, and a light
 * haptic tick where the phone allows one. Call the returned function with the
 * step under the finger as it moves, and with null when the drag ends.
 * Follows the Tap sounds switch; the sound off leaves only the haptic.
 */
export function detents(): (step: string | null) => void {
  let at: string | null = null;
  let last = -Infinity;
  return (step) => {
    // The first step of a drag is where it starts, not a step taken.
    const moved = at !== null && step !== null && step !== at;
    at = step;
    if (!moved || !tapSounds || performance.now() - last < DETENT_GAP_MS) return;
    last = performance.now();
    hapticTick();
    if (!tapSoundsCanPlay() || speaking()) return;
    // A drag isn't a tap, so iOS won't start audio from it: tick only if it's already going, never late.
    const ctx = runningContext();
    if (!ctx) return;
    if (detentBuffer?.sampleRate !== ctx.sampleRate) {
      const samples = clickSamples(ctx.sampleRate, 0.05);
      detentBuffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      detentBuffer.getChannelData(0).set(samples);
    }
    playBuffer(detentBuffer, { fades: false, incidental: true });
  };
}

/**
 * Gets the shared context going as a scrub begins, so its next steps tick,
 * not only once something else has played. iOS won't start a context from a
 * drag, so the very first scrub after opening the app may stay silent; one
 * resumed after a while idle starts. Plays nothing.
 */
export function readyDetents(): void {
  if (!tapSoundsCanPlay() || speaking()) return;
  audioContext(true);
}

export interface ScrubOptions {
  /** Shows what's under the pointer, and says which step it is, for the ticks (null for none). */
  pick(e: PointerEvent): string | null;
  /** As a press begins, before anything is picked: a chance to read where things are. */
  start?(e: PointerEvent): void;
  /** A tap, which clicks like any press. Left out, a tap is left to the control under it (its click ticks itself). */
  tap?(e: PointerEvent): void;
  /** Mice left to the caller (the memory chart looks by hovering). */
  skipMouse?: boolean;
}

/**
 * Scrubbing across something with steps in it (the memory chart's days, a spoken word's sounds by its letters or
 * along its recording): one finger dragged sideways picks each step in turn, ticking at each (see `detents`); a drag
 * that starts up or down is left to scroll the page; a tap is a press. A second finger, or a mouse's other buttons,
 * are left alone.
 */
export function scrubbable(el: HTMLElement, options: ScrubOptions): void {
  const detent = detents();
  let touch: { x: number; y: number; scrub: boolean } | null = null;
  const skip = (e: PointerEvent) => !e.isPrimary || (options.skipMouse === true && e.pointerType === 'mouse');
  el.addEventListener('pointerdown', (e) => {
    if (skip(e) || e.button > 0) return;
    options.start?.(e);
    touch = { x: e.clientX, y: e.clientY, scrub: false };
  });
  el.addEventListener('pointermove', (e) => {
    if (!touch || skip(e)) return;
    // A mouse let go off it, so its lift never came here: nothing is held now.
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      touch = null;
      return;
    }
    const dx = Math.abs(e.clientX - touch.x);
    const dy = Math.abs(e.clientY - touch.y);
    if (!touch.scrub && dy > 8 && dy >= dx) touch = null;
    else if (touch.scrub || (dx > 8 && dx > dy)) {
      if (!touch.scrub) {
        // Audio is got going as the scrub begins (not for a touch that scrolls), so its next step ticks.
        readyDetents();
        // So a finger or mouse dragged off it keeps scrubbing. Only now, so a tap still reaches the control under it.
        el.setPointerCapture?.(e.pointerId);
      }
      touch.scrub = true;
      detent(options.pick(e));
    }
  });
  el.addEventListener('pointerup', (e) => {
    if (skip(e)) return;
    if (touch && !touch.scrub && options.tap) {
      options.tap(e);
      tick('click');
    }
    touch = null;
    detent(null);
  });
  el.addEventListener('pointercancel', (e) => {
    if (skip(e)) return;
    touch = null;
    detent(null);
  });
}

/**
 * The click for pills and small controls, made in code: a very short burst of
 * dull noise (the contact) ringing two heavily damped resonances, with no
 * pitch to it, so it reads as a light switch rather than a bell.
 */
export function clickSamples(rate: number, level = 0.1): Float32Array {
  const length = 0.04;
  const contact = 0.0012;
  const lowpass = 0.6;
  // Frequency (Hz), how fast it dies away (s), and how much of it.
  const modes = [
    [1400, 0.004, 1],
    [2900, 0.0025, 0.5],
  ];
  const n = Math.round(rate * length);
  // The same noise every time, so every press sounds alike.
  let seed = 1;
  let dull = 0;
  const burst = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    dull += lowpass * ((seed / 2 ** 32) * 2 - 1 - dull);
    burst[i] = dull * Math.exp(-i / rate / contact);
  }
  const data = burst.map((x) => 0.5 * x);
  for (const [freq, decay, amount] of modes) {
    // A two-pole resonator, ringing at `freq` and dying away over `decay`.
    const r = Math.exp(-1 / (rate * decay));
    const a1 = 2 * r * Math.cos((2 * Math.PI * freq) / rate);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const y = burst[i] + a1 * y1 - r * r * y2;
      data[i] += amount * y;
      y2 = y1;
      y1 = y;
    }
  }
  // A last few ms' fall, so it doesn't click off, then scaled to its level.
  let peak = 0;
  for (let i = 0; i < n; i++) {
    data[i] *= Math.min(1, (n - i) / (rate * 0.004));
    peak = Math.max(peak, Math.abs(data[i]));
  }
  return data.map((x) => (x / peak) * level);
}

/**
 * Everything that can be tapped: buttons, a section opening (`summary`), links, checkboxes and radios.
 * A label isn't listed, as tapping one clicks its checkbox too. A drill card that turns over when tapped anywhere on
 * it (`data-turnable`) clicks like a pill.
 */
const TAPPABLE = 'button, summary, a[href], [role="button"], input[type="checkbox"], input[type="radio"], [data-turnable]';
/** The big chunky buttons, which thock; everything else tappable (chips, pills, small and text controls) clicks. */
const CHUNKY = '.btn:not(.small), .hub-btn, .choice, .rate, .icon-btn';

/**
 * Tap for every control pressed under `root`. Two marks change that:
 * - `data-no-tap`: silent, for a control that starts recording, which would catch the tap.
 * - `data-tap="before"`: tapped before its own handler runs, for one that may open the microphone inside the press
 *   (starting a Chat call, opening Drills, choosing Speak or turning the mic on in a round), after which nothing
 *   would tap. It reads the mute from before the press, so it's only for presses that don't change it to silent.
 */
export function tickOnPress(root: Node): void {
  if (clipsSupported()) void loadThock().catch(() => {});
  const kind = (control: Element): TapKind => (control.matches(CHUNKY) ? 'thock' : 'click');
  root.addEventListener(
    'click',
    (e) => {
      const control = (e.target as Element).closest?.(TAPPABLE);
      if (control?.getAttribute('data-tap') === 'before') tick(kind(control));
    },
    true,
  );
  // Bubbling, so it runs after the control's own handler, which may have played a word.
  root.addEventListener('click', (e) => {
    const control = (e.target as Element).closest?.(TAPPABLE);
    if (control && !control.hasAttribute('data-no-tap') && control.getAttribute('data-tap') !== 'before') tick(kind(control));
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
}

/** Stop any word playing. */
export function stop(): void {
  generation++;
  reportStart(null);
  currentClip?.stop();
  currentClip = null;
  // Safari can drop a word spoken straight after a cancel, so only cancel when something is playing or stuck.
  if (speechSupported() && (speechSynthesis.speaking || speechSynthesis.pending || speechSynthesis.paused)) {
    speechSynthesis.cancel();
  }
}

/** Whether a card is still being heard, so a screen moving on by itself can wait for it. */
export function speaking(): boolean {
  if (currentClip || loading === generation) return true;
  // Pending until the voice gets going, which can take a moment.
  return speechSupported() && (speechSynthesis.speaking || speechSynthesis.pending);
}

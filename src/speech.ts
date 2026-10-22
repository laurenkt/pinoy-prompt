// Audio for cards. Each text has a recorded clip, listed in clips.json (made
// by scripts/generate-audio.mjs); it plays through the app's one AudioContext,
// which starts it at once. If a clip can't play, the browser's built-in speech
// voice reads the Tagalog text instead.
//
// Not every device has a Filipino voice. When it doesn't, we fall back to a
// voice whose spelling-to-sound rules are close to Tagalog's (Indonesian,
// Malay, then Spanish) and let the UI say so.

import { audioContext, audioRunning, clipsSupported, loadClip, msUntilHeard, playBuffer, type Sound } from './audio-engine';
import clips from './clips.json';
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

/** Clip files by the text they say: `<name>.mp3`, and `<name>-slow.mp3` said slowly. */
const CLIPS: Record<string, string> = clips;

/** The clip for this text, if there is one. */
export function clipUrl(card: Pick<Card, 'tl' | 'say'>, slow = false): string | null {
  const name = CLIPS[card.say ?? card.tl];
  return name ? clipFile(name, slow) : null;
}

function clipFile(name: string, slow: boolean): string {
  return `${import.meta.env.BASE_URL}audio/${name}${slow ? '-slow' : ''}.mp3`;
}

/** Every clip file, to keep offline. */
export function allClipUrls(): string[] {
  return Object.values(CLIPS).flatMap((name) => [clipFile(name, false), clipFile(name, true)]);
}

/** Load a word's clip ahead, so a tap only has to start it. Plays nothing. */
export function preload(card: Pick<Card, 'tl' | 'say'>): void {
  const url = !muted && clipsSupported() ? clipUrl(card) : null;
  if (url) void loadClip(url).catch(() => {});
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
/** Set by quiet mode without headphones: nothing plays at all. */
let muted = false;

export function setMuted(on: boolean): void {
  muted = on;
  if (on) stop();
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
  const url = clipsSupported() ? clipUrl(card, slow) : null;
  if (url) {
    // Made or resumed now, inside the tap, as the clip may only be ready after it.
    audioContext();
    loading = mine;
    try {
      const buffer = await loadClip(url);
      if (mine !== generation) return;
      // A context iOS won't start (outside a tap) plays nothing, so the voice reads it instead.
      if (!(await audioRunning(audioContext()))) throw new Error('audio suspended');
      if (mine !== generation) return;
      const sound = (currentClip = playBuffer(buffer));
      void sound.done.then(() => {
        if (currentClip === sound) currentClip = null;
      });
      report(performance.now() - tapped + msUntilHeard(sound.startsAt));
      return;
    } catch {
      // Fall through to speech if the clip can't play.
      if (mine !== generation) return;
    } finally {
      if (loading === mine) loading = null;
    }
  }
  if (!speechSupported()) return report(null);
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
  return speechSupported() && speechSynthesis.speaking;
}

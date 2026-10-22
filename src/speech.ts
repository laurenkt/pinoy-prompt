// Audio for cards. A recorded clip is used when there is one (card.audio, or
// the clip made for that text, listed in clips.json); it plays through the
// app's one AudioContext, which starts it at once. Otherwise the browser's
// built-in speech voice reads the Tagalog text.
//
// Not every device has a Filipino voice. When it doesn't, we fall back to a
// voice whose spelling-to-sound rules are close to Tagalog's (Indonesian,
// Malay, then Spanish) and let the UI say so.

import { audioContext, audioRunning, clipsSupported, loadClip, msUntilHeard, playBuffer, type Sound } from './audio-engine';
import { setAudioSession } from './audio-session';
import clips from './clips.json';
import type { Card } from './deck';
import { microphoneOpen } from './microphone';

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
export function clipUrl(card: Pick<Card, 'tl' | 'audio' | 'say'>, slow = false): string | null {
  const base = `${import.meta.env.BASE_URL}audio/`;
  if (card.audio) return base + card.audio;
  const name = CLIPS[card.say ?? card.tl];
  return name ? `${base}${name}${slow ? '-slow' : ''}.mp3` : null;
}

/** Load a word's clip ahead, so a tap only has to start it. Plays nothing. */
export function preload(card: Pick<Card, 'tl' | 'audio' | 'say'>): void {
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
  if (on) stop(true);
}
/** Bumped by stop(), so a play() still loading a clip or voices doesn't start afterwards. */
let generation = 0;

/**
 * iOS mutes the built-in voice when the phone is on silent, whatever the audio
 * session says, but lets media through. A silent track playing alongside the
 * voice makes iOS treat the page as a media player, so the voice is heard too.
 */
let silence: HTMLAudioElement | null = null;
/**
 * Restarting the track makes iOS switch the audio session again, which delays or drops
 * the next word, so it keeps running between words and stops only after a quiet spell.
 */
const RELEASE_AFTER_MS = 15_000;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

function releaseSoon(): void {
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(releaseWhenQuiet, RELEASE_AFTER_MS);
}

/** Pausing the track mid-word would let iOS mute the rest of it, so wait for the word to end. */
function releaseWhenQuiet(): void {
  if (speaking()) releaseSoon();
  else releaseMediaSession();
}

function releaseMediaSession(): void {
  clearTimeout(releaseTimer);
  releaseTimer = undefined;
  silence?.pause();
}

/** Half a second of silence as an 8 kHz, 8-bit WAV. */
function silentWav(): string {
  const samples = 4000;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8-bit silence is the midpoint
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
}

/** Start the silent track. Called straight from the tap, as iOS only starts media then. */
function holdMediaSession(): void {
  // The microphone's session isn't muted by the switch, and recording shouldn't share it with a track.
  if (typeof Audio === 'undefined' || microphoneOpen()) return;
  clearTimeout(releaseTimer);
  releaseTimer = undefined;
  silence ??= Object.assign(new Audio(silentWav()), { loop: true });
  if (silence.paused) void silence.play()?.catch(() => {});
}

/** Play a card, or any Tagalog text (an example sentence) given as `{ tl }`. */
export async function play(card: Pick<Card, 'tl' | 'audio' | 'say'>, slow = false): Promise<void> {
  stop();
  started = new Promise((resolve) => (reportStart = resolve));
  const report = reportStart;
  if (muted) return report(null);
  const tapped = performance.now();
  const mine = generation;
  // Play through the iPhone's silent switch, unless the microphone needs the session. Before
  // iOS 17 only media gets through, and so does a voice or Web Audio playing alongside it.
  // Started now, inside the tap, as the voice may only be needed once a clip fails to load.
  if (!microphoneOpen()) setAudioSession('playback');
  holdMediaSession();
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
      // A slow clip is said slowly already; a card's own clip is slowed down instead.
      const sound = (currentClip = playBuffer(buffer, slow && card.audio ? 0.75 : 1));
      void sound.done.then(() => {
        if (currentClip !== sound) return;
        currentClip = null;
        releaseSoon();
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
  if (!speechSupported()) {
    releaseMediaSession();
    report(null);
    return;
  }
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
  utterance.onend = utterance.onerror = () => {
    report(null);
    if (mine === generation) releaseSoon();
  };
  // Also counted from the start, as iOS sometimes skips onend; no word takes this long.
  releaseSoon();
  speechSynthesis.speak(utterance);
}

// iOS sometimes skips an utterance's onend, so never leave the track looping in the background.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(true);
  });
}

/** Stop any word playing. `release` also stops the silent track now: for leaving a screen or recording. */
export function stop(release = false): void {
  generation++;
  reportStart(null);
  currentClip?.stop();
  currentClip = null;
  if (release) releaseMediaSession();
  // Keeps a countdown already running, so stepping on through cards doesn't hold the track forever.
  else if (silence && !silence.paused && releaseTimer === undefined) releaseSoon();
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

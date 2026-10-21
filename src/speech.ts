// Audio for cards. A recorded clip (card.audio) is used when present; otherwise
// the browser's built-in speech voice reads the Tagalog text.
//
// Not every device has a Filipino voice. When it doesn't, we fall back to a
// voice whose spelling-to-sound rules are close to Tagalog's (Indonesian,
// Malay, then Spanish) and let the UI say so.

import { setAudioSession } from './audio-session';
import type { Card } from './deck';
import { microphoneOpen } from './microphone';

/** Language codes to try, best first. "fil" and "tl" are both used for Filipino/Tagalog. */
const PREFERRED = ['fil', 'tl', 'id', 'ms', 'es'];

let voice: SpeechSynthesisVoice | null = null;
let voiceReady: Promise<void> | null = null;

export type VoiceQuality = 'native' | 'approximate' | 'none';

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

export function voiceQuality(): VoiceQuality {
  if (!speechSupported()) return 'none';
  const lang = voice?.lang.toLowerCase() ?? '';
  return lang.startsWith('fil') || lang.startsWith('tl') ? 'native' : 'approximate';
}

let currentClip: HTMLAudioElement | null = null;
/** Set by quiet mode without headphones: nothing plays at all. */
let muted = false;

export function setMuted(on: boolean): void {
  muted = on;
  if (on) stop();
}
/** Bumped by stop(), so a play() still loading a clip or voices doesn't start afterwards. */
let generation = 0;

/**
 * iOS mutes the built-in voice when the phone is on silent, whatever the audio
 * session says, but lets media through. A silent track playing alongside the
 * voice makes iOS treat the page as a media player, so the voice is heard too.
 */
let silence: HTMLAudioElement | null = null;

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
  silence ??= Object.assign(new Audio(silentWav()), { loop: true });
  void silence.play()?.catch(() => {});
}

/** Play a card, or any Tagalog text (an example sentence) given as `{ tl }`. */
export async function play(card: Pick<Card, 'tl' | 'audio' | 'say'>, slow = false): Promise<void> {
  stop();
  if (muted) return;
  // Play through the iPhone's silent switch, unless the microphone needs the session.
  if (!microphoneOpen()) setAudioSession('playback');
  holdMediaSession();
  const mine = generation;
  if (card.audio) {
    currentClip = new Audio(`${import.meta.env.BASE_URL}audio/${card.audio}`);
    currentClip.playbackRate = slow ? 0.75 : 1;
    try {
      await currentClip.play();
      return;
    } catch {
      // Fall through to speech if the clip can't play.
    }
  }
  if (!speechSupported() || mine !== generation) return;
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
  utterance.onend = utterance.onerror = () => {
    if (mine === generation) silence?.pause();
  };
  speechSynthesis.speak(utterance);
}

export function stop(): void {
  generation++;
  currentClip?.pause();
  currentClip = null;
  silence?.pause();
  if (speechSupported()) speechSynthesis.cancel();
}

/** Whether a card is still being heard, so a screen moving on by itself can wait for it. */
export function speaking(): boolean {
  if (currentClip && !currentClip.paused && !currentClip.ended) return true;
  return speechSupported() && speechSynthesis.speaking;
}

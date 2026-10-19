// Audio for cards. A recorded clip (card.audio) is used when present; otherwise
// the browser's built-in speech voice reads the Tagalog text.
//
// Not every device has a Filipino voice. When it doesn't, we fall back to a
// voice whose spelling-to-sound rules are close to Tagalog's (Indonesian,
// Malay, then Spanish) and let the UI say so.

import type { Card } from './deck';

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
/** Bumped by stop(), so a play() still loading a clip or voices doesn't start afterwards. */
let generation = 0;

export async function play(card: Card, slow = false): Promise<void> {
  stop();
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
  const utterance = new SpeechSynthesisUtterance(card.tl);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = 'fil-PH';
  }
  utterance.rate = slow ? 0.6 : 0.9;
  speechSynthesis.speak(utterance);
}

export function stop(): void {
  generation++;
  currentClip?.pause();
  currentClip = null;
  if (speechSupported()) speechSynthesis.cancel();
}

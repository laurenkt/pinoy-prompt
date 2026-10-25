// Every piece of Tagalog the app can say out loud, so each can have a recorded
// clip (see scripts/generate-audio.mjs). What play() is given must be in here:
// src/spoken.test.ts checks that each one has its clip.

import { ASKED_VOCAB } from './deck';
import { GUIDES } from './guides';
import { drillSentence } from './session';

/** The text play() is keyed by: what the voice should say. */
export function spokenText(card: { tl: string; say?: string }): string {
  return card.say ?? card.tl;
}

/** Every text the app can play, once each, in deck order. */
export function allSpoken(): string[] {
  const texts = [
    ...ASKED_VOCAB.map(spokenText),
    ...GUIDES.flatMap((g) => [
      ...(g.examples ?? []).map(spokenText),
      ...(g.drills ?? []).filter((d) => d.tl).map((d) => drillSentence(d)),
    ]),
  ];
  return [...new Set(texts)];
}

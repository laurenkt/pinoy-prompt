// Pictures for cards that have one (`picture` in deck.ts), which recall sometimes shows in place of the English.
// They're OpenMoji's (https://openmoji.org, CC BY-SA 4.0): flat colour with bold black outlines, as the app draws.
// Each is a file in src/pictures/ named by its emoji's code points, as OpenMoji names it, built into the app so a
// picture shows offline.

import type { Card } from './deck';

const files = import.meta.glob<string>('./pictures/*.svg', { query: '?raw', import: 'default', eager: true });

/** The file name OpenMoji gives an emoji: its code points in hex, without the emoji presentation selector. */
export function pictureFile(emoji: string): string {
  return [...emoji]
    .map((c) => c.codePointAt(0)!.toString(16).toUpperCase())
    .filter((hex) => hex !== 'FE0F')
    .join('-');
}

const pictures = new Map(Object.entries(files).map(([path, svg]) => [path.slice('./pictures/'.length, -'.svg'.length), svg]));

/** Every picture file there is, by name. */
export function pictureFiles(): string[] {
  return [...pictures.keys()];
}

/** The card's picture as SVG markup, if it has one. */
export function pictureOf(card: Card): string | undefined {
  return card.picture ? pictures.get(pictureFile(card.picture)) : undefined;
}

/** How often recall shows a card's picture instead of its English, when it has one. */
export const PICTURE_CHANCE = 0.5;

/** Whether to ask this card's recall from its picture this time. Decided once per question, so a redraw keeps it. */
export function askWithPicture(card: Card, random: () => number = Math.random): boolean {
  return pictureOf(card) !== undefined && random() < PICTURE_CHANCE;
}

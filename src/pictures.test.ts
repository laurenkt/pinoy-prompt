// Pictures recall can ask from: every card's picture is in src/pictures/, every file there is a card's, and no two
// words share one, so a picture never has two right answers.

import { describe, expect, it } from 'vitest';
import { VOCAB, getCard } from './deck';
import { askWithPicture, pictureFile, pictureFiles, pictureOf } from './pictures';

const pictured = VOCAB.filter((c) => c.picture);

describe('card pictures', () => {
  it('has a file for every card that names a picture', () => {
    expect(pictured.length).toBeGreaterThan(0);
    for (const card of pictured) expect(pictureOf(card), card.id).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
  });

  it('keeps no file no card uses', () => {
    const used = new Set(pictured.map((c) => pictureFile(c.picture!)));
    expect(pictureFiles().filter((f) => !used.has(f))).toEqual([]);
  });

  it('gives each picture to one card', () => {
    const files = pictured.map((c) => pictureFile(c.picture!));
    expect(new Set(files).size).toBe(files.length);
  });

  it('only gives pictures to words, which recall asks', () => {
    for (const card of pictured) expect(card.kind, card.id).toBe('word');
  });

  it("names a file by its emoji's code points, without the presentation selector", () => {
    expect(pictureFile('☕')).toBe('2615');
    expect(pictureFile('☂️')).toBe('2602');
    expect(pictureFile('🕐')).toBe('1F550');
  });

  it('asks from a picture some of the time, and never for a card without one', () => {
    const kape = getCard('kape')!;
    expect(askWithPicture(kape, () => 0)).toBe(true);
    expect(askWithPicture(kape, () => 0.99)).toBe(false);
    expect(askWithPicture(getCard('salamat')!, () => 0)).toBe(false);
  });
});

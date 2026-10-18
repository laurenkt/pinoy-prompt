import { describe, expect, it } from 'vitest';
import { ALL_CARDS, UNITS } from './deck';

describe('deck', () => {
  it('has unique card and unit ids', () => {
    expect(new Set(ALL_CARDS.map((c) => c.id)).size).toBe(ALL_CARDS.length);
    expect(new Set(UNITS.map((u) => u.id)).size).toBe(UNITS.length);
  });

  it('has unique English meanings so quiz answers are unambiguous', () => {
    const meanings = ALL_CARDS.map((c) => c.en.toLowerCase());
    expect(new Set(meanings).size).toBe(meanings.length);
  });

  it('gives every unit enough cards for a four-option quiz', () => {
    for (const unit of UNITS) expect(unit.cards.length).toBeGreaterThanOrEqual(4);
  });
});

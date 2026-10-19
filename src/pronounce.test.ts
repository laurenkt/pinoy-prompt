import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from './deck';
import { fold, judge, similarity, words } from './pronounce';

describe('words', () => {
  it('drops case, accents and punctuation and splits hyphens', () => {
    expect(words('Dahan-dahan lang po.')).toEqual(['dahan', 'dahan', 'lang', 'po']);
    expect(words('¿Kumustá?')).toEqual(['kumusta']);
  });

  it('reads digits as Tagalog numbers', () => {
    expect(words('3')).toEqual(['tatlo']);
    expect(words('10')).toEqual(['sampu']);
  });
});

describe('fold', () => {
  it('treats common spelling variants as the same sound', () => {
    expect(fold('pasensiya')).toBe(fold('pasensya'));
    expect(fold('siyam')).toBe(fold('syam'));
    expect(fold('kape')).toBe(fold('kapi'));
    expect(fold('tubig')).toBe(fold('tobig'));
    expect(fold('cafe')).toBe(fold('kape'));
  });

  it('keeps doubled vowels, which change the word', () => {
    expect(fold('oo')).toBe('oo');
    expect(fold('saan')).toBe('saan');
  });
});

describe('similarity', () => {
  it('is 1 for equal strings and falls with each edit', () => {
    expect(similarity('salamat', 'salamat')).toBe(1);
    expect(similarity('salamat', 'salamot')).toBeCloseTo(6 / 7);
    expect(similarity('', '')).toBe(1);
  });
});

describe('judge', () => {
  it('passes an exact transcript', () => {
    const v = judge(['Salamat po'], ['salamat po']);
    expect(v.pass).toBe(true);
    expect(v.marks.every((m) => m.ok)).toBe(true);
  });

  it('ignores how the recogniser splits words', () => {
    expect(judge(['Walang anuman'], ['walanganuman']).pass).toBe(true);
    expect(judge(['Dahan-dahan lang po.'], ['dahan dahan lang po']).pass).toBe(true);
  });

  it('accepts digits for numbers', () => {
    expect(judge(['tatlo'], ['3']).pass).toBe(true);
  });

  it('accepts alternative spellings listed on the card', () => {
    const v = judge(['Kumusta?', 'Kamusta?'], ['kamusta']);
    expect(v.pass).toBe(true);
    expect(v.marks).toEqual([{ text: 'Kumusta?', ok: true }]);
  });

  it('uses the best of the alternatives', () => {
    const v = judge(['Magandang umaga'], ['maganda mo ako', 'magandang umaga']);
    expect(v.pass).toBe(true);
    expect(v.heard).toBe('magandang umaga');
  });

  it('fails a different word and marks what was missed', () => {
    const v = judge(['Magandang gabi'], ['magandang hapon']);
    expect(v.pass).toBe(false);
    expect(v.marks).toEqual([
      { text: 'Magandang', ok: true },
      { text: 'gabi', ok: false },
    ]);
  });

  it('is strict with short words', () => {
    expect(judge(['isa'], ['isda']).pass).toBe(false);
    expect(judge(['Oo'], ['o']).pass).toBe(false);
  });

  it('reports nothing heard', () => {
    const v = judge(['Salamat'], []);
    expect(v).toMatchObject({ pass: false, close: false, heard: '', score: 0 });
    expect(v.marks).toEqual([{ text: 'Salamat', ok: false }]);
  });

  it('passes every card read back exactly', () => {
    for (const card of ALL_CARDS) expect(judge([card.tl], [card.tl.toLowerCase()]).pass, card.id).toBe(true);
  });

  it('keeps cards distinguishable from each other', () => {
    // No card should pass when the learner says a different card.
    for (const a of ALL_CARDS) {
      for (const b of ALL_CARDS) {
        if (a.id === b.id) continue;
        expect(judge([a.tl], [b.tl]).pass, `${a.id} vs ${b.id}`).toBe(false);
      }
    }
  });
});

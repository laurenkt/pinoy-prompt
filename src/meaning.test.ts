// Typed meanings are judged on meaning: typos, contractions and wording that
// says the same thing are right, a different meaning isn't.

import { describe, expect, it, vi } from 'vitest';
import { VOCAB, getCard } from './deck';
import { canTypeMeaning, judgeMeaning, matchesMeaning, meanings, words } from './meaning';

const card = (id: string) => getCard(id)!;

describe('matching a typed meaning on the device', () => {
  it.each([
    ['salamat', 'Thank you'],
    ['salamat', 'thank you!'],
    ['salamat', 'thanks'],
    ['salamat', 'Thank u'],
    ['mabuti', 'I am fine'],
    ['mabuti', 'im fine'],
    ['mabuti', 'I’m fine.'],
    ['hindi-maintindihan', 'i dont understand'],
    ['hindi-maintindihan', 'I do not undrestand'],
    ['kumusta', 'hello'],
    ['kumusta', 'hi'],
    ['kumusta', 'how are you'],
    ['isa', '1'],
    ['isa', 'One'],
    ['bukas', 'tommorow'],
    ['magandang-umaga', 'morning good'],
    ['magandang-umaga', 'a good morning'],
    ['dalawampu', '20'],
    ['dalawampu', 'twenty'],
    ['isang-libo', '1000'],
    ['isang-libo', '1,000'],
    ['isang-libo', 'one thousand'],
    ['nauuhaw-ako', 'im thirsy'],
    ['siya', 'he or she'],
    ['siya', 'he/she'],
    ['bahay', 'house / home'],
    ['sumakay', 'to ride'],
    ['sumakay', 'get on'],
    ['isang-daan', 'a hundred'],
  ])('%s: "%s" is right', (id, answer) => {
    expect(matchesMeaning(answer, card(id))).toBe(true);
  });

  it.each([
    ['magandang-umaga', 'good evening'],
    ['magandang-umaga', 'good'],
    ['magandang-umaga', 'not good morning'],
    ['salamat', "you're welcome"],
    ['isa', '2'],
    ['isa', 'polite'],
    ['salamat', ''],
    ['salamat', '?!'],
    ['lola', 'grandfather'],
    ['meron', 'three'],
    ['walo', 'eighty'],
    ['siya', 'he or they'],
    ['apat', 'fourth'],
    ['dalawampu', '21'],
  ])('%s: "%s" is not matched', (id, answer) => {
    expect(matchesMeaning(answer, card(id))).toBe(false);
  });

  it("takes every card's own meaning, as written", () => {
    for (const c of VOCAB.filter(canTypeMeaning)) expect(matchesMeaning(c.en, c), c.en).toBe(true);
  });

  it("never takes one card's meaning for another's", () => {
    const typeable = VOCAB.filter(canTypeMeaning);
    const same = (a: string[][], b: string[][]) => a.some((x) => b.some((y) => x.join(' ') === y.join(' ')));
    for (const target of typeable) {
      for (const other of typeable) {
        if (other === target || same(meanings(other), meanings(target))) continue;
        for (const answer of other.en.split('/')) expect(matchesMeaning(answer, target), `${answer} for ${target.en}`).toBe(false);
      }
    }
  });

  it('spells out contractions typed with or without the apostrophe', () => {
    expect(words("doesnt didn't wont can't Im")).toEqual(['does', 'not', 'did', 'not', 'will', 'not', 'can', 'not', 'i', 'am']);
    expect(words('youre were')).toEqual(['you', 'are', 'were']);
  });

  it('leaves other wording to the fuller check', () => {
    expect(matchesMeaning('thanks a lot', card('maraming-salamat'))).toBe(false);
  });

  it("doesn't ask for a meaning a card only has as a note", () => {
    expect(canTypeMeaning(card('mga'))).toBe(false);
    expect(canTypeMeaning(card('ba'))).toBe(false);
    expect(canTypeMeaning(card('salamat'))).toBe(true);
  });
});

describe('judging a typed meaning', () => {
  it("doesn't ask OpenAI when the device can tell", async () => {
    const ask = vi.fn(async () => false);
    expect(await judgeMeaning('thanks', card('salamat'), ask)).toEqual({ right: true });
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks OpenAI about other wording', async () => {
    const ask = vi.fn(async () => true);
    expect(await judgeMeaning('thanks a lot', card('maraming-salamat'), ask)).toEqual({ right: true });
    expect(ask).toHaveBeenCalledWith('thanks a lot', card('maraming-salamat'));
  });

  it("goes by the device's check without OpenAI, or when it fails, and says when it failed", async () => {
    expect(await judgeMeaning('thanks a lot', card('maraming-salamat'), null)).toEqual({ right: false });
    expect(await judgeMeaning('thanks a lot', card('maraming-salamat'), async () => null)).toEqual({ right: false });
    expect(await judgeMeaning('thanks a lot', card('maraming-salamat'), async () => Promise.reject(new Error('offline')))).toEqual({ right: false, failure: new Error('offline') });
  });

  it("counts an empty answer as not knowing, and doesn't ask about it", async () => {
    const ask = vi.fn(async () => true);
    expect(await judgeMeaning('  ', card('salamat'), ask)).toEqual({ right: false });
    expect(ask).not.toHaveBeenCalled();
  });
});

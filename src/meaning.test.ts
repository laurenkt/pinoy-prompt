// Typed meanings are judged on meaning: typos, contractions and wording that
// says the same thing are right, a different meaning isn't.

import { describe, expect, it, vi } from 'vitest';
import { VOCAB, getCard, type Card } from './deck';
import { canTypeMeaning, judgeMeaning, matchesMeaning, matchesTagalog, meanings, repeatsTagalog, words } from './meaning';

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
    ['gaano-katagal', 'how long it takes'],
    ['ano-ibig-sabihin', 'what this means'],
    ['meron-ba-kayong', 'you have bread?'],
    ['ano-ibig-sabihin', "what's this mean"],
    ['ano-ibig-sabihin', 'whats this mean'],
    ['kumusta', 'how do you do'],
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
    ['kumusta', 'how do you'],
    ['paano-sabihin', 'how are you say this in tagalog'],
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
    expect(ask).toHaveBeenCalledWith('thanks a lot', card('maraming-salamat'), 'en');
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

  it("takes the Tagalog said back as wrong, without asking OpenAI, which would say it means the same", async () => {
    const ask = vi.fn(async () => true);
    expect(await judgeMeaning('Salamat', card('salamat'), ask)).toEqual({ right: false });
    expect(await judgeMeaning('salamat po.', card('salamat'), ask)).toEqual({ right: false });
    expect(await judgeMeaning('Kamusta', card('kumusta'), ask)).toEqual({ right: false });
    expect(await judgeMeaning('maraming salamat', card('maraming-salamat'), ask)).toEqual({ right: false });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('telling the Tagalog said back from an answer', () => {
  it.each([
    ['salamat', 'Salamat'],
    ['salamat', 'salamat po'],
    ['kumusta', 'Kumusta?'],
    ['kumusta', 'kamusta'],
    ['mabuti', 'mabuti naman'],
    ['mabuti', 'Mabuti'],
  ])('%s: "%s" is the Tagalog', (id, answer) => {
    expect(repeatsTagalog(answer, card(id))).toBe(true);
  });

  it.each([
    ['salamat', 'thank you'],
    ['salamat', 'salamat, thank you'],
    ['salamat', 'po'],
    ['salamat', ''],
    ['kumusta', 'salamat'],
  ])('%s: "%s" is not', (id, answer) => {
    expect(repeatsTagalog(answer, card(id))).toBe(false);
  });

  it('still takes an English word the card shares with its Tagalog', async () => {
    expect(await judgeMeaning('the bill', card('bill-po'), null)).toEqual({ right: true });
    // Not matched on the device, but English, so OpenAI is asked.
    const ask = vi.fn(async () => true);
    expect(await judgeMeaning('okay', card('okay-lang-ako'), ask)).toEqual({ right: true });
    expect(ask).toHaveBeenCalledWith('okay', card('okay-lang-ako'), 'en');
    expect(repeatsTagalog('Okay lang ako', card('okay-lang-ako'))).toBe(true);
  });
});

describe('checking typed Tagalog', () => {
  it.each([
    ['salamat', 'salamat'],
    ['salamat', 'Salamat po!'],
    ['maraming-salamat', 'maraming salamat po'],
    ['maraming-salamat', 'Maraming slamat'],
    ['kumusta', 'kamusta'],
    ['kumusta', 'Kumusta po?'],
    ['dahan-dahan', 'dahan dahan lang po'],
    ['dahan-dahan', 'dahandahan lang ho'],
    ['salamat-po', 'Salamat po'],
    ['taga-saan', 'tagasaan ka'],
    ['dahan-dahan', 'dahandahn lang po'],
    ['po', 'po'],
  ])('%s: "%s" is the Tagalog', (id, answer) => {
    expect(matchesTagalog(answer, card(id))).toBe(true);
  });

  it.each([
    ['salamat', 'thank you'],
    ['salamat', ''],
    ['salamat', 'po'],
    ['salamat-po', 'salamat'],
    ['dahan-dahan', 'dahan-dahan lang'],
    ['maraming-salamat', 'salamat'],
    ['kumusta', 'salamat'],
  ])('%s: "%s" is not, or not for sure', (id, answer) => {
    expect(matchesTagalog(answer, card(id))).toBe(false);
  });

  it("takes every word's own Tagalog, and never another word's", () => {
    for (const c of VOCAB) expect(matchesTagalog(c.tl, c), c.tl).toBe(true);
    for (const target of VOCAB) {
      for (const other of VOCAB) {
        if (other.id === target.id || tagalogOf(other) === tagalogOf(target)) continue;
        expect(matchesTagalog(other.tl, target), `${other.tl} for ${target.tl}`).toBe(false);
      }
    }
  });

  it('judges it as Tagalog, leaving English to OpenAI, which is told to turn it down', async () => {
    const ask = vi.fn(async () => true);
    expect(await judgeMeaning('salamat po', card('salamat'), ask, 'tl')).toEqual({ right: true });
    expect(ask).not.toHaveBeenCalled();
    expect(await judgeMeaning('thank you', card('salamat'), null, 'tl')).toEqual({ right: false });
    // Could be a word Tagalog borrows, or a number dictated as digits, so the device can't turn it down.
    await judgeMeaning('traffic', card('trapik'), ask, 'tl');
    expect(ask).toHaveBeenCalledWith('traffic', card('trapik'), 'tl');
    expect(await judgeMeaning('salamat nang marami', card('maraming-salamat'), ask, 'tl')).toEqual({ right: true });
    expect(ask).toHaveBeenCalledWith('salamat nang marami', card('maraming-salamat'), 'tl');
  });
});

/** A card's Tagalog without its "po", so a card that only adds one ("Salamat po" for "Salamat") can be told apart from one that says something else. */
function tagalogOf(c: Card): string {
  return c.tl.toLowerCase().replace(/\b(po|ho|pong|hong)\b/g, '').replace(/[^a-z]/g, '');
}

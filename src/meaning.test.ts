// Typed meanings are judged on meaning: typos, contractions and wording that
// says the same thing are right, a different meaning isn't.

import { describe, expect, it, vi } from 'vitest';
import { VOCAB, getCard, type Card } from './deck';
import { canTypeMeaning, exactAnswer, judgeMeaning, matchesMeaning, matchesTagalog, meanings, leavesOutPo, repeatsTagalog, swapsTagalog, words } from './meaning';

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
    // Two letters off "thursday", but one off "thirsty", which the deck also uses.
    ['huwebes', 'thirstay'],
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
    // OpenAI took this for "repeat this" more often than not.
    expect(await judgeMeaning('paliulit ito', card('pakiulit'), ask)).toEqual({ right: false });
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
    // Misspelt, with another Tagalog word: still not English.
    ['pakiulit', 'paliulit ito'],
    ['maraming-salamat', 'maramng slamat'],
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

describe('telling an answer typed exactly as the card has it', () => {
  it.each([
    ['salamat', 'Thank you!', 'en'],
    ['salamat', '  thank   you ', 'en'],
    ['dalawampu', 'twenty', 'en'],
    ['dalawampu', '20', 'en'],
    ['dahan-dahan', 'dahan dahan lang po', 'tl'],
    ['dahan-dahan', 'Dahan-dahan lang po.', 'tl'],
    ['maraming-salamat', 'MARAMING SALAMAT', 'tl'],
    ['dahan-dahan', 'dahandahan lang po', 'tl'],
    ['isang-libo', '1000', 'en'],
  ] as const)('%s: "%s" is exact', (id, answer, language) => {
    expect(exactAnswer(answer, card(id), language)).toBe(true);
  });

  it.each([
    // Close enough for Check, but not finished, or not as written.
    ['maraming-salamat', 'thank you very muc', 'en'],
    ['salamat', 'thnak you', 'en'],
    ['salamat', 'thanks', 'en'],
    ['salamat', 'salamat', 'en'],
    ['maraming-salamat', 'Maraming salama', 'tl'],
    ['dahan-dahan', 'dahan dahan lang', 'tl'],
    ['salamat', '', 'tl'],
  ] as const)('%s: "%s" is not exact', (id, answer, language) => {
    expect(exactAnswer(answer, card(id), language)).toBe(false);
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
    // A slip in a short word still counts, taken with the rest of the wording.
    ['magandang-umaga', 'Magandang umga'],
    ['mabuti', 'Mabuti nman'],
    ['wala-yon', "Wla 'yon"],
    ['maraming-salamat', 'Marami salamat po'],
    ['walang-anuman', 'walana anuman'],
    ['po', 'po'],
    // Reworded the way people say it, with the textbook wording still right.
    ['ano-pangalan', 'Anong pangalan mo?'],
    ['ano-pangalan', 'ano ang pangalan mo'],
    ['kaunti-lang', 'kaunti lang'],
    ['ano-numero-mo', 'Ano ang numero mo?'],
    ['wala-yon', 'wala yon'],
    ['mauna-na-ako', "una na 'ko"],
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
    ['magandang-umaga', 'maraming umaga'],
    // Two letters off "magandang", but one off "maanghang" (spicy).
    ['magandang-umaga', 'maganghang umaga'],
    // Another word the deck uses, too near to be a swap but no typo either: left to OpenAI.
    ['mabuti', 'marumi naman'],
    ['mabuti', 'mabuti saan'],
    ['ano-pangalan', 'anong pangalan ko'],
    ['kanino', 'kanin ito'],
    ['gaano-kalayo', 'gaano kayo'],
    ['anong-balita', 'anong bata'],
    ['sigurado-ka-ba', 'siguro ka ba'],
    ['magandang-gabi', 'magandang grabe'],
    ['isang-daan', 'ilang daan'],
    ['gaano-kalayo', 'gaano malayo'],
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

describe('telling a mixed-up Tagalog word from a typo', () => {
  it.each([
    ['magandang-umaga', 'maraming umaga'],
    ['magandang-umaga', 'Maraming umaga po'],
    ['maraming-salamat', 'magandang salamat'],
    ['kumanan-ka', 'Kumaliwa ka.'],
    // The other half of a pair, too short to look alike.
    ['tita', 'Tito'],
    ['ninong', 'ninang'],
    ['lola', 'Lolo po'],
  ])('%s: "%s" swaps in another word', (id, answer) => {
    expect(swapsTagalog(answer, card(id))).toBe(true);
  });

  it.each([
    ['magandang-umaga', 'magandng umaga'],
    ['magandang-umaga', 'Magandang umaga po'],
    ['maraming-salamat', 'salamat nang marami'],
    ['magandang-umaga', 'maraming hapon'],
    // Both say yes; the "po" may be added.
    ['oo', 'opo'],
    // Short words are often shortened ("san" for "saan"), and one letter makes another word.
    ['saan-ka-nakatira', 'San ka nakatira?'],
    ['ilang-taon-ka-na', 'Ilan taon ka na?'],
    ['kain-tayo', 'Kain tao!'],
    // A letter or two apart is more often another form of the word, left to OpenAI.
    ['maraming-salamat', 'Marami salamat'],
    ['magandang-umaga', 'Maganda umaga'],
    ['saan-ka-pupunta', 'Saan ka papunta?'],
    ['paano-pumunta', 'Paano pupunta sa palengke?'],
  ])('%s: "%s" does not', (id, answer) => {
    expect(swapsTagalog(answer, card(id))).toBe(false);
  });

  it('turns down the Tagalog without the "po" the card has, without asking OpenAI, which can miss it', async () => {
    const ask = vi.fn(async () => true);
    expect(await judgeMeaning('paliulit ito', card('pakiulit'), ask, 'tl')).toEqual({ right: false });
    expect(await judgeMeaning('Pakiulit', card('pakiulit'), ask, 'tl')).toEqual({ right: false });
    expect(ask).not.toHaveBeenCalled();
    expect(leavesOutPo('pakiulit po', card('pakiulit'))).toBe(false);
    expect(leavesOutPo('pakiulit ho', card('pakiulit'))).toBe(false);
    // Another wording is OpenAI's to judge.
    expect(leavesOutPo('ulitin mo nga', card('pakiulit'))).toBe(false);
    // A card without a "po" has none to leave out.
    expect(leavesOutPo('salamat', card('salamat'))).toBe(false);
  });

  it("turns a swapped word down without asking OpenAI, which can take it for a typo", async () => {
    const ask = vi.fn(async () => true);
    expect(await judgeMeaning('maraming umaga', card('magandang-umaga'), ask, 'tl')).toEqual({ right: false });
    expect(ask).not.toHaveBeenCalled();
    // A typo is still right, on the device.
    expect(await judgeMeaning('magandng umaga', card('magandang-umaga'), ask, 'tl')).toEqual({ right: true });
    expect(ask).not.toHaveBeenCalled();
    // Nearer another word than the card's, it's left to OpenAI.
    await judgeMeaning('maganghang umaga', card('magandang-umaga'), ask, 'tl');
    expect(ask).toHaveBeenCalledWith('maganghang umaga', card('magandang-umaga'), 'tl');
  });
});

/** A card's Tagalog without its "po", so a card that only adds one ("Salamat po" for "Salamat") can be told apart from one that says something else. */
function tagalogOf(c: Card): string {
  return c.tl.toLowerCase().replace(/\b(po|ho|pong|hong)\b/g, '').replace(/[^a-z]/g, '');
}

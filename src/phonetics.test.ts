import { describe, expect, it } from 'vitest';
import { coach } from './coach';
import { ALL_CARDS } from './deck';
import { compare, englishReadings, groupTokens, lostFirstSound, judge, likelihood, packOdds, passes, soundDistance, toPhones, unpackOdds, type Odds } from './phonetics';

/** The required sounds, joined, for compact assertions. */
const sounds = (text: string) =>
  toPhones(text)
    .filter((p) => !p.optional)
    .map((p) => p.ipa)
    .join(' ');

describe('toPhones', () => {
  it('reads Tagalog spelling', () => {
    expect(sounds('Salamat')).toBe('s a l a m a t');
    expect(sounds('Kumusta?')).toBe('k u m u s t a');
    expect(sounds('Sige')).toBe('s i ɡ ɛ');
    expect(sounds('Masarap!')).toBe('m a s a ɾ a p');
  });

  it('treats "ng" as one sound, and "mga" as "maŋa"', () => {
    expect(sounds('Magandang gabi')).toBe('m a ɡ a n d a ŋ ɡ a b i');
    expect(sounds('ngayon')).toBe('ŋ a j o n');
    expect(toPhones('Mga Numero').map((p) => p.ipa).join(' ')).toBe('m a ŋ a n u m ɛ ɾ o');
    expect(sounds('Mga Numero')).toBe('m ŋ a n u m ɛ ɾ o'); // the unspelled a can be swallowed
    expect(sounds('Ingles')).toBe('i ŋ ɡ l ɛ s');
  });

  it('reads the particle "ng" as "nang"', () => {
    expect(toPhones('kain ng kain').map((p) => p.ipa).join(' ')).toContain('n a ŋ');
  });

  it('accepts "ng" said the way the next sound pulls it', () => {
    const c = compare(toPhones('ang pagkain'), ['a', 'm', 'p', 'a', 'ɡ', 'k', 'a', 'i', 'n']);
    expect(c.score).toBe(1);
    expect(compare(toPhones('ang mga'), ['a', 'm', 'a', 'ŋ', 'a']).score).toBe(1);
    // But not before a vowel, where it has to stay "ng".
    expect(compare(toPhones('ngayon'), ['n', 'a', 'j', 'o', 'n']).score).toBeLessThan(1);
  });

  it('accepts "ay" said "e", but not said "a"', () => {
    expect(compare(toPhones('Ito ay'), ['i', 't', 'o', 'e']).score).toBe(1);
    expect(compare(toPhones('Ito ay'), ['i', 't', 'o', 'a', 'j']).score).toBe(1);
    expect(compare(toPhones('Ito ay'), ['i', 't', 'o', 'a']).score).toBeLessThan(1);
  });

  it('keeps "ng" as ng before the g of a loanword like "Ingles"', () => {
    expect(compare(toPhones('Ingles'), ['i', 'n', 'ɡ', 'l', 'ɛ', 's']).score).toBeLessThan(1);
  });

  it("doesn't read the contraction 'ng as the particle", () => {
    expect(sounds("Ano'ng oras")).toBe('a n o ŋ o ɾ a s');
  });

  it('keeps one g in "ngg" and "ngk"', () => {
    expect(sounds('bilanggo')).toBe('b i l a ŋ ɡ o');
    expect(sounds('bangka')).toBe('b a ŋ k a');
  });

  it('takes "sy" and "siy" before a vowel said "sh" or as spelled', () => {
    for (const heard of [['ʃ', 'a', 'm'], ['s', 'j', 'a', 'm'], ['s', 'i', 'j', 'a', 'm']]) expect(compare(toPhones('siyam'), heard).score).toBe(1);
    expect(compare(toPhones('Pasensya na'), ['p', 'a', 's', 'ɛ', 'n', 'ʃ', 'a', 'n', 'a']).score).toBe(1);
    expect(compare(toPhones('siyam'), ['s', 'a', 'm']).score).toBeLessThan(1);
  });

  it('puts an optional catch before word-initial vowels and between vowels', () => {
    const oo = toPhones('Oo');
    expect(oo.map((p) => p.ipa)).toEqual(['ʔ', 'o', 'ʔ', 'o']);
    expect(oo.filter((p) => p.optional)).toHaveLength(2);
    expect(sounds('Paalam')).toBe('p a a l a m');
  });

  it('maps every sound back to its letters', () => {
    const text = 'Magandang umaga';
    const ng = toPhones(text).find((p) => p.ipa === 'ŋ')!;
    expect(text.slice(ng.from, ng.to)).toBe('ng');
  });

  it('covers every card in the deck', () => {
    for (const card of ALL_CARDS) {
      const phones = toPhones(card.tl);
      expect(phones.length, card.id).toBeGreaterThan(0);
      expect(phones.every((p) => p.ipa), card.id).toBe(true);
    }
  });
});

describe('groupTokens', () => {
  it('joins modifiers, affricates and English glides from single-symbol tokens', () => {
    expect(groupTokens(['p', 'ʰ', 'o', 'ʊ'])).toEqual(['pʰ', 'oʊ']);
    expect(groupTokens(['t', 'ʃ', 'a'])).toEqual(['tʃ', 'a']);
    expect(groupTokens(['d', 'e', 'ɪ'])).toEqual(['d', 'eɪ']);
    expect(groupTokens(['g', 'a', 'ː'])).toEqual(['ɡ', 'aː']);
  });

  it('drops a modifier the recording starts on, with no sound before it to join', () => {
    expect(groupTokens(['\u032a', 'u', 'm', 'a'])).toEqual(['u', 'm', 'a']);
  });

  it('splits an r-coloured vowel into the vowel and an r', () => {
    expect(groupTokens(['n', 'ə', 'm', 'b', 'ə', '˞'])).toEqual(['n', 'ə', 'm', 'b', 'ə', 'ɹ']);
  });

  it("doesn't join a glide across a word break", () => {
    expect(groupTokens(['p', 'o', '▁', 'ʊ', 'n'])).toEqual(['p', 'o', 'ʊ', 'n']);
  });
});

describe('soundDistance', () => {
  it("accepts the recogniser's q for a back k, and long vowels written twice", () => {
    expect(soundDistance('k', 'q')).toBe(0);
    expect(soundDistance('k', 'qʰ')).toBeGreaterThan(0);
    // One repeat is length; more is a dragged or stuttered vowel.
    expect(compare(toPhones('po'), ['p', 'o', 'o', 'o', 'o']).score).toBeLessThan(1);
    // Spelled double vowels can be lengthened too.
    expect(compare(toPhones('Nasaan'), ['n', 'a', 's', 'a', 'a', 'a', 'n']).score).toBe(1);
    expect(compare(toPhones('Salamat'), ['s', 'a', 'l', 'a', 'a', 'm', 'a', 't']).score).toBe(1);
  });

  it('treats free variants as the same', () => {
    expect(soundDistance('ɾ', 'r')).toBe(0);
    expect(soundDistance('ɛ', 'e')).toBe(0);
  });

  it('marks aspiration and gliding vowels as close, not right', () => {
    expect(soundDistance('p', 'pʰ')).toBeGreaterThan(0);
    expect(soundDistance('p', 'pʰ')).toBeLessThanOrEqual(0.4);
    expect(soundDistance('o', 'oʊ')).toBeGreaterThan(0);
    expect(soundDistance('o', 'oʊ')).toBeLessThanOrEqual(0.4);
  });

  it('marks different sounds as off', () => {
    expect(soundDistance('ŋ', 'n')).toBeGreaterThan(0.4);
    expect(soundDistance('a', 's')).toBe(1);
  });
});

describe('compare', () => {
  const ipa = (text: string) => toPhones(text).filter((p) => !p.optional).map((p) => p.ipa);

  it('scores a perfect attempt at 1', () => {
    const c = compare(toPhones('Salamat po'), ipa('Salamat po'));
    expect(c.score).toBe(1);
    expect(c.sounds.every((s) => s.verdict === 'good')).toBe(true);
  });

  it('finds the sound that was replaced', () => {
    const c = compare(toPhones('pangit'), ['p', 'a', 'n', 'i', 't']);
    expect(c.sounds[2]).toMatchObject({ verdict: 'off', heard: 'n' });
    expect(c.score).toBeLessThan(1);
  });

  it('takes "ng" heard as n at the start of a word as nearly right, as the recogniser often hears it so', () => {
    const c = compare(toPhones('ngayon'), ['n', 'a', 'j', 'o', 'n']);
    expect(c.sounds[0]).toMatchObject({ verdict: 'close', heard: 'n' });
    expect(passes(c)).toBe(true);
    // Only there: inside a word it has to be "ng".
    expect(compare(toPhones('pangit'), ['p', 'a', 'n', 'i', 't']).sounds[2].verdict).toBe('off');
  });

  it('finds missing and extra sounds', () => {
    const c = compare(toPhones('tatlo'), ['t', 'a', 'l', 'o', 'w']);
    expect(c.sounds.find((s) => s.verdict === 'missing')?.phone.ipa).toBe('t');
    expect(c.extra.map((e) => e.ipa)).toEqual(['w']);
  });

  it('counts added sounds against the attempt', () => {
    const c = compare(toPhones('Salamat'), ['s', 'a', 'l', 'a', 'm', 'a', 't', 'ə', 'p', 'o']);
    expect(c.score).toBeLessThan(0.9);
    // One stray sound on a short word is a slip, not a fail.
    expect(compare(toPhones('Salamat'), ['s', 'a', 'l', 'a', 'm', 'a', 'n', 't']).score).toBeGreaterThanOrEqual(0.9);
    expect(c.extra.filter((e) => e.counts).map((e) => e.ipa)).toEqual(['ə', 'p', 'o']);
  });

  it('forgives what speakers and recognisers naturally add', () => {
    expect(compare(toPhones('Salamat'), ['s', 'a', 'l', 'a', 'm', 'a', 't', 'ə']).score).toBe(1);
    expect(compare(toPhones('Salamat'), ['s', 'a', 'l', 'a', 'm', 'a', 't', 'ɨ']).score).toBe(1);
    expect(compare(toPhones('po'), ['p', 'o', 'h']).score).toBe(1);
    expect(compare(toPhones('Kain tayo'), ['k', 'a', 'j', 'i', 'n', 't', 'a', 'j', 'o']).score).toBe(1);
    expect(compare(toPhones('Salamat po'), ['s', 'a', 'l', 'a', 'm', 'a', 't', 'ʔ', 'p', 'o']).score).toBe(1);
  });

  it('passes the ways native speakers say a sound, from region to region and in everyday speech', () => {
    const right = (text: string, heard: string[]) => compare(toPhones(text), heard).score;
    // o and u, e and i swap freely.
    expect(right('Kumusta', ['k', 'o', 'm', 'o', 's', 't', 'a'])).toBe(1);
    expect(right('babae', ['b', 'a', 'b', 'a', 'i'])).toBe(1);
    expect(right('lalaki', ['l', 'a', 'l', 'a', 'k', 'ɛ'])).toBe(1);
    // An unstressed a relaxes towards "uh".
    expect(right('Salamat', ['s', 'ɐ', 'l', 'a', 'm', 'ə', 't'])).toBe(1);
    // r and d swap between vowels.
    expect(right('marami', ['m', 'a', 'd', 'a', 'm', 'i'])).toBe(1);
    // f said p, v said b.
    expect(right('pamilya', ['f', 'a', 'm', 'i', 'l', 'j', 'a'])).toBe(1);
    // A g before p, t, k or s loses its voice.
    expect(right('magkita', ['m', 'a', 'k', 'k', 'i', 't', 'a'])).toBe(1);
    // l said as a tapped r is nearly right.
    expect(compare(toPhones('salamat'), ['s', 'a', 'ɾ', 'a', 'm', 'a', 't']).sounds[2].verdict).toBe('close');
    // So is an English r, as in "number" said the English way.
    expect(compare(toPhones('namber'), ['n', 'a', 'm', 'b', 'ɛ', 'ɹ']).sounds[5].verdict).toBe('close');
  });

  it('passes "diyan" said "dyan" or "jan", and "puwede" said "pwede"', () => {
    for (const heard of [['d', 'i', 'j', 'a', 'n'], ['d', 'j', 'a', 'n'], ['dʒ', 'a', 'n']]) expect(compare(toPhones('diyan'), heard).score).toBe(1);
    expect(compare(toPhones('dyan'), ['dʒ', 'a', 'n']).score).toBe(1);
    expect(compare(toPhones('Dyan lang.'), ['dʒ', 'a', 'n', 'l', 'a', 'ŋ']).score).toBe(1);
    expect(compare(toPhones('puwede'), ['p', 'w', 'ɛ', 'd', 'ɛ']).score).toBe(1);
    expect(compare(toPhones('tiyo'), ['tʃ', 'o']).score).toBe(1);
    // Said "d", the y has to be there: "dan" isn't "diyan".
    expect(compare(toPhones('diyan'), ['d', 'a', 'n']).score).toBeLessThan(1);
    // However sure the recogniser was of it.
    expect(passes(judge(['diyan'], { sounds: ['d', 'a', 'n'], odds: unpackOdds('|d900||a900||n900|') }).comparison)).toBe(false);
  });

  it("doesn't blend a sound with a y that starts the next word", () => {
    expect(toPhones('bukas yung').find((p) => p.ipa === 's')?.also).toBeUndefined();
    expect(compare(toPhones('bukas yung'), ['b', 'u', 'k', 'a', 'ʃ', 'u', 'ŋ']).score).toBeLessThan(1);
  });

  it('counts a sound the recogniser nearly wrote instead as heard', () => {
    // Torn between n and l at the start of "lang".
    expect(compare(toPhones('lang'), ['n', 'a', 'ŋ'], [['l'], [], []]).score).toBe(1);
    expect(compare(toPhones('lang'), ['n', 'a', 'ŋ']).score).toBeLessThan(1);
  });

  it('still fails a different word, even one a sound away', () => {
    expect(passes(judge(['ba'], { sounds: ['p', 'a'] }).comparison)).toBe(false);
    expect(passes(judge(['dito'], { sounds: ['d', 'o', 'o', 'n'] }).comparison)).toBe(false);
    expect(passes(judge(['Salamat'], { sounds: ['k', 'a', 'l', 'a', 'm', 'a', 'n', 's', 'i'] }).comparison)).toBe(false);
  });

  it("doesn't penalise leaving out an optional catch", () => {
    expect(compare(toPhones('Oo'), ['o', 'o']).score).toBe(1);
  });
});

describe('lostFirstSound', () => {
  it('finds a recording that starts a moment into its first word', () => {
    expect(lostFirstSound('Kailan?', ['a', 'j', 'l', 'a', 'n'])).toEqual({ letters: 'K', heard: 'nothing' });
    expect(lostFirstSound('Pabili po.', ['a', 'b', 'i', 'l', 'i', 'p', 'o'])).toEqual({ letters: 'P', heard: 'nothing' });
  });

  it('takes the first sound said, or heard as a near one', () => {
    expect(lostFirstSound('Kailan?', ['k', 'a', 'j', 'l', 'a', 'n'])).toBeNull();
    expect(lostFirstSound('kanan', ['ɡ', 'a', 'n', 'a', 'n'])).toBeNull();
    expect(lostFirstSound('Psst! Kuya!', ['s', 't', 'k', 'u', 'j', 'a'])).toBeNull();
    expect(lostFirstSound('Pabili po.', ['b', 'i', 'l', 'i', 'p', 'o'])).not.toBeNull();
    expect(lostFirstSound('Trapik!', ['ɾ', 'a', 'p', 'i', 'k'])).not.toBeNull();
  });

  it('leaves out a hiss, which the voice barely sounds', () => {
    expect(lostFirstSound('Psst! Kuya!', ['k', 'u', 'j', 'a'])).toBeNull();
  });

  it('leaves a first vowel to the check for a take cut off', () => {
    expect(lostFirstSound('Ako rin.', ['k', 'o', 'ɾ', 'i', 'n'])).toBeNull();
    expect(lostFirstSound('Ako rin.', ['h', 'a', 'k', 'o', 'ɾ', 'i', 'n'])).toBeNull();
  });
});

describe('englishReadings', () => {
  it('finds a g before e or i said the English way, as in "giant"', () => {
    expect(englishReadings('Gising ka na ba?', ['dʒ', 'i', 's', 'i', 'ŋ', 'k', 'a', 'n', 'a', 'b', 'a'])).toEqual([{ letters: 'Gi', heard: 'dʒ' }]);
    expect(englishReadings('saging', ['s', 'a', 'ʒ', 'i', 'ŋ'])).toEqual([{ letters: 'gi', heard: 'ʒ' }]);
    // Lined up as a missing g, with the soft g beside it or in the vowel's place.
    expect(englishReadings('gising', ['ʒ', 'dʒ', 'i'])).toEqual([{ letters: 'gi', heard: 'ʒ' }]);
  });

  it('passes a hard g, and leaves other slips to the transcript check', () => {
    expect(englishReadings('Gising ka na ba?', ['ɡ', 'i', 's', 'e', 'n', 'k', 'a', 'n', 'ə', 'b', 'a'])).toEqual([]);
    // Before a, o or u English says g hard too, so a slip there is the recogniser's, not an English reading.
    expect(englishReadings('Magandang umaga', ['m', 'a', 'd', 'a', 'n', 'd', 'a', 'ŋ', 'u', 'm', 'a', 'ɡ', 'a'])).toEqual([]);
    expect(englishReadings('Salamat', ['s', 'a', 'l', 'a', 'm', 'a', 'd'])).toEqual([]);
  });
});

describe('coach', () => {
  it('explains "ng" when it comes out as "n"', () => {
    const text = 'ngayon';
    const [tip] = coach(text, compare(toPhones(text), ['n', 'a', 'j', 'o', 'n']));
    expect(tip.letters).toBe('ng');
    expect(tip.text).toContain('sing');
  });

  it('explains an English "r"', () => {
    const text = 'Masarap!';
    const [tip] = coach(text, compare(toPhones(text), ['m', 'a', 's', 'a', 'ɹ', 'a', 'p']));
    expect(tip.letters).toBe('r');
    expect(tip.text).toContain('butter');
  });

  it('explains aspirated stops and gliding vowels', () => {
    const text = 'po';
    expect(coach(text, compare(toPhones(text), ['pʰ', 'o']))[0].text).toContain('puff of air');
    // As the recogniser writes "po" said like English "go": one symbol per token.
    expect(coach(text, compare(toPhones(text), groupTokens(['p', 'o', 'ʊ'])))[0].text).toContain('pure');
  });

  it('explains "ng" that blends into the next sound', () => {
    const text = 'Anong balita?';
    const [tip] = coach(text, compare(toPhones(text), ['a', 'n', 'o', 'n', 'b', 'a', 'l', 'i', 't', 'a']));
    expect(tip.text).toContain('"m"');
  });

  it('points out an added sound', () => {
    const text = 'Salamat';
    const [tip] = coach(text, compare(toPhones(text), ['s', 'a', 'l', 'a', 'm', 'a', 't', 'ə', 's']));
    expect(tip.text).toContain('extra');
    expect(tip.letters).toBe('t');
  });

  it('gives one tip per kind of mistake, at most two', () => {
    const text = 'Magandang umaga';
    const heard = ['m', 'ɛ', 'ɡ', 'a', 'n', 'd', 'a', 'n', 'u', 'm', 'ɛ', 'ɡ', 'ɛ'];
    const tips = coach(text, compare(toPhones(text), heard));
    expect(tips.map((t) => t.letters)).toEqual(['a', 'ng']);
    expect(tips[0].text).toContain('father');
  });

  it('puts sounds that were off before ones that were close', () => {
    const text = 'po pangit';
    const tips = coach(text, compare(toPhones(text), ['pʰ', 'o', 'p', 'a', 'n', 'i', 't']));
    expect(tips[0].letters).toBe('ng');
  });

  it('has nothing to say about a perfect attempt', () => {
    const text = 'Salamat';
    expect(coach(text, compare(toPhones(text), ['s', 'a', 'l', 'a', 'm', 'a', 't']))).toEqual([]);
  });
});

describe('likelihood', () => {
  // "pero" as the recogniser often hears it: torn on the p while the word starts, sure of the rest.
  const pero: Odds = [[], [['p', 0.19], ['d', 0.05]], [['p', 0.1]], [['ɛ', 0.54], ['e', 0.32]], [], [['ɾ', 0.8]], [], [['o', 0.9]], []];

  it('packs odds into a line of text and back', () => {
    expect(packOdds(pero)).toBe('|p190 d50|p100|ɛ540 e320||ɾ800||o900|');
    expect(unpackOdds(packOdds(pero))).toEqual(pero);
  });

  it('finds the word the recording most likely is, even with a sound only half heard', () => {
    const own = likelihood(toPhones('pero'), pero);
    expect(own).toBeGreaterThan(-1);
    for (const other of ['pera', 'bero', 'kero', 'Oo']) expect(likelihood(toPhones(other), pero)).toBeLessThan(own);
    expect(likelihood(toPhones('pera'), pero)).toBeLessThan(-1);
  });

  it('passes a word whose first sound the recogniser missed, when it was likely there', () => {
    const heard = { sounds: ['ɛ', 'ɾ', 'o'], odds: pero };
    expect(passes(judge(['pero'], { sounds: heard.sounds }).comparison)).toBe(false);
    expect(passes(judge(['pero'], heard).comparison)).toBe(true);
    // A different word, with the same odds, still fails.
    expect(passes(judge(['pera'], heard).comparison)).toBe(false);
  });
});

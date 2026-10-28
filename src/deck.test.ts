import { describe, expect, it } from 'vitest';
import { ALL_CARDS, ASKED_VOCAB, CORE_WORDS, LEARN_ORDER, UNITS, VOCAB, buildsOn, cardForWord, getCard, isVocab, tagalogWords, variantsOf } from './deck';
import { GUIDES } from './guides';
import { canBuild, upcomingNewCards } from './session';
import { emptyProgress, recordAnswer } from './store';

/** Every card id a released deck has had. Saved progress is keyed by id, so none of these may be renamed or removed. */
const SHIPPED_IDS = [
  'kumusta', 'mabuti', 'salamat', 'maraming-salamat', 'walang-anuman', 'magandang-umaga', 'magandang-hapon',
  'magandang-gabi', 'paalam', 'ingat', 'oo', 'opo', 'hindi', 'po', 'salamat-po', 'pasensya-na', 'makikiraan-po',
  'sige', 'ano-pangalan', 'ako-si', 'ikinagagalak', 'taga-saan', 'taga-ako', 'ingles', 'kaunti-lang',
  'hindi-maintindihan', 'pakiulit', 'dahan-dahan', 'isa', 'dalawa', 'tatlo', 'apat', 'lima', 'anim', 'pito',
  'walo', 'siyam', 'sampu', 'ano', 'sino', 'saan', 'kailan', 'bakit', 'paano', 'ano-ito', 'magkano',
  'kain-tayo', 'gutom-na-ako', 'masarap', 'kanin', 'tubig', 'kape', 'tinapay', 'manok', 'isda', 'busog-na-ako',
  'nanay', 'tatay', 'ate', 'kuya', 'lola', 'lolo', 'anak', 'kaibigan', 'tara-na', 'sandali-lang',
  'nasaan-banyo', 'gusto-ko-ito', 'ayoko', 'hindi-ko-alam', 'mahal', 'mura', 'mahal-kita', 'anong-balita',
  // Shipped later: the tripled deck, core words and guides.
  'ako', 'ikaw', 'ka', 'mo', 'ang', 'na', 'ko', 'ito', 'sa', 'paano-sabihin', 'ano-ibig-sabihin', 'lang', 'ba',
  'k-psst', 's-letters', 'p-po', 't-ha', 'may-kape-ba', 'wala', 'meron', 'puwede-ba', 'kailangan-ko', 'dito',
  'p-ba', 'p-hindi', 'p-may', 'k-eyebrows', 'nasaan-ka', 'saan-ka-pupunta', 'papunta-na-ako', 'nandito-na-ako',
  'malapit-na-ako', 'ngayon', 'mamaya', 'kanina', 'mamaya-na-lang', 'bukas', 'anong-oras-na', 'p-si', 's-ng',
  'tayo', 'okay-lang-ba', 'okay-lang-ako', 'ayos-lang', 'talaga', 'oo-nga', 'ako-rin', 'tama', 'p-first',
  't-rise', 't-soft', 's-stress', 'k-kain', 's-r', 'kaliwa', 'kanan', 'diretso', 'diyan', 'doon', 'malapit',
  'malayo', 'paano-pumunta', 'para-po', 'bayad-po', 'aalis-na-ako', 'pauwi-na-ako', 'nasaan-ka-na',
  'mahuhuli-ako', 'hintayin-mo-ako', 'teka', 'k-kuya', 'siya', 'kami', 'sila', 'at', 'pero', 'kasi', 'naku',
  'grabe', 'siguro', 'ng', 'pahingi-tubig', 'bill-po', 'isa-pa', 'ito-na-lang', 'iyan', 'iyon', 'magkano-lahat',
  'ilan', 'pabili-po', 'meron-ba-kayong', 'p-gusto', 's-sh', 't-react', 'ala-una', 'alas-dos', 'alas-tres',
  'kalahati', 'alas-singko', 'alas-sais', 'alas-siyete', 'alas-otso', 'alas-diyes', 'alas-dose', 'kahapon',
  'alas-siyete-umaga', 'alas-otso-gabi', 'libre-ka-ba', 'ano-ang-plano', 'saan-tayo-magkikita',
  'anong-oras-magkikita', 'kita-tayo-bukas', 'puwede-ako', 'hindi-ako-puwede', 'baka', 'ewan-ko', 'hindi-naman',
  'ano-ulit', 'ganoon-ba', 'p-paki', 'pagod-na-ako', 'mainit', 'masakit', 'may-sakit-ako', 'tulong',
  'pakitulungan', 'naliligaw-ako', 'bahay', 'nasa-bahay-ako', 'p-glue', 'p-ang', 'alin', 'gaano-katagal',
  'gaano-kalayo', 'anong-ginagawa-mo', 'trapik', 'sayang', 'tama-na', 'araw', 'linggo', 'tanghali',
  'susunod-na-linggo', 'noong-isang-linggo', 'lagi', 'minsan', 'kaagad', 'sumakay', 'bumaba', 'dyip',
  'sa-tabi-lang', 'kumaliwa-ka', 'kumanan-ka', 'katabi', 'sa-harap', 'sa-likod', 'kanto', 'kalye', 'p-sa',
  'palengke', 'tindahan', 'paaralan', 'kainan', 'ospital', 'botika', 'nasaan-ospital', 'kailangan-doktor',
  'gamot', 'ano-masarap-dito', 'maanghang', 'huwag-maanghang', 'ulam', 'baso', 'kutsara', 'tinidor',
  'isa-pong-adobo', 'pera', 'piso', 'sukli', 'barya', 'dalawampu', 'limampu', 'isang-daan', 'limang-daan',
  'isang-libo', 'tumawad', 'tumitingin-lang', 'wala-na', 'malaki', 'maliit', 'p-when', 'nauuhaw-ako',
  'inaantok-ako', 'malamig', 'masaya', 'malungkot', 'gusto-ko-umuwi', 'sasama-ako', 'tuloy-ba-tayo', 'mga',
  'p-mga', 'para-saan', 'kanino', 'simbahan', 'opisina', 'bangko', 'paliparan', 'buwan', 'taon', 'lunes',
  'biyernes', 'sabado', 'hatinggabi', 'nawala-bag', 'tumawag-pulis', 'delikado', 'bahala-na',
  // Shipped later: everyday greetings.
  'uy', 'wala-yon', 'ikaw-pala', 'saan-ka-galing', 'diyan-lang', 'mauna-na-ako', 'anong-meron', 'tao-po', 'k-taglish',
  // Shipped later: more family.
  'tita', 'tito', 'pinsan', 'magulang', 'apo', 'pamangkin', 'panganay', 'bunso', 'ninang', 'ninong',
  // Shipped later: the most common words.
  'niya', 'natin', 'namin', 'nila', 'niyo', 'akin', 'iyo', 'umaga', 'gabi', 'kagabi', 'sandali', 'noon', 'dati',
  'matagal', 'alam', 'kilala', 'sabi', 'gawin', 'nakita', 'tingnan', 'umalis', 'bumalik', 'kunin', 'ibigay',
  'buksan', 'pumasok', 'nakalimutan', 'akala', 'maging', 'nangyari', 'halika', 'tao', 'buhay', 'mundo', 'bagay',
  'lugar', 'pangalan', 'trabaho', 'kamay', 'puso', 'aso', 'kama', 'pinto', 'kuwarto', 'gamit', 'sarili', 'loob',
  'labas', 'dahilan', 'paraan', 'beses', 'kasalanan', 'bansa', 'pare', 'pagkain', 'pakiusap', 'takot', 'totoo',
  'mali', 'masama', 'magaling', 'malakas', 'tahimik', 'ay', 'kung', 'para', 'dahil', 'kaya', 'kahit', 'kapag',
  'habang', 'hanggang', 'mula', 'tungkol', 'tulad', 'parang', 'kaysa', 'mas', 'tapos', 'pagkatapos', 'ulit', 'naman',
  'pala', 'rin', 'daw', 'muna', 'siyempre', 'basta', 'di-ba', 'heto', 'ganito', 'masyado', 'medyo', 'halos', 'lahat',
  'bawat', 'iba', 'pareho', 'dapat', 'huwag',
  // Shipped later: flipped slang.
  'k-baliktad',
];

describe('deck', () => {
  it('has unique card and unit ids', () => {
    expect(new Set(ALL_CARDS.map((c) => c.id)).size).toBe(ALL_CARDS.length);
    expect(new Set(UNITS.map((u) => u.id)).size).toBe(UNITS.length);
  });

  it('has unique English meanings so quiz answers are unambiguous', () => {
    const meanings = [...ASKED_VOCAB, ...GUIDES].map((c) => c.en.toLowerCase());
    expect(new Set(meanings).size).toBe(meanings.length);
  });

  it('gives every unit enough cards for a four-option quiz', () => {
    for (const unit of UNITS) expect(unit.cards.length).toBeGreaterThanOrEqual(4);
  });

  it('puts every card in the learning order exactly once', () => {
    expect([...LEARN_ORDER].sort()).toEqual(ALL_CARDS.map((c) => c.id).sort());
  });

  it('gives every core word its own card', () => {
    for (const id of CORE_WORDS) expect(getCard(id)?.tl.toLowerCase(), id).toBe(id);
  });

  it('introduces the words a card is built from before the card', () => {
    for (const card of ALL_CARDS) {
      // A guide's frame ("Gusto ko ng ___.") uses the little words too, as well as what it needs. Others in it, like
      // the "kumain" whose forms "Did, doing, will do" teaches, are what it is about.
      const words = isVocab(card) ? [] : tagalogWords(card.tl).map(cardForWord).filter((id): id is string => !!id && CORE_WORDS.includes(id));
      for (const id of new Set([...buildsOn(card), ...words])) {
        expect(LEARN_ORDER.indexOf(id), `${card.id} uses ${id}`).toBeLessThan(LEARN_ORDER.indexOf(card.id));
      }
    }
  });

  it('finds the words a phrase is built from, joined with "-ng" or not', () => {
    expect([...buildsOn(getCard('paano-sabihin')!)].sort()).toEqual(['ito', 'paano', 'sa', 'sabihin']);
    expect(buildsOn(getCard('walang-anuman')!)).toEqual(['wala']);
    expect([...buildsOn(getCard('ilang-taon-ka-na')!)].sort()).toEqual(['ilan', 'ka', 'na', 'taon']);
    expect(buildsOn(getCard('magkano-lahat')!)).toEqual(['magkano', 'lahat']);
    expect(buildsOn(getCard('mabuti')!)).toEqual(['naman']);
    expect(buildsOn(getCard('salamat-po')!)).toEqual(['salamat', 'po']);
    // A word only spelled the same isn't built on: "Para po!" is "stop", not "for".
    expect(buildsOn(getCard('para-po')!)).toEqual(['po']);
  });

  it('brings at most one new word with each phrase', () => {
    // Words a learner knows already: English ones Tagalog borrows, and a name.
    const known = ['tagalog', 'mag-english', 'taga-amerika', 'okay', 'bill', 'bag', 'pulis', 'signal', 'number', 'i-text', 'adobo', 'ana'];
    // Said as a whole: "Mabuti naman" is the reply to "Kumusta?", and the formal "nice to meet you" is there to recognise.
    const whole = ['mabuti', 'ikinagagalak'];
    for (const card of VOCAB.filter((c) => !whole.includes(c.id))) {
      // A word is new here if no card teaches it, or this card does ("tumawad" in "Puwede bang tumawad?").
      const fresh = tagalogWords(card.tl).filter((w) => !known.includes(w) && (cardForWord(w) ?? card.id) === card.id);
      expect(fresh.length, `${card.id}: ${fresh.join(', ')}`).toBeLessThanOrEqual(1);
    }
  });

  it('gives every card a memory hook', () => {
    for (const card of ALL_CARDS) expect(card.hook.trim(), card.id).not.toBe('');
  });

  it('writes a hard g before e or i as "gh" in pronunciation hints, as English reads "gee" like "jee"', () => {
    for (const card of [...ASKED_VOCAB, ...GUIDES]) expect(card.hint ?? '', card.tl).not.toMatch(/(?<!n)g[ei]/i);
  });

  it('keeps every card id that saved progress may point at', () => {
    for (const id of SHIPPED_IDS) expect(getCard(id), id).toBeDefined();
  });

  it('moves a learner who has met every earlier card on to the new topics', () => {
    const now = Date.UTC(2026, 0, 1);
    const progress = emptyProgress(now);
    for (const id of SHIPPED_IDS) recordAnswer(progress, id, 'good', now);
    const [next] = upcomingNewCards(progress, 1);
    expect(SHIPPED_IDS).not.toContain(next);
  });
});

describe('phrase variants', () => {
  const varied = VOCAB.filter((c) => c.variants?.length);

  it('are only on phrases, each a sentence no card or other variant already is', () => {
    for (const card of varied) expect(card.kind, card.id).toBe('phrase');
    const sentences = ASKED_VOCAB.map((c) => c.tl.toLowerCase());
    expect(sentences.filter((t, i) => sentences.indexOf(t) !== i)).toEqual([]);
  });

  it('bring no word that has no card of its own, other than the phrase\'s own', () => {
    for (const card of varied) {
      const own = tagalogWords(card.tl);
      for (const v of variantsOf(card)) {
        const unknown = tagalogWords(v.tl).filter((w) => !own.includes(w) && !cardForWord(w));
        expect(unknown, v.tl).toEqual([]);
      }
    }
  });

  it('are asked as the phrase, with a hook saying what changed', () => {
    const [kape] = variantsOf(getCard('nasaan-banyo')!);
    expect(kape).toMatchObject({ id: 'nasaan-banyo', kind: 'phrase', tl: 'Nasaan ang kape?', en: 'Where is the coffee?' });
    expect(kape.hook).toBe('The pattern of "Nasaan ang banyo?" (Where is the bathroom?), with "kape" in place of "banyo".');
    expect(variantsOf(getCard('libre-ka-ba')!)[0].hook).toBe('The pattern of "Libre ka ba?" (Are you free?), with "bukas" added.');
    expect(variantsOf(getCard('nasaan-banyo')!)[0]).toBe(kape);
    expect(variantsOf(getCard('kita-tayo-bukas')!)[1].hook).toBe('The pattern of "Kita tayo bukas." (See you tomorrow.), with "sa Lunes" in place of "bukas".');
    expect(variantsOf(getCard('salamat')!)).toEqual([]);
    expect(variantsOf(kape)).toEqual([]);
  });
});

describe('guides', () => {
  it('explain themselves, with examples and at least one question', () => {
    for (const g of GUIDES) {
      expect(isVocab(g), g.id).toBe(false);
      expect(g.note?.trim(), g.id).toBeTruthy();
      expect(g.examples?.length, g.id).toBeGreaterThan(0);
      expect(g.drills?.length, g.id).toBeGreaterThan(0);
    }
  });

  it('ask questions with one gap, one right answer and at least two wrong ones', () => {
    for (const g of GUIDES) {
      for (const d of g.drills!) {
        const label = `${g.id}: ${d.q}`;
        if (d.tl) expect(d.tl.split('___').length, label).toBe(2);
        expect(d.wrong.length, label).toBeGreaterThanOrEqual(2);
        expect(new Set([d.answer, ...d.wrong]).size, label).toBe(d.wrong.length + 1);
      }
    }
  });

  it('give every pattern sentences to build', () => {
    for (const g of GUIDES.filter((c) => c.kind === 'pattern')) expect(g.drills!.some(canBuild), g.id).toBe(true);
  });

  it('build only on cards that exist and come earlier in the order', () => {
    for (const g of GUIDES) {
      for (const id of g.needs ?? []) {
        expect(getCard(id), `${g.id} needs ${id}`).toBeDefined();
        expect(LEARN_ORDER.indexOf(id), `${g.id} needs ${id}`).toBeLessThan(LEARN_ORDER.indexOf(g.id));
      }
      for (const d of g.drills!) for (const id of d.uses ?? []) expect(getCard(id), `${g.id} uses ${id}`).toBeDefined();
    }
  });
});

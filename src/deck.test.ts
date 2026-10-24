import { describe, expect, it } from 'vitest';
import { ALL_CARDS, CORE_WORDS, LEARN_ORDER, UNITS, getCard, isVocab } from './deck';
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
];

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

  it('puts every card in the learning order exactly once', () => {
    expect([...LEARN_ORDER].sort()).toEqual(ALL_CARDS.map((c) => c.id).sort());
  });

  it('gives every core word its own card', () => {
    for (const id of CORE_WORDS) expect(getCard(id)?.tl.toLowerCase(), id).toBe(id);
  });

  it('introduces the core words a card is built from before the card', () => {
    // "Bang" is "ba" joined to the next word, "pong" is "po", and "nito" is "of this".
    const core = (word: string) =>
      [word, word.replace(/ng$/, ''), word === 'nito' ? 'ito' : ''].find((w) => CORE_WORDS.includes(w));
    for (const card of ALL_CARDS) {
      const words = card.tl.toLowerCase().split(/[^a-z-]+/).map(core);
      for (const word of words.filter((w): w is string => !!w && w !== card.id)) {
        expect(LEARN_ORDER.indexOf(word), `${card.id} uses ${word}`).toBeLessThan(LEARN_ORDER.indexOf(card.id));
      }
    }
  });

  it('gives every card a memory hook', () => {
    for (const card of ALL_CARDS) expect(card.hook.trim(), card.id).not.toBe('');
  });

  it('writes a hard g before e or i as "gh" in pronunciation hints, as English reads "gee" like "jee"', () => {
    for (const card of ALL_CARDS) expect(card.hint ?? '', card.id).not.toMatch(/(?<!n)g[ei]/i);
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

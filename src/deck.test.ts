import { describe, expect, it } from 'vitest';
import { ALL_CARDS, LEARN_ORDER, UNITS, getCard, isVocab } from './deck';
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

  it('gives every card a memory hook', () => {
    for (const card of ALL_CARDS) expect(card.hook.trim(), card.id).not.toBe('');
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

import { describe, expect, it } from 'vitest';
import { ALL_CARDS, LEARN_ORDER, UNITS, VOCAB, getCard, isVocab } from './deck';
import {
  MAX_LEARNING,
  PATTERN_START,
  GUIDE_START,
  buildExtraSession,
  buildTiles,
  canBuild,
  unmetCount,
  drillSentence,
  pickDrill,
  distractors,
  dueCards,
  learningCount,
  newCardsLeftToday,
  nextStudyStep,
  pickFormat,
  requeue,
  studyQueue,
  upcomingNewCards,
} from './session';
import { DAY_MS, newCardState } from './srs';
import { emptyProgress, recordAnswer } from './store';

const NOW = Date.UTC(2026, 0, 1, 12);

const CAN = { listen: true, speak: false };

const isVocabId = (id: string) => isVocab(getCard(id)!);
const VOCAB_ORDER = LEARN_ORDER.filter(isVocabId);

/** Introduce cards and give them each a schedule `days` long, last seen at NOW. */
function learn(progress: ReturnType<typeof emptyProgress>, ids: string[], days = 3): void {
  for (const id of ids) {
    recordAnswer(progress, id, 'good', NOW);
    progress.cards[id] = { ...progress.cards[id], interval: days, reps: 2, due: NOW + days * DAY_MS };
  }
}

describe('nextStudyStep', () => {
  it('starts a new learner at the top of the deck', () => {
    const step = nextStudyStep(emptyProgress(NOW), NOW, [], CAN);
    expect(step).toEqual({ cardId: LEARN_ORDER[0], kind: 'new', format: 'read' });
  });

  it('serves due reviews before any new word, weakest first', () => {
    const progress = emptyProgress(NOW);
    const [a, b] = UNITS[0].cards;
    learn(progress, [a.id], 1);
    learn(progress, [b.id], 10);
    // Both overdue, but the one with the shorter schedule has faded more.
    const later = NOW + 12 * DAY_MS;
    progress.today = { day: 'x', newCount: 0, reviewCount: 0 };
    expect(nextStudyStep(progress, later, [], CAN)).toMatchObject({ cardId: a.id, kind: 'review' });
    expect(nextStudyStep(progress, later, [a.id], CAN)).toMatchObject({ cardId: b.id, kind: 'review' });
    // Short of cards to space out, the gap shrinks rather than skipping a due word.
    expect(nextStudyStep(progress, later, [a.id, b.id], CAN)).toMatchObject({ cardId: a.id, kind: 'review' });
  });

  it('serves due words before learning ones that are not quite due', () => {
    const progress = emptyProgress(NOW);
    const [a, b] = UNITS[0].cards.map((card) => card.id);
    learn(progress, [a], 1);
    recordAnswer(progress, b, 'again', NOW + 2 * DAY_MS);
    expect(studyQueue(progress, NOW + 2 * DAY_MS)).toEqual([a, b]);
  });

  it('holds back new words while several are still being learned', () => {
    const progress = emptyProgress(NOW);
    const ids = UNITS[0].cards.slice(0, MAX_LEARNING).map((c) => c.id);
    for (const id of ids) recordAnswer(progress, id, 'again', NOW);
    expect(learningCount(progress)).toBe(MAX_LEARNING);
    // Words being learned come back even before their minute is up...
    expect(nextStudyStep(progress, NOW, [], CAN)?.kind).toBe('review');
    // ...and the next is one of them again, not another new word.
    const step = nextStudyStep(progress, NOW, ids, CAN);
    expect(step?.kind).toBe('review');
    expect(step?.cardId).not.toBe(ids[ids.length - 1]);
  });

  it('brings in a new word once the only one left to learn was just shown', () => {
    const progress = emptyProgress(NOW);
    const [a] = UNITS[0].cards.map((card) => card.id);
    recordAnswer(progress, a, 'again', NOW);
    expect(nextStudyStep(progress, NOW, [a], CAN)?.kind).toBe('new');
  });

  it('keeps to the daily new-word rate, then moves on to practice', () => {
    const progress = emptyProgress(NOW);
    const ids = ALL_CARDS.slice(0, 8).map((c) => c.id);
    learn(progress, ids);
    expect(newCardsLeftToday(progress)).toBe(0);
    const step = nextStudyStep(progress, NOW, [], CAN);
    expect(step?.kind).toBe('extra');
    expect(ids).toContain(step?.cardId);
  });

  it('practises the weakest words, and missed ones first', () => {
    const progress = emptyProgress(NOW);
    progress.settings.dailyNew = 0;
    const [a, b, c] = UNITS[0].cards.map((card) => card.id);
    learn(progress, [a], 30);
    learn(progress, [b], 3);
    learn(progress, [c], 30);
    const later = NOW + 2 * DAY_MS;
    expect(nextStudyStep(progress, later, [], CAN)?.cardId).toBe(b);
    expect(nextStudyStep(progress, later, [], CAN, new Map([[c, 1]]))?.cardId).toBe(c);
  });

  it("doesn't ask the same card twice in a row while there are others", () => {
    const progress = emptyProgress(NOW);
    progress.settings.dailyNew = 0;
    const [a, b] = UNITS[0].cards.map((card) => card.id);
    learn(progress, [a, b]);
    for (let i = 0; i < 10; i++) {
      const first = nextStudyStep(progress, NOW, [], CAN)!.cardId;
      expect(nextStudyStep(progress, NOW, [first], CAN)!.cardId).not.toBe(first);
    }
  });

  it('only adds speaking when the device can do it', () => {
    const progress = emptyProgress(NOW);
    progress.settings.dailyNew = 0;
    learn(progress, UNITS[0].cards.slice(0, 4).map((c) => c.id));
    expect(nextStudyStep(progress, NOW, [], { listen: false, speak: true }, new Map(), () => 0)?.format).toBe('speak');
    expect(nextStudyStep(progress, NOW, [], { listen: false, speak: false }, new Map(), () => 0)?.format).toBe('read');
  });
});

describe('pickFormat', () => {
  const state = (interval: number) => ({ ...newCardState(NOW), interval });
  const all = (interval: number, can = CAN) => new Set([0, 0.3, 0.6, 0.99].map((r) => pickFormat(state(interval), can, () => r)));

  it('asks words still being learned the easiest way', () => {
    expect(all(0)).toEqual(new Set(['read']));
  });

  it('self-rates learned words, in harder ways as they hold for longer', () => {
    expect(all(3)).toEqual(new Set(['remember', 'hear']));
    expect(all(14)).toEqual(new Set(['remember', 'produce', 'hear']));
  });

  it('leaves out listening without a voice', () => {
    expect(all(14, { listen: false, speak: false })).not.toContain('hear');
  });
});

describe('dueCards', () => {
  it('ignores saved progress for cards no longer in the deck', () => {
    const progress = emptyProgress(NOW);
    recordAnswer(progress, 'isa', 'good', NOW);
    recordAnswer(progress, 'removed-card', 'good', NOW);
    expect(dueCards(progress, NOW + 2 * DAY_MS)).toEqual(['isa']);
  });
});

describe('new cards', () => {
  it('come most useful first across topics, with no vocabulary locked', () => {
    const progress = emptyProgress(NOW);
    expect(upcomingNewCards(progress, Infinity).filter(isVocabId)).toEqual(VOCAB_ORDER);
    for (const id of VOCAB_ORDER.slice(0, 3)) recordAnswer(progress, id, 'good', NOW);
    expect(upcomingNewCards(progress, 2)).toEqual(VOCAB_ORDER.slice(3, 5));
  });

  it('skip cards met in an earlier order, however they were met', () => {
    const progress = emptyProgress(NOW);
    // Older builds introduced whole topics in turn.
    const met = UNITS[0].cards.map((c) => c.id);
    for (const id of met) recordAnswer(progress, id, 'good', NOW);
    const next = upcomingNewCards(progress, Infinity);
    expect(next.filter(isVocabId)).toEqual(VOCAB_ORDER.filter((id) => !met.includes(id)));
    expect(next.filter(isVocabId).length).toBe(VOCAB.length - met.length);
  });

  it('hold guides back until enough cards are met and the ones they build on have settled', () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER.slice(0, GUIDE_START - 1));
    // One more card first: the earliest a guide can come.
    const soon = upcomingNewCards(progress, Infinity);
    expect(isVocabId(soon[0])).toBe(true);
    // Guides that build on cards not yet met wait for them to settle.
    const met = VOCAB_ORDER.slice(0, GUIDE_START - 1);
    const guides = soon.filter((id) => !isVocabId(id));
    expect(guides).toContain('k-psst');
    for (const id of guides) for (const need of getCard(id)!.needs ?? []) expect(met).toContain(need);

    // Everything met so far has lasted a few days, so guides that build on it can come.
    const pastPsst = LEARN_ORDER.slice(0, LEARN_ORDER.indexOf('k-psst')).filter(isVocabId).length;
    learn(progress, VOCAB_ORDER.slice(GUIDE_START - 1, Math.max(pastPsst, PATTERN_START) + 10));
    const next = upcomingNewCards(progress, Infinity);
    const [first] = next.filter((id) => !isVocab(getCard(id)!));
    expect(first).toBe('k-psst');
    // And it comes at the first chance, ahead of the vocabulary it was placed after.
    expect(next[0]).toBe('k-psst');
  });

  it('keep patterns out of the first cards, however settled', () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER.slice(0, PATTERN_START - 3));
    const soon = upcomingNewCards(progress, Infinity);
    // Three more cards before the first pattern, at the earliest.
    expect(soon.findIndex((id) => getCard(id)!.kind === 'pattern')).toBeGreaterThanOrEqual(3);
  });

  it('wait for a card a guide needs to be remembered after a day, not just met', () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER.slice(0, 40));
    // Just met: one good answer, not yet seen again.
    progress.cards['po'] = { ...progress.cards['po'], reps: 1 };
    expect(upcomingNewCards(progress, Infinity)).not.toContain('p-po');
    progress.cards['po'] = { ...progress.cards['po'], reps: 2 };
    expect(upcomingNewCards(progress, Infinity)).toContain('p-po');
  });

  it('space guides out among new words', () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER.slice(0, 40));
    const next = upcomingNewCards(progress, 30);
    const guideAt = next.flatMap((id, i) => (isVocab(getCard(id)!) ? [] : [i]));
    expect(guideAt.length).toBeGreaterThan(1);
    for (let i = 1; i < guideAt.length; i++) expect(guideAt[i] - guideAt[i - 1]).toBeGreaterThanOrEqual(6);
  });

  it('keep bringing in guides once every word is met', () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER);
    const guides = upcomingNewCards(progress, Infinity);
    expect(guides.length).toBeGreaterThan(1);
    learn(progress, guides.slice(0, 1));
    expect(upcomingNewCards(progress, Infinity).length).toBeGreaterThan(0);
  });

  it('still count a card forgotten and relearned as one a guide can build on', () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER.slice(0, 40));
    // Missed once after weeks, then remembered again: reps start over, but it was known.
    progress.cards['po'] = { ...progress.cards['po'], reps: 1, lapses: 1, interval: 1 };
    expect(upcomingNewCards(progress, Infinity)).toContain('p-po');
  });

  it('count guides that are still waiting as unmet', () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER);
    expect(unmetCount(progress)).toBe(LEARN_ORDER.length - VOCAB_ORDER.length);
  });

  it('count guides met earlier when spacing the next one', () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER.slice(0, 80));
    learn(progress, ['k-psst']);
    const next = upcomingNewCards(progress, 30);
    expect(next.slice(0, 5).every((id) => isVocab(getCard(id)!))).toBe(true);
  });

  it('can go beyond the daily rate when asked for', () => {
    const progress = emptyProgress(NOW);
    for (const id of LEARN_ORDER.slice(0, 8)) recordAnswer(progress, id, 'good', NOW);
    expect(newCardsLeftToday(progress)).toBe(0);
    const steps = buildExtraSession(progress, 5);
    expect(steps.map((s) => s.cardId)).toEqual(LEARN_ORDER.slice(8, 13));
    expect(steps.every((s) => s.kind === 'new')).toBe(true);
  });
});

describe('requeue', () => {
  it('puts a missed card back three steps later as a review', () => {
    const queue = ['a', 'b', 'c', 'd'].map((cardId) => ({ cardId, kind: 'new' as const }));
    const next = requeue(queue, { cardId: 'x', kind: 'new' });
    expect(next.map((s) => s.cardId)).toEqual(['a', 'b', 'c', 'x', 'd']);
    expect(next[3].kind).toBe('review');
  });

  it('appends when the queue is short', () => {
    expect(requeue([], { cardId: 'x', kind: 'review' })).toEqual([{ cardId: 'x', kind: 'review' }]);
  });
});

describe('distractors', () => {
  it('returns distinct wrong answers of the same kind when possible', () => {
    const card = ALL_CARDS.find((c) => c.id === 'tubig')!;
    for (let i = 0; i < 20; i++) {
      const picks = distractors(card, 'en', 3);
      expect(picks).toHaveLength(3);
      expect(picks.map((p) => p.id)).not.toContain(card.id);
      expect(new Set(picks.map((p) => p.en)).size).toBe(3);
      expect(picks.every((p) => p.kind === 'word')).toBe(true);
    }
  });

  it('never offers a card that could also be right', () => {
    const pool = ['ako', 'ko', 'ikaw', 'ka', 'mo', 'na', 'ngayon', 'tubig', 'kape', 'kanin'].map((id) => getCard(id)!);
    for (let i = 0; i < 20; i++) {
      expect(distractors(getCard('ka')!, 'en', 3, pool).map((c) => c.id)).not.toContain('ikaw');
      expect(distractors(getCard('ka')!, 'en', 3, pool).map((c) => c.id)).not.toContain('mo');
      expect(distractors(getCard('ako')!, 'en', 3, pool).map((c) => c.id)).not.toContain('ko');
      expect(distractors(getCard('ngayon')!, 'tl', 3, pool).map((c) => c.id)).not.toContain('na');
    }
  });
});

describe('guides', () => {
  it('are checked with a gap while being learned, then built or recalled', () => {
    const learning = newCardState(NOW);
    const learned = { ...learning, interval: 10, reps: 3 };
    expect(pickFormat(learning, CAN, () => 0.1, 'pattern')).toBe('gap');
    expect(pickFormat(learned, CAN, () => 0.1, 'pattern')).toBe('build');
    expect(pickFormat(learned, CAN, () => 0.9, 'pattern')).toBe('think');
    expect(pickFormat(learning, CAN, () => 0.1, 'sound')).toBe('gap');
    expect(pickFormat(learned, CAN, () => 0.1, 'knowhow')).toBe('think');
  });

  it('are never offered for speaking in extra practice', () => {
    const progress = emptyProgress(NOW);
    learn(progress, ['p-po', 's-ng'], 30);
    progress.today.newCount = progress.settings.dailyNew;
    for (let i = 0; i < 20; i++) {
      const step = nextStudyStep(progress, NOW, [], { listen: true, speak: true }, new Map(), () => i / 20);
      expect(['gap', 'build']).toContain(step?.format);
    }
  });

  it('pick drills made of cards already met, and not the same one twice running', () => {
    const progress = emptyProgress(NOW);
    const card = getCard('p-gusto')!;
    learn(progress, ['gusto-ko-ito', 'kape']);
    const known = card.drills!.filter((d) => !d.uses);
    for (let i = 0; i < 10; i++) expect(known).toContain(pickDrill(card, progress, 'gap', undefined, () => i / 10));
    learn(progress, ['tubig', 'kanin', 'tinapay']);
    const first = pickDrill(card, progress, 'gap', undefined, () => 0)!;
    expect(pickDrill(card, progress, 'gap', first, () => 0)).not.toBe(first);
  });

  it('only build sentences long enough to be worth ordering', () => {
    const progress = emptyProgress(NOW);
    const card = getCard('p-hindi')!;
    for (let i = 0; i < 10; i++) expect(canBuild(pickDrill(card, progress, 'build', undefined, () => i / 10)!)).toBe(true);
    expect(drillSentence({ q: 'I want coffee.', tl: 'Gusto ko ___ kape.', answer: 'ng', wrong: [] })).toBe('Gusto ko ng kape.');
    // Capitals and punctuation would give the order away.
    expect(buildTiles({ q: 'Who is Ana?', tl: 'Sino ___ Ana?', answer: 'si', wrong: ['ng', 'ba'] })).toEqual({ words: ['sino', 'si', 'ana'], decoy: 'ng' });
  });

  it('are never used as wrong answers for words', () => {
    for (let i = 0; i < 20; i++) {
      for (const c of distractors(getCard('kape')!, 'en', 3, ALL_CARDS)) expect(isVocab(c)).toBe(true);
    }
  });
});

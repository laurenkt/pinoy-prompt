import { describe, expect, it } from 'vitest';
import { ALL_CARDS, LEARN_ORDER, UNITS, WAYS, buildsOn, cardKey, getCard, isVocab, studyWays, type Card, type Way } from './deck';
import {
  MAX_LEARNING,
  askAs,
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
  nextStudyAt,
  nextStudyStep,
  DRILL_GAP,
  drillHelp,
  drillKey,
  drillWeight,
  noteDrillAnswer,
  drillOdds,
  pickDrillCard,
  noteDrillRepeat,
  DRILL_REPEATS,
  type DrillRepeat,
  setDrillHelp,
  pickFormat,
  requeue,
  studyQueue,
  typing,
  upcomingNewCards,
} from './session';
import { DAY_MS, newCardState, startOfDayAfter } from './srs';
import { emptyProgress, recordAnswer } from './store';

const NOW = Date.UTC(2026, 0, 1, 12);

const CAN = { listen: true };

const isVocabId = (id: string) => isVocab(getCard(id)!);
const VOCAB_ORDER = LEARN_ORDER.filter(isVocabId);
/** Whether a card builds on nothing, so it can come before anything has settled. */
const standsAlone = (id: string) => buildsOn(getCard(id)!).length === 0;

/** Introduce cards and give them each a schedule `days` long, last seen at NOW: read only, or every way Study asks. */
function learn(progress: ReturnType<typeof emptyProgress>, ids: string[], days = 3, everyWay = false): void {
  for (const id of ids) {
    for (const way of everyWay ? studyWays(getCard(id)!) : ['read' as const]) {
      const key = cardKey(id, way);
      recordAnswer(progress, key, 'good', NOW);
      progress.cards[key] = { ...progress.cards[key], interval: days, reps: 2, due: NOW + days * DAY_MS };
    }
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

  it('keeps to the daily new-word rate, then is caught up: practice beyond that is Drills\'', () => {
    const progress = emptyProgress(NOW);
    learn(progress, ALL_CARDS.slice(0, 8).map((c) => c.id), 3, true);
    expect(newCardsLeftToday(progress)).toBe(0);
    expect(nextStudyStep(progress, NOW, [], CAN)).toBeNull();
  });

  it("starts a word's other ways once it has settled, before new words and without using up the day's new words", () => {
    const progress = emptyProgress(NOW);
    const [a, b] = VOCAB_ORDER;
    learn(progress, [a]);
    // Met today and not yet remembered a day later: it's learned by reading first.
    recordAnswer(progress, b, 'good', NOW);
    const step = nextStudyStep(progress, NOW, [], CAN)!;
    expect(step).toEqual({ cardId: a, way: 'listen', kind: 'review', format: 'listen' });
    const before = progress.today.newCount;
    recordAnswer(progress, cardKey(a, 'listen'), 'good', NOW);
    expect(progress.today.newCount).toBe(before);
    expect(nextStudyStep(progress, NOW, [cardKey(a, 'listen')], CAN)).toMatchObject({ kind: 'new' });
    // A way not just shown, once there's nothing else.
    expect(nextStudyStep(progress, NOW, [cardKey(b, 'read'), b, b], CAN)).toEqual({ cardId: a, way: 'recall', kind: 'review', format: 'recall' });
  });

  it('asks each way of a word by its own schedule, and leaves listening waiting while the sound is off', () => {
    const progress = emptyProgress(NOW);
    progress.settings.dailyNew = 0;
    const [a] = VOCAB_ORDER;
    learn(progress, [a], 3, true);
    const later = NOW + 4 * DAY_MS;
    expect(studyQueue(progress, later, CAN).sort()).toEqual([a, cardKey(a, 'listen'), cardKey(a, 'recall')].sort());
    expect(studyQueue(progress, later, { listen: false })).not.toContain(cardKey(a, 'listen'));
    progress.cards[cardKey(a, 'recall')].due = later + DAY_MS;
    const formats = new Set<string>();
    const recent: string[] = [];
    for (let i = 0; i < 6; i++) {
      const step = nextStudyStep(progress, later, recent, { listen: false })!;
      expect(step.way).not.toBe('listen');
      formats.add(step.format!);
      recent.push(cardKey(step.cardId, step.way ?? 'read'));
    }
    expect(formats).toEqual(new Set(['remember']));
  });

  it("doesn't let listening cards waiting for the sound hold back the other ways and new words", () => {
    const progress = emptyProgress(NOW);
    const ids = VOCAB_ORDER.slice(0, 4);
    learn(progress, ids, 3);
    // Three words whose listening was missed, so still being learned, then the sound goes off.
    for (const id of ids.slice(0, 3)) {
      recordAnswer(progress, cardKey(id, 'listen'), 'again', NOW);
      progress.cards[cardKey(id, 'recall')] = { ...progress.cards[id] };
    }
    expect(learningCount(progress)).toBe(3);
    expect(learningCount(progress, { listen: false })).toBe(0);
    const step = nextStudyStep(progress, NOW + 60_000, [], { listen: false });
    expect(step).not.toBeNull();
    expect(step!.way).not.toBe('listen');
  });

  it('asks the card just shown again when it is the only one left being learned, rather than being caught up', () => {
    const progress = emptyProgress(NOW);
    progress.settings.dailyNew = 0;
    const [a] = UNITS[0].cards.map((card) => card.id);
    recordAnswer(progress, a, 'again', NOW);
    expect(nextStudyStep(progress, NOW, [a], CAN)?.cardId).toBe(a);
  });

  it("doesn't ask the same card twice in a row while there are others", () => {
    const progress = emptyProgress(NOW);
    progress.settings.dailyNew = 0;
    const [a, b] = UNITS[0].cards.map((card) => card.id);
    learn(progress, [a, b]);
    for (const id of [a, b]) progress.cards[id].due = NOW - 1;
    for (let i = 0; i < 10; i++) {
      const first = nextStudyStep(progress, NOW, [], CAN)!.cardId;
      expect(nextStudyStep(progress, NOW, [first], CAN)!.cardId).not.toBe(first);
    }
  });
});

describe('nextStudyAt', () => {
  it('is when the next review falls due, once today\'s new cards are in', () => {
    const progress = emptyProgress(NOW);
    learn(progress, ALL_CARDS.slice(0, 8).map((c) => c.id));
    progress.cards[ALL_CARDS[3].id].due = NOW + 3 * 60 * 60 * 1000;
    expect(nextStudyAt(progress, NOW)).toBe(NOW + 3 * 60 * 60 * 1000);
  });

  it('is tomorrow, when the daily new-card rate holds back the next new card sooner than any review', () => {
    const progress = emptyProgress(NOW);
    learn(progress, ALL_CARDS.slice(0, 8).map((c) => c.id), 5);
    expect(nextStudyAt(progress, NOW)).toBe(startOfDayAfter(NOW, 1));
  });

  it('waits only for reviews when new cards are turned off', () => {
    const progress = emptyProgress(NOW);
    learn(progress, ALL_CARDS.slice(0, 8).map((c) => c.id), 5);
    progress.settings.dailyNew = 0;
    expect(nextStudyAt(progress, NOW)).toBe(NOW + 5 * DAY_MS);
  });

  it("doesn't wait for a listening card while the sound is off, as Study won't ask it", () => {
    const progress = emptyProgress(NOW);
    const id = VOCAB_ORDER[0];
    learn(progress, [id], 5, true);
    progress.settings.dailyNew = 0;
    progress.cards[cardKey(id, 'listen')].due = NOW + DAY_MS;
    expect(nextStudyAt(progress, NOW)).toBe(NOW + DAY_MS);
    expect(nextStudyAt(progress, NOW, { listen: false })).toBe(NOW + 5 * DAY_MS);
  });

  it('is null with nothing met and nothing to meet', () => {
    const progress = emptyProgress(NOW);
    progress.settings.dailyNew = 0;
    expect(nextStudyAt(progress, NOW)).toBeNull();
  });
});

describe('pickFormat', () => {
  const state = (interval: number) => ({ ...newCardState(NOW), interval });

  it('asks words still being learned each way by picking from four', () => {
    expect(pickFormat(state(0), 'read')).toBe('read');
    expect(pickFormat(state(0), 'listen')).toBe('listen');
    expect(pickFormat(state(0), 'recall')).toBe('recall');
  });

  it('self-rates learned words, the same way round', () => {
    for (const interval of [3, 30]) {
      expect(pickFormat(state(interval), 'read')).toBe('remember');
      expect(pickFormat(state(interval), 'listen')).toBe('hear');
      expect(pickFormat(state(interval), 'recall')).toBe('produce');
    }
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
    expect(upcomingNewCards(progress, Infinity).filter(isVocabId)).toEqual(VOCAB_ORDER.filter(standsAlone));
    for (const id of VOCAB_ORDER.slice(0, 3)) recordAnswer(progress, id, 'good', NOW);
    expect(upcomingNewCards(progress, 2)).toEqual(VOCAB_ORDER.slice(3, 5));
    // Once everything met has settled, every word and phrase is open.
    learn(progress, VOCAB_ORDER.slice(0, -1));
    expect(upcomingNewCards(progress, Infinity).filter(isVocabId)).toEqual(VOCAB_ORDER.slice(-1));
  });

  it('skip cards met in an earlier order, however they were met', () => {
    const progress = emptyProgress(NOW);
    // Older builds introduced whole topics in turn.
    const met = UNITS[0].cards.map((c) => c.id);
    learn(progress, met);
    const next = upcomingNewCards(progress, Infinity).filter(isVocabId);
    expect(next).toEqual(VOCAB_ORDER.filter((id) => !met.includes(id) && buildsOn(getCard(id)!).every((w) => met.includes(w))));
  });

  it('hold a phrase back until the words it is built from have settled, bringing the next card in meanwhile', () => {
    const progress = emptyProgress(NOW);
    const before = VOCAB_ORDER.slice(0, VOCAB_ORDER.indexOf('salamat-po'));
    learn(progress, before);
    // "Po" was only just met: one good answer, not yet seen again.
    progress.cards['po'] = { ...progress.cards['po'], reps: 1, interval: 0 };
    expect(upcomingNewCards(progress, 1)).toEqual(['wala']);
    progress.cards['po'] = { ...progress.cards['po'], reps: 2, interval: 1 };
    expect(upcomingNewCards(progress, 1)).toEqual(['salamat-po']);
  });

  it('keep a phrase out of the cards met with its words, so it comes on a later day', () => {
    const progress = emptyProgress(NOW);
    const today = upcomingNewCards(progress, 30);
    for (const id of today) for (const word of buildsOn(getCard(id)!)) expect(today, `${id} uses ${word}`).not.toContain(word);
  });

  it('keep spacing guides out while words are still waiting for the ones they build on', () => {
    const progress = emptyProgress(NOW);
    // Every word met and settled but "kumain", just met, so the phrases built on it wait.
    learn(progress, VOCAB_ORDER.filter((id) => id !== 'kumain-ka-na-ba' && id !== 'kumain-na-ako'));
    progress.cards['kumain'] = { ...progress.cards['kumain'], reps: 1, interval: 0 };
    expect(upcomingNewCards(progress, Infinity).length).toBe(1);
  });

  it('bring in the words of a phrase met before they were in the deck', () => {
    const progress = emptyProgress(NOW);
    // Met "Paano sabihin ito sa Tagalog?" before "paano" and "sabihin" came ahead of it.
    learn(progress, [...VOCAB_ORDER.slice(0, VOCAB_ORDER.indexOf('paano')), 'paano-sabihin']);
    expect(upcomingNewCards(progress, 2)).toEqual(['paano', 'sabihin']);
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
    // Phrases built on today's words wait for another day.
    expect(steps.map((s) => s.cardId)).toEqual(LEARN_ORDER.slice(8).filter(standsAlone).slice(0, 5));
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

  it('brings it back asked the same way', () => {
    expect(requeue([], { cardId: 'x', way: 'recall', kind: 'review' })[0].way).toBe('recall');
  });

  it('appends when the queue is short', () => {
    expect(requeue([], { cardId: 'x', kind: 'review' })).toEqual([{ cardId: 'x', kind: 'review' }]);
  });
});

describe('askAs', () => {
  const now = Date.UTC(2026, 0, 1);
  const banyo = getCard('nasaan-banyo')!;
  /** Progress with these cards met, and the phrase settled when read. */
  const met = (...ids: string[]) => {
    const progress = emptyProgress(now);
    for (const id of ['nasaan-banyo', ...ids]) recordAnswer(progress, id, 'good', now);
    progress.cards['nasaan-banyo'] = { ...progress.cards['nasaan-banyo'], interval: 3, reps: 2 };
    return progress;
  };

  it('sometimes asks a settled phrase as a variant whose words are all met', () => {
    const progress = met('nasaan', 'ang', 'kape');
    expect(askAs(progress, banyo, 'read', () => 0).tl).toBe('Nasaan ang kape?');
    expect(askAs(progress, banyo, 'read', () => 0).id).toBe('nasaan-banyo');
    expect(askAs(progress, banyo, 'read', () => 0.99)).toBe(banyo);
    // Speak goes by reading's schedule.
    expect(askAs(progress, banyo, 'speak', () => 0).tl).toBe('Nasaan ang kape?');
  });

  it('never asks a variant with a word not met yet', () => {
    expect(askAs(met('nasaan', 'ang'), banyo, 'read', () => 0)).toBe(banyo);
    // "palengke" met but not "kape": only the market is asked.
    const progress = met('nasaan', 'ang', 'palengke');
    expect(askAs(progress, banyo, 'read', () => 0).tl).toBe('Nasaan ang palengke?');
  });

  it('asks a phrase as itself until it has settled that way', () => {
    const progress = met('nasaan', 'ang', 'kape');
    expect(askAs(progress, banyo, 'listen', () => 0)).toBe(banyo);
    recordAnswer(progress, 'nasaan-banyo', 'good', now);
    progress.cards['nasaan-banyo'].reps = 1;
    expect(askAs(progress, banyo, 'read', () => 0)).toBe(banyo);
  });

  it('asks a card without variants, or a variant, as itself', () => {
    const salamat = getCard('salamat')!;
    expect(askAs(met('salamat'), salamat, 'read', () => 0)).toBe(salamat);
    const kape = askAs(met('nasaan', 'ang', 'kape'), banyo, 'read', () => 0);
    expect(askAs(met('nasaan', 'ang', 'kape', 'palengke'), kape, 'read', () => 0)).toBe(kape);
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

  it('keeps the newer look-alike meanings apart too', () => {
    const pairs = [
      ['kayo', 'ikaw'], ['bata', 'anak'], ['luma', 'matanda'], ['kapatid', 'ate'], ['kapatid', 'kuya'],
      ['walang-problema', 'walang-anuman'], ['walang-problema', 'ayos-lang'], ['maghintay', 'teka'], ['tumulong', 'tulong'],
    ];
    const fillers = ['tubig', 'kape', 'kanin', 'isda'];
    for (const [a, b] of pairs) {
      const pool = [a, b, ...fillers].map((id) => getCard(id)!);
      for (let i = 0; i < 20; i++) {
        expect(distractors(getCard(a)!, 'en', 3, pool).map((c) => c.id), `${a} offers ${b}`).not.toContain(b);
        expect(distractors(getCard(b)!, 'en', 3, pool).map((c) => c.id), `${b} offers ${a}`).not.toContain(a);
      }
    }
  });
});

describe('guides', () => {
  it('are checked with a gap while being learned, then built or recalled', () => {
    const learning = newCardState(NOW);
    const learned = { ...learning, interval: 10, reps: 3 };
    expect(pickFormat(learning, 'read', () => 0.1, 'pattern')).toBe('gap');
    expect(pickFormat(learned, 'read', () => 0.1, 'pattern')).toBe('build');
    expect(pickFormat(learned, 'read', () => 0.9, 'pattern')).toBe('think');
    expect(pickFormat(learning, 'read', () => 0.1, 'sound')).toBe('gap');
    expect(pickFormat(learned, 'read', () => 0.1, 'knowhow')).toBe('think');
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

describe('picking the next card to drill', () => {
  const KNOWN = ['salamat', 'kumusta', 'oo', 'hindi', 'paalam', 'kape'];
  const LATER = NOW + 60 * DAY_MS;

  /** Cards all met long ago and holding for months, so none stands out unless a test makes it. */
  function settledProgress(ids = KNOWN) {
    const progress = emptyProgress(NOW);
    learn(progress, ids, 90);
    return progress;
  }

  /** Words asked every way, guides as a gap to fill (read), as a round with everything in scope does. */
  const everyWay = (card: Card): readonly Way[] => (isVocab(card) ? WAYS : ['read']);

  /** The card picked next, asked any way. */
  function pick(progress: ReturnType<typeof emptyProgress>, now: number, recent: string[], repeats = new Map<string, DrillRepeat>(), ways = everyWay, random?: () => number) {
    return pickDrillCard(progress, now, recent, repeats, 0, ways, random)?.card ?? null;
  }

  /** How often each card comes up over many picks, and (`byWay`) how often each card asked each way, by drillKey. */
  function tallies(progress: ReturnType<typeof emptyProgress>, recent: string[] = [], repeats = new Map<string, DrillRepeat>(), now = LATER) {
    const seen = new Map<string, number>();
    const byWay = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const { card, way } = pickDrillCard(progress, now, recent, repeats, 0, everyWay, () => (i + 0.5) / 4000)!;
      seen.set(card.id, (seen.get(card.id) ?? 0) + 1);
      byWay.set(drillKey(card.id, way), (byWay.get(drillKey(card.id, way)) ?? 0) + 1);
    }
    return { seen, byWay };
  }

  const counts = (...args: Parameters<typeof tallies>) => tallies(...args).seen;

  /** A drill answer asked `way` that needed help (or, with `helped` false, was got right unaided). */
  const helpWith = (progress: ReturnType<typeof emptyProgress>, id: string, way: Way = 'recall', helped = true) =>
    noteDrillAnswer(progress, id, way, helped, LATER);

  it('keeps the last three cards out', () => {
    const seen = counts(settledProgress(), ['kape', 'salamat', 'oo', 'hindi']);
    expect([...seen.keys()].sort()).toEqual(['kape', 'kumusta', 'paalam']);
  });

  it('gives the chances it picks by, adding up to one, with none for a card sitting out', () => {
    const progress = settledProgress();
    progress.cards.kape.lapses = 2;
    helpWith(progress, 'kape');
    const odds = drillOdds(progress, LATER, ['salamat'], new Map(), everyWay);
    expect(odds.reduce((sum, o) => sum + o.chance, 0)).toBeCloseTo(1);
    expect(odds.some((o) => o.pick.card.id === 'salamat')).toBe(false);
    // Over many evenly spread draws, each question comes up about as often as its chance says.
    const seen = tallies(progress, ['salamat']).byWay;
    for (const { pick, chance } of odds) expect((seen.get(drillKey(pick.card.id, pick.way)) ?? 0) / 4000).toBeCloseTo(chance, 2);
  });

  it('only keeps out what leaves a card to ask, when few are known', () => {
    const progress = settledProgress(['salamat', 'oo']);
    expect(pick(progress, LATER, ['salamat', 'oo'])!.id).toBe('salamat');
    expect(pick(progress, LATER, ['oo', 'salamat'])!.id).toBe('oo');
    expect(pick(settledProgress(['oo']), LATER, ['oo'])!.id).toBe('oo');
  });

  it('has nothing to ask with no cards, or none it may ask', () => {
    expect(pick(emptyProgress(NOW), NOW, [])).toBeNull();
    expect(pick(settledProgress(), LATER, [], new Map(), () => [])).toBeNull();
  });

  it('brings a card missed this round back more often between its repeats, asked the way it was missed', () => {
    const plain = tallies(settledProgress()).byWay;
    const missed = tallies(settledProgress(), [], new Map([[drillKey('kape', 'recall'), { misses: 2, rights: 1, due: 10 }]])).byWay;
    expect(missed.get(drillKey('kape', 'recall'))!).toBeGreaterThan(plain.get(drillKey('kape', 'recall'))! * 5);
    expect(missed.get(drillKey('kape', 'recall'))!).toBeGreaterThan(missed.get(drillKey('kape', 'read'))! * 5);
  });

  it('asks a miss again on the very next question, then after one other, then easing off', () => {
    const progress = settledProgress();
    const repeats = new Map<string, DrillRepeat>();
    const key = drillKey('salamat', 'recall');
    // Every random draw lands on the last question it could pick, among the rest, so it's never salamat by chance.
    const first = () => 0.9999;
    const at = (asked: number, recent: string[]) => pickDrillCard(progress, LATER, recent, repeats, asked, everyWay, first);
    noteDrillRepeat(repeats, key, false, 0);
    // Straight back, though it was just asked.
    expect(at(1, ['salamat'])).toEqual({ card: getCard('salamat'), way: 'recall' });
    noteDrillRepeat(repeats, key, true, 1);
    const asked: number[] = [];
    let recent = ['salamat'];
    for (let q = 2; q < 30; q++) {
      const { card, way } = at(q, recent)!;
      recent = [...recent.slice(-DRILL_GAP), card.id];
      if (card.id !== 'salamat') continue;
      expect(way).toBe('recall');
      asked.push(q);
      noteDrillRepeat(repeats, key, true, q);
    }
    // One question between, then three, then six; then it takes its chances with the rest.
    expect(asked).toEqual([3, 7, 14]);
    expect(repeats.size).toBe(0);
    expect(DRILL_REPEATS).toEqual([0, 1, 3, 6]);
  });

  it('keeps a word that slips again close for longer, starting over each time it is missed', () => {
    const repeats = new Map<string, DrillRepeat>();
    const key = drillKey('kape', 'recall');
    noteDrillRepeat(repeats, key, false, 0);
    noteDrillRepeat(repeats, key, true, 1);
    expect(repeats.get(key)).toEqual({ misses: 1, rights: 1, due: 3 });
    // Missed again when it came back: next question again, and one more one-question gap before it eases off.
    noteDrillRepeat(repeats, key, false, 3);
    expect(repeats.get(key)).toEqual({ misses: 2, rights: 0, due: 4 });
    const dues: number[] = [];
    while (repeats.has(key)) {
      const q = repeats.get(key)!.due;
      noteDrillRepeat(repeats, key, true, q);
      if (repeats.has(key)) dues.push(repeats.get(key)!.due - q - 1);
    }
    expect(dues).toEqual([1, 1, 3, 6]);
    // Right with nothing coming back changes nothing.
    noteDrillRepeat(repeats, key, true, 40);
    expect(repeats.size).toBe(0);
  });

  it('holds a repeat that the round can no longer ask until it can', () => {
    const progress = settledProgress();
    const repeats = new Map<string, DrillRepeat>([[drillKey('kape', 'recall'), { misses: 1, rights: 0, due: 1 }]]);
    const readOnly = () => ['read'] as const;
    expect(pickDrillCard(progress, LATER, [], repeats, 1, readOnly, () => 0)!.card.id).not.toBe('kape');
    expect(pickDrillCard(progress, LATER, [], repeats, 5, everyWay, () => 0)).toEqual({ card: getCard('kape'), way: 'recall' });
  });

  it('gives a word the drills keep having to help with a big share of the round, even among many new words', () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER.slice(0, 100), 30);
    const fresh = VOCAB_ORDER.slice(100, 112);
    for (const id of fresh) {
      recordAnswer(progress, id, 'good', LATER - DAY_MS);
      progress.cards[id] = { ...progress.cards[id], introduced: LATER - DAY_MS };
    }
    const [hard, once] = VOCAB_ORDER;
    for (let i = 0; i < 3; i++) helpWith(progress, hard);
    helpWith(progress, once);
    const odds = drillOdds(progress, LATER, [], new Map(), everyWay);
    const chance = (id: string) => odds.filter((o) => o.pick.card.id === id).reduce((sum, o) => sum + o.chance, 0);
    expect(chance(hard)).toBeGreaterThan(0.4);
    expect(chance(once)).toBeGreaterThan(0.12);
    // A word met yesterday comes up far less than either; one held for a month, less again.
    expect(chance(fresh[0])).toBeLessThan(chance(once) / 3);
    expect(chance(VOCAB_ORDER[50])).toBeLessThan(chance(fresh[0]));
  });

  it('always leaves a fifth of the round for words known well, however many need help or are new', () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER.slice(0, 100), 30);
    const fresh = VOCAB_ORDER.slice(100, 110);
    for (const id of fresh) {
      recordAnswer(progress, id, 'good', LATER - DAY_MS);
      progress.cards[id] = { ...progress.cards[id], introduced: LATER - DAY_MS };
    }
    const helped = VOCAB_ORDER.slice(0, 6);
    for (const id of helped) helpWith(progress, id);
    const odds = drillOdds(progress, LATER, [], new Map(), everyWay);
    const known = odds
      .filter((o) => drillHelp(progress.cards[o.pick.card.id], o.pick.way) === 0 && !fresh.includes(o.pick.card.id))
      .reduce((sum, o) => sum + o.chance, 0);
    expect(known).toBeCloseTo(0.2);
  });

  it('keeps room for new words and words known well in a small deck where most need help', () => {
    const progress = emptyProgress(NOW);
    const known = VOCAB_ORDER.slice(0, 8);
    learn(progress, known, 30);
    const fresh = VOCAB_ORDER.slice(8, 11);
    for (const id of fresh) {
      recordAnswer(progress, id, 'good', LATER - DAY_MS);
      progress.cards[id] = { ...progress.cards[id], introduced: LATER - DAY_MS };
    }
    for (const id of known.slice(0, 6)) for (const way of WAYS) helpWith(progress, id, way);
    const odds = drillOdds(progress, LATER, [], new Map(), everyWay);
    const share = (ids: string[]) => odds.filter((o) => ids.includes(o.pick.card.id)).reduce((sum, o) => sum + o.chance, 0);
    expect(share(known.slice(0, 6))).toBeCloseTo(0.6);
    expect(share(fresh)).toBeGreaterThan(0.1);
    expect(share(known.slice(6))).toBeGreaterThanOrEqual(0.19);
  });

  it("doesn't hand a helped word sitting out its share to the others helped with", () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER.slice(0, 100), 30);
    const [hard, once] = VOCAB_ORDER;
    for (let i = 0; i < 3; i++) helpWith(progress, hard, 'read');
    helpWith(progress, once, 'listen');
    const odds = drillOdds(progress, LATER, [hard], new Map(), everyWay);
    const chance = odds.find((o) => o.pick.card.id === once && o.pick.way === 'listen')!.chance;
    expect(chance).toBeCloseTo(0.15, 1);
  });

  it('leans on cards that are fading, still being learned, newly met or often forgotten, and still asks the rest', () => {
    const progress = settledProgress();
    const strong = (id: string) => counts(progress).get(id)! / 4000;
    const before = strong('kape');
    // Fading: last seen long before its interval would hold it.
    progress.cards.oo = { ...progress.cards.oo, interval: 3 };
    // Forgotten and being learned again.
    progress.cards.hindi = { ...progress.cards.hindi, interval: 0, lapses: 2, reviewed: LATER };
    // Just met.
    progress.cards.paalam = { ...progress.cards.paalam, introduced: LATER, reviewed: LATER, interval: 0 };
    const seen = counts(progress);
    for (const id of ['oo', 'hindi', 'paalam']) expect(seen.get(id)!).toBeGreaterThan(seen.get('kape')! * 2);
    // The strong ones come up less than before, but still come up.
    expect(seen.get('kape')! / 4000).toBeLessThan(before);
    expect(seen.get('kape')! / 4000).toBeGreaterThan(0.03);
  });

  it("gives cards met in the last few days half the round, however many cards are known", () => {
    // A big deck held for months, and a few words met yesterday that got a good first answer.
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER.slice(0, 200), 30);
    const yesterday = VOCAB_ORDER.slice(200, 205);
    for (const id of yesterday) {
      recordAnswer(progress, id, 'good', LATER - DAY_MS);
      progress.cards[id] = { ...progress.cards[id], introduced: LATER - DAY_MS };
    }
    const seen = counts(progress);
    const share = yesterday.reduce((sum, id) => sum + (seen.get(id) ?? 0), 0) / 4000;
    expect(share).toBeGreaterThan(0.45);
    // The rest of the round still goes round the others.
    expect(share).toBeLessThan(0.55);
    // So does a real round, where the last few asked sit out.
    let recent: string[] = [];
    let seed = 1;
    let asked = 0;
    for (let i = 0; i < 4000; i++) {
      const id = pick(progress, LATER, recent, new Map(), everyWay, () => (seed = (seed * 16807) % 2147483647) / 2147483647)!.id;
      recent = [...recent.slice(-DRILL_GAP), id];
      if (yesterday.includes(id)) asked++;
    }
    expect(asked / 4000).toBeGreaterThan(0.42);
    expect(asked / 4000).toBeLessThan(0.55);
  });

  it('lets words met this week that have settled take their turn with the rest, and keeps the focus for ones that have not', () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER.slice(0, 100), 30);
    const meet = (ids: string[], settle: boolean) => {
      for (const id of ids) {
        recordAnswer(progress, id, 'good', LATER - 3 * DAY_MS);
        if (settle) recordAnswer(progress, id, 'good', LATER - 2 * DAY_MS);
        progress.cards[id] = { ...progress.cards[id], introduced: LATER - 3 * DAY_MS + 1 };
      }
    };
    const known = VOCAB_ORDER.slice(100, 105);
    const unsure = VOCAB_ORDER.slice(105, 110);
    meet(known, true);
    meet(unsure, false);
    const seen = counts(progress);
    const each = (ids: string[]) => ids.reduce((sum, id) => sum + (seen.get(id) ?? 0), 0) / ids.length;
    const old = each(VOCAB_ORDER.slice(0, 100));
    // Remembered a day after they were met, they come up about as often as words held for weeks.
    expect(each(known)).toBeLessThan(old * 2.5);
    // Not remembered since, they still share the focus part of the round.
    expect(each(unsure)).toBeGreaterThan(each(known) * 3);
  });

  it('asks a word the drills had to help with more often than one met yesterday', () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER.slice(0, 100), 30);
    const yesterday = VOCAB_ORDER.slice(100, 105);
    for (const id of yesterday) recordAnswer(progress, id, 'good', LATER - DAY_MS);
    const [helped] = VOCAB_ORDER;
    helpWith(progress, helped);
    const seen = counts(progress);
    for (const id of yesterday) expect(seen.get(helped)!).toBeGreaterThan(seen.get(id)! * 1.3);
  });

  it('brings a card the drills had to help with back much more often, asked that way, until it is got right unaided', () => {
    const progress = settledProgress();
    const plain = tallies(progress).byWay;
    expect(helpWith(progress, 'kape', 'recall')).toBe(true);
    const helped = tallies(progress).byWay;
    expect(helped.get(drillKey('kape', 'recall'))!).toBeGreaterThan(plain.get(drillKey('kape', 'recall'))! * 5);
    // Read easily, it isn't read any more than before.
    expect(helped.get(drillKey('kape', 'read'))!).toBeLessThanOrEqual(plain.get(drillKey('kape', 'read'))!);
    // Each answer got right unaided takes one off; the schedule is left alone.
    const { help: _help, helpAt: _at, ...schedule } = progress.cards.kape;
    helpWith(progress, 'kape', 'recall');
    expect(drillHelp(progress.cards.kape, 'recall')).toBe(2);
    expect(drillHelp(progress.cards.kape, 'read')).toBe(0);
    helpWith(progress, 'kape', 'recall', false);
    expect(helpWith(progress, 'kape', 'recall', false)).toBe(true);
    const { help, helpAt, ...after } = progress.cards.kape;
    expect(after).toEqual(schedule);
    expect(help).toBeUndefined();
    // Kept, so a sync knows the count was cleared after the copy that still has it.
    expect(helpAt).toBe(LATER);
    expect(helpWith(progress, 'kape', 'recall', false)).toBe(false);
    expect(tallies(progress).byWay).toEqual(plain);
  });

  it('counts only a few answers needing help, so a few got right clear it', () => {
    const progress = settledProgress();
    for (let i = 0; i < 6; i++) helpWith(progress, 'kape', 'speak');
    expect(drillHelp(progress.cards.kape, 'speak')).toBe(3);
    expect(helpWith(progress, 'unmet')).toBe(false);
    expect(progress.cards.unmet).toBeUndefined();
    expect(setDrillHelp(progress, 'kape', 'speak', () => 3, LATER)).toBe(false);
  });

  it('gives a card the drills had to help with its own share of the round in a big deck', () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER.slice(0, 200), 30);
    const [word] = VOCAB_ORDER;
    const plain = counts(progress).get(word)! / 4000;
    helpWith(progress, word);
    const share = counts(progress).get(word)! / 4000;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeGreaterThan(plain * 10);
  });

  it('shares a card between the ways it can be asked, so a word asked four ways comes up no more than one asked one way', () => {
    const progress = settledProgress();
    const seen = new Map<string, number>();
    const oneWay = (card: Card): readonly Way[] => (card.id === 'kape' ? WAYS : ['read']);
    for (let i = 0; i < 4000; i++) {
      const { card } = pickDrillCard(progress, LATER, [], new Map(), 0, oneWay, () => (i + 0.5) / 4000)!;
      seen.set(card.id, (seen.get(card.id) ?? 0) + 1);
    }
    expect(seen.get('kape')! / seen.get('oo')!).toBeCloseTo(1, 1);
  });

  it("doesn't bring one new word round every few questions", () => {
    const progress = emptyProgress(NOW);
    learn(progress, VOCAB_ORDER.slice(0, 200), 30);
    const [fresh] = VOCAB_ORDER.slice(200);
    recordAnswer(progress, fresh, 'good', LATER - DAY_MS);
    progress.cards[fresh] = { ...progress.cards[fresh], introduced: LATER - DAY_MS };
    const share = counts(progress).get(fresh)! / 4000;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.15);
  });

  it('asks a card answered Again or Hard in Study more than one that went smoothly, until it has held a week', () => {
    const progress = settledProgress();
    for (const id of ['kape', 'oo']) progress.cards[id] = { ...progress.cards[id], interval: 3, reviewed: LATER };
    progress.cards.kape.ease = 2.1;
    const seen = counts(progress);
    expect(seen.get('kape')!).toBeGreaterThan(seen.get('oo')! * 1.5);
    // Held for months since: its hard start no longer counts.
    for (const id of ['kape', 'oo']) progress.cards[id] = { ...progress.cards[id], interval: 90 };
    expect(drillWeight(progress.cards.kape, LATER)).toBe(drillWeight(progress.cards.oo, LATER));
  });

  it('drills guides as well as words, as far as the round can ask them', () => {
    const progress = settledProgress([...KNOWN, 'p-gusto', 's-ng']);
    const seen = counts(progress);
    expect(seen.get('p-gusto')).toBeGreaterThan(0);
    expect(seen.get('s-ng')).toBeGreaterThan(0);
    for (let i = 0; i < 50; i++) {
      const card = pick(progress, LATER, [], new Map(), (c) => (isVocab(c) ? WAYS : []), () => i / 50)!;
      expect(isVocab(card)).toBe(true);
    }
  });
});

describe('typing', () => {
  const card = getCard('salamat')!;

  it('types Recall once Study has remembered it a day after it was met, counting the right answers still to go', () => {
    const progress = emptyProgress(NOW);
    expect(typing(progress, card, 'recall')).toEqual({ typed: false, left: 2, readFirst: 2 });
    recordAnswer(progress, 'salamat', 'good', NOW);
    expect(typing(progress, card, 'recall')).toEqual({ typed: false, left: 2, readFirst: 1 });
    const key = cardKey('salamat', 'recall');
    progress.cards[key] = newCardState(NOW);
    expect(typing(progress, card, 'recall')).toEqual({ typed: false, left: 2, due: NOW });
    recordAnswer(progress, key, 'good', NOW);
    expect(typing(progress, card, 'recall')).toEqual({ typed: false, left: 1, due: NOW + DAY_MS });
    recordAnswer(progress, key, 'good', NOW + DAY_MS);
    expect(typing(progress, card, 'recall')).toEqual({ typed: true });
    // Forgotten, it gives choices again until it's remembered once more.
    recordAnswer(progress, key, 'again', NOW + 5 * DAY_MS);
    expect(typing(progress, card, 'recall')).toMatchObject({ typed: false, left: 1 });
  });

  it('never types Read, Speak, or Listen for a meaning that is only a note', () => {
    const progress = emptyProgress(NOW);
    learn(progress, ['salamat'], 3, true);
    expect(typing(progress, card, 'listen')).toEqual({ typed: true });
    expect(typing(progress, card, 'read')).toEqual({ typed: false });
    expect(typing(progress, card, 'speak')).toEqual({ typed: false });
    learn(progress, ['mga'], 3, true);
    expect(typing(progress, getCard('mga')!, 'listen')).toEqual({ typed: false });
    expect(typing(progress, getCard('mga')!, 'recall')).toEqual({ typed: true });
  });
});

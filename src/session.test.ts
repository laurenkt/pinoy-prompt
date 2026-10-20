import { describe, expect, it } from 'vitest';
import { ALL_CARDS, LEARN_ORDER, UNITS } from './deck';
import {
  MAX_LEARNING,
  buildExtraSession,
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
  it('come most useful first across topics, with nothing locked', () => {
    const progress = emptyProgress(NOW);
    expect(upcomingNewCards(progress, Infinity)).toEqual(LEARN_ORDER);
    for (const id of LEARN_ORDER.slice(0, 3)) recordAnswer(progress, id, 'good', NOW);
    expect(upcomingNewCards(progress, 2)).toEqual(LEARN_ORDER.slice(3, 5));
  });

  it('skip cards met in an earlier order, however they were met', () => {
    const progress = emptyProgress(NOW);
    // Older builds introduced whole topics in turn.
    const met = UNITS[0].cards.map((c) => c.id);
    for (const id of met) recordAnswer(progress, id, 'good', NOW);
    const next = upcomingNewCards(progress, Infinity);
    expect(next).toEqual(LEARN_ORDER.filter((id) => !met.includes(id)));
    expect(next.length).toBe(ALL_CARDS.length - met.length);
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
});

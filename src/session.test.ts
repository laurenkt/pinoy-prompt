import { describe, expect, it } from 'vitest';
import { ALL_CARDS, UNITS } from './deck';
import { buildExtraSession, buildSession, distractors, dueCards, requeue, upcomingNewCards } from './session';
import { DAY_MS } from './srs';
import { emptyProgress, recordAnswer } from './store';

const NOW = Date.UTC(2026, 0, 1, 12);

describe('buildSession', () => {
  it('starts a new learner at the top of the deck, up to the daily limit', () => {
    const steps = buildSession(emptyProgress(NOW), NOW);
    expect(steps).toHaveLength(8);
    expect(steps.every((s) => s.kind === 'new')).toBe(true);
    expect(steps[0].cardId).toBe(UNITS[0].cards[0].id);
  });

  it('mixes one new card in after every three reviews', () => {
    const progress = emptyProgress(NOW);
    for (const card of UNITS[0].cards.slice(0, 6)) recordAnswer(progress, card.id, 'good', NOW);
    const later = NOW + 2 * DAY_MS;
    progress.today = { day: 'x', newCount: 0, reviewCount: 0 };
    const kinds = buildSession(progress, later).map((s) => s.kind);
    expect(kinds.slice(0, 4)).toEqual(['review', 'review', 'review', 'new']);
    expect(kinds.filter((k) => k === 'review')).toHaveLength(6);
  });

  it('respects the cards already introduced today', () => {
    const progress = emptyProgress(NOW);
    for (const card of UNITS[0].cards.slice(0, 8)) recordAnswer(progress, card.id, 'good', NOW);
    expect(buildSession(progress, NOW)).toEqual([]);
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
  it('come in deck order across topics, with nothing locked', () => {
    const progress = emptyProgress(NOW);
    expect(upcomingNewCards(progress, Infinity)).toEqual(ALL_CARDS.map((c) => c.id));
    // Someone who stopped part way through a topic carries straight on from there.
    for (const card of UNITS[0].cards.slice(0, 3)) recordAnswer(progress, card.id, 'good', NOW);
    expect(upcomingNewCards(progress, 2)).toEqual(UNITS[0].cards.slice(3, 5).map((c) => c.id));
  });

  it('can go beyond the daily rate when asked for', () => {
    const progress = emptyProgress(NOW);
    for (const card of ALL_CARDS.slice(0, 8)) recordAnswer(progress, card.id, 'good', NOW);
    expect(buildSession(progress, NOW)).toEqual([]);
    const steps = buildExtraSession(progress, 5);
    expect(steps.map((s) => s.cardId)).toEqual(ALL_CARDS.slice(8, 13).map((c) => c.id));
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

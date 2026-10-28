// Walk and talk's round, its spoken commands, and what the live voice is told.

import { describe, expect, it } from 'vitest';
import { getCard } from './deck';
import { drillNote } from './session';
import { emptyProgress, recordAnswer } from './store';
import { askText, heardCommand, verdictText, walkInstructions, walkRound, type WalkQuestion } from './walk';

const KNOWN = ['salamat', 'kumusta', 'oo', 'kape', 'paalam'];

function learner() {
  const now = Date.now();
  const progress = emptyProgress(now);
  for (const id of KNOWN) recordAnswer(progress, id, 'good', now);
  return { progress, now: () => now };
}

describe('heardCommand', () => {
  it.each([
    ['Skip', 'skip'],
    ['pass.', 'skip'],
    ['Okay, skip this one', 'skip'],
    ['next please', 'skip'],
    ["I don't know", 'dont-know'],
    ['Um, I dont know.', 'dont-know'],
    ['I dunno', 'dont-know'],
    ['No idea', 'dont-know'],
    ['Hindi ko alam', 'dont-know'],
    ['ewan ko', 'dont-know'],
  ])('hears "%s" as %s', (said, command) => {
    expect(heardCommand(said)).toBe(command);
  });

  it.each(['salamat', 'thank you', 'no', 'I know this one, it is salamat', "the next day, I don't know what you would say about it"])(
    'takes "%s" as an answer',
    (said) => {
      expect(heardCommand(said)).toBeNull();
    },
  );
});

describe('walkRound', () => {
  it('asks only the ways it is given, of words', () => {
    const { progress, now } = learner();
    const round = walkRound(progress, now, ['recall']);
    for (let i = 0; i < 20; i++) {
      const q = round.next()!;
      expect(q.way).toBe('recall');
      expect(KNOWN).toContain(q.card.id);
      round.note(q, 'right');
    }
  });

  it('notes a miss or "I don\'t know" as needing help, as Drills does, and leaves a skip as it was', () => {
    const { progress, now } = learner();
    const round = walkRound(progress, now, ['recall']);
    const ask = (id: string): WalkQuestion => ({ card: getCard(id)!, way: 'recall' });
    const before = structuredClone(progress.cards.kape);
    expect(round.note(ask('kape'), 'skip')).toBe(false);
    expect(progress.cards.kape).toEqual(before);
    expect(round.note(ask('kape'), 'dont-know')).toBe(true);
    expect(drillNote(progress.cards.kape, 'recall').help).toBe(1);
    round.note(ask('oo'), 'wrong');
    expect(drillNote(progress.cards.oo, 'recall').help).toBe(1);
    // The schedule is never touched.
    expect(progress.cards.kape.due).toBe(before.due);
    expect(round.done).toBe(3);
  });

  it('brings a missed word straight back', () => {
    const { progress, now } = learner();
    const round = walkRound(progress, now, ['recall']);
    const q = round.next()!;
    round.note(q, 'wrong');
    expect(round.next()!.card.id).toBe(q.card.id);
  });
});

describe('what the live voice is told', () => {
  const recall: WalkQuestion = { card: getCard('salamat')!, way: 'recall' };
  const listen: WalkQuestion = { card: getCard('kape')!, way: 'listen' };

  it('follows the GPT-Live prompting guide, and delegates once an answer is finished', () => {
    const text = walkInstructions();
    for (const heading of ['Backchannel policy:', 'Interruption policy:', 'Delegation policy:', 'Backend tools:', 'Generate <|SpawnThinking|> when:', 'Do not generate <|SpawnThinking|> when:']) {
      expect(text).toContain(heading);
    }
    expect(text).toMatch(/pause/);
  });

  it('asks recall in English and listen in Tagalog', () => {
    expect(askText(recall)).toContain('how to say "Thank you"');
    expect(askText(listen)).toContain('"kape"');
  });

  it('always gives the answer after a response, except a skip, then the next question', () => {
    for (const outcome of ['right', 'wrong', 'dont-know'] as const) expect(verdictText(recall, outcome, listen)).toContain('"Salamat"');
    expect(verdictText(recall, 'skip', listen)).not.toContain('"Salamat"');
    expect(verdictText(recall, 'right', listen)).toContain(askText(listen));
  });
});

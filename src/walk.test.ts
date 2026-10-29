// Walk and talk's round, its spoken commands, and what the live voice is told.

import { describe, expect, it } from 'vitest';
import { getCard } from './deck';
import { drillNote } from './session';
import { emptyProgress, recordAnswer } from './store';
import prompts from './prompt-clips.json';
import { checkText, heardCommand, questionBrief, roundUpdate, walkInstructions, walkLines, walkRound, type WalkQuestion } from './walk';

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
    const back = round.next()!;
    expect(back.card.id).toBe(q.card.id);
    expect(back.again).toBe(true);
  });

  it('with a question picked ahead (as the live voice is kept), never asks the same one twice in a row', () => {
    for (let run = 0; run < 30; run++) {
      const { progress, now } = learner();
      const round = walkRound(progress, now, ['recall', 'listen']);
      let current = round.next()!;
      let upcoming = round.next()!;
      for (let i = 0; i < 20; i++) {
        expect(`${upcoming.card.id} ${upcoming.way}`).not.toBe(`${current.card.id} ${current.way}`);
        round.note(current, i % 3 ? 'right' : 'wrong');
        const next = round.next()!;
        current = upcoming;
        upcoming = next;
      }
    }
  });
});

describe('what the live voice is told', () => {
  const recall: WalkQuestion = { card: getCard('salamat')!, way: 'recall' };
  const listen: WalkQuestion = { card: getCard('kape')!, way: 'listen' };

  it('follows the GPT-Live prompting guide, judging answers itself and asking the app only when unsure', () => {
    const text = walkInstructions();
    for (const heading of ['Backchannel policy:', 'Interruption policy:', 'Delegation policy:', 'Backend tools:', 'Generate <|SpawnThinking|> when:', 'Do not generate <|SpawnThinking|> when:']) {
      expect(text).toContain(heading);
    }
    expect(text).toMatch(/judge them yourself/);
    expect(text).toMatch(/let me check/);
    expect(text).toMatch(/Never repeat a word or phrase over and over/);
  });

  it('briefs a question with its answer and hook, asking recall in English and listen in Tagalog', () => {
    expect(questionBrief(recall, 0)).toContain('how to say "Thank you"');
    expect(questionBrief(recall, 0)).toContain('"Salamat"');
    expect(questionBrief(recall, 0)).toContain(getCard('salamat')!.hook);
    expect(questionBrief(listen, 0)).toContain('say the Tagalog "kape"');
    expect(questionBrief(recall, 0)).not.toContain('needed help');
    expect(questionBrief(recall, 2)).toContain('needed help with it 2 times');
    expect(questionBrief(recall, 0)).not.toContain('once more');
    expect(questionBrief({ ...recall, again: true }, 0)).toContain('once more');
  });

  it('keeps the voice a question ahead, with how the last answer went', () => {
    const update = roundUpdate('Q now', 'Q next', checkText(recall, 'salamat', 'right'));
    expect(update).toContain('"salamat": right');
    expect(update.indexOf('Q now')).toBeLessThan(update.indexOf('Q next'));
    expect(roundUpdate(null, null)).toContain('no more questions');
    expect(checkText(recall, 'salam', 'wrong', true)).toContain("couldn't check");
  });
});

describe("the recorded version's English lines", () => {
  const onDisk = new Set(Object.keys(import.meta.glob('../public/audio/en-*')).map((path) => path.split('/').pop()));
  const clips: Record<string, string> = prompts;

  it('has a recorded clip for every line it can say (npm run prompts makes any missing)', () => {
    const missing = walkLines().filter((line) => !clips[line] || !onDisk.has(`${clips[line]}.mp3`));
    expect(missing).toEqual([]);
  });
});

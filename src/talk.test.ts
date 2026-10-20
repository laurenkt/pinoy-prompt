import { describe, expect, it } from 'vitest';
import { UNITS } from './deck';
import { emptyProgress, recordAnswer } from './store';
import { addPiece, findWords, talkInstructions, talkPlan, talkTopics, TURN_GAP_MS, type Segment, type SpokenTurn } from './talk';

const NOW = new Date(2026, 5, 1, 12).getTime();

function progressWith(ids: string[]) {
  const progress = emptyProgress(NOW);
  for (const id of ids) recordAnswer(progress, id, 'good', NOW);
  return progress;
}

/** The words found in a text, as "text=card". */
function found(segments: Segment[]): string[] {
  return segments.filter((s) => 'card' in s).map((s) => `${s.text}=${'card' in s ? s.card.id : ''}`);
}

describe('talkPlan', () => {
  it('lists every word met, firmest first', () => {
    const progress = progressWith(['salamat', 'kumusta', 'oo']);
    progress.cards.kumusta.interval = 30;
    progress.cards.oo.interval = 4;
    progress.cards.salamat.interval = 0;
    const plan = talkPlan(progress, null);
    expect(plan.known.map((k) => [k.card.id, k.strength])).toEqual([
      ['kumusta', 'long'],
      ['oo', 'days'],
      ['salamat', 'new'],
    ]);
  });

  it('brings in the first unmet word of the topic, or of the deck', () => {
    const progress = progressWith(['kumusta']);
    expect(talkPlan(progress, null).newWord?.id).toBe(UNITS[0].cards[1].id);
    const food = UNITS.find((u) => u.id === 'food')!;
    expect(talkPlan(progress, 'food').newWord?.id).toBe(food.cards[0].id);
  });

  it('offers only topics with a word met', () => {
    expect(talkTopics(progressWith(['kumusta', 'kape'])).map((u) => u.id)).toEqual(['greetings', 'food']);
  });

  it('ignores progress for cards no longer in the deck', () => {
    const progress = progressWith(['salamat']);
    progress.cards['gone-card'] = { ...progress.cards.salamat };
    expect(talkPlan(progress, null).known.map((k) => k.card.id)).toEqual(['salamat']);
  });
});

describe('talkInstructions', () => {
  it('names the words by strength, the new word and the topic', () => {
    const progress = progressWith(['salamat', 'kumusta']);
    progress.cards.kumusta.interval = 10;
    progress.cards.salamat.interval = 0;
    const text = talkInstructions(talkPlan(progress, 'greetings'));
    expect(text).toContain('Greetings');
    expect(text).toMatch(/know well: Kumusta\? \(How are you\? \/ Hello\)/);
    expect(text).toMatch(/last day or so: Salamat \(Thank you\)/);
    expect(text).toContain('new word');
  });

  it('asks for the meaning of fresh and new words to be said aloud', () => {
    const progress = progressWith(['salamat']);
    progress.cards.salamat.interval = 0;
    const text = talkInstructions(talkPlan(progress, null));
    expect(text).toMatch(/last day or so: .*Say the English meaning/);
    expect(text).toMatch(/new word.*say the English meaning straight after it/);
  });
});

describe('findWords', () => {
  const plan = talkPlan(progressWith(['salamat', 'maraming-salamat', 'kumusta', 'mahal']), null);

  it('finds known words with their punctuation left outside', () => {
    const segments = findWords('Kumusta? I made kape. Salamat!', plan);
    expect(found(segments)).toEqual(['Kumusta=kumusta', 'Salamat=salamat']);
    expect(segments.map((s) => s.text).join('')).toBe('Kumusta? I made kape. Salamat!');
  });

  it('prefers the longest phrase', () => {
    expect(found(findWords('Oh, maraming   salamat, friend.', plan))).toEqual(['maraming   salamat=maraming-salamat']);
  });

  it('accepts other listed spellings', () => {
    expect(found(findWords('Kamusta ka?', plan))).toEqual(['Kamusta=kumusta']);
  });

  it('marks the new word as unseen', () => {
    const segments = findWords(`This is ${plan.newWord!.tl}`, plan);
    const word = segments.find((s) => 'card' in s);
    expect(word && 'strength' in word && word.strength).toBe('unseen');
  });

  it('leaves deck words that are everyday English alone', () => {
    const lookalikes = talkPlan(progressWith(['ate', 'lima', 'salamat']), null);
    expect(found(findWords('I ate in Lima, salamat.', lookalikes))).toEqual(['salamat=salamat']);
  });

  it('leaves words inside other words alone', () => {
    expect(found(findWords('Mahalaga and salamatan', plan))).toEqual([]);
  });

  it('keeps text with no words as one piece', () => {
    expect(findWords('Hello there.', plan)).toEqual([{ text: 'Hello there.' }]);
    expect(findWords('', plan)).toEqual([]);
  });

  it('copes with leading spaces and odd punctuation', () => {
    const text = '  — salamat… (mahal)';
    const segments = findWords(text, plan);
    expect(segments.map((s) => s.text).join('')).toBe(text);
    expect(found(segments)).toEqual(['salamat=salamat', 'mahal=mahal']);
  });
});

describe('addPiece', () => {
  const text = (turns: SpokenTurn[]) => turns.map((t) => `${t.who}: ${t.text}`);

  it('runs pieces of one turn together, even split mid-word', () => {
    const turns: SpokenTurn[] = [];
    addPiece(turns, 'ai', 'Kum', 0, 200);
    addPiece(turns, 'ai', 'usta! How', 200, 700);
    addPiece(turns, 'ai', ' are you?', 700, 1200);
    expect(text(turns)).toEqual(['ai: Kumusta! How are you?']);
  });

  it('starts a new turn after a pause, and spaces words across a short gap', () => {
    const turns: SpokenTurn[] = [];
    addPiece(turns, 'ai', 'Kumusta ka?', 0, 1000);
    addPiece(turns, 'ai', 'Ano', 1200, 1500);
    expect(text(turns)).toEqual(['ai: Kumusta ka? Ano']);
    expect(addPiece(turns, 'ai', 'Salamat.', 1500 + TURN_GAP_MS + 1, 4000)).toEqual({ index: 1, added: true });
    expect(text(turns)).toEqual(['ai: Kumusta ka? Ano', 'ai: Salamat.']);
  });

  it("keeps the AI's reply whole when the learner's words arrive late, and orders turns by time", () => {
    const turns: SpokenTurn[] = [];
    addPiece(turns, 'ai', 'Kumusta?', 0, 800);
    addPiece(turns, 'ai', ' Gutom ka ba?', 3000, 4000);
    addPiece(turns, 'ai', ' Kain tayo!', 4200, 5000);
    // The learner spoke from 1000 to 2500, but the transcript came in after.
    expect(addPiece(turns, 'you', 'Mabuti.', 1000, 2500)).toEqual({ index: 1, added: true });
    expect(text(turns)).toEqual(['ai: Kumusta?', 'you: Mabuti.', 'ai: Gutom ka ba? Kain tayo!']);
  });
});

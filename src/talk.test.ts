import { describe, expect, it } from 'vitest';
import { getCard, isVocab, LEARN_ORDER, UNITS } from './deck';
import { emptyProgress, recordAnswer } from './store';
import { addPiece, findWords, mixLevel, partOfDay, stuckExample, talkGreeting, talkInstructions, talkPlan, talkTopics, timeContext, TURN_GAP_MS, type Segment, type SpokenTurn } from './talk';

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

  it('brings in the most useful unmet word, from the topic if one is chosen', () => {
    const progress = progressWith(['kumusta']);
    const next = (ids: readonly string[]) => ids.find((id) => !progress.cards[id] && isVocab(getCard(id)!));
    expect(talkPlan(progress, null).newWord?.id).toBe(next(LEARN_ORDER));
    const food = UNITS.find((u) => u.id === 'food')!;
    const foodIds = new Set(food.cards.map((c) => c.id));
    expect(talkPlan(progress, 'food').newWord?.id).toBe(next(LEARN_ORDER.filter((id) => foodIds.has(id))));
  });

  it('leaves guides out of the words to use', () => {
    const progress = progressWith(['kumusta', 'p-po']);
    expect(talkPlan(progress, null).known.map((k) => k.card.id)).toEqual(['kumusta']);
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
    const text = talkInstructions(talkPlan(progress, 'greetings'), new Date(NOW));
    expect(text).toContain('Greetings');
    expect(text).toMatch(/know well, use it whenever it fits: Kumusta\? \(How are you\? \/ Hello\)/);
    expect(text).toMatch(/last day or so; say the English meaning straight after it the first time: Salamat \(Thank you\)/);
    expect(text).toContain('new word');
  });

  it('asks for the meaning of fresh and new words to be said aloud', () => {
    const progress = progressWith(['salamat']);
    progress.cards.salamat.interval = 0;
    const text = talkInstructions(talkPlan(progress, null), new Date(NOW));
    expect(text).toMatch(/last day or so; say the English meaning/);
    expect(text).toMatch(/new word.*say the English meaning straight after it/);
  });
});

describe('pronunciation and accent', () => {
  it('gives each word its stress guide and asks for a Filipino accent throughout', () => {
    const text = talkInstructions(talkPlan(progressWith(['salamat']), null), new Date(NOW));
    expect(text).toContain('Salamat (Thank you), said sah-LAH-maht');
    expect(text).toMatch(/Filipino accent the whole call/);
    expect(text).toMatch(/Never say the guides themselves aloud/);
  });
});

describe('the time of day', () => {
  it('names the part of the day by the hour', () => {
    expect([0, 4, 5, 11, 12, 13, 17, 18, 21, 22, 23].map(partOfDay)).toEqual([
      'late at night',
      'late at night',
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
      'night',
      'night',
    ]);
  });

  it("tells the AI the learner's own day and time, in their time zone", () => {
    // Just after midnight in London is still the afternoon in Los Angeles.
    const when = new Date(Date.UTC(2026, 9, 20, 23, 5));
    expect(timeContext(when, 'Europe/London')).toContain('late at night: Wednesday 21 October');
    expect(timeContext(when, 'Europe/London')).toContain('12:05 am');
    expect(timeContext(when, 'Europe/London')).toContain('Europe/London');
    expect(timeContext(when, 'America/Los_Angeles')).toContain('afternoon: Tuesday 20 October');
  });

  it('puts the time in the instructions', () => {
    const text = talkInstructions(talkPlan(progressWith(['salamat']), null), new Date(Date.UTC(2026, 9, 20, 23, 5)), 'Europe/London');
    expect(text).toMatch(/For the learner it is late at night/);
  });
});

describe('the mix of English and Tagalog', () => {
  it('asks for English with only the listed Tagalog swapped in', () => {
    const text = talkInstructions(talkPlan(progressWith(['salamat', 'kumusta', 'oo', 'kape']), null), new Date(NOW));
    expect(text).toContain('Language: speak English.');
    expect(text).toContain('never say a whole sentence in Tagalog');
    expect(text).toContain('Use no other Tagalog, except');
    expect(text).not.toMatch(/greet(ing)? them in Tagalog/);
  });

  it('helps when the learner is stuck, with Tagalog they know', () => {
    const progress = progressWith(['kumusta', 'kape']);
    progress.cards.kape.interval = 30;
    const text = talkInstructions(talkPlan(progress, null), new Date(NOW));
    expect(text).toContain('When they are stuck, help before moving on.');
    expect(text).toContain('"You could say: kape, coffee."');
    expect(text).toContain('do not point it out');
  });

  it('answers a direct "how do I say" with the Tagalog, even for a word they have not learned', () => {
    const text = talkInstructions(talkPlan(progressWith(['kumusta']), null), new Date(NOW));
    expect(text).toContain('When they ask how to say something');
    expect(text).toContain('only the Tagalog listed below (the one exception is when they ask how to say something)');
    expect(text).toContain('if it is on the list, give that; otherwise give the everyday Tagalog');
    expect(text).toContain('Never refuse, deflect, or say it is not in their words.');
    expect(text).toContain('this overrides the limits on how much Tagalog to use');
    expect(text).not.toMatch(/not (in|on) (their|your) (words|list) yet/);
  });

  it('gives a stuck example a voice can read: one meaning, no slashes or question marks, "I" kept', () => {
    expect(stuckExample(talkPlan(progressWith(['kumusta']), null))).toBe('Kumusta, how are you');
    expect(stuckExample(talkPlan(progressWith(['mabuti']), null))).toBe("Mabuti naman, I'm fine");
    expect(stuckExample(talkPlan(progressWith([]), null))).toBeNull();
    expect(talkInstructions(talkPlan(progressWith([]), null), new Date(NOW))).not.toContain('You could say');
  });

  it("asks for Tagalog only where it fits, not tacked on", () => {
    expect(talkInstructions(talkPlan(progressWith(['salamat']), null), new Date(NOW))).toContain('Never tack one onto the end');
  });

  it('treats the words as a limit, not a list to get through', () => {
    const progress = progressWith(['salamat', 'kumusta']);
    progress.cards.kumusta.interval = 10;
    const text = talkInstructions(talkPlan(progress, null), new Date(NOW));
    expect(text).toContain('not a list to get through');
    expect(text).toContain('many sentences will have no Tagalog at all');
    expect(text).toContain('Never steer the conversation, change the subject or ask a question just to make room for a word.');
    expect(text).toContain('when a sentence does need the meaning of a listed word, say it in Tagalog rather than English');
    expect(text).toMatch(/new word they could pick up.*if none comes, leave it out/);
    expect(text).not.toMatch(/use it freely|every sentence is an English sentence with|reply using their Tagalog/);
  });

  it('caps the Tagalog in a sentence, raising the cap as more words are known', () => {
    expect(mixLevel(19)).toMatch(/^at most one/);
    expect(mixLevel(20)).toMatch(/^at most two or three/);
    expect(mixLevel(59)).toMatch(/^at most two or three/);
    expect(mixLevel(60)).toMatch(/^at most three or four.*most of each sentence English/);
    expect([19, 20, 60].map(mixLevel).join(' ')).not.toMatch(/wherever it fits|up to/);
    expect(talkInstructions(talkPlan(progressWith(['salamat', 'kape']), null), new Date(NOW))).toContain(`Use ${mixLevel(2)}; that is a limit, not a target.`);
  });

  it("shows the style with one of the learner's own words, not other Tagalog", () => {
    const progress = progressWith(['kape', 'salamat']);
    progress.cards.kape.interval = 30;
    const text = talkInstructions(talkPlan(progress, null), new Date(NOW));
    expect(text).toMatch(/For example, with "Kape" \(Coffee\)/i);
    expect(text).not.toMatch(/umaga|gutom/i);
  });

  it('keeps the policies the GPT-Live guide asks for', () => {
    const text = talkInstructions(talkPlan(progressWith(['salamat']), null), new Date(NOW));
    for (const heading of ['Backchannel policy:', 'Interruption policy:', 'Delegation policy:', 'Backend tools:', 'Generate <|SpawnThinking|> when:', 'Do not generate <|SpawnThinking|> when:']) {
      expect(text).toContain(heading);
    }
  });

  it('opens the call in English, on the topic', () => {
    const progress = progressWith(['kape']);
    expect(talkGreeting(talkPlan(progress, null))).toMatch(/^Greet the learner now in English/);
    expect(talkGreeting(talkPlan(progress, 'food'))).toContain('about food & eating');
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
    const lookalikes = talkPlan(progressWith(['at', 'ate', 'lima', 'salamat']), null);
    expect(found(findWords('I ate at noon in Lima, salamat.', lookalikes))).toEqual(['salamat=salamat']);
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
    addPiece(turns, 'ai', 'Ano', 1400, 1500);
    addPiece(turns, 'ai', 'ng', 1550, 1700);
    expect(text(turns)).toEqual(['ai: Kumusta ka? Anong']);
    expect(addPiece(turns, 'ai', 'Salamat.', 1700 + TURN_GAP_MS + 1, 4000)).toEqual({ index: 1, added: true });
    expect(text(turns)).toEqual(['ai: Kumusta ka? Anong', 'ai: Salamat.']);
  });

  it('puts a quick answer after the reply it answers', () => {
    const turns: SpokenTurn[] = [];
    addPiece(turns, 'ai', 'Gusto mo ba ng kape?', 8000, 10_000);
    addPiece(turns, 'you', 'Oo.', 10_300, 10_800);
    addPiece(turns, 'ai', 'Sige!', 11_200, 11_600);
    expect(text(turns)).toEqual(['ai: Gusto mo ba ng kape?', 'you: Oo.', 'ai: Sige!']);
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

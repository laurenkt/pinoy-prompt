// Walk and talk: a drill round heard and answered out loud, with headphones in and
// the phone in a pocket, run by GPT-Live with the app as its backend
// (screens/walk-live.ts). It asks what Drills asks (pickDrillCard), only the ways
// that work without looking: recall (the English said, the Tagalog answered) and
// listen (the Tagalog said, its meaning answered). It notes answers as Drills
// does, so it never touches the schedule.

import { isVocab, type Card, type Way } from './deck';
import { answerLanguageOf, type AnswerLanguage } from './meaning';
import { DRILL_GAP, askAs, drillHelp, drillKey, noteDrillAnswer, noteDrillRepeat, pickDrillCard, type DrillRepeat } from './session';
import type { Progress } from './progress-schema';

/** The ways a round asks: the ones that work without looking at the screen. */
export const WALK_WAYS: readonly Way[] = ['recall', 'listen'];

export interface WalkQuestion {
  card: Card;
  way: Way;
  /** Missed earlier this round and coming back for it, so it's asked as "once more". */
  again?: boolean;
}

/**
 * How an answer went: right, wrong, "I don't know" (the answer is said, and it counts as needing help), or "skip"
 * (moved past, noted nowhere).
 */
export type WalkOutcome = 'right' | 'wrong' | 'dont-know' | 'skip';

/** What the learner answers in: the Tagalog for recall, the meaning for listen. */
export const walkLanguage = (q: WalkQuestion): AnswerLanguage => answerLanguageOf(q.way);

/** A card's first English meaning, as it's said: no slashes or alternatives for a voice to read out. */
export function spokenMeaning(card: Card): string {
  return card.en.split('/')[0].trim();
}

export interface WalkRound {
  /** The next question; null with nothing to ask. */
  next(): WalkQuestion | null;
  /** Note how a question went, as Drills notes it. Whether progress changed, to be saved. */
  note(q: WalkQuestion, outcome: WalkOutcome): boolean;
  /** Questions moved past so far. */
  readonly done: number;
  /** How many answers asked this way the drills have had to help with lately (drillHelp). */
  help(q: WalkQuestion): number;
}

/**
 * A round asking `ways`, picked and noted as a drill round's are. A question may be picked before the last is answered
 * (the live voice is kept one ahead): until it's noted, it isn't picked again, and the next pick counts it as asked.
 */
export function walkRound(progress: Progress, now: () => number, ways: readonly Way[]): WalkRound {
  let recent: string[] = [];
  const repeats = new Map<string, DrillRepeat>();
  let done = 0;
  /** Questions picked and not yet noted, by drillKey. */
  const waiting = new Set<string>();
  const askable = (c: Card) => (isVocab(c) ? ways.filter((w) => !waiting.has(drillKey(c.id, w))) : []);
  return {
    get done() {
      return done;
    },
    help: (q) => drillHelp(progress.cards[q.card.id], q.way),
    next() {
      const pick = pickDrillCard(progress, now(), recent, repeats, done + waiting.size, askable);
      if (!pick) return null;
      const card = askAs(progress, pick.card, pick.way);
      recent = [...recent.slice(-DRILL_GAP), card.id];
      const key = drillKey(card.id, pick.way);
      waiting.add(key);
      return { card, way: pick.way, again: repeats.get(key)?.rights === 0 };
    },
    note(q, outcome) {
      const key = drillKey(q.card.id, q.way);
      waiting.delete(key);
      done++;
      // Skipped, it's left exactly as it was.
      if (outcome === 'skip') return false;
      const right = outcome === 'right';
      noteDrillRepeat(repeats, key, right, done - 1);
      // Got right while it's still coming back after a miss, it takes nothing off, as in Drills.
      if (right && repeats.has(key)) return false;
      return noteDrillAnswer(progress, q.card.id, q.way, !right, now());
    },
  };
}

/** Words that skip a question, or ask for its answer, in what was said: only a short reply, so an answer isn't taken for one. */
const SKIP = /^(?:(?:ok(?:ay)?|um+|uh+|let'?s|just)\s+)*(?:skip|pass|next)(?:\s+(?:it|this|that|one|please|question))*$/;
const DONT_KNOW =
  /^(?:(?:um+|uh+|oh|hmm+|sorry|no)\s+)*(?:i\s+)?(?:don'?t|do not|dunno|really don'?t)(?:\s+know)?(?:\s+(?:it|that|this|sorry))*$|^no idea$|^not sure$|^(?:hindi|di) ko alam$|^ewan(?: ko)?$|^tell me$|^what is it$/;

/** Whether what was said (as text) asks to skip the question or to hear its answer. */
export function heardCommand(said: string): 'skip' | 'dont-know' | null {
  const plain = said
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain || plain.split(' ').length > 6) return null;
  if (SKIP.test(plain)) return 'skip';
  if (DONT_KNOW.test(plain)) return 'dont-know';
  return null;
}

/** What the live voice is told about a card: its Tagalog, its meaning, other right answers, how it's said and its memory hook. */
function facts(card: Card): string {
  const also = [...(card.accept ?? [])];
  return [
    `Tagalog "${card.tl}"${card.hint ? ` (said ${card.hint})` : ''}, meaning "${card.en}"`,
    also.length ? `also right: ${also.map((a) => `"${a}"`).join(', ')}` : '',
    card.note ? `note: ${card.note}` : '',
    `memory hook: ${card.hook}`,
  ]
    .filter(Boolean)
    .join('; ');
}

/** A question as the live voice is told it, to ask in its own words: what to ask, the answer, and how often it has needed help lately. */
export function questionBrief(q: WalkQuestion, help: number): string {
  const ask =
    q.way === 'recall'
      ? `ask how to say "${spokenMeaning(q.card)}" in Tagalog (don't give the Tagalog away)`
      : `say the Tagalog "${q.card.tl}" clearly and ask what it means (don't give the meaning away)`;
  const again = q.again ? ' They missed it a moment ago and this is it again: say so lightly as you ask it ("okay, that one once more").' : '';
  const missed = help > 0 ? ` They've needed help with it ${help === 1 ? 'once' : `${help} times`} lately, so on a miss give the memory hook.` : '';
  return `${ask}. ${facts(q.card)}.${again}${missed}`;
}

/** How an answer went, as the app's check tells the live voice. */
export function checkText(q: WalkQuestion, said: string, outcome: WalkOutcome, unchecked = false): string {
  const about = `Their answer to "${q.way === 'recall' ? spokenMeaning(q.card) : q.card.tl}" was "${said}"`;
  if (unchecked) return `${about}; the app couldn't check it.`;
  return `${about}: ${{ right: 'right', wrong: 'wrong', 'dont-know': "they don't know it", skip: 'they skipped it' }[outcome]}.`;
}

/** The live voice's background for the next stretch of the round: how the last answer went, the question now, and the one after. */
export function roundUpdate(now: string | null, next: string | null, checked?: string): string {
  return [
    checked ? `The app's check: ${checked} If you said otherwise, put it right in a few words.` : '',
    now ? `The question now: ${now}` : 'There are no more questions: wrap up in a sentence.',
    now && next ? `The question after it, once this one is done: ${next}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The live voice's instructions for a round, laid out as OpenAI's GPT-Live prompting guide recommends (see talk.ts). */
export function walkInstructions(): string {
  return [
    'You are a warm, easy-going Filipino friend from Manila quizzing an English-speaking beginner on Tagalog words while they are out walking with headphones in. They cannot see a screen.',
    '',
    'Accent: keep a natural Filipino accent the whole time. Say every Tagalog word as a native Manila speaker would: pure vowels, ng as one sound, a light tapped r, and the stress a guide shows in capitals. Never say the guides themselves.',
    '',
    'The questions: the app picks them. Its notes tell you the question now and the one after it, each with its answer, other right answers and a memory hook. Ask them in that order, one at a time, and no others. Put each in your own words, a little differently each time, in one short sentence, then wait.',
    'Be patient. They are walking, and may pause, say "um", or start again. Wait for them to finish; never hurry them or fill a pause.',
    '',
    'Answers: judge them yourself, straight away; you know the answer. What they say is transcribed, so Tagalog may come out spelled oddly or as English-looking words: judge what they meant to say, and be generous with sound-alikes. Then react like a friend would, briefly and never the same way twice:',
    '- Right: a quick, warm acknowledgement, and on to the next question.',
    '- Wrong: say kindly that it is not quite. If what they said is a real word, say what it actually means. Give the right answer clearly, and the memory hook if the notes say they keep missing it or it would help. Then move on.',
    '- "I don\'t know", "hindi ko alam" or "tell me": give the answer, with the hook if it helps, and move on.',
    '- "Skip", "pass" or "next": move on to the next question without the answer.',
    '- A question or aside from them ("what does that mean?", "can you explain that word?", "say it again"): answer it, briefly, then go back to the same question and ask it again. A question is not an answer: never move on to the next question because of one.',
    'Say a Tagalog word or phrase at most twice in a turn. Never repeat a word or phrase over and over.',
    'No scores, no streaks, no long praise, no lectures.',
    '',
    'Backchannel policy: None. Stay quiet while they think.',
    '',
    'Interruption policy: Stop speaking when the learner interrupts. Listen to what they say.',
    '',
    'Delegation policy:',
    'Backend tools:',
    '- The drill app: it checks an answer you are unsure of, against the card and with a second opinion, and tells you whether it is right.',
    '',
    'Generate <|SpawnThinking|> when:',
    '- You genuinely cannot tell whether their answer is right: it is close, or the transcript is unclear. First say a few words out loud, like "hmm, let me check that", then generate it, and wait for the app.',
    '',
    'Do not generate <|SpawnThinking|> when:',
    '- The answer is clearly right or clearly wrong, or they asked for the answer or to skip: react yourself, straight away.',
    '- You are asking a question.',
  ].join('\n');
}

/** What the live voice opens with: a short hello, then the first question. */
export function walkGreeting(first: string, next: string | null): string {
  return `${roundUpdate(first, next)}\nSay a short, friendly hello in English, then ask the question now.`;
}

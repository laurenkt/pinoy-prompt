// Walk and talk: a drill round heard and answered out loud, with headphones in and
// the phone in a pocket. It asks what Drills asks (pickDrillCard), only the ways
// that work without looking: recall (the English said, the Tagalog answered) and,
// with the live voice, listen (the Tagalog said, its meaning answered). It notes
// answers as Drills does, so it never touches the schedule.
//
// Two ways of running it share this round and the screen in screens/walk.ts:
// recorded clips with the answer judged on the phone (screens/walk-clips.ts), and
// GPT-Live asking the questions with the app as its backend (screens/walk-live.ts).

import { isVocab, type Card, type Way } from './deck';
import { answerLanguageOf, type AnswerLanguage } from './meaning';
import { DRILL_GAP, askAs, drillKey, noteDrillAnswer, noteDrillRepeat, pickDrillCard, type DrillRepeat } from './session';
import type { Progress } from './progress-schema';

/** How a walk and talk round is run: recorded clips judged on the phone, or GPT-Live. */
export type WalkEngine = 'clips' | 'live';

/** The ways each engine can ask. Clips judge Tagalog on the phone; only the live voice can hear an English meaning. */
export const WALK_WAYS: Record<WalkEngine, readonly Way[]> = { clips: ['recall'], live: ['recall', 'listen'] };

export interface WalkQuestion {
  card: Card;
  way: Way;
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
}

/** A round asking `ways`, picked and noted as a drill round's are. */
export function walkRound(progress: Progress, now: () => number, ways: readonly Way[]): WalkRound {
  let recent: string[] = [];
  const repeats = new Map<string, DrillRepeat>();
  let done = 0;
  const askable = (c: Card) => (isVocab(c) ? ways : []);
  return {
    get done() {
      return done;
    },
    next() {
      const pick = pickDrillCard(progress, now(), recent, repeats, done, askable);
      if (!pick) return null;
      const card = askAs(progress, pick.card, pick.way);
      recent = [...recent.slice(-DRILL_GAP), card.id];
      return { card, way: pick.way };
    },
    note(q, outcome) {
      done++;
      // Skipped, it's left exactly as it was.
      if (outcome === 'skip') return false;
      const key = drillKey(q.card.id, q.way);
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

/**
 * The same, as sounds for the phone's recogniser, which only writes down sounds: each spelled the Tagalog way, as the
 * recogniser hears English said by someone who speaks it.
 */
export const COMMAND_SOUNDS: Record<'skip' | 'dont-know', string[]> = {
  skip: ['iskip', 'skip', 'pas', 'nekst'],
  'dont-know': ['ay dont now', 'ay downt now', 'dont now', 'hindi ko alam', 'di ko alam', 'ewan'],
};

/** A card as the live voice is told about it: its Tagalog, its meaning, and the stress guide if it has one. */
function described(card: Card): string {
  return `"${card.tl}" (${spokenMeaning(card)})${card.hint ? `, said ${card.hint}` : ''}`;
}

/** What the live voice is told to ask, in its own words. */
export function askText(q: WalkQuestion): string {
  return q.way === 'recall'
    ? `Ask the learner how to say "${spokenMeaning(q.card)}" in Tagalog. Don't say the Tagalog. (The answer, which you must not say yet, is ${described(q.card)}.)`
    : `Say the Tagalog "${q.card.tl}"${q.card.hint ? ` (said ${q.card.hint})` : ''} slowly and clearly, and ask the learner what it means in English. Don't say the meaning.`;
}

/**
 * What the live voice is told after an answer: how it went, the answer, and the next question, all in one short turn.
 * `unchecked`: OpenAI couldn't be asked about it, so it's neither right nor wrong.
 */
export function verdictText(q: WalkQuestion, outcome: WalkOutcome, next: WalkQuestion | null, unchecked = false): string {
  const answer = `${described(q.card)}`;
  const said = unchecked ? `The app couldn't check that answer. Say so briefly, and say the answer slowly: ${answer}.` : {
    right: `They got it right: briefly say "Tama!" and say the answer, ${answer}.`,
    wrong: `They got it wrong. Kindly say it's not quite, and say the right answer slowly: ${answer}.`,
    'dont-know': `They don't know it. Say the answer slowly: ${answer}.`,
    skip: `They want to skip it. Just say "okay" and move on, without the answer.`,
  }[outcome];
  return `${said} Then, straight away: ${next ? askText(next) : 'say there are no more questions.'}`;
}

/** The live voice's instructions for a round, laid out as OpenAI's GPT-Live prompting guide recommends (see talk.ts). */
export function walkInstructions(): string {
  return [
    'You are a friendly Filipino tutor from Manila running a spoken Tagalog drill for an English-speaking beginner. They are out walking with headphones in, and cannot see a screen.',
    '',
    'Accent: keep a natural Filipino accent the whole time. Say every Tagalog word as a native Manila speaker would: pure vowels, ng as one sound, a light tapped r, and the stress a guide shows in capitals. Never say the guides themselves.',
    '',
    'How the drill goes: the app decides every question and judges every answer; you only speak. Ask exactly the question the app gives you, in one short sentence, then stop and wait.',
    'Be patient. They are walking, and may pause, say "um", or start again partway. Wait for them to finish; never hurry them or fill a pause.',
    'Never judge an answer yourself, never say whether it is right, and never say the answer before the app tells you to. When the app tells you how it went, say that, the answer it gives, and then the next question, in a few short sentences.',
    'Keep it brief: no small talk, no scores, no streaks, no praise beyond a short "Tama!".',
    '',
    'Backchannel policy: None. Stay quiet while they think.',
    '',
    'Interruption policy: Stop speaking when the learner interrupts. Listen to what they say.',
    '',
    'Delegation policy:',
    'Backend tools:',
    '- The drill app: it hears what the learner answered, judges it, and gives you how it went, the answer and the next question.',
    '',
    'Generate <|SpawnThinking|> when:',
    '- The learner has finished answering the question you asked.',
    '- The learner says "pass", "skip", "next", "I don\'t know", "hindi ko alam", or asks for the answer.',
    '',
    'Do not generate <|SpawnThinking|> when:',
    '- They are still speaking, or have paused partway through an answer.',
    '- You are asking a question or saying an answer the app gave you.',
  ].join('\n');
}

/** What the live voice opens with: a short hello, then the first question. */
export function walkGreeting(first: WalkQuestion): string {
  return `Say a short hello in English and that you'll ask some words. Then: ${askText(first)}`;
}

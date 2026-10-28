// Walk and talk with the live voice: GPT-Live asks the questions and says the
// answers, and the app is its backend (client delegation, see startCall). When
// the learner has answered, the voice asks the app, which judges what the
// learner said (from the call's transcript, with Drills' judgeMeaning), notes it,
// and hands back how it went, the answer and the next question to say.

import { judgeMeaning } from '../meaning';
import { errorText, getApiKey, startCall, type Call } from '../openai';
import { stop } from '../speech';
import { addPiece, type SpokenTurn } from '../talk';
import { askText, heardCommand, verdictText, walkGreeting, walkInstructions, walkLanguage, type WalkOutcome, type WalkQuestion, type WalkRound } from '../walk';
import type { WalkDeps, WalkRun, WalkView } from './walk';

/** Waited after the voice asks, so the end of what the learner said reaches the transcript. */
const TRANSCRIPT_SETTLE_MS = 600;
/** Quiet this long after the learner said something, and the voice hasn't asked, the app judges it anyway. */
const ANSWER_FALLBACK_MS = 7000;
/** How long an answer stays on the screen before the next question shows. */
const SHOW_ANSWER_MS = 4000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run a round on a call until it's stopped. Called from the tap that starts it, so the call's audio may start. */
export function startLiveWalk(round: WalkRound, view: WalkView, deps: WalkDeps): WalkRun {
  // A word still playing mustn't talk over the call.
  stop();
  const abort = new AbortController();
  let stopped = false;
  let call: Call | null = null;
  let current: WalkQuestion | null = round.next();
  /** The call's transcript, in turns. */
  const turns: SpokenTurn[] = [];
  /** When the voice last stopped speaking, in ms from the start of the call: what the learner said before it isn't an answer. */
  let answerFrom = 0;
  /** An answer is being judged, so another ask for the same one waits for it. */
  let judging = false;
  /** The voice asked while an answer was already being judged: the verdict goes to it. */
  let waiting: string | null = null;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  let showNext: ReturnType<typeof setTimeout> | undefined;

  const end = (problem?: string) => {
    if (!stopped) view.ended(problem);
  };

  /** What the learner has said since the voice last spoke, which is their answer. */
  const heard = () =>
    turns
      .filter((t) => t.who === 'you' && t.start >= answerFrom)
      .map((t) => t.text.trim())
      .join(' ')
      .trim();

  /** How the answer went: the card judged first (on the device, then OpenAI), so a card that is "Hindi ko alam" isn't taken for a command. */
  async function judged(said: string, q: WalkQuestion): Promise<{ outcome: WalkOutcome; unchecked: boolean }> {
    const language = walkLanguage(q);
    if ((await judgeMeaning(said, q.card, null, language, false)).right) return { outcome: 'right', unchecked: false };
    const command = heardCommand(said);
    if (command) return { outcome: command, unchecked: false };
    const { right, failure } = await judgeMeaning(said, q.card, deps.askMeaning, language, false);
    // OpenAI couldn't be asked: it may well have been right, so it isn't counted.
    return { outcome: right ? 'right' : 'wrong', unchecked: !right && failure !== undefined };
  }

  /** The voice asked the app how the answer went (`id`), or it has gone quiet without asking (null). */
  async function judgeAnswer(id: string | null): Promise<void> {
    clearTimeout(fallback);
    const q = current;
    // Not before the voice has said the verdict and the next question: nothing said meanwhile answers it.
    if (!call || !q || stopped || (answerFrom === Infinity && !judging)) {
      if (id) call?.append('commentary', 'Carry on with what the app gave you.', id);
      return;
    }
    // Nothing to say while the app works: the answer comes back in a moment.
    if (id) call.append('thinking', '', id);
    if (judging) {
      waiting = id ?? waiting;
      return;
    }
    judging = true;
    view.status('Checking…');
    try {
      await wait(TRANSCRIPT_SETTLE_MS);
      const said = heard();
      if (stopped || !call) return;
      if (!said) {
        call.append('commentary', `The app didn't hear an answer. Ask the same question again: ${askText(q)}`, id ?? waiting);
        return view.status('Listening. Answer out loud.');
      }
      const { outcome, unchecked } = await judged(said, q);
      if (stopped || !call || current !== q) return;
      view.answered(q, outcome, round.note(q, unchecked ? 'skip' : outcome), said);
      const next = round.next();
      current = next;
      // Anything said from here, before the voice has given the verdict, is about this question, not the next.
      answerFrom = Infinity;
      call.append('commentary', verdictText(q, outcome, next, unchecked), id ?? waiting);
      if (!next) return end('There was nothing more to ask.');
      clearTimeout(showNext);
      showNext = setTimeout(() => {
        if (stopped || current !== next) return;
        view.asked(next);
        view.status('Listening. Answer out loud.');
      }, SHOW_ANSWER_MS);
    } finally {
      judging = false;
      waiting = null;
    }
  }

  const key = getApiKey();
  if (!key || !current) {
    // After the screen has drawn the round, so it shows why it stopped.
    queueMicrotask(() => end(current ? 'Chat needs an OpenAI key.' : 'There was nothing to ask.'));
  } else {
    view.asked(current);
    view.status('Connecting…');
    void startCall(
      key,
      { instructions: walkInstructions(), greeting: walkGreeting(current), signal: abort.signal, delegate: true },
      {
        onStarted: () => !stopped && view.status('Listening. Answer out loud.'),
        onTranscript: (who, text, start, end) => {
          if (stopped) return;
          addPiece(turns, who, text, start, end);
          clearTimeout(fallback);
          if (who === 'ai') {
            // The voice is speaking: an answer starts once it stops.
            answerFrom = answerFrom === Infinity ? end : Math.max(answerFrom, end);
            return;
          }
          // Tolerant of pauses, but not stuck if the voice never asks.
          fallback = setTimeout(() => void judgeAnswer(null), ANSWER_FALLBACK_MS);
        },
        onUsage: () => {},
        onDelegation: (id) => void judgeAnswer(id),
        onEnded: (e) => end(e ? errorText(e) : 'The call ended.'),
      },
      deps.call,
    ).then(
      (c) => {
        if (stopped) c.hangUp();
        else call = c;
      },
      (e: unknown) => end(errorText(e)),
    );
  }

  return {
    stop() {
      stopped = true;
      clearTimeout(fallback);
      clearTimeout(showNext);
      abort.abort();
      call?.hangUp();
      call = null;
    },
  };
}

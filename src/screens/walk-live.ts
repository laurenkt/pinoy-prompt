// Walk and talk with the live voice: GPT-Live asks the questions, judges the
// answers and reacts to them itself, as a friend quizzing you would. The app
// picks the questions and keeps the voice a step ahead, telling it in the
// background (thinking appends) the question now and the one after, so it
// never waits on the app to move on. As the voice answers each reply, the app
// checks what the learner said (from the call's transcript, with Drills'
// judgeMeaning) to note it as Drills does, and tells the voice how it went. Only
// when the voice can't tell does it say it's checking and ask the app (client
// delegation, see startCall), which says the verdict aloud.

import { judgeMeaning } from '../meaning';
import { errorText, getApiKey, startCall, type Call } from '../openai';
import { stop } from '../speech';
import { addPiece, type SpokenTurn } from '../talk';
import { checkText, heardCommand, questionBrief, roundUpdate, walkGreeting, walkInstructions, walkLanguage, type WalkOutcome, type WalkQuestion, type WalkRound } from '../walk';
import type { WalkDeps, WalkRun, WalkView } from './walk';

/** Waited once the voice starts its reply, so the end of what the learner said reaches the transcript. */
const TRANSCRIPT_SETTLE_MS = 600;
/** A check this recent is the one the voice means when it asks the app. */
const RECENT_CHECK_MS = 15_000;
/** How long an answer stays on the screen before the next question shows. */
const SHOW_ANSWER_MS = 3000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Something said that asks rather than answers ("what does it mean?", "say it again"): the question stays. */
const ASKS = /\?\s*$|^(?:um+\s+|uh+\s+|sorry\s+)?(?:what|how|can you|could you|say (?:it|that) again|again|repeat|wait|hold on)\b/i;

/** An answer checked by the app: how it went, and whether it could be told at all. */
interface Check {
  q: WalkQuestion;
  said: string;
  outcome: WalkOutcome;
  /** OpenAI couldn't be asked, so it's noted nowhere. */
  unchecked: boolean;
}

/** Run a round on a call until it's stopped. Called from the tap that starts it, so the call's audio may start. */
export function startLiveWalk(round: WalkRound, view: WalkView, deps: WalkDeps): WalkRun {
  // A word still playing mustn't talk over the call.
  stop();
  const abort = new AbortController();
  let stopped = false;
  let call: Call | null = null;
  /** The question being asked, and the one after it, which the voice already knows about. */
  let current: WalkQuestion | null = round.next();
  let upcoming: WalkQuestion | null = current && round.next();
  /** The call's transcript, in turns. */
  const turns: SpokenTurn[] = [];
  /** When the voice last stopped speaking, in ms from the start of the call: what the learner says after it is their reply. */
  let answerFrom = 0;
  /** The answer to the current question being checked, once the voice has started its reply to it. */
  let checking: Promise<Check | null> | null = null;
  /** The last answer checked, and when, for the voice to ask about just after. */
  let lastCheck: { result: Check; at: number } | null = null;
  let showNext: ReturnType<typeof setTimeout> | undefined;

  const end = (problem?: string) => {
    if (!stopped) view.ended(problem);
  };
  const brief = (q: WalkQuestion | null) => (q ? questionBrief(q, round.help(q)) : null);

  /** What the learner said between two moments of the call. */
  const said = (from: number, to: number) =>
    turns
      .filter((t) => t.who === 'you' && t.start >= from && t.start < to)
      .map((t) => t.text.trim())
      .join(' ')
      .trim();

  /** How the answer went: the card judged first (on the device, then OpenAI), so a card that is "Hindi ko alam" isn't taken for a command. */
  async function judged(answer: string, q: WalkQuestion): Promise<Check> {
    const language = walkLanguage(q);
    if ((await judgeMeaning(answer, q.card, null, language, false)).right) return { q, said: answer, outcome: 'right', unchecked: false };
    const command = heardCommand(answer);
    if (command) return { q, said: answer, outcome: command, unchecked: false };
    const { right, failure } = await judgeMeaning(answer, q.card, deps.askMeaning, language, false);
    // OpenAI couldn't be asked: it may well have been right, so it isn't counted.
    return { q, said: answer, outcome: right ? 'right' : 'wrong', unchecked: !right && failure !== undefined };
  }

  /**
   * The voice has started replying (at `replyAt`) to what the learner said since `from`: check it, note it, and move
   * the round on a question, telling the voice how it went and what's now next. Null when nothing was an answer.
   */
  async function check(from: number, replyAt: number): Promise<Check | null> {
    const q = current;
    await wait(TRANSCRIPT_SETTLE_MS);
    const answer = said(from, replyAt);
    if (stopped || !q || !answer || ASKS.test(answer)) return null;
    view.status('Checking…');
    const result = await judged(answer, q);
    if (stopped || current !== q) return null;
    view.answered(q, result.outcome, round.note(q, result.unchecked ? 'skip' : result.outcome), answer);
    current = upcoming;
    upcoming = current && round.next();
    call?.append('thinking', roundUpdate(brief(current), brief(upcoming), checkText(q, answer, result.outcome, result.unchecked)), null);
    clearTimeout(showNext);
    const next = current;
    if (!next) end('There was nothing more to ask.');
    else
      showNext = setTimeout(() => {
        if (stopped || current !== next) return;
        view.asked(next);
        view.status('Listening. Answer out loud.');
      }, SHOW_ANSWER_MS);
    return result;
  }

  /** The voice couldn't tell and said it's checking: say the app's verdict aloud under its delegation. */
  async function delegated(id: string): Promise<void> {
    // It has said it's checking already; nothing more until the verdict.
    call?.append('thinking', '', id);
    const recent = lastCheck && Date.now() - lastCheck.at < RECENT_CHECK_MS ? lastCheck.result : null;
    const result = (await checking) ?? recent ?? (await check(answerFrom, Infinity));
    if (stopped || !call) return;
    call.append(
      'commentary',
      result
        ? `The app checked: ${checkText(result.q, result.said, result.outcome, result.unchecked)} Say so in a few words, with the answer if they missed it, then carry on.`
        : "The app didn't hear an answer to check. Carry on with the question.",
      id,
    );
  }

  /** A reply the voice started while an earlier one was still being checked, to check once that's done. */
  let waiting: { from: number; at: number } | null = null;

  /** Check what the learner said between `from` and the voice's reply at `at`, keeping it for the voice to ask about. */
  function startCheck(from: number, at: number): void {
    const pending = (checking = check(from, at));
    void pending.then((result) => {
      if (checking === pending) checking = null;
      if (result) lastCheck = { result, at: Date.now() };
      const next = waiting;
      waiting = null;
      if (next && !checking) startCheck(next.from, next.at);
    });
  }

  /** A piece of what the voice said: the start of a new turn is its reply to whatever the learner said since it last spoke. */
  function voiceSpoke(start: number, endMs: number, newTurn: boolean): void {
    if (newTurn && current && start >= answerFrom) {
      // Checked a moment later whatever has arrived by then: the learner's last words can reach the transcript after the voice's first.
      if (checking) waiting = { from: answerFrom, at: start };
      else startCheck(answerFrom, start);
    }
    answerFrom = Math.max(answerFrom, endMs);
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
      { instructions: walkInstructions(), greeting: walkGreeting(brief(current)!, brief(upcoming)), signal: abort.signal, delegate: true },
      {
        onStarted: () => !stopped && view.status('Listening. Answer out loud.'),
        onTranscript: (who, text, start, endMs) => {
          if (stopped) return;
          const { added } = addPiece(turns, who, text, start, endMs);
          if (who === 'ai') voiceSpoke(start, endMs, added);
        },
        onUsage: () => {},
        onDelegation: (id) => void delegated(id),
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
      clearTimeout(showNext);
      abort.abort();
      call?.hangUp();
      call = null;
    },
  };
}

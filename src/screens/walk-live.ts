// Walk and talk with the live voice: GPT-Live asks the questions and says the
// answers, and the app is its backend (client delegation, see startCall). When
// the learner has answered, the voice asks the app, which judges what the
// learner said (from the call's transcript, with Drills' judgeMeaning), notes it,
// and hands back how it went, the answer and the next question to say.

import { judgeMeaning } from '../meaning';
import { errorText, getApiKey, startCall, type Call } from '../openai';
import { stop } from '../speech';
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
  /** What the learner has said since the question was asked, from the transcript. */
  let heard = '';
  /** An answer is being judged, so another ask for the same one waits for it. */
  let judging = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  let showNext: ReturnType<typeof setTimeout> | undefined;

  const end = (problem?: string) => {
    if (!stopped) view.ended(problem);
  };

  /** The voice asked the app how the answer went (`id`), or it has gone quiet without asking (null). */
  async function judgeAnswer(id: string | null): Promise<void> {
    clearTimeout(fallback);
    const q = current;
    if (!call || !q || judging || stopped) return;
    // Nothing to say while the app works: the answer comes back in a moment.
    if (id) call.append('thinking', '', id);
    judging = true;
    view.status('Checking…');
    try {
      await wait(TRANSCRIPT_SETTLE_MS);
      const said = heard.trim();
      if (stopped) return;
      if (!said) {
        call.append('commentary', `The app didn't hear an answer. Ask the same question again: ${askText(q)}`, id);
        return view.status('Listening. Answer out loud.');
      }
      const outcome: WalkOutcome =
        heardCommand(said) ?? ((await judgeMeaning(said, q.card, deps.askMeaning, walkLanguage(q), false)).right ? 'right' : 'wrong');
      if (stopped || current !== q) return;
      round.note(q, outcome);
      view.answered(q, outcome, said);
      const next = round.next();
      current = next;
      heard = '';
      call.append('commentary', verdictText(q, outcome, next), id);
      if (!next) return end('There was nothing more to ask.');
      clearTimeout(showNext);
      showNext = setTimeout(() => {
        if (stopped || current !== next) return;
        view.asked(next);
        view.status('Listening. Answer out loud.');
      }, SHOW_ANSWER_MS);
    } finally {
      judging = false;
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
        onTranscript: (who, text) => {
          if (who !== 'you' || stopped) return;
          heard += text;
          // Tolerant of pauses, but not stuck if the voice never asks.
          clearTimeout(fallback);
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

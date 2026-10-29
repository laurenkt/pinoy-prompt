// Walk and talk with the live voice: GPT-Live asks the questions, judges the
// answers and reacts to them itself, as a friend quizzing you would. The app
// picks the questions and keeps the voice a step ahead, telling it in the
// background (thinking appends) the question now and the one after, so it
// never waits on the app to move on. As the voice answers each reply, the app
// checks what the learner said (from the call's transcript, with Drills'
// judgeMeaning) to note it as Drills does, and tells the voice how it went. Only
// when the voice can't tell does it say it's checking and ask the app (client
// delegation, see startCall), which says the verdict aloud. A right answer gets
// Drills' chime, as soon as the app's check finds it. While the call connects a
// soft note sounds every so often, and a rising one once it's ready, for someone
// not looking at the screen.

import { judgeMeaning } from '../meaning';
import { errorText, getApiKey, startCall, type Call } from '../openai';
import { chime, readySound, stop, waitingSound } from '../speech';
import { addPiece, type SpokenTurn } from '../talk';
import { checkText, heardCommand, questionBrief, spokenMeaning, roundUpdate, walkGreeting, walkInstructions, walkLanguage, type WalkOutcome, type WalkQuestion, type WalkRound } from '../walk';
import type { WalkDeps, WalkRun, WalkView } from './walk';

/** Waited once the voice starts its reply, so the end of what the learner said reaches the transcript. */
const TRANSCRIPT_SETTLE_MS = 600;
/** A check this recent, with nothing said since, is the one the voice means when it asks the app. */
const RECENT_CHECK_MS = 15_000;
/** Time for the voice to say its last reaction and goodbye before the call ends. */
const WRAP_UP_MS = 8000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * An aside to the voice rather than an answer ("what does that mean?", "can you explain it?", "say it again"), or
 * only a filler: the question stays, and the voice answers it and goes back to the question. Kept to what is clearly
 * meant for the voice, as an answer taken for one leaves the app a question behind the voice. Only tried once the
 * answer hasn't passed as the card and isn't a command, and never for a card whose meaning reads like one ("What
 * does this mean?").
 */
const ASIDE =
  /^(?:(?:um+|uh+|sorry|actually|okay|ok|hmm+)[,\s]+)*(?:what does (?:that|this|it)(?: word| one)? mean|what(?: does|'s| is) .{1,30} mean|(?:can|could|would) you (?:please )?(?:explain|repeat|say (?:it|that) again|go over)|say (?:it|that) again|tell me (?:about|more)|explain (?:it|that|this)|one more time|hold on)\b|^(?:ok(?:ay)?|yeah|uh huh|mm+|hmm+|um+|uh+|what)[\s.!?]*$/i;

/** Hedges round an answer ("is it salamat?", "oh, salamat"), taken off before it's judged. */
const HEDGE = /^(?:(?:um+|uh+|oh|so|wait|hmm+|okay|ok|is it|it's|it is|i think(?: it's)?|maybe)[,\s]+)+|[?.!\s]+$/gi;

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
  /** Where what the learner has said is taken up to, in ms from the start of the call: what ends after it is still to check. */
  let takenTo = 0;
  /** When the voice last started saying something. */
  let voiceAt = -1;
  /** The check running, if one is. */
  let checking: Promise<Check | null> | null = null;
  /** The last answer checked, and when, for the voice to ask about just after. */
  let lastCheck: { result: Check; at: number } | null = null;
  /** Stops the sound that says the call is still connecting. */
  let stopWaiting = () => {};
  let wrapUp: ReturnType<typeof setTimeout> | undefined;

  const end = (problem?: string) => {
    stopWaiting();
    if (!stopped) view.ended(problem);
  };
  const brief = (q: WalkQuestion | null) => (q ? questionBrief(q, round.help(q)) : null);

  /** What the learner has said that's still to check, before a moment of the call. */
  const untaken = (before: number) => turns.filter((t) => t.who === 'you' && t.end > takenTo && t.start < before);

  /** How the answer went: the card judged first (on the device, then OpenAI), so a card that is "Hindi ko alam" isn't taken for a command. Null for an aside to the voice. */
  async function judged(answer: string, q: WalkQuestion): Promise<Check | null> {
    const language = walkLanguage(q);
    const plain = answer.replace(HEDGE, '') || answer;
    if ((await judgeMeaning(plain, q.card, null, language, false)).right) return { q, said: answer, outcome: 'right', unchecked: false };
    const command = heardCommand(answer);
    if (command) return { q, said: answer, outcome: command, unchecked: false };
    if (ASIDE.test(answer) && !ASIDE.test(spokenMeaning(q.card))) return null;
    const { right, failure } = await judgeMeaning(plain, q.card, deps.askMeaning, language, false);
    // OpenAI couldn't be asked: it may well have been right, so it isn't counted.
    return { q, said: answer, outcome: right ? 'right' : 'wrong', unchecked: !right && failure !== undefined };
  }

  /**
   * The voice has replied to what the learner said before `before`: check it, note it, and move the round on a
   * question, telling the voice how it went and what's now next. Null when it wasn't an answer.
   */
  async function check(before: number): Promise<Check | null> {
    const q = current;
    await wait(TRANSCRIPT_SETTLE_MS);
    const heard = untaken(before);
    if (stopped || !q || !heard.length) return null;
    takenTo = Math.max(takenTo, ...heard.map((t) => t.end));
    const answer = heard.map((t) => t.text.trim()).join(' ').trim();
    if (!answer) return null;
    view.status('Checking…');
    const result = await judged(answer, q);
    if (stopped || current !== q) return null;
    if (!result) {
      view.status('Listening. Answer out loud.');
      return null;
    }
    // Drills' chime for a right answer, played by the app as it knows: asking the voice to would hold it up.
    if (result.outcome === 'right') void chime();
    // One OpenAI couldn't check is noted, and counted, as moved past.
    const outcome = result.unchecked ? 'skip' : result.outcome;
    view.answered(q, outcome, round.note(q, outcome));
    current = upcoming;
    upcoming = current && round.next();
    call?.append('thinking', roundUpdate(brief(current), brief(upcoming), checkText(q, answer, result.outcome, result.unchecked)), null);
    if (current) view.status('Listening. Answer out loud.');
    else wrapUp = setTimeout(() => end('There was nothing more to ask.'), WRAP_UP_MS);
    return result;
  }

  /** Check what the learner said before `before`, one check at a time, then anything said while it ran. */
  function startCheck(before: number): Promise<Check | null> {
    const pending = (checking = check(before));
    void pending.then((result) => {
      if (checking === pending) checking = null;
      if (result) lastCheck = { result, at: Date.now() };
      settle();
    });
    return pending;
  }

  /** Once the voice has spoken after something the learner said, that's its reply: check what they said. */
  function settle(): void {
    if (!checking && current && untaken(voiceAt).length) void startCheck(voiceAt);
  }

  /** The voice couldn't tell and said it's checking: say the app's verdict aloud under its delegation. */
  async function delegated(id: string): Promise<void> {
    // It has said it's checking already; nothing more until the verdict.
    call?.append('thinking', '', id);
    while (checking) await checking;
    // Asked before its own words reached the transcript, what the learner said is checked now.
    // With nothing said since, it means the answer just checked.
    const recent = lastCheck && Date.now() - lastCheck.at < RECENT_CHECK_MS ? lastCheck.result : null;
    const result = untaken(Infinity).length ? await startCheck(Infinity) : recent;
    if (stopped || !call) return;
    call.append(
      'commentary',
      result
        ? `The app checked: ${checkText(result.q, result.said, result.outcome, result.unchecked)} Say so in a few words, with the answer if they missed it, then carry on.`
        : "The app didn't hear an answer to check. Carry on with the question.",
      id,
    );
  }

  const key = getApiKey();
  if (!key || !current) {
    // After the screen has drawn the round, so it shows why it stopped.
    queueMicrotask(() => end(current ? 'Chat needs an OpenAI key.' : 'There was nothing to ask.'));
  } else {
    view.status('Connecting…');
    // Started inside the tap, so the audio may start.
    stopWaiting = waitingSound();
    void startCall(
      key,
      { instructions: walkInstructions(), greeting: walkGreeting(brief(current)!, brief(upcoming)), signal: abort.signal, delegate: true },
      {
        onStarted: () => {
          stopWaiting();
          if (stopped) return;
          void readySound();
          view.status('Listening. Answer out loud.');
        },
        onTranscript: (who, text, start, endMs) => {
          if (stopped) return;
          addPiece(turns, who, text, start, endMs);
          if (who === 'ai') voiceAt = Math.max(voiceAt, start);
          settle();
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
      stopWaiting();
      clearTimeout(wrapUp);
      abort.abort();
      call?.hangUp();
      call = null;
    },
  };
}

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
// soft note sounds every so often, for someone not looking at the screen; the
// voice's greeting says it's ready. These play through the shared context, closed
// as the round starts and made afresh once the microphone is open, so the phone's
// switch into a call and the context's making are both over before the voice
// starts, and held running for the whole call (holdAudio) so it doesn't stop and
// start beside the voice.

import { closeAudio, holdAudio } from '../audio-engine';
import { judgeMeaning } from '../meaning';
import { errorText, getApiKey, startCall, type Call, type CallQuality } from '../openai';
import { chime, stop, waitingSound } from '../speech';
import { addPiece, type SpokenTurn } from '../talk';
import { checkText, heardCommand, questionBrief, spokenMeaning, roundUpdate, walkGreeting, walkInstructions, walkLanguage, type WalkOutcome, type WalkQuestion, type WalkRound } from '../walk';
import type { WalkDeps, WalkRun, WalkView } from './walk';

/** Waited once the voice starts its reply, so the end of what the learner said reaches the transcript. */
const TRANSCRIPT_SETTLE_MS = 600;
/** How long the voice's reply is listened to before asking OpenAI whether it took what was said as an answer. */
const REPLY_MS = 2500;
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
  /** What the voice said, piece by piece as it came, for its words between two moments (turns run pieces together). */
  const voicePieces: { text: string; start: number; end: number }[] = [];
  /** Cuts short the wait for the voice's reply, once the voice asks the app: it took what was said as an answer. */
  let hurry: (() => void) | null = null;
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
  /** How the voice has come through so far. */
  let quality: CallQuality | null = null;
  /** The call is connected, so the waiting sound mustn't start. */
  let connected = false;

  const end = (problem?: string) => {
    stopWaiting();
    // Once stopped, the hold was let go already, and may now be the next round's.
    if (stopped) return;
    holdAudio(false);
    view.ended(problem);
  };
  const brief = (q: WalkQuestion | null) => (q ? questionBrief(q, round.help(q)) : null);

  /** What the learner has said that's still to check, before a moment of the call. */
  const untaken = (before: number) => turns.filter((t) => t.who === 'you' && t.end > takenTo && t.start < before);

  /** What the voice said from one moment of the call to another. */
  const voiceSaid = (from: number, to: number) =>
    voicePieces
      .filter((p) => p.end > from && p.start < to)
      .map((p) => p.text)
      .join('')
      .trim();

  /** Text as plain words, padded with spaces so a word is found only whole. */
  const plainWords = (text: string) => ` ${text.toLowerCase().normalize('NFD').replace(/[^a-z]+/g, ' ').trim()} `;

  /** A question's words as the voice would say them: the English for recall (without what's in brackets), the Tagalog for listen. */
  const termOf = (q: WalkQuestion) => plainWords(q.way === 'recall' ? spokenMeaning(q.card).replace(/\([^)]*\)/g, ' ') : q.card.tl);

  /** The voice's last question in what it said: from just after the question before it, up to its last question mark. */
  function lastQuestion(said: string): string {
    const end = said.lastIndexOf('?');
    return end < 0 ? '' : said.slice(said.lastIndexOf('?', end - 1) + 1, end + 1);
  }

  /**
   * Whether the voice's last question was the question after the current one, rather than the current one: it names the
   * next one's words and not the current one's. Short words ("oo", "no", "you") are too easily said in passing to go by,
   * and nor are words that are part of the current one's ("night" in "good night"); then the round stays where it is.
   */
  function movedOn(said: string): boolean {
    if (!current || !upcoming) return false;
    const asked = plainWords(lastQuestion(said));
    const now = termOf(current);
    const next = termOf(upcoming);
    return next.trim().length >= 4 && asked.includes(next) && !now.includes(next) && !(now.trim() && asked.includes(now));
  }

  /** Waits for the voice's reply, unless the voice asks the app first. Whether it asked. */
  function replyHeard(): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => ((hurry = null), resolve(false)), REPLY_MS);
      hurry = () => {
        clearTimeout(timer);
        hurry = null;
        resolve(true);
      };
    });
  }

  /**
   * How the answer went: the card judged first, on the device, so a card that is "Hindi ko alam" isn't taken for a
   * command; then, with the voice's reply, OpenAI says how the voice took it (checkTurn): not as an answer, so the
   * round moves on only when the voice does, or with its verdict, which counts as the voice heard what was said. Only
   * an answer the voice gave no verdict on is judged as Drills judges one (judgeMeaning). Null for an aside to the
   * voice. Asked by the voice (replyAt Infinity), it's an answer the voice can't judge.
   */
  async function judged(answer: string, q: WalkQuestion, heard: SpokenTurn[], replyAt: number): Promise<Check | null> {
    const language = walkLanguage(q);
    const plain = answer.replace(HEDGE, '') || answer;
    if ((await judgeMeaning(plain, q.card, null, language, false)).right) return { q, said: answer, outcome: 'right', unchecked: false };
    const command = heardCommand(answer);
    if (command) return { q, said: answer, outcome: command, unchecked: false };
    if (replyAt !== Infinity && deps.askTurn) {
      const asked = await replyHeard();
      if (stopped) return null;
      if (!asked) {
        const from = heard[0].start;
        const to = Math.max(...heard.map((t) => t.end));
        // The voice's words since the learner last spoke, and its reply up to when they next spoke.
        const before = turns.filter((t) => t.who === 'you' && t.end <= from).at(-1)?.end ?? 0;
        const after = turns.find((t) => t.who === 'you' && t.start > to)?.start ?? Infinity;
        try {
          const turn = await deps.askTurn({ tl: q.card.tl, en: q.card.en, language, asked: voiceSaid(before, from), said: answer, reply: voiceSaid(to, after) });
          if (turn && !turn.answered) return null;
          // The voice heard them, where the transcript of Tagalog said by a beginner is often far off: its verdict, the
          // one the learner heard, is the one noted.
          if (turn && turn.tutor !== 'none') return { q, said: answer, outcome: turn.tutor === 'skipped' ? 'skip' : turn.tutor, unchecked: false };
        } catch {
          // Couldn't be asked, so it won't be asked again for the verdict: what's plainly an aside is taken as one, and
          // the rest isn't counted.
          return ASIDE.test(answer) && !ASIDE.test(spokenMeaning(q.card)) ? null : { q, said: answer, outcome: 'wrong', unchecked: true };
        }
      }
    } else if (replyAt !== Infinity && ASIDE.test(answer) && !ASIDE.test(spokenMeaning(q.card))) return null;
    const { right, failure } = await judgeMeaning(plain, q.card, deps.askMeaning, language, false);
    // OpenAI couldn't be asked: it may well have been right, so it isn't counted.
    return { q, said: answer, outcome: right ? 'right' : 'wrong', unchecked: !right && failure !== undefined };
  }

  /**
   * The voice has replied to what the learner said before `before`: check it, note it, and move the round on a
   * question, telling the voice how it went and what's now next. Null when it wasn't an answer.
   */
  async function check(before: number): Promise<Check | null> {
    await wait(TRANSCRIPT_SETTLE_MS);
    const heard = untaken(before);
    if (stopped || !current || !heard.length) return null;
    takenTo = Math.max(takenTo, ...heard.map((t) => t.end));
    const answer = heard.map((t) => t.text.trim()).join(' ').trim();
    if (!answer) return null;
    const since = turns.filter((t) => t.who === 'you' && t.end <= heard[0].start).at(-1)?.end ?? 0;
    let resynced = false;
    if (movedOn(voiceSaid(since, heard[0].start))) {
      // The voice went on to the next question without the app (an answer the transcript missed): the app follows, so
      // this answer is judged against the question it answers. The one passed is noted nowhere, as a skip is.
      view.answered(current, 'skip', round.note(current, 'skip'));
      current = upcoming;
      upcoming = current && round.next();
      if (!current) return null;
      resynced = true;
    }
    const q = current;
    view.status('Checking…');
    const result = await judged(answer, q, heard, before);
    if (stopped || current !== q) return null;
    if (!result) {
      // Followed to a new question, the voice is told what's after it.
      if (resynced) call?.append('thinking', roundUpdate(brief(current), brief(upcoming)), null);
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
    // A check waiting on the voice's reply has it: the voice took what was said as an answer.
    hurry?.();
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
    // Made before the microphone opens (the taps that got here), the context would be replaced on the first connecting
    // note, just as the call connects. Let go now, it's made once the microphone is open.
    closeAudio();
    holdAudio(true);
    void startCall(
      key,
      { instructions: walkInstructions(), greeting: walkGreeting(brief(current)!, brief(upcoming)), signal: abort.signal, delegate: true },
      {
        // Not from the tap: once the microphone is open the context may start by itself, made under the call's audio.
        onMicrophone: () => {
          if (!stopped && !connected) stopWaiting = waitingSound();
        },
        onStarted: () => {
          connected = true;
          stopWaiting();
          if (stopped) return;
          // No sound here: the voice starts its greeting now, and a sound of the app's over its first moments is what
          // a call on an iPhone can stutter under.
          view.status('Listening. Answer out loud.');
        },
        onTranscript: (who, text, start, endMs) => {
          if (stopped) return;
          addPiece(turns, who, text, start, endMs);
          if (who === 'ai') {
            voiceAt = Math.max(voiceAt, start);
            voicePieces.push({ text, start, end: endMs });
          }
          settle();
        },
        onUsage: () => {},
        onDelegation: (id) => void delegated(id),
        onQuality: (q) => (quality = q),
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
    quality: () => quality,
    stop() {
      stopped = true;
      stopWaiting();
      holdAudio(false);
      clearTimeout(wrapUp);
      abort.abort();
      call?.hangUp();
      call = null;
    },
  };
}

// Walk and talk with recorded clips: the English question in a recorded voice
// (sayEnglish, scripts/generate-prompts.mjs), the Tagalog answer judged on the
// phone by Speak's recogniser and judge, and the answer said back in a recorded
// voice. No network once the speech model is on
// the phone.

import { DownloadError } from '../model-cache';
import { everyWordSaid, judge, passes } from '../phonetics';
import type { PhoneModel } from '../phone-model';
import { RecordError, type Recording } from '../recorder';
import { chime, play, sayEnglish, stop, untilQuiet } from '../speech';
import { COMMAND_SOUNDS, questionLine, WALK_LINES, type WalkOutcome, type WalkQuestion, type WalkRound } from '../walk';
import { PROBLEMS, targets, type SpeakDeps } from './speak';
import type { WalkRun, WalkView } from './walk';

/** A pause this long ends an answer: longer than Speak's, as an answer is remembered, not read off the screen. */
const ANSWER_SILENCE_MS = 1800;
/** How long it listens for an answer, from the microphone giving sound. */
const ANSWER_MAX_MS = 12_000;
/** A short rest between one question and the next. */
const BETWEEN_MS = 700;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a take was, judged against the card and then the spoken commands. Null when nothing could be told from it. */
function outcomeOf(card: WalkQuestion['card'], heard: Awaited<ReturnType<PhoneModel['recognise']>>): WalkOutcome | null {
  if (!heard.sounds.length) return null;
  const said = judge(targets(card), heard);
  if (passes(said.comparison) && everyWordSaid(said.text, said.comparison)) return 'right';
  for (const command of ['skip', 'dont-know'] as const) {
    if (passes(judge(COMMAND_SOUNDS[command], heard).comparison)) return command;
  }
  return 'wrong';
}

/** Run a round until it's stopped. Called from the tap that starts it, so the first words and the microphone may start. */
export function startClipsWalk(round: WalkRound, view: WalkView, deps: SpeakDeps): WalkRun {
  let stopped = false;
  let take: Recording | null = null;
  // Said inside the tap: iOS lets the page speak only once a tap has started it.
  const hello = sayEnglish(WALK_LINES.start);
  deps.holdMicrophone?.(true);
  const asking = deps.askMicrophone?.() ?? Promise.resolve(true);

  async function listen(): Promise<{ samples: Float32Array; speech: boolean }> {
    const recording = (take = deps.record(
      { onListening: () => !stopped && view.status('Listening…') },
      { trailingSilenceMs: ANSWER_SILENCE_MS, maxMs: ANSWER_MAX_MS },
    ));
    try {
      return await recording.audio;
    } finally {
      if (take === recording) take = null;
    }
  }

  async function run(): Promise<void> {
    try {
      if (!(await asking)) return;
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      return view.ended(PROBLEMS[name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'no-mic']);
    }
    if (!(await deps.modelDownloaded())) view.status('Downloading the speech model…');
    const model = await deps.loadPhoneModel((fraction) => !stopped && view.status(`Downloading the speech model… ${Math.round(fraction * 100)}%`));
    await hello;
    while (!stopped) {
      const q = round.next();
      if (!q) return view.ended('There was nothing to ask.');
      view.asked(q);
      let outcome: WalkOutcome | null = null;
      // Nothing said, it's asked once more; still nothing, the answer is said.
      for (let tries = 0; outcome === null && !stopped; tries++) {
        view.status('Asking…');
        // Asked again after a silence, or back after a miss earlier on.
        if (tries > 0 || q.again) await sayEnglish(WALK_LINES.again);
        await sayEnglish(questionLine(q.card));
        if (stopped) return;
        view.status('Getting the mic ready…');
        const heard = await listen();
        if (stopped) return;
        if (!heard.speech) {
          if (tries > 0) outcome = 'dont-know';
          continue;
        }
        view.status('Checking…');
        outcome = outcomeOf(q.card, await model.recognise(heard.samples));
        if (outcome === null && tries > 0) outcome = 'wrong';
      }
      if (stopped || !outcome) return;
      view.answered(q, outcome, round.note(q, outcome));
      // The answer is always said after a response, apart from a skip.
      if (outcome === 'right') await chime();
      else if (outcome === 'wrong') await sayEnglish(WALK_LINES.miss);
      if (outcome !== 'skip') {
        view.status('The answer');
        await play(q.card);
        await untilQuiet();
        // Missed, it's said again slowly, to say along with.
        if (outcome !== 'right' && !stopped) {
          await wait(400);
          await play(q.card, true);
          await untilQuiet();
        }
      }
      await wait(BETWEEN_MS);
    }
  }

  void run().catch((e: unknown) => {
    if (stopped) return;
    view.ended(e instanceof RecordError ? PROBLEMS[e.problem] : e instanceof DownloadError ? PROBLEMS.download : PROBLEMS.failed);
  });

  return {
    stop() {
      stopped = true;
      take?.cancel();
      stop();
      deps.holdMicrophone?.(false);
    },
  };
}

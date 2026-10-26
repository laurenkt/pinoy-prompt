import type { App } from '../app';
import { VOCAB, getCard, isVocab, type Card, type Drill, type Way } from '../deck';
import { exactAnswer, judgeMeaning, type AnswerLanguage, type MeaningJudge } from '../meaning';
import { AiError, checkMeaning, errorText, getApiKey, transcribe } from '../openai';
import { everyWordSaid, judge } from '../phonetics';
import { askWithPicture } from '../pictures';
import { RecordError, toWav, type Recording } from '../recorder';
import { DRILL_GAP, DRILL_MIN_WORDS, askAs, canDrill, distractors, drillHelp, drillKey, noteDrillAnswer, noteDrillRepeat, drillOdds, pickDrillCard, setDrillHelp, shuffle, typing, type DrillRepeat } from '../session';
import { canPlay, chime, play, preload, stop } from '../speech';
import { audioButton, audioPair, choiceList, chip, h, hookView, icon, iconButton, pageHeader, recallCue } from '../ui';
import { continueButton, countdown, holdOnTap, previousButton, type Countdown } from './auto-advance';
import { promptBlock, guideAnswer, guideFeedback, guideFormats, guideQuestion, guideQuestionView, sentenceClip, type CardBack, type GuideFormat, type GuideQuestion } from './guide-question';
import { cardBack } from './card-back';
import { quietToggle } from './quiet';
import { askForMicrophone, defaultDeps, isRight, micWaiting, needsMicrophone, PROBLEMS, speakPanel, targets, type SpeakDeps, type SpeakPanel } from './speak';

/**
 * The kind of question each way of asking a guide counts as: filling a sentence's gap is reading it, building a
 * sentence from the English is recalling it. Guides aren't heard or said.
 */
const GUIDE_MODES: Record<GuideFormat, Way> = { gap: 'read', build: 'recall' };

/** A guide's ways, by what Drills asks: filling a gap is reading it, building a sentence recalling it. */
const GUIDE_WAYS: { id: Way; title: string }[] = [
  { id: 'read', title: 'Gap' },
  { id: 'recall', title: 'Build' },
];

const MODES: { id: Way; title: string }[] = [
  { id: 'listen', title: 'Listen' },
  { id: 'read', title: 'Read' },
  { id: 'recall', title: 'Recall' },
  { id: 'speak', title: 'Speak' },
];

/** The kinds of question a round may ask. Kept across visits, as the Library's filter is, and back to all of them when the app opens. */
let scope = new Set<Way>(MODES.map((m) => m.id));

interface Question {
  card: Card;
  mode: Way;
  /** For a guide, its question as it's asked; `choices` is then empty. */
  guide?: GuideQuestion;
  choices: Card[];
  /**
   * A word that has settled in Study, listened to or recalled: the answer (its meaning, or for recall its Tagalog) is
   * typed (or dictated), not picked.
   */
  typed: boolean;
  /** A recall question asked from the card's picture rather than its English. */
  picture?: boolean;
  /** "Show choices" was tapped on a typed question, so an answer to it was picked rather than recalled. */
  hinted?: boolean;
  /** How many answers asked this way had needed help before this one, to go back to if "I had it right". */
  helpBefore?: number;
  /** Where this way stood in coming back on its own (see noteDrillRepeat) before this answer, likewise. */
  repeatBefore?: DrillRepeat;
  /** How it went has been noted for the round (see settle), so moving on doesn't note it again. */
  tallied?: boolean;
  /** What's typed so far, kept while the screen is redrawn. */
  draft?: string;
  /** What was typed, once it's sent. */
  answer?: string;
  /** Why OpenAI couldn't be asked about the answer, so it was only checked on the device. */
  failure?: unknown;
  /** Typed Tagalog that was the card's own wording, misspelt. */
  misspelt?: boolean;
  /** The box has been offered, and taken focus, once: later redraws leave the keyboard alone. */
  offered?: boolean;
  /** Why a spoken answer didn't come through, to say under the box. */
  unheard?: string;
  /** The microphone's level as the meaning was said, oldest first, drawn in the box until the answer is checked. */
  wave?: number[];
  /** When the wave began running while what was said is heard and checked, by Date.now(). */
  thinkingSince?: number;
}

/** Turns a spoken answer, in the language asked for, into text. */
export type MeaningHearer = (audio: Blob, language: AnswerLanguage) => Promise<string>;

/** OpenAI's speech-to-text, when the learner has given a key for Chat; without one, meanings are typed (see canSay). */
const hearWithOpenAi = (): MeaningHearer | null => {
  const key = getApiKey();
  return key ? (audio, language) => transcribe(key, audio, language) : null;
};

/** What saidOnDevice gives when the device couldn't judge a take at all. */
const UNCHECKED = Symbol('unchecked');

/** What `picked` holds for a typed meaning that wasn't right. */
const MISSED = '';

/** Asks OpenAI, when the learner has given a key for Chat. */
const askOpenAi: MeaningJudge = async (answer, card, language, typed) => {
  const key = getApiKey();
  return key ? checkMeaning(key, { tl: card.tl, en: card.en, answer, language, typed }) : null;
};

/** What a typed answer to the question is given in: the meaning when listening, the Tagalog when recalling. */
const languageOf = (mode: Way): AnswerLanguage => (mode === 'recall' ? 'tl' : 'en');
const answerLanguage = (q: Question): AnswerLanguage => languageOf(q.mode);

/** The kinds of question a card can be asked as. */
function modesFor(card: Card): Way[] {
  return isVocab(card) ? MODES.map((m) => m.id) : guideFormats(card).map((f) => GUIDE_MODES[f]);
}

export function practiceScreen(
  app: App,
  deps: SpeakDeps = defaultDeps,
  askMeaning: MeaningJudge | null = askOpenAi,
  hearMeaning: () => MeaningHearer | null = hearWithOpenAi,
): HTMLElement {
  const root = h('div', { class: 'practice' });
  const canListen = canPlay();
  const canSpeak = deps.recordingSupported();
  // Mixed rounds only include speaking once the model is on the device, so they never stop for a download.
  let speakReady = deps.modelKnownDownloaded?.() ?? false;
  /** The model turned out to be on the device after the round opened; speaking joins once the microphone has been asked for. */
  let modelFound = false;
  /** The model was there, but the phone has cleared it since: nothing more is heard on the device this round. */
  let modelGone = false;
  if (canSpeak) {
    // Found only after the round opened (the app's own check hadn't finished), it's too late to ask for the microphone
    // from the opening tap, so speaking waits for a later tap that does (see askForMicrophoneIfNeeded).
    deps.modelDownloaded().then(
      (ready) => (modelFound ||= ready),
      () => {},
    );
  }

  /** The question being asked; null only when there are too few words to drill. */
  let current: Question | null = null;
  /** The question before, for looking back at. */
  let previous: Question | null = null;
  /** The question after, picked once this one is answered so its word can load. */
  let upcoming: Question | null = null;
  let picked: string | null = null;
  /** A typed meaning is being checked. */
  let checking = false;
  /** Recording a spoken meaning, from a tap on the box's microphone button. */
  let listening: Recording | null = null;
  /** Whether that recording's microphone gives sound yet (onListening); until then, anything said is lost. */
  let micLive = false;
  /** The recording whose spoken meaning is being turned into text; a reply for any other is dropped. */
  let hearing: Recording | null = null;
  /** Waiting for a pause in typing before taking a right meaning without Check. */
  let typingPause: ReturnType<typeof setTimeout> | undefined;
  /** Questions moved past this round. */
  let done = 0;
  let distractorPool: Card[] = VOCAB;
  /** The last few words asked, oldest first. */
  let recent: string[] = [];
  /** `recent` as it was before the question waiting to be asked was picked, should it be picked again. */
  let recentBeforeUpcoming: string[] = [];
  /** Ways missed this round, by drillKey, coming back on their own until they've been got right a few times running. */
  const repeats = new Map<string, DrillRepeat>();
  /** Each guide's drill asked last, so the next is another. */
  const lastDrill = new Map<string, Drill>();
  let speak: SpeakPanel | null = null;
  let spokenRight = false;
  /** An attempt at the current spoken question was heard and judged wrong. */
  let spokeWrong = false;
  /** The latest attempt at it was the miss that set spokeWrong, so "I had it right" can take that back. */
  let missNoted = false;
  /** Counting down to the next question after a right answer. */
  let auto: Countdown | null = null;
  /** What was picked on the question before; null when there's nothing to look back at (a spoken question has no pick). */
  let previousPick: string | null = null;
  let lookingBack = false;
  /** The question whose memory is open: none to begin with, so a card's rating stays out of sight until asked for. */
  let memoryFor: Question | null = null;
  /** Set as a question moves on by itself, so the next one doesn't take focus: an Enter meant for Next would answer it. */
  let autoMoved = false;
  /** The kinds of question are tucked away until asked for. */
  let scopeOpen = false;
  /** The microphone has been asked for this visit, or is being (see askForMicrophone). */
  let micAsked = false;
  /** The phone is asking for the microphone, as the round starts (see askForMicrophone). */
  let waiting = false;
  /** The microphone was refused as the round started, so speaking is left out of this visit. */
  let speakSkipped = false;

  holdOnTap(root, hold);

  /** Why a kind of question can't be asked right now, if it can't: the mic or sound may have gone off mid-round, here or in another tab. */
  function unavailable(mode: Way): string | null {
    if (mode === 'listen' && !canListen) return 'Listen needs a voice, and this device has none.';
    if (mode === 'listen' && !app.progress.settings.sound) return 'Listen is off while the sound is off.';
    if (mode === 'speak' && !canSpeak) return "Speak needs the microphone, and this browser can't record.";
    if (mode === 'speak' && !app.progress.settings.mic) return 'Speak is off while the mic is off.';
    if (mode === 'speak' && speakSkipped) return 'Speak needs the microphone. Allow it, then open Drills again.';
    return null;
  }

  /** The kinds in scope that can be asked right now, before the speaking model is taken into account. */
  function chosen(): Way[] {
    return MODES.map((m) => m.id).filter((m) => scope.has(m) && unavailable(m) === null);
  }

  /**
   * The kinds of question the next one can be: those in scope that can be asked right now. Speaking waits for the model
   * to be on the device, so a round never stops for a download, unless Speak is all that's chosen: then it asks for it.
   * When nothing in scope can be asked (only Listen, then the sound goes off), it falls back to everything that can.
   */
  function modes(): Way[] {
    const picks = chosen();
    if (picks.length === 1 && picks[0] === 'speak') return picks;
    const ready = (m: Way) => m !== 'speak' || speakReady || (modelFound && micAsked);
    const ways = picks.filter(ready);
    return ways.length ? ways : MODES.map((m) => m.id).filter((m) => unavailable(m) === null && ready(m));
  }

  /** The ways a card can be asked, of `ways`: what the round picks from, and what its card backs count. */
  function askable(ways: readonly Way[]): (c: Card) => Way[] {
    return (c) => modesFor(c).filter((m) => ways.includes(m));
  }

  /**
   * A question on the next card, asked any way the scope allows right now, as question number `asked` of the round
   * (from 0): the current one (`done`) unless given. Null only with nothing to ask.
   */
  function nextQuestion(asked = done): Question | null {
    const ways = modes();
    const pick = pickDrillCard(app.progress, app.now(), recent, repeats, asked, askable(ways));
    if (!pick) return null;
    const { way: mode } = pick;
    // A phrase may be asked as a variant on its pattern: the same card, in other words.
    const card = isVocab(pick.card) ? askAs(app.progress, pick.card, mode) : pick.card;
    recent = [...recent.slice(-DRILL_GAP), card.id];
    if (!isVocab(card)) {
      const format = guideFormats(card).find((f) => GUIDE_MODES[f] === mode)!;
      const guide = guideQuestion(card, app.progress, format, lastDrill.get(card.id));
      // modesFor only offers ways the guide has a drill for, so this is never null.
      if (!guide) return null;
      lastDrill.set(card.id, guide.drill);
      return { card, mode, guide, choices: [], typed: false };
    }
    const field = languageOf(mode);
    const choices = mode === 'speak' ? [] : shuffle([card, ...distractors(card, field, 3, distractorPool)]);
    const { typed } = typing(app.progress, card, mode);
    return { card, mode, choices, typed, picture: mode === 'recall' && askWithPicture(card) };
  }

  /** What a right answer to the question is: the card, or for a guide, its answer. */
  const answerOf = (q: Question) => (q.guide ? guideAnswer(q.guide) : q.card.id);

  /** Load what the question will play: the word, or a guide's whole sentence. */
  function load(q: Question | null): void {
    if (!q) return;
    if (!q.guide) preload(q.card);
    else {
      const clip = sentenceClip(q.guide.drill);
      if (clip) preload(clip);
    }
  }

  /**
   * From a tap that may let the round ask to speak (opening Drills, the Speak chip, the mic going on): the
   * microphone is asked for now, so the phone doesn't ask over a speaking question. If the browser
   * would ask, it asks now, over a holding screen.
   */
  function askForMicrophoneIfNeeded(): void {
    const speaks = modes().includes('speak') || (modelFound && chosen().includes('speak'));
    if (waiting || !canSpeak || !current || !speaks) return;
    // While WebKit still remembers the Allow it goes straight through, with no holding screen. Asked anyway, as that
    // starts its ten minutes again. Once it has lapsed (ten minutes without a take), the phone asks again.
    const asks = needsMicrophone(deps);
    if (!asks && micAsked) return;
    // Not over an answer being checked or heard, or one counting down to the next: the holding screen would hide it. A later tap asks.
    if (asks && (checking || hearing || listening || auto)) return;
    micAsked = true;
    waiting = asks;
    void askForMicrophone(deps).then((answer) => {
      if (answer === 'left') return;
      const shown = waiting;
      waiting = false;
      speakSkipped = answer === 'refused';
      // Nothing was covered up, so there's nothing to show again.
      if (!shown && !speakSkipped) return;
      if (current && picked === null && !modes().includes(current.mode)) {
        current = nextQuestion();
        load(current);
      }
      // An answered question (the chip tapped after answering) is shown again as it was.
      if (picked !== null) draw();
      else ask();
    });
  }

  /**
   * Note how the current question went, once, so a miss comes back soon (null: it can't be told, as when the check
   * failed), and pick the one after it.
   */
  function settle(right: boolean | null): void {
    if (!current) return;
    if (right === null) {
      // Kept as it stands, for "I had it right" to tally from.
      current.tallied = true;
      current.repeatBefore = repeats.get(drillKey(current.card.id, current.mode));
    } else if (!current.tallied) tally(current, right);
    if (upcoming) return;
    recentBeforeUpcoming = recent;
    upcoming = nextQuestion(done + 1);
    load(upcoming);
  }

  function tally(q: Question, right: boolean): void {
    const key = drillKey(q.card.id, q.mode);
    q.tallied = true;
    q.repeatBefore = repeats.get(key);
    noteDrillRepeat(repeats, key, right, done);
  }

  function ask(): void {
    speak?.dispose();
    speak = null;
    spokenRight = false;
    spokeWrong = false;
    missNoted = false;
    const q = current;
    if (waiting) return draw();
    if (q?.mode === 'speak') {
      /** How an attempt went, once any miss it was is noted. */
      const spoken = (right: boolean, heard: boolean) => {
        const first = right && !spokenRight;
        if (first) {
          spokenRight = true;
          void chime();
        }
        // The word said back after any attempt it was heard in, right or wrong, as a Listen answer is: after the
        // chime, and before moving on, which waits for it.
        if (heard) sayCard(q);
        if (!first) return;
        // Pick what's next now, so its word loads while the coaching is up. Said wrong first, it comes back as a miss does.
        settle(!spokeWrong);
        if (!spokeWrong) noteHelp(q, false);
        auto = countdown(root, () => {
          autoMoved = true;
          advance();
        });
      };
      speak = speakPanel(q.card, {
        say: (slow) => sayCard(q, slow),
        silence: () => stop(),
        onAttempt: (right, heard) => {
          // A miss heard as some other sounds comes up more to be said in later rounds, counted once a question, as it
          // happens. Nothing recognised says nothing about the word. Said right first time, it takes one off.
          missNoted = false;
          if (!right && heard && !spokeWrong && !spokenRight) {
            spokeWrong = true;
            missNoted = true;
            q.helpBefore = drillHelp(app.progress.cards[q.card.id], q.mode);
            noteHelp(q, true);
          }
          spoken(right, heard);
        },
        onClaim: () => {
          // Its stress measured wrong, as the learner says: if that miss was the first, it's taken back, as "I had it
          // right" takes back a typed one, and it goes on as said right. A miss said before it still stands.
          if (missNoted) {
            if (setDrillHelp(app.progress, q.card.id, q.mode, () => q.helpBefore ?? 0, app.now())) app.commit();
            spokeWrong = false;
          }
          missNoted = false;
          spoken(true, false);
        },
        counting: () => auto !== null,
        onNext: () => advance(),
        onReady: () => (speakReady = true),
        autofocus: !autoMoved,
        deps,
      });
    }
    draw();
    if (q && !q.guide && (q.mode === 'listen' || (q.mode === 'read' && app.progress.settings.autoplay))) void play(q.card);
  }

  /**
   * Play the question's word, except on a speaking question before an attempt or while the microphone is open (see
   * `mayPlay`). A guide's sentence is its answer, so it plays only once answered.
   */
  function sayCard(q: Question, slow = false, answered = picked !== null): void {
    // Nor while the meaning is being said into the microphone, which would record it.
    if ((speak && !speak.mayPlay()) || listening) return;
    // Recalling a word, the word is the answer.
    if (q.mode === 'recall' && !answered) return;
    if (!q.guide) void play(q.card, slow);
    else if (answered) {
      const clip = sentenceClip(q.guide.drill);
      if (clip) void play(clip, slow);
    }
  }

  /** A choice picked: a card, or for a guide, the answer's text (or the sentence built). */
  function choose(choice: Card | string): void {
    const q = current;
    if (!q || picked !== null) return;
    answer(q, typeof choice === 'string' ? choice : choice.id);
  }

  /** Check a typed meaning: on the device, then with OpenAI when there's a key. */
  function send(text: string, spoken = false): void {
    const q = current;
    // Nothing typed (an Enter meant for Next, say) isn't an answer; "Show choices" is there for not knowing.
    if (!q || picked !== null || checking || !text.trim()) return;
    q.answer = text.trim();
    // A said meaning keeps its wave in the box while it's checked; a typed one shows what was typed.
    if (!spoken) q.wave = undefined;
    checking = true;
    draw();
    // Typed Tagalog has to be spelled right; said, it's written down by speech-to-text, not the learner.
    void judgeMeaning(q.answer, q.card, askMeaning, answerLanguage(q), !spoken).then(({ right, failure, misspelt }) => {
      // Left the question (or the drill), or went to the choices, while it was being checked.
      if (current !== q || !q.typed || !root.isConnected) return;
      checking = false;
      q.failure = failure;
      q.misspelt = misspelt;
      answer(q, right ? q.card.id : MISSED);
    });
  }

  /**
   * Whether the answer to `q` can be said into the box: through OpenAI's speech-to-text, or for Tagalog without a key,
   * on the device alone once the pronunciation model is there (see saidOnDevice).
   */
  const canSay = (q: Question): boolean => hearMeaning() !== null || (answerLanguage(q) === 'tl' && modelOnDevice());
  /** The pronunciation model is on the device, as far as this round knows. */
  const modelOnDevice = () => (speakReady || modelFound) && !modelGone;

  /**
   * The box's microphone button: record the meaning said out loud, turn it into text, and check that. A second tap
   * stops early, or before the microphone gives sound (when nothing could have been heard) throws the take away.
   */
  function sayMeaning(q: Question): void {
    if (listening) return micLive ? listening.stop() : cancelSaying(q);
    const hearer = hearMeaning();
    if (!canSay(q) || picked !== null || checking || hearing) return;
    // The word playing would be recorded too.
    stop();
    q.unheard = undefined;
    // Starts empty and grows from the left, a bar for each moment of speech, so silence draws nothing.
    const wave = liveWave((q.wave = []), () => (listening === recording ? root.querySelector('.meaning-wave') : null));
    q.thinkingSince = undefined;
    micLive = false;
    const recording = deps.record({
      onListening: () => {
        if (listening !== recording) return;
        micLive = true;
        // In place, as the level is, rather than redrawing the round mid-recording.
        root.querySelector('.meaning-wave')?.classList.add('live');
        const status = root.querySelector('.meaning-status');
        if (status) status.textContent = listeningText(q);
      },
      onLevel: (_level, speech, parts) => {
        if (listening === recording && speech) wave.take(parts);
      },
    });
    listening = recording;
    draw();
    const unheard = (why: string) => {
      if (hearing === recording) hearing = null;
      if (current !== q || !root.isConnected) return;
      q.unheard = why;
      q.wave = undefined;
      draw();
    };
    recording.audio.then(
      async (take) => {
        if (listening !== recording) return;
        // What's still to come in goes in at once, so the wave being checked is the whole of it.
        wave.flush();
        listening = null;
        if (current !== q || !q.typed || !root.isConnected || picked !== null) return draw();
        if (!take.speech) return unheard("Didn't hear anything. Tap the microphone and say it again, or type it.");
        hearing = recording;
        q.thinkingSince = Date.now();
        draw();
        // Tagalog is heard by its sounds first, on the device, as Speak hears it: speech-to-text writes the words it
        // expects, and turned "kumusta" into "como esta". Only an answer that doesn't pass goes to OpenAI to be written out.
        if (answerLanguage(q) === 'tl') {
          const said = await saidOnDevice(q.card, take.samples);
          if (hearing !== recording) return;
          if (typeof said === 'string') {
            hearing = null;
            if (current !== q || !q.typed || !root.isConnected || picked !== null) return;
            q.draft = q.answer = said;
            return answer(q, q.card.id);
          }
          // Without a key there's nothing to write out what else was said.
          if (!hearer) return unheard(said === UNCHECKED ? "Couldn't check it on this phone. Type it instead." : "That didn't sound like it. Tap the microphone and try again, or type it.");
        }
        if (!hearer) return unheard("Couldn't hear it. Type it instead.");
        let text: string;
        try {
          text = await hearer(toWav(take.samples), answerLanguage(q));
        } catch (e) {
          // Dropped (the mic went off, or the question went) while it was being heard.
          if (hearing !== recording) return;
          return unheard(failedKey(e) ? errorText(e) : "Couldn't hear it through OpenAI. Type it instead.");
        }
        if (hearing !== recording) return;
        hearing = null;
        if (current !== q || !q.typed || !root.isConnected || picked !== null) return;
        if (!text) return unheard("Didn't catch that. Tap the microphone and say it again, or type it.");
        q.draft = text;
        send(text, true);
      },
      (e) => {
        if (listening !== recording) return;
        listening = null;
        unheard(e instanceof RecordError ? PROBLEMS[e.problem] : PROBLEMS['no-mic']);
      },
    );
  }

  /**
   * The card's Tagalog (or an accepted spelling) the recording passes as, judged as Speak judges its sounds, with every
   * word said (not its stress, which only Speak fails on: recall asks for the word, not how well it's said); null when it doesn't pass; UNCHECKED when it can't be heard on the device: the model is never downloaded for
   * this, and checked for again in case the phone has cleared it since.
   */
  async function saidOnDevice(card: Card, samples: Float32Array): Promise<string | null | typeof UNCHECKED> {
    if (!modelOnDevice()) return UNCHECKED;
    try {
      if (!(await deps.modelDownloaded())) return (modelGone = true), UNCHECKED;
      const model = await deps.loadPhoneModel();
      const { text, comparison } = judge(targets(card), await model.recognise(samples));
      return isRight(comparison) && everyWordSaid(text, comparison) ? text : null;
    } catch {
      // Left to OpenAI, as it would be without the model.
      return UNCHECKED;
    }
  }

  /** What the box says once the microphone gives sound. */
  const listeningText = (q: Question) => (answerLanguage(q) === 'tl' ? 'Listening… say it in Tagalog.' : 'Listening… say what it means.');

  /** Stop recording a spoken meaning and drop it: the question is going. */
  function stopListening(): void {
    const recording = listening;
    listening = null;
    // A reply still on its way is dropped when it comes.
    hearing = null;
    recording?.cancel();
  }

  /** Throw away a meaning being said and give the box back, so it can be said again or typed. */
  function cancelSaying(q: Question): void {
    if (!listening) return;
    stopListening();
    q.wave = undefined;
    q.thinkingSince = undefined;
    draw();
  }

  function answer(q: Question, pick: string): void {
    picked = pick;
    const right = pick === answerOf(q);
    // The chime first, so the word said back is heard after it.
    if (right) void chime();
    if (q.guide || q.mode === 'recall' || q.mode === 'listen') sayCard(q);
    // Picked from the choices, it comes back as soon as a miss does. A miss the check couldn't confirm doesn't count.
    settle(q.failure !== undefined && !right ? null : right && !q.hinted);
    // Got wrong, or from the choices, it comes up more asked this way in later rounds too, until it's got right unaided.
    // Not when the check itself failed (offline, say): the answer may well have been right.
    q.helpBefore = drillHelp(app.progress.cards[q.card.id], q.mode);
    if (q.failure === undefined || right) noteHelp(q, q.hinted || !right);
    // From the choices it waits for Next, as a miss does, so the hook can be read.
    if (right && !q.hinted)
      auto = countdown(root, () => {
        autoMoved = true;
        advance();
      });
    draw();
  }

  /** The learner says a typed meaning marked wrong was right after all: the check only goes by the card's wording. */
  function claim(): void {
    const q = current;
    if (!q || picked !== MISSED) return;
    picked = q.card.id;
    // Count it as the right answer it was: take back the miss, then tally it right, and pick what's next again, as it
    // was picked to bring this one straight back.
    const key = drillKey(q.card.id, q.mode);
    if (q.repeatBefore) repeats.set(key, q.repeatBefore);
    else repeats.delete(key);
    tally(q, true);
    recent = recentBeforeUpcoming;
    upcoming = nextQuestion(done + 1);
    load(upcoming);
    // And on the card: back to before the miss, less one for a right answer that doesn't leave it coming back (see noteHelp).
    const before = q.helpBefore ?? 0;
    const after = repeats.has(key) ? before : Math.max(before - 1, 0);
    if (setDrillHelp(app.progress, q.card.id, q.mode, () => after, app.now())) app.commit();
    draw();
  }

  /**
   * Note on the card how the answer went, once it's tallied. Got right while it's still coming back after a miss (see
   * noteDrillRepeat), it takes nothing off: asked again so soon, a right answer says little. The one that ends it does.
   */
  function noteHelp(q: Question, helped: boolean): void {
    if (!helped && repeats.has(drillKey(q.card.id, q.mode))) return;
    if (noteDrillAnswer(app.progress, q.card.id, q.mode, helped, app.now())) app.commit();
  }

  /** Not sure enough to type it, or tired of waiting for the check: pick from choices instead. */
  function showChoices(): void {
    const q = current;
    if (!q || picked !== null) return;
    q.typed = false;
    q.hinted = true;
    checking = false;
    stopListening();
    draw();
  }

  /** Next question, keeping this one and its pick to look back at. */
  function advance(): void {
    hold();
    stopListening();
    settle(spokenRight);
    done++;
    previous = current;
    previousPick = picked;
    // Picked before the mic or sound may have gone off, or the scope changed.
    current = upcoming && modes().includes(upcoming.mode) ? upcoming : nextQuestion();
    upcoming = null;
    // A missed card asked again straight away can't offer its own answer to look back at.
    if (previous && previous.card.id === current?.card.id) previousPick = null;
    picked = null;
    checking = false;
    // Ten minutes without a take and WebKit has forgotten the Allow: the phone asks now, over the holding screen, rather
    // than at the question's own tap.
    if (current?.mode === 'speak') askForMicrophoneIfNeeded();
    ask();
  }

  const home = () => app.navigate({ name: 'home' });

  /**
   * The scope, the mic or the sound changed: a question waiting to be asked that can't be any more is picked again, and so is
   * the one showing, while it's unanswered, so the change shows straight away.
   */
  function rescope({ mayAsk = true } = {}): void {
    // With the mic off nothing listens, not even warming up for Speak.
    if (!app.progress.settings.mic) stopListening();
    speak?.setWarm(app.progress.settings.mic);
    // Only a tap that may let the round ask to speak asks for the microphone, and only that one taps first (quiet.ts).
    if (mayAsk) askForMicrophoneIfNeeded();
    if (waiting) return draw();
    const ways = modes();
    if (upcoming && !ways.includes(upcoming.mode)) upcoming = null;
    if (current && picked === null && !checking && !lookingBack && !ways.includes(current.mode)) {
      hold();
      stopListening();
      // Anything settled on the old question (a right spoken attempt picks what's next) goes with it.
      upcoming = null;
      current = nextQuestion();
      load(current);
      return ask();
    }
    draw();
  }

  function toggleScope(mode: Way): void {
    // The last kind left in that can be asked stays on, so the round asks what was chosen.
    const picks = chosen();
    if (picks.length === 1 && picks[0] === mode) return;
    if (!scope.delete(mode)) scope.add(mode);
    rescope();
    root.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)?.focus();
  }

  /** Stop counting down: the learner wants another look. */
  function hold(): void {
    auto?.cancel();
    auto = null;
  }

  function setLookingBack(on: boolean): void {
    stop();
    lookingBack = on;
    // The mic, the sound or the scope may have changed while looking back.
    if (!on) rescope();
    else draw();
  }

  function draw(): void {
    if (!current) root.replaceChildren(tooFew());
    // An answer said into the box goes to OpenAI only on a listening or recall question, and with a key to send it.
    else if (waiting) root.replaceChildren(h('div', { class: 'session' }, ...header(), micWaiting((modes().includes('listen') || modes().includes('recall')) && hearMeaning() !== null)));
    else if (lookingBack && previous && previousPick !== null) root.replaceChildren(questionView(previous, previousPick));
    else root.replaceChildren(questionView(current, picked));
    if (!autoMoved) root.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    autoMoved = false;
  }

  /** Before there are words enough to drill, a page saying so. */
  function tooFew(): HTMLElement {
    return h(
      'div',
      { class: 'fill' },
      ...pageHeader('Drills', home),
      h(
        'section',
        { class: 'panel center' },
        h('p', null, `Learn at least ${DRILL_MIN_WORDS} words first, then come back here to drill them.`),
        h('button', { class: 'btn primary big', onclick: () => app.navigate({ name: 'study' }) }, 'Go to Study'),
      ),
    );
  }

  /** The control for which kinds of question a round asks, and its chips, shown when it's opened. */
  function scopeControls(): [HTMLElement, HTMLElement] {
    // Kinds that can't be asked right now don't count either way: with all the rest chosen, or none, it's the mix.
    const picks = chosen();
    const mix = picks.length === 0 || picks.length === MODES.filter((m) => unavailable(m.id) === null).length;
    const label = mix ? 'Mix' : picks.length === 1 ? MODES.find((m) => m.id === picks[0])!.title : `${picks.length} kinds`;
    const toggle = h(
      'button',
      {
        class: 'chip filter-toggle',
        'aria-expanded': String(scopeOpen),
        'aria-controls': 'drill-scope',
        'aria-label': `Questions: ${label}`,
        onclick: () => {
          scopeOpen = !scopeOpen;
          draw();
          root.querySelector<HTMLButtonElement>('.filter-toggle')?.focus();
        },
      },
      icon('filter'),
      label,
    );
    const reasons = MODES.map((m) => unavailable(m.id)).filter(Boolean);
    const chips = h(
      'div',
      { id: 'drill-scope', hidden: !scopeOpen },
      h(
        'div',
        { class: 'chips', role: 'group', 'aria-label': 'Ask' },
        MODES.map((m) => {
          const on = scope.has(m.id);
          return chip(m.title, on, {
            'data-mode': m.id,
            // Choosing Speak may open the microphone, after which the tap sound would be held back.
            'data-tap': m.id === 'speak' && !on ? 'before' : undefined,
            // One that can't be asked right now keeps its place, for when the mic or sound goes back on.
            disabled: unavailable(m.id) !== null,
            // The last kind left in stays on (see toggleScope); say so, rather than look like it will toggle.
            'aria-disabled': String(on && picks.length === 1 && picks[0] === m.id),
            onclick: () => toggleScope(m.id),
          });
        }),
      ),
      reasons.length > 0 && h('p', { class: 'muted scope-note' }, reasons.join(' ')),
    );
    return [toggle, chips];
  }

  function header(): HTMLElement[] {
    const [scopeToggle, scopeChips] = scopeControls();
    return [
      h(
        'header',
        { class: 'session-header' },
        iconButton('close', 'End drill', home),
        h('span', { class: 'session-count' }, `${done} done`),
        scopeToggle,
        quietToggle(app, (which) => rescope({ mayAsk: which === 'mic' }), { mayOpenMicrophone: true }),
      ),
      scopeChips,
    ];
  }

  /**
   * How well the card is known, on its back: a tap on the card turns it over, so it doesn't colour the answer unless
   * asked for. A drill never changes the schedule, so it reads the same once answered. Turned only on the question it
   * was turned on.
   */
  function backOf(q: Question): CardBack {
    return {
      // As this round would pick at that time, its misses so far and its kinds (the card back allows for sitting out).
      back: () => {
        const ways = modes();
        return cardBack(app.progress, q.card, q.mode, q.guide ? GUIDE_WAYS : MODES, app.now(), (at) =>
          drillOdds(app.progress, at, [], repeats, askable(ways)),
        );
      },
      turned: memoryFor === q,
      onTurn: (turned) => {
        memoryFor = turned ? q : null;
      },
    };
  }

  /** A question with what was picked on it; the one before, while looking back. */
  function questionView(q: Question, picked: string | null): HTMLElement {
    const reviewing = q !== current;
    const turnable = backOf(q);
    const answered = picked !== null;
    const right = picked === answerOf(q);
    const field = answerLanguage(q);
    const say = (slow = false) => sayCard(q, slow, answered);
    const onward = () =>
      reviewing ? continueButton(() => setLookingBack(false), false, 'Back to the current card') : continueButton(() => advance(), auto !== null, 'Next');
    const back =
      previousPick !== null && !answered && !checking && !listening && !hearing && !reviewing && q.mode !== 'speak' && previousButton(() => setLookingBack(true));

    if (q.guide) {
      const d = q.guide.drill;
      return h(
        'div',
        { class: 'session' },
        ...header(),
        back,
        guideQuestionView(q.card, q.guide, picked, {
          say,
          onPick: choose,
          onChange: draw,
          feedback: (right) => guideFeedback(q.card, d, right, { praise: 'Tama!', miss: 'Mali.' }),
          after: [onward()],
          back: turnable,
        }),
      );
    }

    let prompt: HTMLElement;
    if (q.mode === 'speak') {
      prompt = promptBlock(
        'prompt',
        'Say this out loud',
        turnable,
        // No audio until the learner has had a go: the word is played on the result.
        h('p', { class: 'tl', lang: 'fil' }, q.card.tl),
        h('p', { class: 'prompt-meaning' }, q.card.en),
      );
    } else if (q.mode === 'listen') {
      prompt = promptBlock(
        'prompt center',
        q.typed ? 'What does it mean?' : 'What did you hear?',
        turnable,
        audioPair(say, true),
        answered && h('p', { class: 'tl', lang: 'fil' }, q.card.tl),
      );
    } else if (q.mode === 'read') {
      prompt = promptBlock(
        'prompt',
        'What does this mean?',
        turnable,
        h('div', { class: 'tl-row' }, h('p', { class: 'tl', lang: 'fil' }, q.card.tl), audioButton(() => say())),
      );
    } else {
      prompt = promptBlock('prompt', 'How do you say…', turnable, ...recallCue(q.card, !!q.picture));
    }

    return h(
      'div',
      { class: 'session' },
      ...header(),
      back,
      h(
        'div',
        { class: 'panel' },
        prompt,
        q.mode === 'speak' ? speak?.el : null,
        q.typed && typedAnswer(q, picked),
        q.mode !== 'speak' && !q.typed &&
          choiceList(q.choices, {
            key: (c) => c.id,
            label: (c) => c[field],
            answer: q.card.id,
            picked,
            lang: field === 'tl' ? 'fil' : undefined,
            onPick: choose,
          }),
        q.mode !== 'speak' && answered &&
          h(
            'div',
            { class: `feedback ${right ? 'good' : 'bad'}`, role: 'status' },
            h('strong', null, right ? 'Tama!' : 'Mali.'),
            ' ',
            `${q.card.tl} = ${q.card.en}`,
            !right && q.failure !== undefined && h('p', { class: 'feedback-note' }, checkProblem(q.failure)),
            !right && q.misspelt && h('p', { class: 'feedback-note' }, 'Nearly: check the spelling.'),
          ),
        // Picked from the choices after "Show choices" is half a miss: the hook shows then too.
        q.mode !== 'speak' && answered && (!right || reviewing || q.hinted) &&
          hookView(q.card),
        // Not for a misspelling: the spelling is what was wrong.
        picked === MISSED && !reviewing && !q.misspelt && h('button', { class: 'btn secondary claim', onclick: claim }, 'I had it right'),
        q.mode !== 'speak' && answered && onward(),
      ),
    );
  }

  /** Records the answer said out loud; a second tap stops. Silent itself, since its tap would be recorded. */
  function micButton(q: Question): HTMLButtonElement {
    const button = iconButton('mic', listening ? 'Stop recording' : 'Say it out loud', () => sayMeaning(q), { pressed: listening !== null });
    button.type = 'button';
    button.classList.add('meaning-mic');
    button.classList.toggle('listening', listening !== null);
    button.disabled = checking || hearing !== null;
    button.setAttribute('data-no-tap', '');
    return button;
  }

  /**
   * What the microphone heard, as bars, in place of the box while the meaning is said: empty and cream until the
   * microphone gives sound, then saffron, with a bar added from the left only while there's speech. A beat runs
   * along them while what was said is heard and checked.
   */
  function waveBox(levels: number[], thinkingSince: number | undefined): HTMLElement {
    const thinking = thinkingSince !== undefined;
    const live = listening !== null && micLive;
    return h(
      'div',
      {
        class: `meaning-wave${thinking ? ' thinking' : ''}${live ? ' live' : ''}`,
        'aria-hidden': 'true',
        style: `--bars: ${WAVE_BARS}${thinking ? `; --since: ${Date.now() - thinkingSince}ms` : ''}`,
      },
      levels.map(waveBar),
    );
  }

  /**
   * A box to type the answer in: the meaning, or for recall the Tagalog. It keeps what was sent, marked right or
   * wrong. An answer that is the card's own wording, exactly, is taken as it's typed, without Check. With the mic on and a
   * way to hear it (canSay), a microphone button beside it records the answer said out loud instead.
   */
  function typedAnswer(q: Question, picked: string | null): HTMLElement {
    const answered = picked !== null;
    const busy = checking || hearing !== null || listening !== null;
    const tagalog = answerLanguage(q) === 'tl';
    const input = h('input', {
      class: `meaning-input ${answered ? (picked === q.card.id ? 'correct' : 'wrong') : ''}`,
      type: 'text',
      'aria-label': tagalog ? 'How you say it, in Tagalog' : 'What it means, in English',
      placeholder: tagalog ? 'Type it in Tagalog' : 'Type it in English',
      lang: tagalog ? 'fil' : undefined,
      // The phone's English autocorrect would turn Tagalog into English words.
      autocorrect: tagalog ? 'off' : undefined,
      autocapitalize: tagalog ? 'off' : undefined,
      spellcheck: tagalog ? 'false' : undefined,
      autocomplete: 'off',
      enterkeyhint: 'done',
      disabled: answered || busy,
      'data-autofocus': (!answered && !q.offered) || undefined,
      oninput: () => {
        q.draft = input.value;
        // Only the card's own wording, exactly, once typing pauses: "no" is right for Hindi, but not on the way to "now",
        // and "thank you very muc" is close enough for Check, but not finished. Anything else waits for Check.
        clearTimeout(typingPause);
        // Goes by the question, not this box: a redraw meanwhile (the filter opening, say) replaces the box.
        typingPause = setTimeout(() => {
          // Not while it's being said instead, or behind the microphone's holding screen.
          const busy = listening !== null || hearing !== null || waiting || lookingBack;
          if (current === q && q.typed && !busy && root.isConnected && q.draft && exactAnswer(q.draft, q.card, answerLanguage(q))) send(q.draft);
        }, TYPING_PAUSE_MS);
      },
      // The keyboard takes the bottom of the screen; keep the box in sight above it.
      onfocus: () => setTimeout(() => input.closest('form')?.scrollIntoView({ block: 'nearest' }), 300),
    });
    input.value = q.answer ?? q.draft ?? '';
    q.offered = true;
    const mic =
      !answered &&
      app.progress.settings.mic &&
      canSpeak &&
      !speakSkipped &&
      canSay(q) &&
      micButton(q);
    const status = listening
      ? micLive
        ? listeningText(q)
        : 'Getting the mic ready…'
      : hearing
        ? 'Hearing what you said…'
        : checking && q.wave
          ? `Heard “${q.answer?.replace(/[.!?]+$/, '')}”. Checking…`
          : (!answered && q.unheard) || null;
    const wave = !answered && q.wave && (listening || hearing || checking) ? waveBox(q.wave, listening ? undefined : (q.thinkingSince ?? Date.now())) : null;
    return h(
      'form',
      {
        class: 'meaning-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          send(input.value);
        },
      },
      h('div', { class: 'meaning-row' }, wave ?? input, mic),
      status && h('p', { class: 'muted meaning-status', role: 'status' }, status),
      !answered &&
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn secondary', type: 'button', onclick: showChoices }, 'Show choices'),
          // While a meaning is being said there's nothing to check yet, so this place throws it away instead.
          listening
            ? h('button', { class: 'btn secondary', type: 'button', onclick: () => cancelSaying(q) }, 'Cancel')
            : h('button', { class: 'btn primary', type: 'submit', disabled: busy }, checking ? 'Checking…' : 'Check'),
        ),
    );
  }

  app.onKey((e) => {
    const q = lookingBack ? previous : current;
    if (!q || waiting) return;
    if (e.key === 'r' || e.key === 'R') {
      hold();
      return sayCard(q, false, lookingBack || picked !== null);
    }
    if (q.mode === 'speak' || lookingBack || picked !== null || q.typed) return;
    const n = Number(e.key);
    const choices = q.guide ? q.guide.choices : q.choices;
    if (n >= 1 && n <= choices.length) choose(choices[n - 1]);
  });
  // Drills open straight into a round; closing it, or going back, goes Home.
  const known = Object.keys(app.progress.cards).map((id) => getCard(id)!).filter((c) => c && isVocab(c));
  distractorPool = known.length >= 6 ? known : VOCAB;
  if (canDrill(app.progress)) {
    current = nextQuestion();
    load(current);
    // Still inside the tap that opened Drills.
    askForMicrophoneIfNeeded();
  }
  ask();
  return root;
}

/** Bars the box holds while a meaning is said, each a slot of its width: under two seconds of speech at about fifty levels a second, before they merge in pairs. Even, so they can. */
const WAVE_BARS = 80;
/** About how long each of the recorder's finer levels stands for, so the wave takes them in at the pace they're said. */
const WAVE_PART_MS = 21;
/** Levels more than this behind are let in faster, so the wave never lags far behind what's said. */
const WAVE_LAG = 8;
/** How long merged bars take to glide into their slots: `.meaning-wave span`'s flex-basis transition. */
const WAVE_GLIDE_MS = 250;

const waveBar = (level: number, i: number) => h('span', { style: `--level: ${level}; --i: ${i}` });

/**
 * The wave of a meaning being said, kept in `levels` and drawn in the box `box` gives (none once the take is over or
 * dropped, which stops it). The recorder's levels come four at a time; they're let in one by one at the pace they
 * were said, a frame at a time, each smoothed a little towards the one before, so the wave grows steadily rather than
 * in jumps. Each new bar eases in. Each bar is the loudest of `span` smoothed levels; once the box is full,
 * neighbouring bars merge in pairs and span doubles, so the whole of what was said stays in the box, the merged bars
 * gliding from double width into their slots while new ones wait.
 */
function liveWave(levels: number[], box: () => Element | null) {
  const pending: number[] = [];
  let span = 1;
  let inLast = 0;
  let smoothed = 0;
  let frame = 0;
  let then = 0;
  let due = 0;
  let glidingUntil = 0;
  const add = (part: number, el: Element | null, now: number) => {
    smoothed = levels.length ? smoothed + (part - smoothed) * 0.6 : part;
    const level = smoothed;
    if (inLast > 0 && inLast < span) {
      levels[levels.length - 1] = Math.max(levels[levels.length - 1], level);
      inLast++;
      (el?.lastElementChild as HTMLElement | null)?.style.setProperty('--level', String(levels[levels.length - 1]));
      return;
    }
    if (levels.length === WAVE_BARS) {
      levels.splice(0, WAVE_BARS, ...Array.from({ length: WAVE_BARS / 2 }, (_, i) => Math.max(levels[2 * i], levels[2 * i + 1])));
      span *= 2;
      if (el) {
        const merged = levels.map(waveBar);
        merged.forEach((bar) => bar.classList.add('merged'));
        el.replaceChildren(...merged);
        // Laid out at double width first, so taking the class off glides them into their slots.
        void (el as HTMLElement).offsetWidth;
        merged.forEach((bar) => bar.classList.remove('merged'));
        glidingUntil = now + WAVE_GLIDE_MS;
      }
    }
    levels.push(level);
    inLast = 1;
    const bar = waveBar(level, levels.length - 1);
    bar.classList.add('new');
    el?.append(bar);
  };
  const tick = (now: number) => {
    frame = 0;
    const el = box();
    if (!el) return void pending.splice(0);
    due = Math.min(due + (now - then) / WAVE_PART_MS, pending.length);
    then = now;
    // While merged bars glide into their slots there's no room for new ones; they wait, then catch up gently.
    if (now >= glidingUntil) {
      let count = Math.floor(due) + Math.ceil(Math.max(0, pending.length - WAVE_LAG) / 4);
      due -= Math.floor(due);
      for (; count > 0 && pending.length; count--) add(pending.shift()!, el, now);
    }
    if (pending.length) frame = requestAnimationFrame(tick);
  };
  return {
    /** A block's finer levels, in order. */
    take(parts: number[]) {
      pending.push(...parts);
      if (frame) return;
      then = performance.now();
      frame = requestAnimationFrame(tick);
    },
    /** Put in whatever is still to come in, now. */
    flush() {
      cancelAnimationFrame(frame);
      frame = 0;
      const el = box();
      for (const part of pending.splice(0)) add(part, el, 0);
    },
  };
}

/** How long typing has to pause before a meaning the device can tell is right is taken without Check. */
const TYPING_PAUSE_MS = 700;

/** A key or billing problem, which says what to fix; anything else is told as OpenAI not being reached. */
function failedKey(e: unknown): e is AiError {
  return e instanceof AiError && (e.kind === 'key' || e.kind === 'quota');
}

/** Why a typed meaning was only checked on the device. */
function checkProblem(failure: unknown): string {
  const fix = failedKey(failure) ? `${errorText(failure)} ` : "Couldn't reach OpenAI to check other wordings. ";
  return `${fix}If you meant the same thing, tap I had it right.`;
}

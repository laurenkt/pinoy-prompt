import type { App } from '../app';
import { VOCAB, getCard, isVocab, type Card, type Drill } from '../deck';
import { canTypeMeaning, judgeMeaning, matchesMeaning, type MeaningJudge } from '../meaning';
import { AiError, checkMeaning, errorText, getApiKey, transcribe } from '../openai';
import { RecordError, toWav, type Recording } from '../recorder';
import { DRILL_GAP, DRILL_MIN_WORDS, canDrill, distractors, pickDrillCard, settled, shuffle } from '../session';
import { canPlay, chime, play, preload, stop } from '../speech';
import { audioButton, audioPair, choiceList, chip, h, hookView, icon, iconButton, pageHeader } from '../ui';
import { continueButton, countdown, holdOnTap, previousButton, type Countdown } from './auto-advance';
import { guideAnswer, guideFeedback, guideFormats, guideQuestion, guideQuestionView, sentenceClip, type GuideFormat, type GuideQuestion } from './guide-question';
import { isSilent, quietToggle } from './quiet';
import { askForMicrophone, defaultDeps, micWaiting, needsMicrophone, PROBLEMS, speakPanel, type SpeakDeps, type SpeakPanel } from './speak';

type Mode = 'listen' | 'read' | 'recall' | 'speak';


/**
 * The kind of question each way of asking a guide counts as: filling a sentence's gap is reading it, building a
 * sentence from the English is recalling it. Guides aren't heard or said.
 */
const GUIDE_MODES: Record<GuideFormat, Mode> = { gap: 'read', build: 'recall' };

const MODES: { id: Mode; title: string }[] = [
  { id: 'listen', title: 'Listen' },
  { id: 'read', title: 'Read' },
  { id: 'recall', title: 'Recall' },
  { id: 'speak', title: 'Speak' },
];

/** The kinds of question a round may ask. Kept across visits, as the Library's filter is, and back to all of them when the app opens. */
let scope = new Set<Mode>(MODES.map((m) => m.id));

interface Question {
  card: Card;
  mode: Mode;
  /** For a guide, its question as it's asked; `choices` is then empty. */
  guide?: GuideQuestion;
  choices: Card[];
  /** Listening to a word that has settled in Study: the meaning is typed (or dictated), not picked. */
  typed: boolean;
  /** What's typed so far, kept while the screen is redrawn. */
  draft?: string;
  /** What was typed, once it's sent. */
  answer?: string;
  /** Why OpenAI couldn't be asked about the answer, so it was only checked on the device. */
  failure?: unknown;
  /** The box has been offered, and taken focus, once: later redraws leave the keyboard alone. */
  offered?: boolean;
  /** Why a spoken answer didn't come through, to say under the box. */
  unheard?: string;
  /** The microphone's level as the meaning was said, oldest first, drawn in the box until the answer is checked. */
  wave?: number[];
  /** When the wave began running while what was said is heard and checked, by Date.now(). */
  thinkingSince?: number;
}

/** Turns a spoken answer into text. */
export type MeaningHearer = (audio: Blob) => Promise<string>;

/** OpenAI's speech-to-text, when the learner has given a key for Chat; without one, answers are typed. */
const hearWithOpenAi = (): MeaningHearer | null => {
  const key = getApiKey();
  return key ? (audio) => transcribe(key, audio) : null;
};

/** What `picked` holds for a typed meaning that wasn't right. */
const MISSED = '';

/** Asks OpenAI, when the learner has given a key for Chat. */
const askOpenAi: MeaningJudge = async (answer, card) => {
  const key = getApiKey();
  return key ? checkMeaning(key, { tl: card.tl, en: card.en, answer }) : null;
};

/** The kinds of question a card can be asked as. */
function modesFor(card: Card): Mode[] {
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
  if (canSpeak) {
    // Found only after the round opened (the app's own check hadn't finished), it's too late to ask for the
    // microphone from the opening tap, so speaking joins only if the phone wouldn't ask over a speaking question.
    deps.modelDownloaded().then(
      (ready) => (speakReady ||= ready && !needsMicrophone(deps)),
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
  /** The recording whose spoken meaning is being turned into text; a reply for any other is dropped. */
  let hearing: Recording | null = null;
  /** Waiting for a pause in typing before taking a right meaning without Check. */
  let typingPause: ReturnType<typeof setTimeout> | undefined;
  /** Questions moved past this round. */
  let done = 0;
  let distractorPool: Card[] = VOCAB;
  /** The last few words asked, oldest first. */
  let recent: string[] = [];
  /** Cards missed this round and not yet got right since, with how many times. */
  let missed = new Map<string, number>();
  /** Each guide's drill asked last, so the next is another. */
  const lastDrill = new Map<string, Drill>();
  let speak: SpeakPanel | null = null;
  let spokenRight = false;
  /** Counting down to the next question after a right answer. */
  let auto: Countdown | null = null;
  /** What was picked on the question before, when it moved on by itself; null when there's nothing to look back at. */
  let previousPick: string | null = null;
  let lookingBack = false;
  /** Set as a question moves on by itself, so the next one doesn't take focus: an Enter meant for Next would answer it. */
  let autoMoved = false;
  /** The kinds of question are tucked away until asked for. */
  let scopeOpen = false;
  /** The microphone has been held this visit, or is being (see askForMicrophone). */
  let micHeld = false;
  /** The phone is asking for the microphone, as the round starts (see askForMicrophone). */
  let waiting = false;
  /** The microphone was refused as the round started, so speaking is left out of this visit. */
  let speakSkipped = false;

  holdOnTap(root, hold);

  /** Why a kind of question can't be asked right now, if it can't: quiet or silent mode may have come on mid-round, here or in another tab. */
  function unavailable(mode: Mode): string | null {
    if (mode === 'listen' && !canListen) return 'Listen needs a voice, and this device has none.';
    if (mode === 'listen' && isSilent(app.progress.settings)) return 'Listen is off in silent mode.';
    if (mode === 'speak' && !canSpeak) return "Speak needs the microphone, and this browser can't record.";
    if (mode === 'speak' && app.progress.settings.quiet) return 'Speak is off in quiet mode.';
    if (mode === 'speak' && speakSkipped) return 'Speak needs the microphone. Allow it, then open Drills again.';
    return null;
  }

  /** The kinds in scope that can be asked right now, before the speaking model is taken into account. */
  function chosen(): Mode[] {
    return MODES.map((m) => m.id).filter((m) => scope.has(m) && unavailable(m) === null);
  }

  /**
   * The kinds of question the next one can be: those in scope that can be asked right now. Speaking waits for the model
   * to be on the device, so a round never stops for a download, unless Speak is all that's chosen: then it asks for it.
   * When nothing in scope can be asked (only Listen, then silent mode), it falls back to everything that can.
   */
  function modes(): Mode[] {
    const picks = chosen();
    if (picks.length === 1 && picks[0] === 'speak') return picks;
    const ready = (m: Mode) => m !== 'speak' || speakReady;
    const ways = picks.filter(ready);
    return ways.length ? ways : MODES.map((m) => m.id).filter((m) => unavailable(m) === null && ready(m));
  }

  /** A question on the next card, asked any way the scope allows right now. Null only with nothing to ask. */
  function nextQuestion(): Question | null {
    const ways = modes();
    const card = pickDrillCard(app.progress, app.now(), recent, missed, (c) => modesFor(c).some((m) => ways.includes(m)));
    if (!card) return null;
    recent = [...recent.slice(-DRILL_GAP), card.id];
    const fits = modesFor(card).filter((m) => ways.includes(m));
    const mode = fits[Math.floor(Math.random() * fits.length)];
    if (!isVocab(card)) {
      const format = guideFormats(card).find((f) => GUIDE_MODES[f] === mode)!;
      const guide = guideQuestion(card, app.progress, format, lastDrill.get(card.id));
      // modesFor only offers ways the guide has a drill for, so this is never null.
      if (!guide) return null;
      lastDrill.set(card.id, guide.drill);
      return { card, mode, guide, choices: [], typed: false };
    }
    const field = mode === 'recall' ? 'tl' : 'en';
    const choices = mode === 'speak' ? [] : shuffle([card, ...distractors(card, field, 3, distractorPool)]);
    const typed = mode === 'listen' && settled(app.progress, card.id) && canTypeMeaning(card);
    return { card, mode, choices, typed };
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
   * From a tap that may let the round ask to speak (opening Drills, the Speak chip, quiet mode going off): the
   * microphone is held for the rest of the visit, so the phone never asks over a speaking question. If the browser
   * would ask, it asks now, over a holding screen.
   */
  function askForMicrophoneIfNeeded(): void {
    if (waiting || !canSpeak || !current || !modes().includes('speak')) return;
    // While WebKit still remembers the Allow it goes straight through, with no holding screen. Held anyway, as that
    // only lasts minutes. Once it has lapsed (a long while in the background closes the stream), the phone asks again.
    const asks = needsMicrophone(deps);
    if (!asks && micHeld) return;
    // Not over an answer being checked or heard, or one counting down to the next: the holding screen would hide it. A later tap asks.
    if (asks && (checking || hearing || listening || auto)) return;
    micHeld = true;
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

  /** Note how the current question went, so a miss comes back soon, and pick the one after it. */
  function settle(right: boolean): void {
    if (!current || upcoming) return;
    tally(current.card.id, right);
    upcoming = nextQuestion();
    load(upcoming);
  }

  function tally(id: string, right: boolean): void {
    const misses = missed.get(id) ?? 0;
    if (!right) missed.set(id, misses + 1);
    else if (misses > 1) missed.set(id, misses - 1);
    else missed.delete(id);
  }

  function ask(): void {
    speak?.dispose();
    speak = null;
    spokenRight = false;
    const q = current;
    if (waiting) return draw();
    if (q?.mode === 'speak') {
      speak = speakPanel(q.card, {
        say: (slow) => sayCard(q, slow),
        silence: () => stop(),
        onAttempt: (right) => {
          if (!right || spokenRight) return;
          spokenRight = true;
          void chime();
          // Pick what's next now, so its word loads while the coaching is up.
          settle(true);
          auto = countdown(root, () => {
            autoMoved = true;
            advance();
          });
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
    void judgeMeaning(q.answer, q.card, askMeaning).then(({ right, failure }) => {
      // Left the question (or the drill), or went to the choices, while it was being checked.
      if (current !== q || !q.typed || !root.isConnected) return;
      checking = false;
      q.failure = failure;
      answer(q, right ? q.card.id : MISSED);
    });
  }

  /** The box's microphone button: record the meaning said out loud, turn it into text, and check that. A second tap stops early. */
  function sayMeaning(q: Question): void {
    if (listening) return listening.stop();
    const hearer = hearMeaning();
    if (!hearer || picked !== null || checking || hearing) return;
    // The word playing would be recorded too.
    stop();
    q.unheard = undefined;
    // Starts flat and fills from the right as the level comes in.
    const wave = (q.wave = new Array<number>(WAVE_BARS).fill(0));
    q.thinkingSince = undefined;
    const recording = deps.record({
      onLevel: (level) => {
        if (listening !== recording) return;
        wave.push(level);
        wave.shift();
        const bars = root.querySelectorAll<HTMLElement>('.meaning-wave span');
        // Move each bar's height one along rather than redraw the box, a dozen times a second.
        bars.forEach((bar, i) => bar.style.setProperty('--level', String(wave[i])));
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
        listening = null;
        if (current !== q || !q.typed || !root.isConnected || picked !== null) return draw();
        if (!take.speech) return unheard("Didn't hear anything. Tap the microphone and say it again, or type it.");
        hearing = recording;
        q.thinkingSince = Date.now();
        draw();
        let text: string;
        try {
          text = await hearer(toWav(take.samples));
        } catch (e) {
          // Dropped (quiet mode came on, or the question went) while it was being heard.
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
    settle(right);
    if (right)
      auto = countdown(root, () => {
        autoMoved = true;
        advance(pick);
      });
    draw();
  }

  /** The learner says a typed meaning marked wrong was right after all: the check only goes by the card's wording. */
  function claim(): void {
    const q = current;
    if (!q || picked !== MISSED) return;
    picked = q.card.id;
    // Count it as the right answer it was: take back the miss, then tally it right.
    const misses = missed.get(q.card.id) ?? 0;
    if (misses > 1) missed.set(q.card.id, misses - 1);
    else missed.delete(q.card.id);
    tally(q.card.id, true);
    draw();
  }

  /** Not sure enough to type it, or tired of waiting for the check: pick from choices instead. */
  function showChoices(): void {
    const q = current;
    if (!q || picked !== null) return;
    q.typed = false;
    checking = false;
    stopListening();
    draw();
  }

  /** Next question; `back` is this one's pick, when it moved on by itself, so it can be looked back at. */
  function advance(back: string | null = null): void {
    hold();
    stopListening();
    settle(spokenRight);
    done++;
    previous = current;
    previousPick = back;
    // Picked before quiet or silent mode may have come on, or the scope changed.
    current = upcoming && modes().includes(upcoming.mode) ? upcoming : nextQuestion();
    upcoming = null;
    picked = null;
    checking = false;
    ask();
  }

  const home = () => app.navigate({ name: 'home' });

  /**
   * The scope or quiet mode changed: a question waiting to be asked that can't be any more is picked again, and so is
   * the one showing, while it's unanswered, so the change shows straight away.
   */
  function rescope(): void {
    // Quiet mode means nothing listens.
    if (app.progress.settings.quiet) stopListening();
    askForMicrophoneIfNeeded();
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

  function toggleScope(mode: Mode): void {
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
    // Quiet mode or the scope may have changed while looking back.
    if (!on) rescope();
    else draw();
  }

  function draw(): void {
    if (!current) root.replaceChildren(tooFew());
    // A meaning can be said into the box only on a listening question, and with a way to hear it.
    else if (waiting) root.replaceChildren(h('div', { class: 'session' }, ...header(), micWaiting(modes().includes('listen') && hearMeaning() !== null)));
    else if (lookingBack && previous && previousPick) root.replaceChildren(questionView(previous, previousPick));
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
            'data-tap': m.id === 'speak' ? 'before' : undefined,
            // One that can't be asked right now keeps its place, for when quiet mode goes off.
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
        quietToggle(app, rescope),
      ),
      scopeChips,
    ];
  }

  /** A question with what was picked on it; the one before, while looking back. */
  function questionView(q: Question, picked: string | null): HTMLElement {
    const reviewing = q !== current;
    const answered = picked !== null;
    const right = picked === answerOf(q);
    const field = q.mode === 'recall' ? 'tl' : 'en';
    const say = (slow = false) => sayCard(q, slow, answered);
    const onward = () =>
      reviewing ? continueButton(() => setLookingBack(false), false, 'Back to the current card') : continueButton(() => advance(), auto !== null, 'Next');
    const back =
      previousPick && !answered && !checking && !listening && !hearing && !reviewing && q.mode !== 'speak' && previousButton(() => setLookingBack(true));

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
        }),
      );
    }

    let prompt: HTMLElement;
    if (q.mode === 'speak') {
      prompt = h(
        'div',
        { class: 'prompt' },
        h('p', { class: 'eyebrow' }, 'Say this out loud'),
        // No audio until the learner has had a go: the word is played on the result.
        h('p', { class: 'tl', lang: 'fil' }, q.card.tl),
        h('p', { class: 'prompt-meaning' }, q.card.en),
      );
    } else if (q.mode === 'listen') {
      prompt = h(
        'div',
        { class: 'prompt center' },
        h('p', { class: 'eyebrow' }, q.typed ? 'What does it mean?' : 'What did you hear?'),
        audioPair(say, true),
        answered && h('p', { class: 'tl', lang: 'fil' }, q.card.tl),
      );
    } else if (q.mode === 'read') {
      prompt = h(
        'div',
        { class: 'prompt' },
        h('p', { class: 'eyebrow' }, 'What does this mean?'),
        h('div', { class: 'tl-row' }, h('p', { class: 'tl', lang: 'fil' }, q.card.tl), audioButton(() => say())),
      );
    } else {
      prompt = h('div', { class: 'prompt' }, h('p', { class: 'eyebrow' }, 'How do you say…'), h('p', { class: 'prompt-en' }, q.card.en));
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
          ),
        q.mode !== 'speak' && answered && (!right || reviewing) &&
          hookView(q.card),
        picked === MISSED && !reviewing && h('button', { class: 'btn secondary claim', onclick: claim }, 'I had it right'),
        q.mode !== 'speak' && answered && onward(),
      ),
    );
  }

  /** Records the meaning said out loud; a second tap stops. Silent itself, since its tap would be recorded. */
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
   * What the microphone heard, as bars, in place of the box while the meaning is said; they run across while what
   * was said is heard and checked.
   */
  function waveBox(levels: number[], thinkingSince: number | undefined): HTMLElement {
    const thinking = thinkingSince !== undefined;
    return h(
      'div',
      {
        class: `meaning-wave${thinking ? ' thinking' : ''}`,
        'aria-hidden': 'true',
        style: thinking ? `--since: ${Date.now() - thinkingSince}ms` : undefined,
      },
      levels.map((level, i) => h('span', { style: `--level: ${level}; --i: ${i}` })),
    );
  }

  /**
   * A box to type the meaning in; it keeps what was sent, marked right or wrong. A meaning the device can tell is
   * right is taken as it's typed, without Check. With a key for OpenAI, and outside quiet mode, a microphone button
   * beside it records the meaning said out loud instead.
   */
  function typedAnswer(q: Question, picked: string | null): HTMLElement {
    const answered = picked !== null;
    const busy = checking || hearing !== null || listening !== null;
    const input = h('input', {
      class: `meaning-input ${answered ? (picked === q.card.id ? 'correct' : 'wrong') : ''}`,
      type: 'text',
      'aria-label': 'What it means, in English',
      placeholder: 'Type it in English',
      autocomplete: 'off',
      enterkeyhint: 'done',
      disabled: answered || busy,
      'data-autofocus': (!answered && !q.offered) || undefined,
      oninput: () => {
        q.draft = input.value;
        // Only a meaning the device is sure of, once typing pauses: "no" is right for Hindi, but not on the way to "now".
        // Anything else waits for Check, so a wrong answer is never sent.
        clearTimeout(typingPause);
        // Goes by the question, not this box: a redraw meanwhile (the filter opening, say) replaces the box.
        typingPause = setTimeout(() => {
          // Not while it's being said instead, or behind the microphone's holding screen.
          const busy = listening !== null || hearing !== null || waiting || lookingBack;
          if (current === q && q.typed && !busy && root.isConnected && q.draft && matchesMeaning(q.draft, q.card)) send(q.draft);
        }, TYPING_PAUSE_MS);
      },
      // The keyboard takes the bottom of the screen; keep the box in sight above it.
      onfocus: () => setTimeout(() => input.closest('form')?.scrollIntoView({ block: 'nearest' }), 300),
    });
    input.value = q.answer ?? q.draft ?? '';
    q.offered = true;
    const mic =
      !answered &&
      !app.progress.settings.quiet &&
      canSpeak &&
      !speakSkipped &&
      hearMeaning() !== null &&
      micButton(q);
    const status = listening
      ? 'Listening… say what it means.'
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

/** Bars in the box while a meaning is said, sharing its width: four seconds at about twelve levels a second. */
const WAVE_BARS = 48;

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

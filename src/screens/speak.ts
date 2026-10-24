// The Speak question: record the learner saying a card, recognise the sounds
// on the device, and coach them sound by sound.

import { coach, stressTip, type Tip } from '../coach';
import { holdMicrophone, microphoneAllowed } from '../microphone';
import { DownloadError, modelDownloaded, modelKnownDownloaded } from '../model-cache';
import type { Card } from '../deck';
import type { PhoneModel, Recognition } from '../phone-model';
import { compare, judge, passes, toPhones, type Comparison } from '../phonetics';
import { cardStress } from '../stress';
import { record, RecordError, recordingSupported, warmRecorder, type RecordProblem, type Recording, type Warmth } from '../recorder';
import { audioButton, h, icon } from '../ui';
import { webAudioPlayer, type Player } from '../player';
import { continueButton } from './auto-advance';
import { colouredWord, resultView as soundResults, type ResultView } from './speak-result';

/** Download size shown to the learner before they agree to it. */
const MODEL_MB = 71;
/** Below PASS, at or above this an attempt is close. */
const CLOSE = 0.65;

/** What the Speak question needs from the outside, so tests can stand in for the microphone and model. */
export interface SpeakDeps {
  recordingSupported(): boolean;
  record: typeof record;
  modelDownloaded(): Promise<boolean>;
  loadPhoneModel(onProgress?: (fraction: number) => void): Promise<PhoneModel>;
  /** Plays back pieces of the recording, and single sounds made in code. */
  player(): Player;
  /** Whether the model was on the device when last checked, for a screen deciding as it's drawn. */
  modelKnownDownloaded?(): boolean;
  /** Whether the microphone would open without the browser asking (see askForMicrophone). A stand-in without it always would. */
  microphoneAllowed?(): boolean;
  /** Open the microphone and keep it until the screen is left; false if it was left meanwhile. */
  holdMicrophone?(): Promise<boolean>;
  /** Get the held microphone going ahead of a take, its sound thrown away until then; null if there was nothing to warm. */
  warmRecorder?(): Warmth | null;
}

export const defaultDeps: SpeakDeps = {
  recordingSupported,
  record,
  modelDownloaded,
  // Loaded on demand so the model runtime isn't part of the app's first download.
  loadPhoneModel: async (onProgress) => (await import('../phone-model')).loadPhoneModel(onProgress),
  player: () => (sharedPlayer ??= webAudioPlayer()),
  modelKnownDownloaded,
  microphoneAllowed,
  holdMicrophone,
  warmRecorder,
};
let sharedPlayer: Player | null = null;

type Problem = RecordProblem | 'download' | 'start' | 'failed';

/** What went wrong, in words; the recording ones are used by Drills' spoken meanings too. */
export const PROBLEMS: Record<Problem, string> = {
  unsupported: "This browser can't record from the microphone, so speaking questions are off here.",
  denied: 'The microphone is blocked. Allow it for this site in your browser settings, then try again.',
  'no-mic': "Couldn't use the microphone. Check that the device has one and no other app is using it.",
  silent: "The microphone didn't pick up any sound, not even the room. Try again, and if it keeps happening, close the app and open it again.",
  download: "Couldn't download the pronunciation model. Check your connection and try again.",
  start: "Couldn't start the pronunciation model. Try again, or close the app and open it again.",
  failed: 'Something went wrong while checking your pronunciation. Try again.',
};

/** Not "Downloading" until bytes arrive: a model kept on the device loads without any. */
const loadingText = (progress: number | null) =>
  progress === null || progress >= 1 ? 'Getting ready…' : `Downloading… ${Math.round(progress * 100)}%`;

type State =
  | { name: 'checking' }
  | { name: 'offer' }
  /** progress is null until a download reports any: loading a model kept on the device reports none. */
  | { name: 'loading'; progress: number | null }
  | { name: 'ready' }
  /** live once the microphone gives sound (onListening): before that, anything said would be lost. */
  | { name: 'recording'; live: boolean; speech: boolean }
  | { name: 'analysing' }
  | {
      name: 'result';
      text: string;
      comparison: Comparison;
      tips: Tip[];
      /** Which syllable to lean on, when the attempt clearly leaned on the other. */
      stress?: string | null;
      heard: string[];
      recognition?: Recognition;
      samples?: Float32Array;
    }
  /** detail is what went wrong in the browser's words, shown small so a failure seen only on one phone can be told apart. */
  | { name: 'problem'; problem: Problem; detail?: string };

export interface SpeakOptions {
  /** Play the card's audio (slowly if asked). */
  say(slow?: boolean): void;
  /** Stop any audio that's playing. */
  silence(): void;
  /** Called after each judged attempt; `right` is true for a good one. */
  onAttempt(right: boolean): void;
  /** Whether the screen is counting down to the next word after a right attempt. */
  counting?(): boolean;
  onNext(): void;
  /** Called once the model is loaded and the learner can speak. */
  onReady?(): void;
  /** False when the question came up by itself: nothing takes focus until the learner acts, so a late Enter can't start a recording. */
  autofocus?: boolean;
  deps?: SpeakDeps;
}

export interface SpeakPanel {
  el: HTMLElement;
  /**
   * Whether the card's audio may play: only once an attempt has been judged, as the
   * question is whether the learner remembers how it sounds, not whether they can
   * repeat it; and not while the microphone is open.
   */
  mayPlay(): boolean;
  /** Whether the microphone may be warmed ahead of a take: not with the mic off. */
  setWarm(allowed: boolean): void;
  dispose(): void;
}

/** Whether the browser would ask the learner before the microphone opens. */
export function needsMicrophone(deps: SpeakDeps): boolean {
  return !(deps.microphoneAllowed?.() ?? true);
}

/**
 * Open the microphone and hold it until the screen is left. Called from the tap that starts a round that may ask the
 * learner to speak, so the phone asks then, over micWaiting(), rather than over a speaking question. 'refused' if
 * it was refused or there's no microphone (the round then leaves speaking out), 'left' if the screen went meanwhile.
 */
export async function askForMicrophone(deps: SpeakDeps): Promise<'on' | 'refused' | 'left'> {
  try {
    return (await (deps.holdMicrophone?.() ?? true)) ? 'on' : 'left';
  } catch {
    return 'refused';
  }
}

/** What shows while the phone asks for the microphone. `dictation`: a meaning said into Drills' box goes to OpenAI. */
export function micWaiting(dictation = false): HTMLElement {
  return h(
    'div',
    { class: 'panel center mic-waiting', role: 'status' },
    h('p', { class: 'eyebrow' }, 'Speaking'),
    h('h2', null, 'Allow the microphone'),
    h(
      'p',
      null,
      'Some questions ask you to say a word out loud, so your phone asks now rather than in the middle of one. Those are checked on this phone.',
      dictation ? ' A meaning you say into the answer box goes to OpenAI to be written out.' : null,
    ),
  );
}

/** True when the attempt was good enough to count as right. */
export const isRight = passes;

/** What an attempt at the card is judged against: its spelling and any other accepted pronunciations (Kamusta for Kumusta). */
export const targets = (card: Card): string[] => [card.tl, ...(card.accept ?? [])];

export function speakPanel(card: Card, options: SpeakOptions): SpeakPanel {
  const deps = options.deps ?? defaultDeps;
  const el = h('div', { class: 'speak' });
  let state: State = { name: 'checking' };
  let model: PhoneModel | null = null;
  let recording: Recording | null = null;
  let disposed = false;
  /** Bumped for each attempt, so a stale attempt's result is ignored. */
  let attempt = 0;
  /** Set once an attempt has been judged, after which the card's audio can play. */
  let judged = false;
  /** Whether a redraw may move focus to its main button. */
  let takeFocus = options.autofocus ?? true;
  const texts = targets(card);

  /**
   * The microphone warmed for this question. It's warmed from the tap that brought the question up (or, once
   * the model is ready, as it can be without one) and while ready to listen, so a take starts with sound already
   * flowing; anything else (a result, a problem, the question going) lets it go.
   */
  let warmth: Warmth | null = null;
  let mayWarm = true;
  /** Again if the last one ended by itself (timed out, or the app went into the background). */
  const warmUp = () => {
    if (warmth?.warm || disposed || !mayWarm) return;
    warmth = deps.warmRecorder?.() ?? null;
  };
  const coolDown = () => {
    warmth?.cool();
    warmth = null;
  };

  const set = (next: State) => {
    if (disposed) return;
    state = next;
    if (next.name === 'ready') warmUp();
    else if (next.name !== 'checking' && next.name !== 'loading' && next.name !== 'recording') coolDown();
    draw();
  };

  async function prepare(): Promise<void> {
    if (!deps.recordingSupported()) return set({ name: 'problem', problem: 'unsupported' });
    let downloaded = false;
    try {
      downloaded = await deps.modelDownloaded();
    } catch {
      // The model code itself couldn't load (offline, or an old page after an update): offer the download, which retries it.
    }
    if (downloaded) return load();
    set({ name: 'offer' });
  }

  /** `progress` is 0 when the learner asked for the download, and null when the model should already be on the device. */
  async function load(progress: number | null = null): Promise<void> {
    set({ name: 'loading', progress });
    try {
      model = await deps.loadPhoneModel((progress) => {
        if (state.name !== 'loading') return;
        if (state.progress === null) return set({ name: 'loading', progress });
        state = { name: 'loading', progress };
        updateProgress();
      });
      // So the next round knows, as it's drawn, that it may ask to speak (modelKnownDownloaded).
      void deps.modelDownloaded().catch(() => {});
      set({ name: 'ready' });
      options.onReady?.();
    } catch (err) {
      // A failed fetch, or anything while offline (the runtime's own files can't load either), is the connection's fault;
      // running out of memory, or an old page whose code has gone after an update, isn't.
      const offline = err instanceof DownloadError || !navigator.onLine;
      set({ name: 'problem', problem: offline ? 'download' : 'start', detail: err instanceof Error ? err.message : String(err) });
    }
  }

  async function startRecording(): Promise<void> {
    if (!model) return void load();
    takeFocus = true;
    options.silence();
    const mine = ++attempt;
    const stale = () => disposed || attempt !== mine;
    set({ name: 'recording', live: false, speech: false });
    const current = deps.record({
      onLevel: (level) => recording === current && showLevel(level),
      onListening: () => {
        if (recording !== current || state.name !== 'recording' || state.live) return;
        // "Wait…" couldn't hold focus, so it went nowhere: give it to "I'm done", unless the learner moved it to Cancel,
        // where it stays (the redraw makes a new Cancel).
        const cancelling = document.activeElement === el.querySelector('.speak-cancel button');
        takeFocus = !cancelling;
        set({ name: 'recording', live: true, speech: false });
        if (cancelling) el.querySelector<HTMLElement>('.speak-cancel button')?.focus({ preventScroll: true });
      },
      onSpeech: () => {
        if (recording !== current || state.name !== 'recording') return;
        // Speech is sound too, should it come first.
        if (!state.live) return set({ name: 'recording', live: true, speech: true });
        state = { name: 'recording', live: true, speech: true };
        el.querySelector('.listen-status')!.textContent = 'Hearing you…';
        el.classList.replace('phase-mic-on', 'phase-sound');
      },
      onRestart: () => {
        if (recording !== current || state.name !== 'recording' || state.live) return;
        el.querySelector('.listen-status')!.textContent = 'Still getting the mic ready…';
      },
    });
    // The take has adopted the warmed microphone, so this only forgets it.
    coolDown();
    recording = current;
    try {
      const take = await current.audio;
      if (stale()) return;
      recording = null;
      if (!take.speech) {
        return set({ name: 'result', text: card.tl, comparison: compare(toPhones(card.tl), []), tips: [], heard: [] });
      }
      set({ name: 'analysing' });
      const recognition = await model.recognise(take.samples);
      if (stale()) return;
      const { sounds } = recognition;
      const { text, comparison } = judge(texts, recognition);
      // Nothing recognised isn't an attempt at the word, so it doesn't give the word away.
      if (sounds.length > 0) judged = true;
      options.onAttempt(isRight(comparison));
      const stress = stressTip(cardStress(card, text, comparison, recognition.prosody));
      set({ name: 'result', text, comparison, tips: coach(text, comparison), stress, heard: sounds, recognition, samples: take.samples });
    } catch (err) {
      if (stale()) return;
      recording = null;
      set({ name: 'problem', problem: err instanceof RecordError ? err.problem : 'failed' });
    }
  }

  /** Throw the take away and go back to ready, so the learner can start again without it counting as an attempt. */
  function cancelRecording(): void {
    if (state.name !== 'recording') return;
    takeFocus = true;
    // Makes the take stale, so whatever it resolves to is ignored.
    attempt++;
    const current = recording;
    recording = null;
    current?.cancel();
    set({ name: 'ready' });
  }

  function updateProgress(): void {
    if (state.name !== 'loading' || state.progress === null) return;
    const pct = Math.round(state.progress * 100);
    const fill = el.querySelector<HTMLElement>('.bar-fill');
    if (fill) fill.style.width = `${pct}%`;
    const label = el.querySelector('.listen-status');
    if (label) label.textContent = loadingText(state.progress);
  }

  /** Bars follow the real input level, each a little different so it reads as a meter. */
  function showLevel(level: number): void {
    const shape = [0.55, 0.85, 1, 0.75, 0.5];
    el.querySelectorAll<HTMLElement>('.meter span').forEach((bar, i) => {
      bar.style.height = `${Math.round(12 + Math.min(1, level * shape[i]) * 44)}px`;
    });
  }

  // The sounds-like spelling gives the pronunciation away too, so it waits for a first attempt like the audio.
  const hint = () => judged && card.hint && h('p', { class: 'hint' }, h('span', { class: 'muted' }, 'Say it: '), card.hint);
  const micButton = (label: string, className: string) =>
    h('button', { class: className, 'data-autofocus': true, 'data-no-tap': true, onclick: () => void startRecording() }, icon('mic'), ' ', label);
  const skip = (label = 'Skip') => h('button', { class: 'btn secondary', onclick: options.onNext }, label);

  /**
   * Below the big button while listening: throw the take away and start again. It keeps its room while ready and
   * checking, hidden, so the big button doesn't move.
   */
  const cancel = () =>
    h('div', { class: 'row speak-cancel' }, h('button', { class: 'btn secondary', disabled: state.name !== 'recording', onclick: cancelRecording }, 'Cancel'));

  function listening(status: string, button: HTMLElement): HTMLElement[] {
    return [
      h(
        'div',
        { class: 'speak-cue' },
        hint(),
        h('div', { class: 'meter', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5].map(() => h('span', null))),
        h('p', { class: 'listen-status center', role: 'status' }, status),
      ),
      button,
      cancel(),
    ];
  }

  function view(): HTMLElement[] {
    switch (state.name) {
      case 'checking':
        return [h('p', { class: 'listen-status center' }, 'Getting ready…')];
      case 'offer':
        return [
          h(
            'div',
            { class: 'feedback' },
            h('strong', null, 'Pronunciation coaching'),
            h(
              'p',
              { class: 'small' },
              `It listens to each sound you make and tells you which ones to work on. It runs on this device, so your voice stays here. It needs a one-time download of about ${MODEL_MB} MB, then works offline.`,
            ),
          ),
          h(
            'div',
            { class: 'row' },
            skip('Not now'),
            h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => {
                takeFocus = true;
                void load(0);
              } }, 'Download'),
          ),
        ];
      case 'loading':
        if (state.progress === null) return [h('p', { class: 'listen-status center', role: 'status' }, loadingText(null))];
        return [
          h('div', { class: 'bar download-bar', role: 'progressbar', 'aria-label': 'Download progress' }, h('div', { class: 'bar-fill', style: { width: `${Math.round(state.progress * 100)}%` } })),
          h('p', { class: 'listen-status center', role: 'status' }, loadingText(state.progress)),
        ];
      // Ready, listening and checking share one layout: one big button in the middle of the space below the prompt,
      // where a thumb rests, to start and then stop in the same place, with what the microphone hears above it
      // (see .speak.listening in style.css). The meter and status keep their room while ready, so nothing moves.
      case 'ready':
        return listening('', micButton('Tap and speak', 'btn mic huge'));
      // Until the microphone gives sound, the big button waits (it would only stop an empty take) and the status
      // says so; once it does, the prompt card turns magenta and the button saffron, so it's plain the take has begun.
      case 'recording':
        if (!state.live) return listening('Getting the mic ready…', h('button', { class: 'btn mic huge done', disabled: true }, 'Wait…'));
        return listening(
          state.speech ? 'Hearing you…' : 'Listening. Say it now!',
          h('button', { class: 'btn mic huge done', 'data-autofocus': true, 'data-no-tap': true, onclick: () => recording?.stop() }, "I'm done"),
        );
      case 'analysing':
        return listening('Checking your sounds…', h('button', { class: 'btn mic huge done', disabled: true }, "I'm done"));
      case 'problem':
        return [
          h(
            'div',
            { class: 'feedback bad', role: 'status' },
            h('strong', null, 'Hmm.'),
            ' ',
            PROBLEMS[state.problem],
            state.detail && h('p', { class: 'small muted problem-detail' }, state.detail),
          ),
          h(
            'div',
            { class: 'row' },
            skip(),
            state.problem !== 'unsupported' &&
              h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => {
                takeFocus = true;
                void (model ? startRecording() : load());
              } }, 'Try again'),
          ),
        ];
      case 'result':
        return resultView(state);
    }
  }

  /** The sound-by-sound breakdown currently on screen, so it can stop its audio when replaced. */
  let breakdown: ResultView | null = null;

  function resultView(result: Extract<State, { name: 'result' }>): HTMLElement[] {
    const { text, comparison, tips, stress, heard, recognition, samples } = result;
    const right = isRight(comparison);
    const pct = Math.round(comparison.score * 100);
    const title = heard.length === 0 ? "Didn't catch that." : right ? 'Tama!' : comparison.score >= CLOSE ? 'Close.' : "Let's work on it.";
    const detail =
      heard.length === 0
        ? 'Speak a little louder or closer to the phone.'
        : right
          ? comparison.sounds.every((s) => s.verdict === 'good')
            ? 'Every sound came through clearly.'
            : 'Easy to understand. The coloured letters could be sharper.'
          : 'Letters in pink need work; yellow ones were nearly there.';
    breakdown =
      heard.length > 0 && recognition && samples
        ? soundResults({ text, comparison, tips, heard, timing: recognition.timing, features: recognition.features, samples }, { player: deps.player() })
        : null;
    if (breakdown) {
      // The breakdown takes the card's place: the word, coloured by how each sound came
      // out. Each sound's tip is in the breakdown. The whole word to play back sits at
      // the bottom with the way on, under the thumb.
      const whole = breakdown;
      return [
        h(
          'div',
          { class: `feedback result-card ${right ? 'good' : 'bad'}`, role: 'status' },
          h('div', { class: 'feedback-head' }, h('div', null, h('p', { class: 'eyebrow' }, h('strong', null, title), ' ', h('span', { class: 'result-meaning' }, card.en)), breakdown.word), dial(comparison.score, `${pct}% of the way there`)),
          stress && h('p', { class: 'stress-tip' }, stress),
        ),
        breakdown.el,
        h(
          'div',
          { class: 'word-actions' },
          h('span', { class: 'word-actions-label' }, 'Whole word'),
          h('button', { class: 'btn secondary small', onclick: () => whole.playWhole() }, '▶ Yours'),
          h('button', { class: 'btn secondary small', onclick: () => options.say() }, '▶ Target'),
          audioButton(() => options.say(true), 'Target, slowly', 'slow small'),
        ),
        actions(right),
      ];
    }
    const lettersEl = heard.length > 0 && colouredWord(text, comparison).el;
    return [
      h(
        'div',
        { class: `feedback ${right ? 'good' : 'bad'}`, role: 'status' },
        h('div', { class: 'feedback-head' }, h('div', null, h('strong', null, title), ' ', detail), heard.length > 0 && dial(comparison.score, `${pct}% of the way there`)),
        lettersEl,
        (tips.length > 0 || stress) &&
          h('ul', { class: 'tips' }, [...tips.map((t) => h('li', null, h('strong', { lang: 'fil' }, t.letters), ': ', t.text)), stress && h('li', { class: 'stress-tip' }, stress)]),
      ),
      judged && h('div', { class: 'row hear-slowly' }, h('button', { class: 'btn secondary', onclick: () => options.say(true) }, 'Hear it slowly')),
      actions(right),
    ].filter(Boolean) as HTMLElement[];
  }

  function actions(right: boolean): HTMLElement {
    return h(
      'div',
      { class: 'row result-actions' },
      right
        ? continueButton(options.onNext, options.counting?.() ?? false, 'Next', false)
        : [h('button', { class: 'btn secondary', onclick: options.onNext }, 'Next word'), micButton('Try again', 'btn mic')],
    );
  }

  /** A ring that fills with how close the attempt was. */
  function dial(score: number, label: string): HTMLElement {
    const r = 26;
    const c = 2 * Math.PI * r;
    const el = h('div', { class: 'dial', role: 'img', 'aria-label': label });
    el.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="dial-track" cx="32" cy="32" r="${r}"/><circle class="dial-fill" cx="32" cy="32" r="${r}" stroke-dasharray="${c * score} ${c}" transform="rotate(-90 32 32)"/></svg>`;
    const pct = Math.round(score * 100);
    // "100%" is too wide for the middle of the ring, so a score that rounds to it shows a check instead.
    el.append(pct === 100 ? h('span', null, icon('check')) : h('span', null, `${pct}`, h('small', null, '%')));
    return el;
  }

  function draw(): void {
    breakdown?.dispose();
    breakdown = null;
    const phase = state.name === 'recording' ? (state.speech ? 'phase-sound' : state.live ? 'phase-mic-on' : 'phase-starting') : '';
    const children = view();
    // With a breakdown on screen, the card above gives way to it (see .result-card).
    const listens = state.name === 'ready' || state.name === 'recording' || state.name === 'analysing';
    const live = state.name === 'recording' && state.live;
    el.className = `speak ${state.name} ${phase}${listens ? ' listening' : ''}${live ? ' live' : ''}${breakdown ? ' has-breakdown' : ''}`.trim();
    el.replaceChildren(...children);
    if (takeFocus) el.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }

  draw();
  // Inside the tap that brought the question up, if one did: a model already on the device means a take is coming.
  if (deps.modelKnownDownloaded?.()) warmUp();
  void prepare();

  return {
    el,
    mayPlay: () => judged && state.name !== 'recording',
    setWarm: (allowed) => {
      mayWarm = allowed;
      if (!allowed) coolDown();
      else if (state.name === 'ready') warmUp();
    },
    dispose: () => {
      disposed = true;
      coolDown();
      recording?.cancel();
      breakdown?.dispose();
    },
  };
}

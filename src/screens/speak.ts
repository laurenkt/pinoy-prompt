// The Speak question: record the learner saying a card, recognise the sounds
// on the device, and coach them sound by sound.

import { coach, type Tip } from '../coach';
import type { Card } from '../deck';
import type { PhoneModel, Recognition } from '../phone-model';
import { compare, toPhones, type Comparison, type SoundVerdict } from '../phonetics';
import { record, RecordError, recordingSupported, type RecordProblem, type Recording } from '../recorder';
import { audioButton, h, icon } from '../ui';
import { webAudioPlayer, type Player } from '../player';
import { continueButton } from './auto-advance';
import { resultView as soundResults, type ResultView } from './speak-result';

/** Download size shown to the learner before they agree to it. */
const MODEL_MB = 71;
/**
 * At or above this score the attempt counts as right: clearly understood and
 * fairly natural, not native-perfect. A sound said well scores 1 and a nearly
 * there one half, so a phrase can pass with about one sound in ten off (from
 * 10 sounds one, from 20 two: in context a listener still gets it), and any word with one sound in five
 * nearly there. A short word with a sound off, which can turn it into another
 * word, still needs another go.
 */
export const GOOD = 0.9;
const CLOSE = 0.65;

/** What the Speak question needs from the outside, so tests can stand in for the microphone and model. */
export interface SpeakDeps {
  recordingSupported(): boolean;
  record: typeof record;
  modelDownloaded(): Promise<boolean>;
  loadPhoneModel(onProgress?: (fraction: number) => void): Promise<PhoneModel>;
  /** Plays back pieces of the recording and reference sounds. */
  player(): Player;
}

export const defaultDeps: SpeakDeps = {
  recordingSupported,
  record,
  // Loaded on demand so the model runtime isn't part of the app's first download.
  modelDownloaded: async () => (await import('../model-cache')).modelDownloaded(),
  loadPhoneModel: async (onProgress) => (await import('../phone-model')).loadPhoneModel(onProgress),
  player: () => (sharedPlayer ??= webAudioPlayer()),
};
let sharedPlayer: Player | null = null;

type Problem = RecordProblem | 'download' | 'failed';

const PROBLEMS: Record<Problem, string> = {
  unsupported: "This browser can't record from the microphone, so speaking questions are off here.",
  denied: 'The microphone is blocked. Allow it for this site in your browser settings, then try again.',
  'no-mic': "Couldn't use the microphone. Check that the device has one and no other app is using it.",
  download: "Couldn't download the pronunciation model. Check your connection and try again.",
  failed: 'Something went wrong while checking your pronunciation. Try again.',
};

type State =
  | { name: 'checking' }
  | { name: 'offer' }
  | { name: 'loading'; progress: number }
  | { name: 'ready' }
  | { name: 'recording'; speech: boolean }
  | { name: 'analysing' }
  | { name: 'result'; text: string; comparison: Comparison; tips: Tip[]; heard: string[]; recognition?: Recognition; samples?: Float32Array }
  | { name: 'problem'; problem: Problem };

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
  /** Whether the microphone is open (the card's audio shouldn't play then). */
  recording(): boolean;
  dispose(): void;
}

/** How each sound verdict ranks when several sounds share letters: the worst one shows. */
const RANK: Record<SoundVerdict, number> = { good: 0, close: 1, off: 2, missing: 2 };

/** The card's text split into runs of letters, each marked with how it was said. */
export function markLetters(text: string, comparison: Comparison): { text: string; verdict: SoundVerdict | null }[] {
  const marks: (SoundVerdict | null)[] = Array.from(text, () => null);
  for (const s of comparison.sounds) {
    if (s.phone.optional) continue;
    for (let i = s.phone.from; i < s.phone.to; i++) {
      const current = marks[i];
      if (current === null || RANK[s.verdict] > RANK[current]) marks[i] = s.verdict;
    }
  }
  const runs: { text: string; verdict: SoundVerdict | null }[] = [];
  Array.from(text).forEach((ch, i) => {
    const last = runs[runs.length - 1];
    if (last && last.verdict === marks[i]) last.text += ch;
    else runs.push({ text: ch, verdict: marks[i] });
  });
  return runs;
}

/** True when the attempt was good enough to count as right. */
export function isRight(comparison: Comparison): boolean {
  return comparison.score >= GOOD;
}

export function speakPanel(card: Card, options: SpeakOptions): SpeakPanel {
  const deps = options.deps ?? defaultDeps;
  const el = h('div', { class: 'speak' });
  let state: State = { name: 'checking' };
  let model: PhoneModel | null = null;
  let recording: Recording | null = null;
  let disposed = false;
  /** Bumped for each attempt, so a stale attempt's result is ignored. */
  let attempt = 0;
  /** Whether a redraw may move focus to its main button. */
  let takeFocus = options.autofocus ?? true;
  // The card's spelling and any other accepted pronunciations (e.g. Kamusta for Kumusta).
  const variants = [card.tl, ...(card.accept ?? [])].map((text) => ({ text, phones: toPhones(text) }));
  /** Judge what was heard against the closest accepted pronunciation. */
  const judge = (heard: string[]) =>
    variants
      .map((v) => ({ text: v.text, comparison: compare(v.phones, heard) }))
      .reduce((best, next) => (next.comparison.score > best.comparison.score ? next : best));

  const set = (next: State) => {
    if (disposed) return;
    state = next;
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

  async function load(): Promise<void> {
    set({ name: 'loading', progress: 0 });
    try {
      model = await deps.loadPhoneModel((progress) => {
        if (state.name !== 'loading') return;
        state = { name: 'loading', progress };
        updateProgress();
      });
      set({ name: 'ready' });
      options.onReady?.();
    } catch {
      set({ name: 'problem', problem: 'download' });
    }
  }

  async function startRecording(): Promise<void> {
    if (!model) return void load();
    takeFocus = true;
    options.silence();
    const mine = ++attempt;
    const stale = () => disposed || attempt !== mine;
    set({ name: 'recording', speech: false });
    const current = deps.record({
      onLevel: (level) => recording === current && showLevel(level),
      onSpeech: () => {
        if (recording !== current || state.name !== 'recording') return;
        state = { name: 'recording', speech: true };
        el.querySelector('.listen-status')!.textContent = 'Hearing you…';
        el.classList.replace('phase-mic-on', 'phase-sound');
      },
    });
    recording = current;
    try {
      const take = await current.audio;
      if (stale()) return;
      recording = null;
      if (!take.speech) {
        return set({ name: 'result', text: card.tl, comparison: compare(variants[0].phones, []), tips: [], heard: [] });
      }
      set({ name: 'analysing' });
      const recognition = await model.recognise(take.samples);
      if (stale()) return;
      const { sounds } = recognition;
      const { text, comparison } = judge(sounds);
      options.onAttempt(isRight(comparison));
      set({ name: 'result', text, comparison, tips: coach(text, comparison), heard: sounds, recognition, samples: take.samples });
    } catch (err) {
      if (stale()) return;
      recording = null;
      set({ name: 'problem', problem: err instanceof RecordError ? err.problem : 'failed' });
    }
  }

  function updateProgress(): void {
    if (state.name !== 'loading') return;
    const pct = Math.round(state.progress * 100);
    const fill = el.querySelector<HTMLElement>('.bar-fill');
    if (fill) fill.style.width = `${pct}%`;
    const label = el.querySelector('.listen-status');
    if (label) label.textContent = state.progress >= 1 ? 'Getting ready…' : `Downloading… ${pct}%`;
  }

  /** Bars follow the real input level, each a little different so it reads as a meter. */
  function showLevel(level: number): void {
    const shape = [0.55, 0.85, 1, 0.75, 0.5];
    el.querySelectorAll<HTMLElement>('.meter span').forEach((bar, i) => {
      bar.style.height = `${Math.round(12 + Math.min(1, level * shape[i]) * 44)}px`;
    });
  }

  const hint = () => card.hint && h('p', { class: 'hint' }, h('span', { class: 'muted' }, 'Say it: '), card.hint);
  const micButton = (label: string, className = 'btn mic big') =>
    h('button', { class: className, 'data-autofocus': true, onclick: () => void startRecording() }, icon('mic'), ' ', label);
  const skip = (label = 'Skip') => h('button', { class: 'btn secondary', onclick: options.onNext }, label);

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
                void load();
              } }, 'Download'),
          ),
        ];
      case 'loading':
        return [
          h('div', { class: 'bar download-bar', role: 'progressbar', 'aria-label': 'Download progress' }, h('div', { class: 'bar-fill', style: { width: `${Math.round(state.progress * 100)}%` } })),
          h('p', { class: 'listen-status center', role: 'status' }, state.progress >= 1 ? 'Getting ready…' : `Downloading… ${Math.round(state.progress * 100)}%`),
        ];
      case 'ready':
        return [hint(), micButton('Tap and speak')].filter(Boolean) as HTMLElement[];
      case 'recording':
        return [
          hint(),
          h('div', { class: 'meter', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5].map(() => h('span', null))),
          h('p', { class: 'listen-status center', role: 'status' }, state.speech ? 'Hearing you…' : 'Mic on. Say it now.'),
          h('button', { class: 'btn mic big done', 'data-autofocus': true, onclick: () => recording?.stop() }, "I'm done"),
        ].filter(Boolean) as HTMLElement[];
      case 'analysing':
        return [h('p', { class: 'listen-status center', role: 'status' }, 'Checking your sounds…')];
      case 'problem':
        return [
          h('div', { class: 'feedback bad', role: 'status' }, h('strong', null, 'Hmm.'), ' ', PROBLEMS[state.problem]),
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
    const { text, comparison, tips, heard, recognition, samples } = result;
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
    const lettersEl = heard.length > 0 && h('p', { class: `letters${text.length > 16 ? ' long' : ''}`, lang: 'fil' }, markLetters(text, comparison).map((run) => h('span', { class: run.verdict ? `sound-${run.verdict}` : '' }, run.text)));
    if (breakdown) {
      // The breakdown takes the card's place: the word, coloured by how each sound came
      // out, with the whole word to play back. Each sound's tip is in the breakdown.
      const whole = breakdown;
      return [
        h(
          'div',
          { class: `feedback result-card ${right ? 'good' : 'bad'}`, role: 'status' },
          h('div', { class: 'feedback-head' }, h('div', null, h('p', { class: 'eyebrow' }, h('strong', null, title), ' ', h('span', { class: 'result-meaning' }, card.en)), lettersEl), dial(comparison.score, `${pct}% of the way there`)),
          h(
            'div',
            { class: 'word-actions' },
            h('span', { class: 'word-actions-label' }, 'Whole word'),
            h('button', { class: 'btn secondary small', onclick: () => whole.playWhole() }, '▶ Yours'),
            h('button', { class: 'btn secondary small', onclick: () => options.say() }, '▶ Target'),
            audioButton(() => options.say(true), 'Target, slowly', 'slow small'),
          ),
        ),
        breakdown.el,
        actions(right),
      ];
    }
    return [
      h(
        'div',
        { class: `feedback ${right ? 'good' : 'bad'}`, role: 'status' },
        h('div', { class: 'feedback-head' }, h('div', null, h('strong', null, title), ' ', detail), heard.length > 0 && dial(comparison.score, `${pct}% of the way there`)),
        lettersEl,
        tips.length > 0 && h('ul', { class: 'tips' }, tips.map((t) => h('li', null, h('strong', { lang: 'fil' }, t.letters), ': ', t.text))),
      ),
      h('div', { class: 'row' }, h('button', { class: 'btn secondary', onclick: () => options.say(true) }, 'Hear it slowly')),
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
    el.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="dial-track" cx="32" cy="32" r="${r}"/><circle class="dial-fill" cx="32" cy="32" r="${r}" stroke-dasharray="${c * score} ${c}" transform="rotate(-90 32 32)"/></svg><span>${Math.round(score * 100)}<small>%</small></span>`;
    return el;
  }

  function draw(): void {
    breakdown?.dispose();
    breakdown = null;
    const phase = state.name === 'recording' ? (state.speech ? 'phase-sound' : 'phase-mic-on') : '';
    const children = view();
    // With a breakdown on screen, the card above gives way to it (see .result-card).
    el.className = `speak ${state.name} ${phase}${breakdown ? ' has-breakdown' : ''}`.trim();
    el.replaceChildren(...children);
    if (takeFocus) el.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }

  draw();
  void prepare();

  return {
    el,
    recording: () => state.name === 'recording',
    dispose: () => {
      disposed = true;
      recording?.cancel();
      breakdown?.dispose();
    },
  };
}

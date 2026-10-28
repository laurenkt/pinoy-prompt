import type { App } from '../app';
import { askOpenAi, browserCallDeps, callSupported, getApiKey, CENTS_PER_MINUTE, type CallDeps } from '../openai';
import type { MeaningJudge } from '../meaning';
import { canDrill, DRILL_MIN_WORDS } from '../session';
import { spokenMeaning, WALK_WAYS, walkRound, type WalkEngine, type WalkOutcome, type WalkQuestion, type WalkRound } from '../walk';
import { h, iconButton } from '../ui';
import { defaultDeps, type SpeakDeps } from './speak';
import { keyForm } from './settings';
import { startClipsWalk } from './walk-clips';
import { startLiveWalk } from './walk-live';

/** What a walk and talk engine tells the screen as it goes, so someone glancing at the phone can see where it is. */
export interface WalkView {
  /** What's happening now: "Listening…", "Checking…". */
  status(text: string): void;
  /** A question is being asked. */
  asked(q: WalkQuestion): void;
  /** How the answer to it went, whether noting it changed progress (to be saved), and what was heard, if it's known. */
  answered(q: WalkQuestion, outcome: WalkOutcome, changed: boolean, heard?: string): void;
  /** It stopped by itself; why, if it broke. */
  ended(problem?: string): void;
}

/** An engine running a round, until it's stopped or stops itself. */
export interface WalkRun {
  stop(): void;
}

export interface WalkDeps {
  speak: SpeakDeps;
  call: CallDeps;
  callSupported(): boolean;
  /** Judges a spoken answer the device can't match, with OpenAI (see judgeMeaning); null without a key. */
  askMeaning: MeaningJudge | null;
}

export const defaultWalkDeps: WalkDeps = { speak: defaultDeps, call: browserCallDeps, callSupported, askMeaning: askOpenAi };

const ENGINES: Record<WalkEngine, { title: string; about: string; start: (round: WalkRound, view: WalkView, deps: WalkDeps) => WalkRun }> = {
  clips: {
    title: 'Walk and talk',
    about:
      "You hear an English word or phrase and say it in Tagalog. Your answer is checked on this phone, then you hear it said by a recorded voice. Say \"skip\" to move on, or \"I don't know\" (or \"hindi ko alam\") to hear the answer.",
    start: (round, view, deps) => startClipsWalk(round, view, deps.speak),
  },
  live: {
    title: 'Walk and talk live',
    about: `An AI voice asks you words, in Tagalog or English, and you answer out loud. The app checks each answer and tells the voice how it went. Say "skip" to move on, or "I don't know" to hear the answer. About ${CENTS_PER_MINUTE}¢ a minute on your OpenAI key.`,
    start: startLiveWalk,
  },
};

let active: WalkRun | null = null;
/** Keeps the screen on while a round runs: a phone that locks cuts off the microphone. */
let wakeLock: { release(): Promise<void> } | null = null;

type WakeLocks = { request(type: 'screen'): Promise<{ release(): Promise<void> }> };

/** Keep the screen on for the round running now; the phone drops the lock when the app is hidden, so it's asked again on return. */
function keepAwake(): void {
  const run = active;
  void (navigator as { wakeLock?: WakeLocks }).wakeLock
    ?.request('screen')
    .then((lock) => {
      if (active === run && run) {
        void wakeLock?.release().catch(() => {});
        wakeLock = lock;
      } else void lock.release().catch(() => {});
    })
    .catch(() => {});
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && active) keepAwake();
  });
}

/** Stop a round that's going. Leaving the screen by any route comes here through `app.navigate`. */
export function endWalk(): void {
  active?.stop();
  active = null;
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
}

type State = { name: 'ready' } | { name: 'running' } | { name: 'stopped'; problem?: string };

/** One question and how it went, for a glance at the phone. */
interface Shown {
  q: WalkQuestion;
  outcome?: WalkOutcome;
  heard?: string;
}

/**
 * Walk and talk: a drill round to do with headphones in and the phone in a pocket (see walk.ts). A session: its close
 * button ends the round and goes Home. Experimental, opened from Settings.
 */
export function walkScreen(app: App, engine: WalkEngine, deps: WalkDeps = defaultWalkDeps): HTMLElement {
  const root = h('div', { class: 'walk fill' });
  const about = ENGINES[engine];
  let state: State = { name: 'ready' };
  let status = '';
  let shown: Shown | null = null;
  let round: WalkRound | null = null;

  const home = () => app.navigate({ name: 'home' });

  /** Why a round can't start here, if it can't. */
  function blocked(): string | null {
    const { settings } = app.progress;
    if (!canDrill(app.progress)) return `Learn at least ${DRILL_MIN_WORDS} words first, then come back to drill them out loud.`;
    if (!settings.sound || !settings.mic) return 'Walk and talk needs the sound and the mic on. Turn them on from Home.';
    if (!deps.speak.recordingSupported()) return "This browser can't use the microphone.";
    if (engine === 'live' && !deps.callSupported()) return "This browser can't use the microphone for calls. Try Safari or Chrome.";
    return null;
  }

  const view: WalkView = {
    status(text) {
      status = text;
      const el = root.querySelector('.walk-status');
      if (el) el.textContent = text;
      else draw();
    },
    asked(q) {
      shown = { q };
      draw();
    },
    answered(q, outcome, changed, heard) {
      shown = { q, outcome, heard };
      if (changed) app.commit();
      draw();
    },
    ended(problem) {
      if (state.name !== 'running') return;
      endWalk();
      state = { name: 'stopped', problem };
      draw();
    },
  };

  function start(): void {
    endWalk();
    round = walkRound(app.progress, app.now, WALK_WAYS[engine]);
    shown = null;
    status = 'Starting…';
    state = { name: 'running' };
    draw();
    // Inside the tap: the engine starts its audio and microphone from here.
    active = about.start(round, view, deps);
    keepAwake();
  }

  function stop(): void {
    endWalk();
    state = { name: 'stopped' };
    draw();
  }

  function header(): HTMLElement {
    return h(
      'header',
      { class: 'session-header' },
      iconButton('close', 'End walk and talk', home),
      h('span', { class: 'session-count' }, round ? `${round.done} done` : about.title),
    );
  }

  /** The question on show, and once answered, how it went, as a drill shows them. */
  function question(s: Shown): (HTMLElement | false | undefined)[] {
    const recall = s.q.way === 'recall';
    const verdict = s.outcome && { right: 'Tama!', wrong: 'Mali.', 'dont-know': 'The answer:', skip: 'Skipped.' }[s.outcome];
    return [
      h(
        'div',
        { class: 'prompt' },
        h('p', { class: 'eyebrow' }, recall ? 'How do you say…' : 'What does it mean?'),
        recall ? h('p', { class: 'prompt-en' }, spokenMeaning(s.q.card)) : h('p', { class: 'tl', lang: 'fil' }, s.q.card.tl),
      ),
      s.outcome &&
        h(
          'div',
          { class: `feedback ${s.outcome === 'right' ? 'good' : 'bad'}`, role: 'status' },
          h('strong', null, verdict),
          s.outcome !== 'skip' && ` ${s.q.card.tl} = ${s.q.card.en}`,
          s.heard && h('p', { class: 'feedback-note' }, `Heard “${s.heard}”.`),
        ),
    ];
  }

  function draw(): void {
    const why = blocked();
    if (engine === 'live' && !getApiKey()) {
      root.replaceChildren(header(), h('section', { class: 'card' }, h('h2', null, 'Connect OpenAI'), keyForm(draw)));
      return;
    }
    let body: HTMLElement;
    if (why && state.name !== 'running') {
      body = h('section', { class: 'panel center' }, h('p', null, why));
    } else if (state.name === 'running') {
      body = h(
        'section',
        { class: 'panel' },
        ...(shown ? question(shown) : []),
        h('p', { class: 'walk-status muted', role: 'status' }, status),
        h('button', { class: 'btn secondary big', onclick: stop }, 'Stop'),
      );
    } else {
      const again = state.name === 'stopped';
      body = h(
        'section',
        { class: 'panel center' },
        h('p', { class: 'eyebrow' }, 'Experimental'),
        h('h2', null, about.title),
        h('p', null, about.about),
        h('p', { class: 'muted small' }, 'Put your headphones in. The screen stays on while it runs; locking the phone stops it.'),
        state.name === 'stopped' && state.problem && h('div', { class: 'feedback bad', role: 'alert' }, state.problem),
        h('button', { class: 'btn primary big', 'data-tap': 'before', onclick: start }, again ? 'Start again' : 'Start'),
      );
    }
    root.replaceChildren(h('div', { class: 'session' }, header(), body));
  }

  draw();
  return root;
}

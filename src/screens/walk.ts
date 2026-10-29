import type { App } from '../app';
import { askOpenAi, askTurnOpenAi, browserCallDeps, callSupported, getApiKey, CENTS_PER_MINUTE, type CallDeps, type TurnVerdict } from '../openai';
import type { AnswerLanguage, MeaningJudge } from '../meaning';
import { canDrill, DRILL_MIN_WORDS } from '../session';
import { WALK_WAYS, walkRound, type WalkOutcome, type WalkQuestion } from '../walk';
import { h, iconButton } from '../ui';
import { keyForm } from './settings';
import { startLiveWalk } from './walk-live';

/** What the round tells the screen as it goes, so someone glancing at the phone can see how it's going. */
export interface WalkView {
  /** What's happening now: "Connecting…", "Listening…", "Checking…". */
  status(text: string): void;
  /** How the answer to a question went, and whether noting it changed progress (to be saved). */
  answered(q: WalkQuestion, outcome: WalkOutcome, changed: boolean): void;
  /** It stopped by itself; why, if it broke. */
  ended(problem?: string): void;
}

/** A round running, until it's stopped or stops itself. */
export interface WalkRun {
  stop(): void;
}

export interface WalkDeps {
  call: CallDeps;
  callSupported(): boolean;
  /** Judges a spoken answer the device can't match, with OpenAI (see judgeMeaning); null without a key. */
  askMeaning: MeaningJudge | null;
  /** How the voice took what was said: whether it was an answer, and its verdict (see checkTurn); null without a key. */
  askTurn: ((turn: { tl: string; en: string; language: AnswerLanguage; asked: string; said: string; reply: string }) => Promise<TurnVerdict | null>) | null;
}

export const defaultWalkDeps: WalkDeps = { call: browserCallDeps, callSupported, askMeaning: askOpenAi, askTurn: askTurnOpenAi };

const ABOUT = `An AI voice asks you words, in Tagalog or English, and you answer out loud. Say "skip" to move on, or "I don't know" to hear the answer, and ask it anything along the way. About ${CENTS_PER_MINUTE}¢ a minute on your OpenAI key.`;

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

/** How the round has gone so far: what someone glancing at the phone sees, rather than the question. */
interface Tally {
  asked: number;
  right: number;
  /** Wrong, or not known. */
  wrong: number;
  skipped: number;
}

/**
 * Walk and talk: a drill round to do with headphones in and the phone in a pocket (see walk.ts), run by GPT-Live
 * (walk-live.ts). A session: its close button ends the round and goes Home. While it runs, the screen shows only how
 * the round is going and a big Stop. Opened from Home.
 */
export function walkScreen(app: App, deps: WalkDeps = defaultWalkDeps): HTMLElement {
  const root = h('div', { class: 'walk fill' });
  let state: State = { name: 'ready' };
  let status = '';
  let tally: Tally = { asked: 0, right: 0, wrong: 0, skipped: 0 };

  const home = () => app.navigate({ name: 'home' });

  /** Why a round can't start here, if it can't. */
  function blocked(): string | null {
    const { settings } = app.progress;
    if (!canDrill(app.progress)) return `Learn at least ${DRILL_MIN_WORDS} words first, then come back to drill them out loud.`;
    if (!settings.sound || !settings.mic) return 'Walk and talk needs the sound and the mic on. Turn them on from Home.';
    if (!deps.callSupported()) return "This browser can't use the microphone for calls. Try Safari or Chrome.";
    return null;
  }

  const view: WalkView = {
    status(text) {
      status = text;
      const el = root.querySelector('.walk-status');
      if (el) el.textContent = text;
      else draw();
    },
    answered(_q, outcome, changed) {
      tally = {
        asked: tally.asked + 1,
        right: tally.right + (outcome === 'right' ? 1 : 0),
        wrong: tally.wrong + (outcome === 'wrong' || outcome === 'dont-know' ? 1 : 0),
        skipped: tally.skipped + (outcome === 'skip' ? 1 : 0),
      };
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
    tally = { asked: 0, right: 0, wrong: 0, skipped: 0 };
    status = 'Starting…';
    state = { name: 'running' };
    draw();
    // Inside the tap: the round starts its audio and the call from here.
    active = startLiveWalk(walkRound(app.progress, app.now, WALK_WAYS), view, deps);
    keepAwake();
  }

  function stop(): void {
    endWalk();
    state = { name: 'stopped' };
    draw();
  }

  function header(): HTMLElement {
    return h('header', { class: 'session-header' }, iconButton('close', 'End walk and talk', home), h('span', { class: 'session-count' }, 'Walk and talk'));
  }

  /** The round so far, in numbers. */
  function stats(): HTMLElement {
    const stat = (value: number, label: string) => h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, String(value)), h('span', { class: 'stat-label' }, label));
    return h('div', { class: 'stats' }, stat(tally.asked, 'asked'), stat(tally.right, 'right'), stat(tally.wrong, 'wrong'), stat(tally.skipped, 'skipped'));
  }

  function draw(): void {
    const why = blocked();
    // A reason it can't start comes first, so nobody pastes a key only to learn they need more words.
    if (!getApiKey() && !why) {
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
        stats(),
        h('p', { class: 'walk-status muted', role: 'status' }, status),
        h('button', { class: 'btn primary big walk-stop', onclick: stop }, 'Stop'),
      );
    } else {
      const again = state.name === 'stopped';
      body = h(
        'section',
        { class: 'panel center' },
        h('h2', null, 'Walk and talk'),
        again && tally.asked > 0 && stats(),
        h('p', null, ABOUT),
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

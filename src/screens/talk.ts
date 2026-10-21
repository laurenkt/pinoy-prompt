import type { App } from '../app';
import { browserCallDeps, callSupported, CENTS_PER_MINUTE, errorText, getApiKey, getTalkVoice, MAX_CALL_SECONDS, startCall, type Call, type CallDeps } from '../openai';
import { play } from '../speech';
import { addPiece, findWords, talkGreeting, talkInstructions, talkPlan, talkTopics, type SpokenTurn, type TalkPlan } from '../talk';
import { h, icon } from '../ui';
import { createVisualizer, type Visualizer } from '../visualizer';
import { keyForm } from './settings';

export interface TalkDeps {
  call: CallDeps;
  callSupported(): boolean;
  visualizer(canvas: HTMLCanvasElement): Visualizer;
}

export const defaultTalkDeps: TalkDeps = { call: browserCallDeps, callSupported, visualizer: createVisualizer };

const MIN_WORDS = 4;

let activeCall: Call | null = null;
let activeVisual: Visualizer | null = null;
/** Bumped whenever a call is started or abandoned, so a call still connecting can tell it's no longer wanted. */
let generation = 0;

/** End a spoken conversation that's going or still connecting, as when leaving the screen. */
export function hangUpTalk(): void {
  generation++;
  activeCall?.hangUp();
  activeCall = null;
  activeVisual?.stop();
  activeVisual = null;
}

type State = { name: 'menu' } | { name: 'connecting' } | { name: 'call'; muted: boolean } | { name: 'ended' };

export function talkScreen(app: App, deps: TalkDeps = defaultTalkDeps): HTMLElement {
  const root = h('div', { class: 'talk' });
  let topicId: string | null = null;
  let plan: TalkPlan = talkPlan(app.progress, null);
  let turns: SpokenTurn[] = [];
  let state: State = { name: 'menu' };
  let error: string | null = null;
  let seconds = 0;
  /** Words whose meaning the learner has tapped to see; kept as the transcript grows. */
  let revealed = new Set<string>();
  /** The transcript's bubbles, one per turn, updated in place as pieces arrive. */
  let log: HTMLElement | null = null;
  /** Kept across redraws, so the visual keeps running when the screen changes around it. */
  const canvas = h('canvas', { class: 'talk-backdrop', 'aria-hidden': 'true' }) as HTMLCanvasElement;

  async function begin(): Promise<void> {
    const key = getApiKey();
    if (!key) return;
    hangUpTalk();
    const mine = generation;
    const current = () => mine === generation;
    plan = talkPlan(app.progress, topicId);
    turns = [];
    error = null;
    seconds = 0;
    revealed = new Set();
    state = { name: 'connecting' };
    // Made in the tap, before anything is awaited, so the browser lets its audio run.
    const visual = deps.visualizer(canvas);
    activeVisual = visual;
    draw();
    try {
      const call = await startCall(key, { instructions: talkInstructions(plan, new Date(app.now())), greeting: talkGreeting(plan), voice: getTalkVoice() }, {
        onStarted: () => {
          if (!current() || state.name !== 'connecting') return;
          state = { name: 'call', muted: false };
          draw();
        },
        onTranscript: (who, text, start, end) => {
          if (!current()) return;
          const { index, added } = addPiece(turns, who, text, start, end);
          if (state.name === 'connecting') {
            state = { name: 'call', muted: false };
            draw();
          } else showTurn(index, added);
        },
        onUsage: (s) => {
          if (!current()) return;
          seconds = s;
          const meter = root.querySelector('.talk-meter');
          if (meter) meter.textContent = meterText();
        },
        onAudio: (who, stream) => {
          if (current()) visual.listen(who, stream);
        },
        onEnded: (e) => {
          if (!current()) return;
          activeCall = null;
          visual.stop();
          activeVisual = null;
          if (e) error = errorText(e);
          state = { name: 'ended' };
          draw();
        },
      }, deps.call);
      // Ended, left or restarted while it was connecting.
      if (current()) activeCall = call;
      else call.hangUp();
    } catch (e) {
      if (!current()) return;
      visual.stop();
      activeVisual = null;
      error = errorText(e);
      state = { name: 'ended' };
      draw();
    }
  }

  function end(): void {
    hangUpTalk();
    state = { name: 'ended' };
    draw();
  }

  function leave(): void {
    hangUpTalk();
    app.navigate({ name: 'home' });
  }

  function meterText(): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const time = `${m}:${String(s).padStart(2, '0')}`;
    return seconds > 0 ? `${time} · about ${Math.ceil((seconds / 60) * CENTS_PER_MINUTE)}¢` : time;
  }

  function draw(): void {
    // The transcript scrolls by itself: keep the learner's place, or keep following the newest words.
    const before = log as HTMLElement | null;
    const follow = !before || atEnd(before);
    const top = before?.scrollTop ?? 0;
    log = null;
    if (!getApiKey()) root.replaceChildren(setup());
    else if (state.name === 'menu') root.replaceChildren(menu());
    else {
      root.replaceChildren(conversation());
      const now = log as HTMLElement | null;
      if (now) now.scrollTop = follow ? now.scrollHeight : top;
    }
  }

  /** Whether the transcript is scrolled to its newest words, give or take a line. */
  function atEnd(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  /** Show a turn that changed, without redrawing the rest of the screen under the learner's finger. */
  function showTurn(index: number, added: boolean): void {
    if (!log) return;
    const follow = atEnd(log);
    const el = bubble(turns[index]);
    if (added) log.insertBefore(el, log.children[index] ?? null);
    else log.children[index]?.replaceWith(el);
    if (follow) log.scrollTop = log.scrollHeight;
  }

  function header(title: string, extra?: HTMLElement): HTMLElement {
    return h(
      'header',
      { class: 'session-header' },
      h('button', { class: 'icon-btn', 'aria-label': 'Leave Chat', onclick: leave }, icon('close')),
      h('span', { class: 'session-count' }, title),
      extra,
    );
  }

  function setup(): HTMLElement {
    return h('div', null, header('Chat'), h('section', { class: 'card' }, h('h2', null, 'Connect OpenAI'), keyForm(draw)));
  }

  function menu(): HTMLElement {
    if (plan.known.length < MIN_WORDS) {
      return h(
        'div',
        null,
        header('Chat'),
        h(
          'section',
          { class: 'card center' },
          h('p', null, `Learn at least ${MIN_WORDS} words first. Chat mixes the words you know into the conversation.`),
          h('button', { class: 'btn primary', onclick: () => app.navigate({ name: 'study' }) }, 'Go to Study'),
        ),
      );
    }
    const canCall = deps.callSupported();
    return h(
      'div',
      null,
      header('Chat'),
      h(
        'p',
        { class: 'muted' },
        `A conversation in English with your ${plan.known.length} Tagalog words mixed in${plan.newWord ? ', plus one new one' : ''}. The firmer you know a word, the more it comes up. Chat doesn't change your review schedule.`,
      ),
      h('h2', { class: 'talk-label' }, 'Chat about'),
      h(
        'div',
        { class: 'talk-topics', role: 'radiogroup', 'aria-label': 'Topic' },
        [{ id: null, title: 'Anything' }, ...talkTopics(app.progress)].map((t) =>
          h(
            'button',
            {
              role: 'radio',
              'aria-checked': String(topicId === t.id),
              class: `chip ${topicId === t.id ? 'selected' : ''}`,
              onclick: () => {
                topicId = t.id;
                plan = talkPlan(app.progress, topicId);
                draw();
              },
            },
            t.title,
          ),
        ),
      ),
      plan.newWord && h('p', { class: 'muted small' }, 'New word this time: ', h('strong', { lang: 'fil' }, plan.newWord.tl), ` (${plan.newWord.en})`),
      h('button', { class: 'btn primary big', disabled: !canCall, onclick: () => void begin() }, icon('mic'), ' Start talking'),
      h(
        'p',
        { class: 'muted small center' },
        canCall
          ? `Spoken with GPT-Live, about ${CENTS_PER_MINUTE}¢ a minute on your OpenAI key. Calls end after ${MAX_CALL_SECONDS / 60} minutes.`
          : "This browser can't use the microphone for calls. Try Safari or Chrome.",
      ),
    );
  }

  function conversation(): HTMLElement {
    const live = state.name === 'call' || state.name === 'connecting';
    const status = state.name === 'connecting' ? 'Connecting…' : state.name === 'call' ? (state.muted ? 'Muted' : 'Listening. Just talk.') : null;
    log = h('div', { class: 'talk-log', 'aria-live': 'polite' }, turns.map(bubble));
    return h(
      'div',
      { class: 'talk-chat' },
      live && canvas,
      header('Talking', h('span', { class: 'session-title talk-meter' }, meterText())),
      log,
      status && h('p', { class: 'talk-status' }, status),
      error && h('div', { class: 'feedback bad', role: 'alert' }, error),
      h('p', { class: 'muted small talk-help' }, 'Tap a Tagalog word to hear it and see what it means.'),
      live &&
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: 'btn secondary',
              disabled: state.name !== 'call',
              'aria-pressed': state.name === 'call' && state.muted ? 'true' : 'false',
              onclick: () => {
                if (state.name !== 'call') return;
                state = { name: 'call', muted: !state.muted };
                activeCall?.setMuted(state.muted);
                activeVisual?.setMuted(state.muted);
                draw();
              },
            },
            state.name === 'call' && state.muted ? 'Unmute' : 'Mute',
          ),
          h('button', { class: 'btn danger', onclick: end }, 'End call'),
        ),
      state.name === 'ended' &&
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn secondary', onclick: () => { state = { name: 'menu' }; draw(); } }, 'Change topic'),
          h('button', { class: 'btn primary', onclick: () => void begin() }, 'Chat again'),
        ),
    );
  }

  function bubble(turn: SpokenTurn): HTMLElement {
    if (turn.who === 'you') return h('p', { class: 'bubble you' }, turn.text);
    return h(
      'p',
      { class: 'bubble ai' },
      findWords(turn.text, plan).map((s) => ('card' in s ? word(s.text, s.card, s.strength) : s.text)),
    );
  }

  function word(text: string, card: TalkPlan['known'][number]['card'], strength: string): HTMLElement {
    // The AI says the meaning of new words aloud, so here meanings wait for a tap.
    const meaning = h('span', { class: 'gloss', hidden: !revealed.has(card.id) }, ` (${card.en})`);
    return h(
      'span',
      { class: `tl-word w-${strength}` },
      h(
        'button',
        {
          lang: 'fil',
          title: card.en,
          onclick: () => {
            meaning.hidden = false;
            revealed.add(card.id);
            // While the call is on, the AI's voice is playing; don't talk over it.
            if (!activeCall) void play(card);
          },
        },
        text,
      ),
      meaning,
    );
  }

  draw();
  return root;
}

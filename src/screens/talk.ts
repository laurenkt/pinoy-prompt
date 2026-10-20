import type { App } from '../app';
import {
  browserCallDeps,
  callSupported,
  errorText,
  getApiKey,
  MAX_CALL_SECONDS,
  startCall,
  type Call,
  type CallDeps,
  type ChatTurn,
} from '../openai';
import { play } from '../speech';
import { findWords, talkInstructions, talkPlan, talkTopics, type TalkPlan } from '../talk';
import { h, icon } from '../ui';
import { keyForm } from './settings';

export interface TalkDeps {
  call: CallDeps;
  callSupported(): boolean;
}

export const defaultTalkDeps: TalkDeps = { call: browserCallDeps, callSupported };

const MIN_WORDS = 4;
/** GPT-Live's price per minute, in US cents. */
const CENTS_PER_MINUTE = 5;

let activeCall: Call | null = null;

/** End a spoken conversation that's still going, as when leaving the screen. */
export function hangUpTalk(): void {
  activeCall?.hangUp();
  activeCall = null;
}

type State =
  | { name: 'menu' }
  | { name: 'connecting' }
  | { name: 'call'; muted: boolean }
  | { name: 'ended' };

export function talkScreen(app: App, deps: TalkDeps = defaultTalkDeps): HTMLElement {
  const root = h('div', { class: 'talk' });
  let topicId: string | null = null;
  let plan: TalkPlan = talkPlan(app.progress, null);
  let turns: ChatTurn[] = [];
  let state: State = { name: 'menu' };
  let error: string | null = null;
  let seconds = 0;
  /** Words whose meaning the learner has tapped to see; kept as the transcript redraws. */
  let revealed = new Set<string>();

  function begin(): void {
    plan = talkPlan(app.progress, topicId);
    turns = [];
    error = null;
    seconds = 0;
    revealed = new Set();
    void call();
  }

  async function call(): Promise<void> {
    const key = getApiKey();
    if (!key) return;
    state = { name: 'connecting' };
    draw();
    try {
      activeCall = await startCall(key, talkInstructions(plan), {
        onStarted: () => {
          if (state.name === 'connecting') state = { name: 'call', muted: false };
          draw();
        },
        onTranscript: (who, text) => {
          addSpeech(who, text);
          if (state.name === 'connecting') state = { name: 'call', muted: false };
          draw();
        },
        onUsage: (s) => {
          seconds = s;
          const meter = root.querySelector('.talk-meter');
          if (meter) meter.textContent = meterText();
        },
        onEnded: (e) => {
          activeCall = null;
          if (state.name === 'menu') return;
          if (e) error = errorText(e);
          state = { name: 'ended' };
          draw();
        },
      }, deps.call);
      // Ended or left while it was connecting.
      const now = state as State;
      if (now.name !== 'connecting' && now.name !== 'call') hangUpTalk();
    } catch (e) {
      activeCall = null;
      error = errorText(e);
      state = { name: 'ended' };
      draw();
    }
  }

  /** Transcripts arrive in pieces; a piece from the same speaker continues their turn. */
  function addSpeech(who: ChatTurn['who'], text: string): void {
    const last = turns[turns.length - 1];
    if (last?.who === who) last.text += text;
    else turns.push({ who, text: text.trimStart() });
  }

  function leave(): void {
    state = { name: 'menu' };
    hangUpTalk();
    app.navigate({ name: 'practice' });
  }

  function meterText(): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const cents = Math.max(1, Math.ceil((seconds / 60) * CENTS_PER_MINUTE));
    return `${m}:${String(s).padStart(2, '0')} · about ${cents}¢`;
  }

  function draw(): void {
    if (!getApiKey()) root.replaceChildren(setup());
    else if (state.name === 'menu') root.replaceChildren(menu());
    else root.replaceChildren(conversation());
    const log = root.querySelector('.talk-log');
    log?.lastElementChild?.scrollIntoView?.({ block: 'end' });
  }

  function header(title: string, extra?: HTMLElement): HTMLElement {
    return h(
      'header',
      { class: 'session-header' },
      h('button', { class: 'icon-btn', 'aria-label': 'Leave Talk', onclick: leave }, icon('close')),
      h('span', { class: 'session-count' }, title),
      extra,
    );
  }

  function setup(): HTMLElement {
    return h(
      'div',
      null,
      header('Talk'),
      h('section', { class: 'card' }, h('h2', null, 'Connect OpenAI'), keyForm(draw)),
    );
  }

  function menu(): HTMLElement {
    const topics = talkTopics(app.progress);
    if (plan.known.length < MIN_WORDS) {
      return h(
        'div',
        null,
        header('Talk'),
        h(
          'section',
          { class: 'card center' },
          h('p', null, `Learn at least ${MIN_WORDS} words first. Talk mixes the words you know into the conversation.`),
          h('button', { class: 'btn primary', onclick: () => app.navigate({ name: 'home' }) }, 'Go to Study'),
        ),
      );
    }
    const canCall = deps.callSupported();
    return h(
      'div',
      null,
      header('Talk'),
      h(
        'p',
        { class: 'muted' },
        `A conversation in English with your ${plan.known.length} Tagalog words mixed in, plus one new one. The firmer you know a word, the more it comes up. Talk doesn't change your review schedule.`,
      ),
      h('h2', { class: 'talk-label' }, 'Talk about'),
      h(
        'div',
        { class: 'talk-topics', role: 'radiogroup', 'aria-label': 'Topic' },
        [{ id: null, title: 'Anything' }, ...topics].map((t) =>
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
      h(
        'button',
        { class: 'btn primary big', disabled: !canCall, onclick: begin },
        icon('mic'),
        ' Start talking',
      ),
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
    const status =
      state.name === 'connecting'
        ? 'Connecting…'
        : state.name === 'call'
          ? state.muted
            ? 'Muted'
            : 'Listening. Just talk.'
          : null;
    return h(
      'div',
      { class: 'talk-chat' },
      header('Talking', h('span', { class: 'session-title talk-meter' }, meterText())),
      h(
        'div',
        { class: 'talk-log', 'aria-live': 'polite' },
        turns.map((t) => bubble(t)),
        status && h('p', { class: 'talk-status' }, status),
      ),
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
                draw();
              },
            },
            state.name === 'call' && state.muted ? 'Unmute' : 'Mute',
          ),
          h(
            'button',
            {
              class: 'btn danger',
              onclick: () => {
                if (activeCall) return hangUpTalk();
                state = { name: 'ended' };
                draw();
              },
            },
            'End call',
          ),
        ),
      state.name === 'ended' &&
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn secondary', onclick: () => { state = { name: 'menu' }; draw(); } }, 'Change topic'),
          h('button', { class: 'btn primary', onclick: () => begin() }, 'Talk again'),
        ),
    );
  }

  function bubble(turn: ChatTurn): HTMLElement {
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

import type { App } from '../app';
import {
  browserCallDeps,
  callSupported,
  errorText,
  getApiKey,
  MAX_CALL_SECONDS,
  startCall,
  textReply,
  type Call,
  type CallDeps,
  type ChatTurn,
} from '../openai';
import { play } from '../speech';
import { findWords, talkInstructions, talkPlan, talkTopics, type TalkMode, type TalkPlan } from '../talk';
import { h, icon } from '../ui';
import { keyForm } from './settings';

export interface TalkDeps {
  textReply: typeof textReply;
  call: CallDeps;
  callSupported(): boolean;
}

export const defaultTalkDeps: TalkDeps = { textReply, call: browserCallDeps, callSupported };

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
  | { name: 'text'; waiting: boolean }
  | { name: 'ended' };

export function talkScreen(app: App, deps: TalkDeps = defaultTalkDeps): HTMLElement {
  const root = h('div', { class: 'talk' });
  let topicId: string | null = null;
  let plan: TalkPlan = talkPlan(app.progress, null);
  let mode: TalkMode = 'voice';
  let turns: ChatTurn[] = [];
  let state: State = { name: 'menu' };
  let error: string | null = null;
  let seconds = 0;
  let draft = '';

  function begin(chosen: TalkMode): void {
    mode = chosen;
    plan = talkPlan(app.progress, topicId);
    turns = [];
    error = null;
    seconds = 0;
    if (mode === 'voice') void call();
    else {
      state = { name: 'text', waiting: true };
      draw();
      void reply();
    }
  }

  async function call(): Promise<void> {
    const key = getApiKey();
    if (!key) return;
    state = { name: 'connecting' };
    draw();
    try {
      activeCall = await startCall(key, talkInstructions(plan, 'voice'), {
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

  async function reply(): Promise<void> {
    const key = getApiKey();
    if (!key) return;
    try {
      const text = await deps.textReply(key, talkInstructions(plan, 'text'), turns.slice());
      turns.push({ who: 'ai', text });
      error = null;
    } catch (e) {
      error = errorText(e);
    }
    if (state.name === 'text') state = { name: 'text', waiting: false };
    draw();
  }

  function send(): void {
    const text = draft.trim();
    if (!text || state.name !== 'text' || state.waiting) return;
    turns.push({ who: 'you', text });
    draft = '';
    state = { name: 'text', waiting: true };
    draw();
    void reply();
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
    const hadFocus = document.activeElement?.classList.contains('talk-input');
    if (!getApiKey()) root.replaceChildren(setup());
    else if (state.name === 'menu') root.replaceChildren(menu());
    else root.replaceChildren(conversation());
    const log = root.querySelector('.talk-log');
    log?.lastElementChild?.scrollIntoView?.({ block: 'end' });
    if (hadFocus) root.querySelector<HTMLElement>('.talk-input')?.focus();
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
        { class: 'btn primary big', disabled: !canCall, onclick: () => begin('voice') },
        icon('mic'),
        ' Start talking',
      ),
      h(
        'p',
        { class: 'muted small center' },
        canCall
          ? `Spoken with GPT-Live, about ${CENTS_PER_MINUTE}¢ a minute on your OpenAI key. Calls end after ${MAX_CALL_SECONDS / 60} minutes.`
          : "This browser can't make calls from the microphone. You can still type.",
      ),
      h('button', { class: 'btn secondary talk-type', onclick: () => begin('text') }, 'Type instead'),
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
          : state.name === 'text' && state.waiting
            ? 'Typing…'
            : null;
    return h(
      'div',
      { class: 'talk-chat' },
      header(mode === 'voice' ? 'Talking' : 'Chat', mode === 'voice' ? h('span', { class: 'session-title talk-meter' }, meterText()) : undefined),
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
      state.name === 'text' && composer(),
      state.name === 'ended' &&
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn secondary', onclick: () => { state = { name: 'menu' }; draw(); } }, 'Change topic'),
          h('button', { class: 'btn primary', onclick: () => begin(mode) }, mode === 'voice' ? 'Talk again' : 'Chat again'),
        ),
    );
  }

  function composer(): HTMLElement {
    const input = h('textarea', {
      class: 'talk-input',
      rows: 2,
      placeholder: 'Reply in English, Tagalog or both',
      'aria-label': 'Your reply',
      lang: 'fil',
    });
    input.value = draft;
    input.addEventListener('input', () => (draft = input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    const waiting = state.name === 'text' && state.waiting;
    return h(
      'form',
      { class: 'talk-composer', onsubmit: (e: Event) => { e.preventDefault(); send(); } },
      input,
      h('button', { class: 'btn primary', type: 'submit', disabled: waiting }, 'Send'),
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
    // Words met in the last day, and the new one, show their meaning straight away.
    const open = strength === 'new' || strength === 'unseen';
    const meaning = h('span', { class: 'gloss', hidden: !open }, ` (${card.en})`);
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

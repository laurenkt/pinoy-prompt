// A tiny helper for building DOM elements, so screens read like markup
// without pulling in a framework.

import { speaking } from './speech';

type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : String(child));
  }
}

/** The same for SVG elements, which need their namespace. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  ...children: (SVGElement | string)[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

const ICONS = {
  speaker: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  cards: '<rect x="3" y="7" width="13" height="14" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
  quiet: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 3l16 18"/>',
};

export type IconName = keyof typeof ICONS;

/** A decorative stroke icon that takes the text color. */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

/** The audio button whose word is playing, lit until the word ends or another starts. */
let lit: HTMLButtonElement | null = null;
/** A tap lights its button for at least this long, so it shows even when there's nothing to hear. */
const LIGHT_AT_LEAST_MS = 400;
/** Bumped by each tap, so only the latest tap's check can put the light out. */
let lighting = 0;

function lightWhilePlaying(button: HTMLButtonElement): void {
  lit?.classList.remove('playing');
  lit = button;
  button.classList.add('playing');
  const from = performance.now();
  const mine = ++lighting;
  const check = () => {
    if (mine !== lighting) return;
    if (button.isConnected && (speaking() || performance.now() - from < LIGHT_AT_LEAST_MS)) {
      requestAnimationFrame(check);
      return;
    }
    button.classList.remove('playing');
    lit = null;
  };
  requestAnimationFrame(check);
}

/** A speaker button that plays a card's audio, lit while it plays; the slow one is labelled 0.5×. */
export function audioButton(onPlay: () => void, label = 'Play audio', extraClass = ''): HTMLButtonElement {
  const button: HTMLButtonElement = h(
    'button',
    {
      class: `audio-btn ${extraClass}`.trim(),
      'aria-label': label,
      title: label,
      onclick: () => {
        onPlay();
        lightWhilePlaying(button);
      },
    },
    extraClass.includes('slow') ? h('span', { 'aria-hidden': 'true' }, '0.5×') : icon('speaker'),
  );
  return button;
}

/** A word's play and play-slowly buttons; `big` for a question that is only heard. */
export function audioPair(say: (slow: boolean) => void, big = false): HTMLElement {
  return h(
    'div',
    { class: `audio-group${big ? ' big' : ''}` },
    big ? audioButton(() => say(false), 'Play again', 'huge') : audioButton(() => say(false)),
    audioButton(() => say(true), 'Play slowly', 'slow'),
  );
}

/**
 * Numbered answer buttons. Once one is picked, all are disabled, the answer is
 * marked right and a wrong pick is marked wrong. Keys 1–n are the screen's to handle.
 */
export function choiceList<T>(
  choices: T[],
  { key, label, answer, picked, lang, onPick }: { key: (c: T) => string; label: (c: T) => string; answer: string; picked: string | null; lang?: string; onPick: (c: T) => void },
): HTMLElement {
  const answered = picked !== null;
  return h(
    'div',
    { class: 'choices' },
    choices.map((choice, i) =>
      h(
        'button',
        {
          class: `choice ${answered && key(choice) === answer ? 'correct' : ''} ${answered && key(choice) === picked && picked !== answer ? 'wrong' : ''}`,
          disabled: answered,
          'data-autofocus': (!answered && i === 0) || undefined,
          lang,
          onclick: () => onPick(choice),
        },
        h('span', { class: 'key', 'aria-hidden': 'true' }, i + 1),
        label(choice),
      ),
    ),
  );
}

/** The top of a page opened from Home: the back arrow, then the title and any one control beside it. */
export function pageHeader(title: string, onBack: () => void, action?: Node | false | null): HTMLElement[] {
  return [
    h('nav', { class: 'back-bar' }, h('button', { class: 'icon-btn', 'aria-label': 'Home', title: 'Home', onclick: onBack }, icon('back'))),
    h('header', { class: 'page-header' }, h('h1', null, title), action),
  ];
}

export function progressBar(value: number, max: number, label?: string): HTMLElement {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return h(
    'div',
    { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': value, 'aria-label': label },
    h('div', { class: 'bar-fill', style: { width: `${pct}%` } }),
  );
}

/** A card's memory hook, for the moments it helps: introduction and after a miss. */
export function hookView(card: { hook: string }): HTMLElement {
  return h('div', { class: 'hook' }, h('p', { class: 'hook-label' }, 'Remember it by'), h('p', null, card.hook));
}

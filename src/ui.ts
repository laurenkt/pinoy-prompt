// A tiny helper for building DOM elements, so screens read like markup
// without pulling in a framework.

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

/** A round speaker button that plays a card's audio. */
export function audioButton(onPlay: () => void, label = 'Play audio', extraClass = ''): HTMLButtonElement {
  return h(
    'button',
    { class: `audio-btn ${extraClass}`.trim(), 'aria-label': label, title: label, onclick: onPlay },
    h('span', { 'aria-hidden': 'true' }, extraClass.includes('slow') ? '🐢' : '🔊'),
  );
}

export function progressBar(value: number, max: number, label?: string): HTMLElement {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return h(
    'div',
    { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': value, 'aria-label': label },
    h('div', { class: 'bar-fill', style: { width: `${pct}%` } }),
  );
}

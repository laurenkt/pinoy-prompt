import type { App } from '../app';
import { UNITS, type Card, type CardKind } from '../deck';
import { GUIDES, KIND_INFO } from '../guides';
import { STRENGTHS, strengthCounts, strengthOf } from '../memory';
import { play } from '../speech';
import { audioButton, chip, h, icon, pageHeader } from '../ui';

const STRENGTH_LABEL = new Map(STRENGTHS.map((s) => [s.id, s.label]));

type Filter = 'all' | 'vocab' | Exclude<CardKind, 'word' | 'phrase'>;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'vocab', label: 'Words & phrases' },
  { id: 'pattern', label: KIND_INFO.pattern.label },
  { id: 'sound', label: KIND_INFO.sound.label },
  { id: 'tune', label: KIND_INFO.tune.label },
  { id: 'knowhow', label: KIND_INFO.knowhow.label },
];

/** Kept across visits, so the Library opens where the learner left it. */
let filter: Filter = 'all';

/** Everything there is to learn: words and phrases by topic, then the guides by kind. Tap any card to hear it, learned or not. */
export function wordsScreen(app: App): HTMLElement {
  const root = h('div', { class: 'words' });
  // The filters stay tucked away until asked for, so the list starts near the top.
  let filtersOpen = false;

  function badge(card: Card): HTMLElement | null {
    const state = app.progress.cards[card.id];
    const strength = state && strengthOf(state);
    return strength ? h('span', { class: `badge s-${strength}` }, STRENGTH_LABEL.get(strength)) : null;
  }

  function wordItem(card: Card): HTMLElement {
    return h(
      'li',
      { class: `word ${app.progress.cards[card.id] ? '' : 'unseen'}` },
      audioButton(() => void play(card), `Play ${card.tl}`),
      h(
        'div',
        { class: 'word-text' },
        h('span', { class: 'word-tl', lang: 'fil' }, card.tl, ' ', badge(card)),
        h('span', { class: 'word-en' }, card.en),
        card.hint && h('span', { class: 'word-hint' }, card.hint),
        h('span', { class: 'word-hook' }, card.hook),
      ),
    );
  }

  /** A guide shows its rule once met; before that, just its name, so it's still a surprise worth meeting. */
  function guideItem(card: Card): HTMLElement {
    const met = !!app.progress.cards[card.id];
    return h(
      'li',
      { class: `word guide ${met ? '' : 'unseen'}` },
      h(
        'div',
        { class: 'word-text' },
        h('span', { class: 'word-tl' }, card.en, ' ', badge(card)),
        met ? h('span', { class: 'word-en' }, card.note) : h('span', { class: 'word-hook' }, 'Not met yet. It comes once you know the words it builds on.'),
        met &&
          card.examples?.map((ex) =>
            h('span', { class: 'guide-example' }, audioButton(() => void play(ex), `Play ${ex.tl}`), h('span', { lang: 'fil' }, ex.tl), ' ', h('span', { class: 'muted' }, ex.en)),
          ),
      ),
    );
  }

  /**
   * A strip along the bottom of a topic's heading: its cards by strength, as
   * on Home's memory chart, firmest first, with the rest left empty. It sits in
   * the heading's padding, so a topic takes no more room than without it.
   */
  function memoryStrip(cards: Card[]): HTMLElement {
    const counts = strengthCounts(app.progress, cards);
    const met = STRENGTHS.reduce((sum, s) => sum + counts[s.id], 0);
    const label = met
      ? `${met} of ${cards.length} met: ${STRENGTHS.filter((s) => counts[s.id]).map((s) => `${counts[s.id]} ${s.label}`).join(', ')}`
      : `None of ${cards.length} met yet`;
    return h(
      'span',
      { class: 'memory-strip', role: 'img', 'aria-label': label },
      [...STRENGTHS].reverse().map((s) =>
        counts[s.id] ? h('span', { class: `s-${s.id}`, style: { width: `${(counts[s.id] / cards.length) * 100}%` } }) : null,
      ),
    );
  }

  function group(title: string, sub: string | null, cards: Card[], item: (card: Card) => HTMLElement): HTMLElement {
    return h(
      'details',
      // Narrowed to one kind of guide, there is only one group, so it opens straight away.
      { class: 'card unit-list', open: filter !== 'all' && filter !== 'vocab' },
      h('summary', null, h('span', { class: 'unit-body' }, h('span', { class: 'unit-title' }, title), sub && h('span', { class: 'unit-tl' }, sub)), memoryStrip(cards)),
      h('ul', { class: 'word-list' }, cards.map(item)),
    );
  }

  function draw(): void {
    const showVocab = filter === 'all' || filter === 'vocab';
    const kinds = (['pattern', 'sound', 'tune', 'knowhow'] as const).filter((k) => filter === 'all' || filter === k);
    const current = FILTERS.find((f) => f.id === filter)!;
    const chips = h(
      'div',
      { class: 'chips', id: 'library-filters', role: 'group', 'aria-label': 'Show', hidden: !filtersOpen },
      FILTERS.map((f) =>
        chip(f.label, filter === f.id, {
          onclick: () => {
            filter = f.id;
            filtersOpen = false;
            draw();
            root.querySelector<HTMLButtonElement>('.filter-toggle')!.focus();
          },
        }),
      ),
    );
    // Opening and closing only shows the chips, so open topics and the scroll position stay put.
    const toggle = h(
      'button',
      {
        class: 'chip filter-toggle',
        'aria-expanded': String(filtersOpen),
        'aria-controls': 'library-filters',
        onclick: () => {
          filtersOpen = !filtersOpen;
          chips.hidden = !filtersOpen;
          toggle.setAttribute('aria-expanded', String(filtersOpen));
        },
      },
      icon('filter'),
      current.label,
    );
    root.replaceChildren(
      ...pageHeader('Library', () => app.navigate({ name: 'home' }), toggle),
      chips,
      h('p', { class: 'muted' }, 'Tap the speaker to hear any word.'),
      ...(showVocab ? UNITS.map((unit) => group(unit.title, unit.tlTitle, unit.cards, wordItem)) : []),
      ...kinds.map((k) => group(KIND_INFO[k].label, null, GUIDES.filter((g) => g.kind === k), guideItem)),
    );
  }

  draw();
  return root;
}

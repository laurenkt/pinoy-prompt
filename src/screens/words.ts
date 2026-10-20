import type { App } from '../app';
import { UNITS, type Card, type CardKind } from '../deck';
import { GUIDES, KIND_INFO } from '../guides';
import { STRENGTHS, strengthOf } from '../memory';
import { play } from '../speech';
import { audioButton, h } from '../ui';

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

  function group(title: string, sub: string | null, items: HTMLElement[]): HTMLElement {
    return h(
      'details',
      // Narrowed to one kind of guide, there is only one group, so it opens straight away.
      { class: 'card unit-list', open: filter !== 'all' && filter !== 'vocab' },
      h('summary', null, h('span', { class: 'unit-body' }, h('span', { class: 'unit-title' }, title), sub && h('span', { class: 'unit-tl' }, sub))),
      h('ul', { class: 'word-list' }, items),
    );
  }

  function draw(): void {
    const showVocab = filter === 'all' || filter === 'vocab';
    const kinds = (['pattern', 'sound', 'tune', 'knowhow'] as const).filter((k) => filter === 'all' || filter === k);
    root.replaceChildren(
      h('h1', null, 'Library'),
      h('p', { class: 'muted' }, 'Everything there is to learn. Tap the speaker to hear anything, even words you have not met yet. Each card you know shows how firmly it is stored.'),
      h(
        'div',
        { class: 'chips', role: 'group', 'aria-label': 'Show' },
        FILTERS.map((f) =>
          h(
            'button',
            {
              class: `chip ${filter === f.id ? 'selected' : ''}`,
              'aria-pressed': String(filter === f.id),
              onclick: () => {
                filter = f.id;
                draw();
              },
            },
            f.label,
          ),
        ),
      ),
      ...(showVocab ? UNITS.map((unit) => group(unit.title, unit.tlTitle, unit.cards.map(wordItem))) : []),
      ...kinds.map((k) => group(KIND_INFO[k].label, null, GUIDES.filter((g) => g.kind === k).map(guideItem))),
    );
  }

  draw();
  return root;
}

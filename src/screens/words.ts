import type { App } from '../app';
import { UNITS } from '../deck';
import { STRENGTHS, strengthOf } from '../memory';
import { play } from '../speech';
import { audioButton, h } from '../ui';

const STRENGTH_LABEL = new Map(STRENGTHS.map((s) => [s.id, s.label]));

/** A phrasebook by topic. Tap any card to hear it, learned or not. */
export function wordsScreen(app: App): HTMLElement {
  const { progress } = app;
  return h(
    'div',
    { class: 'words' },
    h('h1', null, 'Words'),
    h('p', { class: 'muted' }, 'Your phrasebook. Tap the speaker to hear any word, even ones you have not met yet. Each word you know shows how firmly it is stored.'),
    UNITS.map((unit) =>
      h(
        'details',
        { class: 'card unit-list' },
        h(
          'summary',
          null,
          h('span', { class: 'unit-body' }, h('span', { class: 'unit-title' }, unit.title), h('span', { class: 'unit-tl' }, unit.tlTitle)),
        ),
        h(
          'ul',
          { class: 'word-list' },
          unit.cards.map((card) => {
            const state = progress.cards[card.id];
            const strength = state && strengthOf(state);
            const badge = strength && h('span', { class: `badge s-${strength}` }, STRENGTH_LABEL.get(strength));
            return h(
              'li',
              { class: `word ${state ? '' : 'unseen'}` },
              audioButton(() => void play(card), `Play ${card.tl}`),
              h(
                'div',
                { class: 'word-text' },
                h('span', { class: 'word-tl', lang: 'fil' }, card.tl, ' ', badge),
                h('span', { class: 'word-en' }, card.en),
                card.hint && h('span', { class: 'word-hint' }, card.hint),
                h('span', { class: 'word-hook' }, card.hook),
              ),
            );
          }),
        ),
      ),
    ),
  );
}

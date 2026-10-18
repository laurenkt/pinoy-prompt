import type { App } from '../app';
import { UNITS } from '../deck';
import { isIntroduced, isUnlocked } from '../session';
import { isMature } from '../srs';
import { play } from '../speech';
import { audioButton, h, icon } from '../ui';

/** A phrasebook of every unit. Tap any card to hear it, learned or not. */
export function wordsScreen(app: App, openUnitId?: string): HTMLElement {
  const { progress } = app;
  const el = h(
    'div',
    { class: 'words' },
    h('h1', null, 'Words'),
    h('p', { class: 'muted' }, 'Your phrasebook. Tap the speaker to hear any word, even ones you have not learned yet.'),
    UNITS.map((unit, i) => {
      const learned = unit.cards.filter((c) => isIntroduced(progress, c.id)).length;
      return h(
        'details',
        { class: 'card unit-list', id: `unit-${unit.id}`, open: unit.id === openUnitId || undefined },
        h(
          'summary',
          null,
          h('span', { class: 'unit-num', 'aria-hidden': 'true' }, i + 1),
          h('span', { class: 'unit-body' }, h('span', { class: 'unit-title' }, unit.title), h('span', { class: 'unit-tl' }, unit.tlTitle)),
          h('span', { class: 'unit-count' }, isUnlocked(progress, i) ? `${learned}/${unit.cards.length}` : h('span', { role: 'img', 'aria-label': 'Locked' }, icon('lock'))),
        ),
        h(
          'ul',
          { class: 'word-list' },
          unit.cards.map((card) => {
            const state = progress.cards[card.id];
            const badge = !state ? null : isMature(state) ? h('span', { class: 'badge known' }, 'known') : h('span', { class: 'badge' }, 'learning');
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
              ),
            );
          }),
        ),
      );
    }),
  );
  if (openUnitId) requestAnimationFrame(() => document.getElementById(`unit-${openUnitId}`)?.scrollIntoView({ block: 'start' }));
  return el;
}
